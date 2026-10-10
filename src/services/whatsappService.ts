/**
 * Frontend WhatsApp Service (Baileys Integration Client)
 */

import { formatIndonesianDate } from '../utils/dateTimeUtils';
import { isDummyOrRemovedTechnician } from '../utils/entityLookup';
import { PreventiveEntry, Equipment, EquipmentType, Location } from '../types';
import { getAuthHeaders } from './authService';

export interface WhatsAppConfig {
  enabled: boolean;
  target_jid: string;
  auto_notify_preventive: boolean;
  auto_notify_attendance: boolean;
  auto_notify_export: boolean;
  recipient_name?: string;
}

export interface WhatsAppStatusResponse {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'logged_out';
  qrDataUrl: string | null;
  pairingCode: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  lastConnected: string | null;
  config: WhatsAppConfig;
}

export type WhatsAppStatus = WhatsAppStatusResponse;

/**
 * Fetch current WhatsApp status from backend
 */
export async function getWhatsAppStatus(): Promise<WhatsAppStatusResponse> {
  const auth = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/status', { headers: { ...auth } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gagal memeriksa status WhatsApp (${res.status})`);
  }
  return res.json();
}

/**
 * Trigger connection / QR regeneration
 */
export async function connectWhatsApp(): Promise<WhatsAppStatusResponse> {
  const auth = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/connect', { method: 'POST', headers: { ...auth } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gagal memulai koneksi WhatsApp (${res.status})`);
  }
  return res.json();
}

/**
 * Request an 8-character pairing code
 */
export async function requestPairingCode(phoneNumber: string): Promise<{ code: string }> {
  const auth = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/pairing-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gagal meminta pairing code WhatsApp (${res.status})`);
  }
  return res.json();
}

/**
 * Disconnect / Logout WhatsApp
 */
export async function disconnectWhatsApp(): Promise<{ success: boolean }> {
  const auth = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/disconnect', { method: 'POST', headers: { ...auth } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gagal memutuskan koneksi WhatsApp (${res.status})`);
  }
  return res.json();
}

/**
 * Save WhatsApp Bot Configuration
 */
export async function saveWhatsAppConfig(config: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  const auth = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gagal menyimpan pengaturan WhatsApp (${res.status})`);
  }
  return res.json();
}

/**
 * Send a Test Message via WhatsApp
 */
export async function sendWhatsAppTest(
  targetJid: string,
  message?: string
): Promise<{ success: boolean; message?: string }> {
  const auth = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/send-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      target_jid: targetJid,
      message: message || '🟢 *Tes Koneksi Bot WhatsApp Faskampen Halim Berhasil!*\n\nSistem notifikasi pemeliharaan siap beroperasi.',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Gagal mengirim pesan uji coba WhatsApp (${res.status})`);
  }
  return data;
}

/**
 * Send Attendance Photo & Text via WhatsApp
 */
export async function sendWhatsAppAttendance(params: {
  targetJid?: string;
  photo?: string;
  caption: string;
}): Promise<boolean> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch('/api/whatsapp/send-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        target_jid: params.targetJid,
        photo: params.photo,
        caption: params.caption,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return !!data.success;
  } catch (_) {
    return false;
  }
}

/**
 * Formats WhatsApp text for Preventive Maintenance (uses markdown asterisks for bold)
 */
export function formatPreventiveWhatsAppText(params: {
  entry: PreventiveEntry;
  equipment?: Equipment;
  equipmentType?: EquipmentType;
  location?: Location;
  technicianNames: string[];
}): string {
  const { entry, equipment, equipmentType, location, technicianNames } = params;

  // Jenis Alat
  const jenisAlat =
    equipmentType?.name ||
    (equipment?.equipment_type_id === 1
      ? 'X-Ray System'
      : equipment?.equipment_type_id === 2
      ? 'Walk Through Metal Detector'
      : equipment?.equipment_type_id === 3
      ? 'Hand Held Metal Detector'
      : equipment?.equipment_type_id === 4
      ? 'Explosive Trace Detector'
      : (equipment?.name ? equipment.name.split(' ')[0] : 'X-Ray System'));

  // Tipe / Model Alat (Brand & Model)
  let tipeModel = [equipment?.brand, equipment?.model].filter(Boolean).join(' - ');
  if (equipment?.default_view || equipment?.default_view_type) {
    const viewLabel = (equipment.default_view_type || equipment.default_view) === 'dual' ? 'Dual View' : 'Single View';
    if (!tipeModel.toLowerCase().includes(viewLabel.toLowerCase())) {
      tipeModel = tipeModel ? `${tipeModel} (${viewLabel})` : viewLabel;
    }
  }
  if (!tipeModel.trim()) {
    tipeModel = equipment?.type || '-';
  }

  // Lokasi & Nama Alat
  const locName = location?.name || (equipment?.location_id ? `Lokasi ${equipment.location_id}` : '');
  const eqName = equipment?.name || 'Equipment';
  let alatLokasi = '';
  if (eqName && locName) {
    if (eqName.toLowerCase() === locName.toLowerCase() || eqName.toLowerCase().includes(locName.toLowerCase())) {
      alatLokasi = eqName;
    } else if (locName.toLowerCase().includes(eqName.toLowerCase())) {
      alatLokasi = locName;
    } else {
      alatLokasi = `${eqName} (${locName})`;
    }
  } else {
    alatLokasi = eqName || locName || 'Area Bandara';
  }

  const dateStr = formatIndonesianDate(entry.operational_date || '', { includeDayName: true });
  const techNames = (technicianNames || [])
    .filter((n) => !isDummyOrRemovedTechnician(n))
    .join(', ') || 'Teknisi Jaga';

  const isOk = entry.status === 'OK' || !entry.status;
  const statusResult = isOk ? 'Normal' : 'Tidak Normal';

  let docLink = (entry as any).folder_url || (entry as any).drive_folder_url || (entry as any).collage_url;
  if (!docLink && entry.evidences && entry.evidences.length > 0) {
    docLink = entry.evidences[0].url;
  }
  if (!docLink && (entry as any).folder_path) {
    docLink = `https://is3.cloudhost.id/nti-evidence-storage/${encodeURI((entry as any).folder_path)}`;
  }
  if (!docLink || typeof docLink !== 'string' || !docLink.startsWith('http')) {
    docLink = '-';
  }

  let msg = `*Laporan Preventif Maintenance!*\n`;
  msg += `*Hari, Tanggal* : ${dateStr}\n`;
  msg += `*Teknisi* : ${techNames}\n`;
  msg += `*Jenis Alat* : ${jenisAlat}\n`;
  msg += `*Tipe / Model* : ${tipeModel}\n`;
  msg += `*Lokasi Alat* : ${alatLokasi}\n`;
  msg += `*Hasil* : *${statusResult}*\n`;
  msg += `*Dokumentasi* : ${docLink}\n\n`;
  msg += `*_sent from nararyaapps.net_*`;

  return msg;
}

/**
 * Formats WhatsApp text for Attendance (Presensi Masuk & Pulang)
 */
export function formatAttendanceWhatsAppText(params: {
  technicianName: string;
  attendanceType?: 'masuk' | 'pulang';
  shift: string;
  date: string;
  time: string;
  status: 'ontime' | 'late' | 'very_late' | 'bypassed' | 'off_duty';
  notes?: string;
  checkInTime?: string;
  workDuration?: string;
}): string {
  const {
    technicianName,
    attendanceType = 'masuk',
    shift,
    date,
    time,
    status,
    notes,
    checkInTime,
    workDuration,
  } = params;

  const safeTechName = isDummyOrRemovedTechnician(technicianName) ? 'Teknisi' : technicianName;
  const dateStr = formatIndonesianDate(date, { includeDayName: true });
  const isMasuk = attendanceType !== 'pulang';
  const cleanTime = time.toUpperCase().includes('WIB') ? time : `${time} WIB`;

  if (isMasuk) {
    let msg = `Assalamualaikum, *${safeTechName}* absen masuk !\n`;
    msg += `Jam Absen Masuk : *${cleanTime}*\n`;
    msg += `Tanggal : ${dateStr}\n`;
    msg += `Shift : ${shift}\n`;
    if (status === 'very_late') {
      msg += `🚨 *SANGAT TERLAMBAT*`;
      if (notes && notes.trim()) {
        msg += `\n📝 *Alasan :* _${notes.trim()}_`;
      }
    } else if (status === 'late') {
      msg += `⚠️ *TERLAMBAT*`;
      if (notes && notes.trim()) {
        msg += `\n📝 *Catatan :* _${notes.trim()}_`;
      }
    } else {
      msg += `✅ *HADIR TEPAT WAKTU*`;
    }
    return msg;
  }

  // Absen Pulang
  let cleanCheckIn = checkInTime;
  if (!cleanCheckIn) {
    cleanCheckIn = '- (Tidak tercatat)';
  } else if (!cleanCheckIn.toUpperCase().includes('WIB')) {
    cleanCheckIn = `${cleanCheckIn} WIB`;
  }

  // Calculate work duration from shift start
  let calculatedDuration = workDuration;
  if (!calculatedDuration) {
    if (!checkInTime) {
      calculatedDuration = '- (Tanpa absen masuk)';
    } else {
      try {
        const isMalam = shift.toLowerCase().includes('malam');
        const timeClean = time.replace(/[^\d:.]/g, '').replace('.', ':');
        const [pushedHourStr, pushedMinStr] = timeClean.split(':');
        const endH = parseInt(pushedHourStr || '0', 10);
        const endM = parseInt(pushedMinStr || '0', 10);

        let totalMinutes = 0;
        if (!isMalam) {
          const startTotalMin = 7 * 60;
          const endTotalMin = endH * 60 + endM;
          totalMinutes = Math.max(0, endTotalMin - startTotalMin);
        } else {
          const startTotalMin = 19 * 60;
          let endTotalMin = endH * 60 + endM;
          if (endH < 19) endTotalMin += 24 * 60;
          totalMinutes = Math.max(0, endTotalMin - startTotalMin);
        }

        const durH = Math.floor(totalMinutes / 60);
        const durM = totalMinutes % 60;
        calculatedDuration = `${durH} Jam ${durM} Menit`;
      } catch (_) {
        calculatedDuration = '12 Jam';
      }
    }
  }

  let msg = `Assalamualaikum, *${safeTechName}* absen pulang !\n`;
  msg += `Jam Absen Masuk : *${cleanCheckIn}*\n`;
  msg += `Jam Absen Pulang : *${cleanTime}*\n`;
  msg += `Jam Kerja : *${calculatedDuration}*`;
  return msg;
}

/**
 * Formats WhatsApp text for Corrective Maintenance
 */
export function formatCorrectiveWhatsAppText(params: {
  report: {
    corrective_code?: string;
    problem_description: string;
    action_taken?: string;
    result?: string;
    result_text?: string;
    status?: string;
    operational_date: string;
    shift: string;
    time_start: string;
    time_end?: string;
    notes?: string;
  };
  equipment?: Equipment;
  location?: Location;
  technicianNames?: string[];
  isNew?: boolean;
}): string {
  const { report, equipment, location, technicianNames } = params;

  const dateFormatted = formatIndonesianDate(report.operational_date, { includeDayName: true });
  const shiftText = report.shift ? ` Shift ${report.shift}.` : '.';
  const fullDate = `${dateFormatted}${shiftText}`;

  const cleanTechs = (technicianNames || [])
    .filter((n) => !isDummyOrRemovedTechnician(n))
    .join(', ') || 'Teknisi';

  const formatWibTime = (t?: string) => {
    if (!t || t === '-' || t.trim() === '') return '-';
    const clean = t.trim().replace(':', '.');
    return clean.toUpperCase().includes('WIB') ? clean : `${clean} WIB`;
  };

  const locName = (location?.name || (equipment as any)?.location_name || '').trim();
  const eqName = (equipment?.name || 'Security Equipment').trim();
  let lokasiAlat = '-';
  if (eqName && locName) {
    if (eqName.toLowerCase() === locName.toLowerCase()) {
      lokasiAlat = eqName;
    } else if (eqName.toLowerCase().includes(locName.toLowerCase())) {
      lokasiAlat = eqName;
    } else if (locName.toLowerCase().includes(eqName.toLowerCase())) {
      lokasiAlat = locName;
    } else {
      lokasiAlat = `${eqName} ${locName}`;
    }
  } else {
    lokasiAlat = eqName || locName || '-';
  }

  // Jenis Alat & Tipe/Model
  const jenisAlat = (equipment as any)?.equipment_type_name || (equipment as any)?.type_name || (equipment?.equipment_type_id === 1 ? 'X-Ray System' : equipment?.equipment_type_id === 2 ? 'Walk Through Metal Detector' : equipment?.equipment_type_id === 3 ? 'Hand Held Metal Detector' : equipment?.equipment_type_id === 4 ? 'Explosive Trace Detector' : 'X-Ray System');
  let tipeModel = [equipment?.brand, equipment?.model].filter(Boolean).join(' - ');
  if (equipment?.default_view || equipment?.default_view_type) {
    const viewLabel = (equipment.default_view_type || equipment.default_view) === 'dual' ? 'Dual View' : 'Single View';
    if (!tipeModel.toLowerCase().includes(viewLabel.toLowerCase())) {
      tipeModel = tipeModel ? `${tipeModel} (${viewLabel})` : viewLabel;
    }
  }
  if (!tipeModel.trim()) {
    tipeModel = equipment?.type || '-';
  }

  // Format bullet points for tindakan
  const rawAction = report.action_taken || '-';
  const actionLines = rawAction.split('\n').map((l) => l.trim()).filter(Boolean);
  const formattedAction = actionLines
    .map((l) => (l.startsWith('-') || l.startsWith('•') ? l : `- ${l}`))
    .join('\n');

  const hasilText = report.result_text || report.result || 'Xray sudah bisa di Gunakan dengan Normal.';

  let msg = `*LAPORAN CORRECTIVE MAINTENANCE*\n`;
  msg += `--------------------------\n`;
  msg += `*Hari / Tanggal* : ${fullDate}\n`;
  msg += `*Teknisi* : ${cleanTechs}\n`;
  msg += `*Jam Mulai* : ${formatWibTime(report.time_start)}\n`;
  msg += `*Jam Selesai* : ${formatWibTime(report.time_end)}\n`;
  msg += `*Jenis Alat* : ${jenisAlat}\n`;
  msg += `*Tipe / Model* : ${tipeModel}\n`;
  msg += `*Lokasi Alat* : ${lokasiAlat}\n`;
  msg += `*Uraian Masalah* : \n${report.problem_description || '-'}\n`;
  msg += `*Tindakan* : \n${formattedAction}\n`;
  msg += `*Hasil* : ${hasilText}\n\n`;
  msg += `*_sent from nararyaapps.net_*`;

  return msg;
}

export interface WhatsAppGroupItem {
  id: string;
  subject: string;
  participantsCount: number;
}

/**
 * Fetches participating WhatsApp groups from connected Baileys account
 */
export async function fetchWhatsAppGroups(): Promise<WhatsAppGroupItem[]> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch('/api/whatsapp/groups', { headers: { ...auth } });
    const data = await res.json();
    if (data.success && Array.isArray(data.groups)) {
      return data.groups;
    }
    return [];
  } catch (_) {
    return [];
  }
}

/**
 * Sends a direct text message through the connected WhatsApp Baileys bot
 */
export async function sendWhatsAppDirectText(params: {
  targetJid?: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch('/api/whatsapp/send-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Error HTTP ${res.status} saat mengirim teks WA.` };
    }
    return { success: !!data.success, error: data.error };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Gagal mengirim pesan WhatsApp' };
  }
}

/**
 * Sends a Document (PDF) directly through WhatsApp WAHA endpoint (/api/sendFile)
 */
export async function sendWhatsAppWahaFile(params: {
  chatId?: string;
  file: string; // Base64 Data URL or URL
  filename: string;
  caption?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch('/api/sendFile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        chatId: params.chatId,
        file: params.file,
        filename: params.filename,
        caption: params.caption,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Error HTTP ${res.status} saat mengirim file WAHA.` };
    }
    return { success: !!data.success, error: data.error };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Gagal mengirim file PDF via WAHA' };
  }
}

/**
 * Sends a Document (PDF) directly through WhatsApp Baileys bot
 */
export async function sendWhatsAppDirectDocument(params: {
  targetJid?: string;
  document: string;
  fileName: string;
  caption?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch('/api/whatsapp/send-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        target_jid: params.targetJid,
        document: params.document,
        file_name: params.fileName,
        caption: params.caption,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Error HTTP ${res.status} saat mengirim dokumen WA.` };
    }
    return { success: !!data.success, error: data.error };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Gagal mengirim dokumen PDF ke WhatsApp' };
  }
}

/**
 * Sends a Photo / Collage directly through WhatsApp Baileys bot
 */
export async function sendWhatsAppDirectPhoto(params: {
  targetJid?: string;
  photo: string;
  caption?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch('/api/whatsapp/send-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        target_jid: params.targetJid,
        photo: params.photo,
        caption: params.caption,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Error HTTP ${res.status} saat mengirim foto WA.` };
    }
    return { success: !!data.success, error: data.error };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Gagal mengirim foto ke WhatsApp' };
  }
}

