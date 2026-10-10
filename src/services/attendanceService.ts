import { Technician, AttendanceRecord, AttendanceSessionState, AttendanceVerificationStatus } from '../types';
import { getAuthHeaders } from './authService';
import { ShiftScheduleV2, ScheduleStatus, ON_DUTY_STATUSES } from './scheduleService';
import { getOperationalShift } from '../utils/technicianSchedule';
import { evaluateOperationalPermissions, PermissionCheckResult } from './rbacPermissionService';

const ATTENDANCE_HISTORY_KEY = 'faskampen_attendance_history';

export type AttendanceButtonState =
  | 'OFF'                       // "Libur / Tidak Terjadwal" (disabled)
  | 'SCHEDULED_EARLY'          // "Presensi Belum Dibuka" (disabled)
  | 'CAN_CHECK_IN'             // "Absen Masuk" (active, clickable)
  | 'CHECKED_IN_WAITING'       // "Absen Pulang" (disabled, menunggu window buka)
  | 'CAN_CHECK_OUT'            // "Absen Pulang" (active, clickable)
  | 'COMPLETED';               // "Presensi Selesai" (disabled/badge)

export interface ResolvedAttendanceStatus {
  state: AttendanceButtonState;
  label: string;
  sublabel: string;
  isActionable: boolean;
  actionType: 'masuk' | 'pulang' | null;
  shift: 'Pagi' | 'Malam' | 'Office';
  operationalDate: string;
  activeCheckInRecord: AttendanceRecord | null;
  activeCheckOutRecord: AttendanceRecord | null;
  isScheduled: boolean;
  isOff: boolean;
}

/**
 * Resolves schedule-aware attendance status based on authoritative evaluateOperationalPermissions,
 * ensuring complete alignment between UI button states and backend authorization windows.
 */
export function getScheduleAwareAttendanceStatus(params: {
  technician: Technician | { id?: number; name?: string; code?: string; role?: string } | null;
  scheduleDoc?: ShiftScheduleV2 | null;
  history?: AttendanceRecord[];
  nowDate?: Date;
}): ResolvedAttendanceStatus {
  const { technician, scheduleDoc, history = getAllAttendanceHistory(), nowDate } = params;

  const jkt = nowDate
    ? new Date(nowDate.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
    : getJakartaDate();

  const userRole: 'supervisor' | 'technician' | 'admin' =
    (technician as any)?.role === 'admin'
      ? 'admin'
      : (technician as any)?.role === 'supervisor'
      ? 'supervisor'
      : 'technician';

  // Evaluate single source of truth permissions & attendance windows
  const permResult = evaluateOperationalPermissions({
    userRole,
    technician: technician
      ? {
          id: technician.id !== undefined && !isNaN(Number(technician.id)) ? Number(technician.id) : undefined,
          name: technician.name || technician.code || '',
        }
      : null,
    nowDate: jkt,
    scheduleDocPS: scheduleDoc?.shift === 'PS' ? scheduleDoc : null,
    scheduleDocM: scheduleDoc?.shift === 'M' ? scheduleDoc : null,
    attendanceHistory: history,
  });

  const shiftLabel: 'Pagi' | 'Malam' | 'Office' =
    permResult.shiftCode === 'M' ? 'Malam' : permResult.shiftCode === 'OFFICE' ? 'Office' : 'Pagi';

  // Supervisor or Admin without shift obligation: Unrestricted oversight
  const isScheduledStaff = permResult.schedule === 'OFFICE' || permResult.schedule === 'PS' || permResult.schedule === 'M';
  if ((userRole === 'supervisor' || userRole === 'admin') && !isScheduledStaff) {
    return {
      state: 'COMPLETED',
      label: userRole === 'admin' ? 'Administrator (Bebas Presensi)' : 'Supervisor (Bebas Presensi)',
      sublabel: 'Akses penuh pengawasan',
      isActionable: false,
      actionType: null,
      shift: shiftLabel,
      operationalDate: permResult.operationalDate,
      activeCheckInRecord: permResult.checkInRecord || null,
      activeCheckOutRecord: permResult.checkOutRecord || null,
      isScheduled: false,
      isOff: false,
    };
  }

  // Scheduled LIBUR
  if (permResult.schedule === 'LIBUR') {
    return {
      state: 'OFF',
      label: 'Libur / Tidak Terjadwal',
      sublabel: 'Anda sedang libur / tidak terjadwal bertugas pada shift ini',
      isActionable: false,
      actionType: null,
      shift: shiftLabel,
      operationalDate: permResult.operationalDate,
      activeCheckInRecord: permResult.checkInRecord || null,
      activeCheckOutRecord: permResult.checkOutRecord || null,
      isScheduled: false,
      isOff: true,
    };
  }

  // Mapped button states from authoritative attendanceState
  switch (permResult.attendanceState) {
    case 'CAN_CHECK_IN':
      return {
        state: 'CAN_CHECK_IN',
        label: 'Absen Masuk',
        sublabel: 'Silakan lakukan presensi masuk (Tepat Waktu)',
        isActionable: true,
        actionType: 'masuk',
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: permResult.checkInRecord || null,
        activeCheckOutRecord: permResult.checkOutRecord || null,
        isScheduled: true,
        isOff: false,
      };

    case 'CAN_CHECK_IN_LATE':
      return {
        state: 'CAN_CHECK_IN',
        label: 'Absen Masuk (Terlambat)',
        sublabel: 'Presensi masuk terlambat (Wajib isi catatan alasan)',
        isActionable: true,
        actionType: 'masuk',
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: permResult.checkInRecord || null,
        activeCheckOutRecord: permResult.checkOutRecord || null,
        isScheduled: true,
        isOff: false,
      };

    case 'CHECKED_IN':
      return {
        state: 'CHECKED_IN_WAITING',
        label: 'Presensi Masuk Tercatat',
        sublabel: permResult.reason || 'Menunggu jadwal presensi pulang dibuka',
        isActionable: false,
        actionType: null,
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: permResult.checkInRecord || null,
        activeCheckOutRecord: permResult.checkOutRecord || null,
        isScheduled: true,
        isOff: false,
      };

    case 'CAN_CHECK_OUT':
      return {
        state: 'CAN_CHECK_OUT',
        label: 'Absen Pulang',
        sublabel: 'Window presensi pulang dibuka, silakan absen pulang',
        isActionable: true,
        actionType: 'pulang',
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: permResult.checkInRecord || null,
        activeCheckOutRecord: permResult.checkOutRecord || null,
        isScheduled: true,
        isOff: false,
      };

    case 'CHECKED_OUT':
      return {
        state: 'COMPLETED',
        label: 'Presensi Selesai',
        sublabel: `Presensi pulang telah tercatat (${permResult.checkOutRecord?.attendance_time || ''})`,
        isActionable: false,
        actionType: null,
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: permResult.checkInRecord || null,
        activeCheckOutRecord: permResult.checkOutRecord || null,
        isScheduled: false,
        isOff: false,
      };

    case 'MISSED_CHECK_IN':
      return {
        state: permResult.operationalState === 'ON_DUTY' ? 'CHECKED_IN_WAITING' : 'OFF',
        label: 'Tidak Absen Masuk',
        sublabel: 'Batas presensi masuk terlewati. Anda tetap dapat menginput laporan saat ON DUTY.',
        isActionable: false,
        actionType: null,
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: null,
        activeCheckOutRecord: permResult.checkOutRecord || null,
        isScheduled: true,
        isOff: false,
      };

    case 'MISSED_CHECK_OUT':
      return {
        state: 'COMPLETED',
        label: 'Tidak Absen Pulang',
        sublabel: 'Batas waktu presensi pulang telah terlewati.',
        isActionable: false,
        actionType: null,
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: permResult.checkInRecord || null,
        activeCheckOutRecord: null,
        isScheduled: false,
        isOff: false,
      };

    case 'EXPIRED':
    default:
      if (permResult.operationalState === 'PRE_SHIFT') {
        return {
          state: 'SCHEDULED_EARLY',
          label: 'Presensi Belum Dibuka',
          sublabel: permResult.reason,
          isActionable: false,
          actionType: null,
          shift: shiftLabel,
          operationalDate: permResult.operationalDate,
          activeCheckInRecord: permResult.checkInRecord || null,
          activeCheckOutRecord: permResult.checkOutRecord || null,
          isScheduled: true,
          isOff: false,
        };
      }
      return {
        state: 'OFF',
        label: 'Di Luar Jam Kerja',
        sublabel: permResult.reason || 'Di luar jam kerja operasional aktif.',
        isActionable: false,
        actionType: null,
        shift: shiftLabel,
        operationalDate: permResult.operationalDate,
        activeCheckInRecord: permResult.checkInRecord || null,
        activeCheckOutRecord: permResult.checkOutRecord || null,
        isScheduled: false,
        isOff: true,
      };
  }
}

/**
 * Returns ISO 8601 string with Asia/Jakarta timezone (+07:00).
 * e.g. "2026-09-28T00:52:39.324+07:00"
 */
export function getJakartaISOString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}.${ms}+07:00`;
}

/**
 * Returns current Date in Asia/Jakarta timezone.
 */
export function getJakartaDate(): Date {
  const now = new Date();
  const jakartaTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  return new Date(jakartaTimeString);
}

/**
 * Returns YYYY-MM-DD in Asia/Jakarta timezone.
 */
export function getJakartaDateString(): string {
  const jkt = getJakartaDate();
  const year = jkt.getFullYear();
  const month = String(jkt.getMonth() + 1).padStart(2, '0');
  const day = String(jkt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns formatted time in Asia/Jakarta timezone, e.g. "06.48 WIB"
 */
export function getJakartaTimeString(): string {
  const jkt = getJakartaDate();
  const hours = String(jkt.getHours()).padStart(2, '0');
  const minutes = String(jkt.getMinutes()).padStart(2, '0');
  return `${hours}.${minutes} WIB`;
}

/**
 * Detects default shift based on current Jakarta hour.
 * 06:00 - 18:59 -> Shift Pagi
 * 19:00 - 05:59 -> Shift Malam
 */
export function detectDefaultShift(): 'Pagi' | 'Malam' {
  const jkt = getJakartaDate();
  const hour = jkt.getHours();
  return hour >= 6 && hour < 19 ? 'Pagi' : 'Malam';
}

/**
 * Calculates standard attendance status based on shift and time.
 * - OFFICE: 06:00:00 - 08:15:00 Tepat Waktu, >08:15:00 - 10:00:00 Telat, >10:00:00 Sangat Terlambat.
 * - Shift Pagi (PS): 06:00:00 - 07:15:00 Tepat Waktu, >07:15:00 - 10:00:00 Telat, >10:00:00 Sangat Terlambat.
 * - Shift Malam (M): 18:00:00 - 19:15:00 Tepat Waktu, >19:15:00 - 22:00:00 Telat, >22:00:00 Sangat Terlambat.
 */
export function calculateAttendanceStatus(
  shift: 'Pagi' | 'Malam' | 'OFFICE' | 'Office' | 'PS' | 'M'
): 'Tepat Waktu' | 'Telat' | 'Sangat Terlambat' {
  const jkt = getJakartaDate();
  const hour = jkt.getHours();
  const minute = jkt.getMinutes();
  const second = jkt.getSeconds();
  const totalSeconds = hour * 3600 + minute * 60 + second;

  if (shift === 'OFFICE' || shift === 'Office') {
    if (totalSeconds <= 8 * 3600 + 15 * 60) {
      return 'Tepat Waktu';
    } else if (totalSeconds <= 10 * 3600) {
      return 'Telat';
    } else {
      return 'Sangat Terlambat';
    }
  }

  if (shift === 'Pagi' || shift === 'PS') {
    if (totalSeconds <= 7 * 3600 + 15 * 60) {
      return 'Tepat Waktu';
    } else if (totalSeconds <= 10 * 3600) {
      return 'Telat';
    } else {
      return 'Sangat Terlambat';
    }
  } else {
    // Shift Malam (M): 18:00 - 19:15 Tepat Waktu, 19:15 - 22:00 Telat, > 22:00 Sangat Terlambat
    if (totalSeconds >= 18 * 3600 && totalSeconds <= 19 * 3600 + 15 * 60) {
      return 'Tepat Waktu';
    } else if (totalSeconds > 19 * 3600 + 15 * 60 && totalSeconds <= 22 * 3600) {
      return 'Telat';
    } else {
      return 'Sangat Terlambat';
    }
  }
}

/**
 * Workplace reference: Bandara Halim Perdanakusuma (Terminal & Area Operasional)
 * Coordinates based on operational airport map: -6.2657, 106.8906
 * Authoritative radius limit: 2500m (2.5 km)
 */
export const AIRPORT_BASE_COORDINATES = {
  latitude: -6.2657,
  longitude: 106.8906,
  name: 'Bandara Halim Perdanakusuma',
  maxRadiusMeters: 2500, // 2.5km operational radius covering terminal, hangars, and runway
};

/**
 * Calculates distance between two coordinates in meters using Haversine formula
 */
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Validates GPS location against operational work area (Bandara Halim Perdanakusuma)
 * Uses authoritative server/standard radius (Never blindly trusts client override)
 */
export function validateWorkLocation(latitude: number, longitude: number, accuracy?: number): {
  isWithinRadius: boolean;
  distanceMeters: number;
  areaName: string;
  statusText: string;
} {
  const distance = calculateDistanceMeters(
    latitude,
    longitude,
    AIRPORT_BASE_COORDINATES.latitude,
    AIRPORT_BASE_COORDINATES.longitude
  );

  const radiusLimit = AIRPORT_BASE_COORDINATES.maxRadiusMeters;

  const isWithinRadius = distance <= radiusLimit;
  const areaName = isWithinRadius
    ? 'Bandara Halim Perdanakusuma'
    : `Di Luar Radius Bandara (${(distance / 1000).toFixed(1)} km)`;
  const statusText = isWithinRadius
    ? 'Lokasi Valid & Terverifikasi di Bandara Halim Perdanakusuma'
    : 'Perhatian: Posisi berada di luar radius operasional Bandara Halim';

  return {
    isWithinRadius,
    distanceMeters: distance,
    areaName,
    statusText,
  };
}

/**
 * Generates WhatsApp format with photo verification & GPS location
 */
export function generateAttendanceWhatsAppText(data: {
  name: string;
  shift: 'Pagi' | 'Malam';
  time: string;
  status: 'Tepat Waktu' | 'Telat';
  locationStr?: string;
  hasPhoto?: boolean;
}): string {
  const lines = [
    `*PRESENSI MASUK TEKNISI PEMELIHARAAN*`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `*Nama :* ${data.name}`,
    `*Shift :* ${data.shift}`,
    `*Waktu Absen :* ${data.time}`,
    `*Status :* ${data.status}`,
  ];

  if (data.locationStr) {
    lines.push(`*Lokasi GPS :* ${data.locationStr}`);
  }

  if (data.hasPhoto) {
    lines.push(`*Foto Absen :* Terlampir (Watermark Waktu & GPS Live)`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`_Dilaporkan via Sistem Monitoring Operasional Peralatan Bandara_`);
  return lines.join('\n');
}

/**
 * Normalizes technician name for storage key
 */
function normalizeKeyName(name: string): string {
  return (name || 'anonymous').trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Gets the session key for today's technician attendance
 */
function getTodaySessionKey(techName: string, dateStr?: string): string {
  const date = dateStr || getJakartaDateString();
  return `faskampen_attendance_${date}_${normalizeKeyName(techName)}`;
}

/**
 * Retrieves today's attendance state for a given technician
 */
export function getTodayAttendanceState(techName: string, dateStr?: string): AttendanceSessionState {
  const op = getOperationalShift();
  const date = dateStr || op.operationalDate;
  const sessionKey = getTodaySessionKey(techName, date);

  try {
    // 1. Check direct session key
    const sessionRaw = localStorage.getItem(sessionKey);
    if (sessionRaw) {
      const parsed = JSON.parse(sessionRaw);
      if (parsed.hasAttended || parsed.isBypassed || parsed.isOffDuty) {
        return {
          hasAttended: !!parsed.hasAttended,
          isBypassed: !!parsed.isBypassed,
          isOffDuty: !!parsed.isOffDuty,
          record: parsed.record,
        };
      }
    }

    // Also check operational date session key if different from date
    if (op.operationalDate !== date) {
      const opSessionKey = getTodaySessionKey(techName, op.operationalDate);
      const opSessionRaw = localStorage.getItem(opSessionKey);
      if (opSessionRaw) {
        const parsed = JSON.parse(opSessionRaw);
        if (parsed.hasAttended || parsed.isBypassed || parsed.isOffDuty) {
          return {
            hasAttended: !!parsed.hasAttended,
            isBypassed: !!parsed.isBypassed,
            isOffDuty: !!parsed.isOffDuty,
            record: parsed.record,
          };
        }
      }
    }

    // 2. Check general admin bypass for today
    const generalBypass =
      sessionStorage.getItem(`faskampen_admin_bypass_${date}`) ||
      sessionStorage.getItem(`faskampen_admin_bypass_${op.operationalDate}`);
    if (generalBypass === 'true') {
      return {
        hasAttended: false,
        isBypassed: true,
        isOffDuty: false,
      };
    }

    // 3. Fallback check from persistent attendance history list
    const history = getAllAttendanceHistory();
    const cleanTech = techName.trim().toLowerCase();
    const matching = history.find((r) => {
      if (!r || !r.technician_name) return false;
      const rName = r.technician_name.trim().toLowerCase();
      const isNameMatch =
        cleanTech &&
        (rName === cleanTech || cleanTech.includes(rName) || rName.includes(cleanTech));
      const isDateMatch = r.attendance_date === date || r.attendance_date === op.operationalDate;
      return isNameMatch && isDateMatch;
    });

    if (matching) {
      const isBypassed = Boolean(matching.is_bypassed);
      const isOffDuty = Boolean(matching.is_off_duty);
      const hasAttended = !isBypassed && !isOffDuty;
      const resolvedState: AttendanceSessionState = {
        hasAttended,
        isBypassed,
        isOffDuty,
        record: matching,
      };
      try {
        localStorage.setItem(sessionKey, JSON.stringify(resolvedState));
      } catch (_) {}
      return resolvedState;
    }
  } catch (err) {
    console.error('Error reading attendance state:', err);
  }

  return {
    hasAttended: false,
    isBypassed: false,
    isOffDuty: false,
  };
}

/**
 * Saves a new attendance record locally and sends to server
 */
export function saveAttendanceRecord(record: AttendanceRecord): void {
  const date = record.attendance_date || getJakartaDateString();
  const sessionKey = getTodaySessionKey(record.technician_name, date);

  try {
    // 1. Save session indicator
    const sessionData: AttendanceSessionState = {
      hasAttended: true,
      isBypassed: false,
      isOffDuty: false,
      record,
    };
    localStorage.setItem(sessionKey, JSON.stringify(sessionData));

    // 2. Append to history list
    const historyRaw = localStorage.getItem(ATTENDANCE_HISTORY_KEY);
    const history: AttendanceRecord[] = historyRaw ? JSON.parse(historyRaw) : [];
    // Replace if same tech, date and attendance_type exists, otherwise prepend
    const recordType = record.attendance_type || 'masuk';
    const filtered = history.filter(
      (h) =>
        !(
          h.attendance_date === date &&
          h.technician_name.toLowerCase() === record.technician_name.toLowerCase() &&
          (h.attendance_type || 'masuk') === recordType
        )
    );
    filtered.unshift(record);
    localStorage.setItem(ATTENDANCE_HISTORY_KEY, JSON.stringify(filtered.slice(0, 100)));

    // 3. Asynchronously sync to backend endpoint
    getAuthHeaders().then((authHeaders) => {
      fetch('/api/attendance', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      }).catch((err) => {
        console.warn('Could not sync attendance to backend:', err);
      });
    });
  } catch (err) {
    console.error('Error saving attendance record:', err);
  }
}

export interface AttendanceBypassSkipParams {
  technician_name: string;
  technician_id?: number;
  shift: 'Pagi' | 'Malam';
  type: 'grace_period' | 'admin_override' | 'off_duty';
  reason?: string;
  notes?: string;
  authorized_by?: string;
  dateStr?: string;
}

/**
 * Logs bypass, grace period skip, or off-duty declaration into both
 * local storage and the persistent server database (/api/attendance),
 * ensuring audit trails and technical consistency even when schedules are undefined.
 */
export async function logAttendanceBypassOrSkip(
  params: AttendanceBypassSkipParams
): Promise<AttendanceRecord> {
  const dateStr = params.dateStr || getJakartaDateString();
  const timeStr = getJakartaTimeString();
  const recordId = `att-${params.type.replace('_', '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let notes = params.notes;
  if (!notes) {
    if (params.type === 'admin_override') {
      notes = `[ADMIN OVERRIDE] Otorisasi: ${params.authorized_by || 'Supervisor'} | Alasan: ${params.reason || 'Bypass resmi oleh supervisor'}`;
    } else if (params.type === 'grace_period') {
      notes = `[GRACE PERIOD] Akses Masa Tenggang / Jadwal Belum Terbit | Alasan: ${params.reason || 'Transisi operasional darurat'}`;
    } else if (params.type === 'off_duty') {
      notes = `[OFF DUTY] Personel Lepas Piket | Akses: Pemantauan Dashboard Saja`;
    }
  }

  const record: AttendanceRecord = {
    id: recordId,
    technician_id: params.technician_id,
    technician_name: params.technician_name,
    shift: params.shift,
    attendance_date: dateStr,
    attendance_time: timeStr,
    status: 'Tepat Waktu',
    is_bypassed: params.type === 'admin_override' || params.type === 'grace_period',
    is_off_duty: params.type === 'off_duty',
    notes,
    created_at: getJakartaISOString(),
  };

  // 1. Save session indicator
  const sessionKey = getTodaySessionKey(params.technician_name, dateStr);
  const sessionData: AttendanceSessionState = {
    hasAttended: false,
    isBypassed: params.type === 'admin_override' || params.type === 'grace_period',
    isOffDuty: params.type === 'off_duty',
    record,
  };

  try {
    localStorage.setItem(sessionKey, JSON.stringify(sessionData));
    if (params.type === 'admin_override' || params.type === 'grace_period') {
      sessionStorage.setItem(`faskampen_admin_bypass_${dateStr}`, 'true');
    }
  } catch (err) {
    console.error('Error saving bypass session to localStorage:', err);
  }

  // 2. Append to history list
  try {
    const historyRaw = localStorage.getItem(ATTENDANCE_HISTORY_KEY);
    const history: AttendanceRecord[] = historyRaw ? JSON.parse(historyRaw) : [];
    const filtered = history.filter(
      (h) => !(h.attendance_date === dateStr && h.technician_name.toLowerCase() === params.technician_name.toLowerCase())
    );
    filtered.unshift(record);
    localStorage.setItem(ATTENDANCE_HISTORY_KEY, JSON.stringify(filtered.slice(0, 100)));
  } catch (err) {
    console.error('Error saving bypass record to history:', err);
  }

  // 3. Post to backend database endpoint (/api/attendance)
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(record),
    });
    const result = await res.json();
    if (result && result.record) {
      return result.record;
    }
  } catch (err) {
    console.warn('Could not sync bypass log to backend database:', err);
  }

  return record;
}

/**
 * Checks if current time is within standard shift transition grace period window (e.g. within 60 minutes of shift start)
 */
export function isWithinGracePeriodWindow(shift: 'Pagi' | 'Malam'): boolean {
  const jkt = getJakartaDate();
  const hour = jkt.getHours();
  const minute = jkt.getMinutes();
  const totalMinutes = hour * 60 + minute;

  if (shift === 'Pagi') {
    // 06:30 - 08:30 WIB is the standard grace window for Shift Pagi
    return totalMinutes >= 6 * 60 + 30 && totalMinutes <= 8 * 60 + 30;
  } else {
    // 18:30 - 20:30 WIB is the standard grace window for Shift Malam
    return totalMinutes >= 18 * 60 + 30 && totalMinutes <= 20 * 60 + 30;
  }
}

/**
 * Marks current user as Off-Duty for today (e.g. Reza who is just viewing dashboard)
 */
export function setSessionOffDuty(techName: string, dateStr?: string): void {
  const date = dateStr || getJakartaDateString();
  const sessionKey = getTodaySessionKey(techName, date);
  try {
    const sessionData: AttendanceSessionState = {
      hasAttended: false,
      isBypassed: false,
      isOffDuty: true,
    };
    localStorage.setItem(sessionKey, JSON.stringify(sessionData));
  } catch (err) {
    console.error('Error setting off-duty:', err);
  }
}

/**
 * Sets Admin / Supervisor bypass for today
 */
export function setSessionBypass(techName?: string, dateStr?: string): void {
  const date = dateStr || getJakartaDateString();
  try {
    sessionStorage.setItem(`faskampen_admin_bypass_${date}`, 'true');
    if (techName) {
      const sessionKey = getTodaySessionKey(techName, date);
      const sessionData: AttendanceSessionState = {
        hasAttended: false,
        isBypassed: true,
        isOffDuty: false,
      };
      localStorage.setItem(sessionKey, JSON.stringify(sessionData));
    }
  } catch (err) {
    console.error('Error setting bypass:', err);
  }
}



/**
 * Verifies face liveness and anti-spoofing via server-side Gemini API (Non fail-open)
 */
export interface LivenessVerificationResult {
  isLive: boolean;
  verification_status: AttendanceVerificationStatus;
  confidence: number;
  rejectionReason: string;
  details?: string;
  detectedFace?: boolean;
}

export async function verifyFaceLiveness(
  imageDataUrl: string,
  technicianName?: string
): Promise<LivenessVerificationResult> {
  if (!imageDataUrl || !imageDataUrl.startsWith('data:image')) {
    return {
      isLive: false,
      verification_status: 'verification_failed',
      confidence: 0,
      rejectionReason: 'Format gambar tidak valid atau kosong.',
    };
  }

  try {
    const authHeaders = await getAuthHeaders();
    const response = await fetch('/api/attendance/verify-liveness', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: imageDataUrl,
        technician_name: technicianName || 'Teknisi',
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return {
        isLive: false,
        verification_status: 'unverified',
        confidence: 0.5,
        rejectionReason: '',
        details: errData.error || 'Layanan verifikasi biometrik tidak merespons.',
      };
    }

    const data = await response.json();
    const isLive = Boolean(data.isLive);
    const verificationStatus: AttendanceVerificationStatus = data.verification_status || (isLive ? 'verified' : (data.rejectionReason ? 'verification_failed' : 'unverified'));

    return {
      isLive,
      verification_status: verificationStatus,
      confidence: typeof data.confidence === 'number' ? data.confidence : (isLive ? 0.95 : 0.5),
      rejectionReason: data.rejectionReason || '',
      details: data.details,
      detectedFace: data.detectedFace !== undefined ? data.detectedFace : true,
    };
  } catch (error: any) {
    console.warn('[Liveness] Network exception during face verification. Status set to unverified:', error);
    return {
      isLive: false,
      verification_status: 'unverified',
      confidence: 0.5,
      rejectionReason: '',
      details: `Koneksi jaringan terputus saat verifikasi biometrik (${error?.message || 'Offline'}). Presensi dicatat dengan status 'unverified'.`,
      detectedFace: true,
    };
  }
}

/**
 * Returns all saved attendance history
 */
export function getAllAttendanceHistory(): AttendanceRecord[] {
  try {
    const raw = localStorage.getItem(ATTENDANCE_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Fetches attendance history from server / database endpoint and updates local cache
 */
export async function fetchAttendanceHistoryFromServer(dateStr?: string): Promise<AttendanceRecord[]> {
  try {
    const authHeaders = await getAuthHeaders();
    const url = dateStr ? `/api/attendance?date=${encodeURIComponent(dateStr)}` : '/api/attendance';
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return getAllAttendanceHistory();
    }

    const data = await response.json();
    if (data && Array.isArray(data.records)) {
      const records: AttendanceRecord[] = data.records.map((r: any) => ({
        id: r.id || `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        technician_id: r.technician_id,
        technician_name: r.technician_name || 'Teknisi',
        attendance_type: r.attendance_type || (r.is_bypassed ? 'bypass' : r.is_off_duty ? 'off_duty' : 'masuk'),
        shift: r.shift === 'M' || r.shift === 'Malam' ? 'Malam' : 'Pagi',
        attendance_date: r.attendance_date || (r.created_at ? r.created_at.split('T')[0] : getJakartaDateString()),
        attendance_time: r.attendance_time || (r.timestamp ? r.timestamp : getJakartaTimeString()),
        status: r.status || 'Tepat Waktu',
        verification_status: r.verification_status || (r.is_verified ? 'verified' : 'unverified'),
        liveness_confidence: r.liveness_confidence,
        notes: r.notes || r.reason || '',
        is_bypassed: Boolean(r.is_bypassed),
        is_off_duty: Boolean(r.is_off_duty),
        photo_url: r.photo_url || r.selfie_url || '',
        photo_object_key: r.photo_object_key || '',
        location: r.location || (r.latitude && r.longitude ? {
          latitude: r.latitude,
          longitude: r.longitude,
          distance_meters: r.distance_meters,
          area_name: r.area_name,
          is_within_radius: r.is_within_radius,
        } : undefined),
        created_at: r.created_at || r.timestamp || new Date().toISOString(),
      }));

      // Merge into local cache
      try {
        const local = getAllAttendanceHistory();
        const mergedMap = new Map<string, AttendanceRecord>();
        // Add server records first and update technician session indicators
        records.forEach((rec) => {
          const key = `${rec.attendance_date}_${rec.technician_name.toLowerCase()}_${rec.attendance_type || 'masuk'}`;
          mergedMap.set(key, rec);

          // Populate session key for active technician login
          try {
            const sessionKey = getTodaySessionKey(rec.technician_name, rec.attendance_date);
            const sessionData: AttendanceSessionState = {
              hasAttended: Boolean(!rec.is_bypassed && !rec.is_off_duty),
              isBypassed: Boolean(rec.is_bypassed),
              isOffDuty: Boolean(rec.is_off_duty),
              record: rec,
            };
            localStorage.setItem(sessionKey, JSON.stringify(sessionData));
          } catch (_) {}
        });
        // Add any local not in server
        local.forEach((rec) => {
          const key = `${rec.attendance_date}_${rec.technician_name.toLowerCase()}_${rec.attendance_type || 'masuk'}`;
          if (!mergedMap.has(key)) {
            mergedMap.set(key, rec);
          }
        });
        const mergedList = Array.from(mergedMap.values()).sort((a, b) => {
          const tA = new Date(a.created_at || `${a.attendance_date}T00:00:00Z`).getTime();
          const tB = new Date(b.created_at || `${b.attendance_date}T00:00:00Z`).getTime();
          return tB - tA;
        });
        localStorage.setItem(ATTENDANCE_HISTORY_KEY, JSON.stringify(mergedList.slice(0, 200)));
        return mergedList;
      } catch (_) {
        return records;
      }
    }
  } catch (err) {
    console.warn('Could not fetch attendance history from server:', err);
  }
  return getAllAttendanceHistory();
}
