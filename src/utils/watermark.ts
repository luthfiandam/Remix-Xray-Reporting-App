import { formatIndonesianDate, formatTimeShort } from './timeFormat';
import { getJakartaDateString } from './dateTimeUtils';

export interface WatermarkOptions {
  equipmentName?: string;
  locationName?: string;
  equipmentType?: string;
  operationalDate?: string; // "2026-08-10"
  time?: string;            // "21:30" or "21.30"
  shift?: string;           // "Pagi" / "Malam"
  reportType?: 'PREVENTIVE' | 'CORRECTIVE';
}

/**
 * Sanitizes a string for safe file name / folder name generation
 */
export function sanitizeFileNamePart(str?: string): string {
  if (!str) return '';
  return str
    .replace(/[\\/:*?"<>|#%&{}]/g, '') // remove forbidden filename chars
    .replace(/\s+/g, ' ')               // normalize whitespace
    .trim();
}

/**
 * Generates standardized filename based on prompt rule:
 * "foto_{jammenitdetik}"
 * Example: "foto_081530.jpg" or "foto_081530_1.jpg"
 */
export function generateDriveFileName(
  _locationOrEquipment?: string,
  timeStr?: string, // e.g. "15:30" or "15:30:15" or ISO string
  _dateStr?: string, // e.g. "2026-08-10"
  index?: number
): string {
  const now = new Date();
  let hhmmss = '';

  if (timeStr) {
    let cleanTime = timeStr.trim();
    // If it's an ISO string, parse to Asia/Jakarta / local
    if (cleanTime.includes('T')) {
      const d = new Date(cleanTime);
      if (!isNaN(d.getTime())) {
        try {
          const formatter = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
          const parts = formatter.formatToParts(d);
          const hh = parts.find((p) => p.type === 'hour')?.value.padStart(2, '0') || '00';
          const mm = parts.find((p) => p.type === 'minute')?.value.padStart(2, '0') || '00';
          const ss = parts.find((p) => p.type === 'second')?.value.padStart(2, '0') || '00';
          hhmmss = `${hh}${mm}${ss}`;
        } catch {
          cleanTime = cleanTime.split('T')[1] || '';
        }
      }
    }

    if (!hhmmss) {
      const digits = cleanTime.replace(/\D/g, '');
      if (digits.length >= 6) {
        hhmmss = digits.substring(0, 6);
      } else if (digits.length >= 4) {
        const ss = String(now.getSeconds()).padStart(2, '0');
        hhmmss = digits.substring(0, 4) + ss;
      }
    }
  }

  if (!hhmmss) {
    try {
      const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const hh = parts.find((p) => p.type === 'hour')?.value.padStart(2, '0') || '00';
      const mm = parts.find((p) => p.type === 'minute')?.value.padStart(2, '0') || '00';
      const ss = parts.find((p) => p.type === 'second')?.value.padStart(2, '0') || '00';
      hhmmss = `${hh}${mm}${ss}`;
    } catch {
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      hhmmss = `${hh}${mm}${ss}`;
    }
  }

  const suffix = typeof index === 'number' ? `_${index + 1}` : '';
  return `foto_${hhmmss}${suffix}.jpg`;
}

/**
 * Builds Google Drive structured folder path per specifications:
 *
 * 📁 !Kantor/
 * └── 📁 2. Foto Laporan/
 *     ├── 📁 1. Foto Laporan Harian/
 *     │    └── 📁 {YYYY}/
 *     │         └── 📁 {MM. NamaBulan}/  (contoh: 01. Januari)
 *     │              └── 📁 {DD NamaBulan}/  (contoh: 01 Januari)
 *     │                   └── 📁 {PAGI/MALAM}/
 *     │                        └── 📁 XRAY {LOKASI}/
 *     │                             └── foto_{jammenitdetik}.jpg
 *     ├── 📁 1.1 Foto Laporan Corrective/
 *     ├── 📁 2. Foto Laporan Mingguan/
 *     ├── 📁 3. Foto Laporan Bulanan/
 *     ├── 📁 4. Foto Laporan Triwulan/
 *     ├── 📁 5. Foto Laporan Semesteran/
 *     └── 📁 6. Foto Laporan Tahunan/
 */
export function buildDriveFolderPath(options: {
  reportType: 'PREVENTIVE' | 'CORRECTIVE';
  frequencyName?: string;  // "Harian", "Mingguan", "Bulanan", "Triwulan", "Semesteran", "Tahunan"
  operationalDate?: string; // "2026-08-10"
  shift?: string;           // "Pagi" / "Malam"
  equipmentType?: string;   // "XRAY" / "WTMD" / "HHMD" / "ETD"
  locationName?: string;    // "SCP LINE E"
  equipmentName?: string;   // "X-RAY HEIMANN"
  subFolderType?: 'preventif' | 'kolase';
}): string {
  const root = '!Kantor/2. Foto Laporan';

  let categoryFolder = '1. Foto Laporan Harian';
  if (options.reportType === 'CORRECTIVE') {
    categoryFolder = '1.1 Foto Laporan Corrective';
  } else if (options.reportType === 'PREVENTIVE') {
    const freq = (options.frequencyName || 'Harian').toLowerCase();
    if (freq.includes('minggu')) categoryFolder = '2. Foto Laporan Mingguan';
    else if (freq.includes('bulan')) categoryFolder = '3. Foto Laporan Bulanan';
    else if (freq.includes('triwulan')) categoryFolder = '4. Foto Laporan Triwulan';
    else if (freq.includes('semester')) categoryFolder = '5. Foto Laporan Semesteran';
    else if (freq.includes('tahun')) categoryFolder = '6. Foto Laporan Tahunan';
    else categoryFolder = '1. Foto Laporan Harian';
  }

  const cleanDate = getJakartaDateString(options.operationalDate);
  const [yyyyStr, mmStr, ddStr] = cleanDate.split('-');
  const yyyy = parseInt(yyyyStr, 10);
  const mm = parseInt(mmStr, 10);
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const mmNum = mmStr;
  const monthName = monthNames[Math.max(0, Math.min(11, mm - 1))];
  const ddNum = ddStr;

  // Format MM. NamaBulan: e.g. "01. Januari", "09. September"
  const mmFolder = `${mmNum}. ${monthName}`;
  // Format DD NamaBulan: e.g. "01 Januari", "04 September"
  const ddFolder = `${ddNum} ${monthName}`;
  // Shift folder: "PAGI" or "MALAM"
  const shiftUpper = (options.shift || 'Pagi').toUpperCase();
  const shiftFolder = shiftUpper.includes('MALAM') || shiftUpper === 'M' ? 'MALAM' : 'PAGI';

  // Equipment & Location folder: e.g. "XRAY {LOKASI}"
  let eqType = sanitizeFileNamePart(options.equipmentType || 'XRAY').toUpperCase();
  if (eqType.includes('X-RAY') || eqType.includes('XRAY')) {
    eqType = 'XRAY';
  }
  let eqLoc = sanitizeFileNamePart(options.locationName || options.equipmentName || 'LOKASI').toUpperCase();
  if (eqLoc.startsWith(eqType)) {
    eqLoc = eqLoc.substring(eqType.length).trim();
  }
  const eqLocFolder = eqLoc ? `${eqType} ${eqLoc}` : eqType;

  // Pathing per category
  if (options.subFolderType === 'kolase') {
    if (categoryFolder === '3. Foto Laporan Bulanan') {
      return `${root}/${categoryFolder}/${yyyy}/${mmFolder}/${shiftFolder}/FOTO KOLASE`;
    }
    if (categoryFolder === '4. Foto Laporan Triwulan') {
      const qNum = Math.ceil(mm / 3);
      return `${root}/${categoryFolder}/${yyyy}/Triwulan ${qNum}/${mmFolder}/${shiftFolder}/FOTO KOLASE`;
    }
    if (categoryFolder === '5. Foto Laporan Semesteran') {
      const sNum = mm <= 6 ? 1 : 2;
      return `${root}/${categoryFolder}/${yyyy}/Semester ${sNum}/${mmFolder}/${shiftFolder}/FOTO KOLASE`;
    }
    if (categoryFolder === '6. Foto Laporan Tahunan') {
      return `${root}/${categoryFolder}/${yyyy}/${mmFolder}/${shiftFolder}/FOTO KOLASE`;
    }
    return `${root}/${categoryFolder}/${yyyy}/${mmFolder}/${ddFolder}/${shiftFolder}/FOTO KOLASE`;
  }

  if (categoryFolder === '1. Foto Laporan Harian' || categoryFolder === '1.1 Foto Laporan Corrective') {
    return `${root}/${categoryFolder}/${yyyy}/${mmFolder}/${ddFolder}/${shiftFolder}/${eqLocFolder}`;
  }

  if (categoryFolder === '2. Foto Laporan Mingguan') {
    return `${root}/${categoryFolder}/${yyyy}/${mmFolder}/${ddFolder}/${shiftFolder}/${eqLocFolder}`;
  }

  if (categoryFolder === '3. Foto Laporan Bulanan') {
    return `${root}/${categoryFolder}/${yyyy}/${mmFolder}/${shiftFolder}/${eqLocFolder}`;
  }

  if (categoryFolder === '4. Foto Laporan Triwulan') {
    const qNum = Math.ceil(mm / 3);
    return `${root}/${categoryFolder}/${yyyy}/Triwulan ${qNum}/${mmFolder}/${shiftFolder}/${eqLocFolder}`;
  }

  if (categoryFolder === '5. Foto Laporan Semesteran') {
    const sNum = mm <= 6 ? 1 : 2;
    return `${root}/${categoryFolder}/${yyyy}/Semester ${sNum}/${mmFolder}/${shiftFolder}/${eqLocFolder}`;
  }

  // 6. Foto Laporan Tahunan
  return `${root}/${categoryFolder}/${yyyy}/${mmFolder}/${shiftFolder}/${eqLocFolder}`;
}

// Neutral storage aliases (Supabase PostgreSQL + IDCloudHost S3 Storage)
export const generateStorageFileName = generateDriveFileName;
export const buildStorageFolderPath = buildDriveFolderPath;

/**
 * Applies a neat, clear watermark directly onto an image using HTML Canvas.
 * Stamped cleanly at the bottom of the image with a subtle dark backdrop.
 */
export async function applyWatermark(
  input: File | string,
  options: WatermarkOptions,
  maxDimension: number = 1600,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const process = () => {
      let width = img.width;
      let height = img.height;

      if (!width || !height) {
        if (typeof input === 'string') resolve(input);
        else resolve('');
        return;
      }

      // Scale proportionally if width or height exceeds maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        if (typeof input === 'string') resolve(input);
        else resolve('');
        return;
      }

      // Draw Base Image
      ctx.drawImage(img, 0, 0, width, height);

      // Subtle, clean timestamp matching reference example.jpeg
      // Position: Bottom-left, Small font, No heavy banner or colored bar
      const baseDim = Math.min(width, height);
      const fontSize = Math.max(12, Math.min(24, Math.round(baseDim * 0.019)));
      const paddingX = Math.max(16, Math.round(width * 0.035));
      const paddingBottom = Math.max(18, Math.round(height * 0.035));
      const lineSpacing = Math.round(fontSize * 1.35);

      // Line 1: Date & Time in "YYYY/MM/DD HH:mm" format
      const now = new Date();
      let year = String(now.getFullYear());
      let month = String(now.getMonth() + 1).padStart(2, '0');
      let day = String(now.getDate()).padStart(2, '0');

      if (options.operationalDate) {
        const parts = options.operationalDate.split(/[-/]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) {
            year = parts[0];
            month = parts[1].padStart(2, '0');
            day = parts[2].padStart(2, '0');
          } else if (parts[2].length === 4) {
            day = parts[0].padStart(2, '0');
            month = parts[1].padStart(2, '0');
            year = parts[2];
          }
        }
      }

      let timeFormatted = '';
      if (options.time) {
        const cleanTime = options.time.replace('.', ':');
        const tParts = cleanTime.split(':');
        if (tParts.length >= 2) {
          timeFormatted = `${tParts[0].padStart(2, '0')}:${tParts[1].padStart(2, '0')}`;
        } else {
          timeFormatted = options.time;
        }
      } else {
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        timeFormatted = `${hh}:${mm}`;
      }

      const line1 = `${year}/${month}/${day} ${timeFormatted}`;

      // Line 2: Location name (e.g., "Kecamatan Kramat jati, Indonesia" matching example.jpeg)
      let locText = options.locationName ? options.locationName.trim() : 'Kecamatan Kramat jati, Indonesia';
      if (!locText.toLowerCase().includes('indonesia')) {
        locText = `${locText}, Indonesia`;
      }
      const line2 = locText;

      // Render clean, small timestamp at bottom-left
      ctx.font = `400 ${fontSize}px Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';

      // Soft drop shadow for legibility over bright backgrounds
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.16));
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      const yLine2 = height - paddingBottom;
      const yLine1 = yLine2 - lineSpacing;

      ctx.fillText(line1, paddingX, yLine1);
      ctx.fillText(line2, paddingX, yLine2);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);

      // Memory cleanup
      canvas.width = 0;
      canvas.height = 0;

      resolve(dataUrl);
    };

    img.onload = () => {
      process();
    };

    img.onerror = (err) => {
      console.warn('Watermark overlay error, falling back:', err);
      if (typeof input === 'string') resolve(input);
      else reject(err);
    };

    if (typeof input === 'string') {
      img.src = input;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          img.src = e.target.result as string;
        } else {
          reject(new Error('Failed to read file for watermark'));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(input);
    }
  });
}

export interface AttendanceWatermarkOptions {
  technicianName: string;
  attendanceType?: 'masuk' | 'pulang';
  shift: 'Pagi' | 'Malam' | 'Office' | string;
  timeString: string;
  dateString: string;
  status: 'Tepat Waktu' | 'Telat' | string;
  locationInfo?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    areaName?: string;
    isWithinRadius?: boolean;
  };
}

/**
 * Applies tamper-proof attendance watermark directly onto selfie/presence photo.
 * Permanently embeds technician name, date/time, shift, status, and live GPS coordinates.
 */
export async function applyAttendanceWatermark(
  input: File | string,
  options: AttendanceWatermarkOptions,
  maxDimension: number = 1280,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const process = () => {
      let width = img.width;
      let height = img.height;

      if (!width || !height) {
        if (typeof input === 'string') resolve(input);
        else resolve('');
        return;
      }

      // Scale down if needed
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        if (typeof input === 'string') resolve(input);
        else resolve('');
        return;
      }

      // 1. Draw base photo
      ctx.drawImage(img, 0, 0, width, height);

      // Responsive sizing based on smallest dimension to guarantee perfect scaling in portrait & landscape
      const baseDim = Math.min(width, height);
      const fontSize = Math.max(12, Math.min(22, Math.round(baseDim * 0.024)));
      const lineSpacing = Math.round(fontSize * 1.35);
      const paddingX = Math.max(14, Math.round(width * 0.035));
      const paddingBottom = Math.max(16, Math.round(height * 0.035));

      // Construct clean text lines
      const isPulang = options.attendanceType === 'pulang';
      const typeLabel = isPulang ? 'Presensi Pulang' : 'Presensi Masuk';
      // Hilangkan 'Tepat Waktu' untuk presensi pulang
      const statusLabel = (!isPulang && options.status) ? ` • ${options.status}` : '';
      const line1 = `${typeLabel} : ${options.technicianName} • Shift ${options.shift}${statusLabel}`;
      
      const indoDate = formatIndonesianDate(options.dateString, { includeDayName: true });
      const line2 = `Hari & Tanggal : ${indoDate}`;

      const rawTime = (options.timeString || '').replace(':', '.').trim();
      const cleanTime = rawTime.toUpperCase().includes('WIB') ? rawTime : `${rawTime} WIB`;
      const line3 = `Jam : ${cleanTime}`;

      let line4 = 'GPS: Lokasi Terverifikasi';
      if (options.locationInfo) {
        const lat = options.locationInfo.latitude.toFixed(6);
        const lng = options.locationInfo.longitude.toFixed(6);
        const acc = options.locationInfo.accuracy ? ` (±${Math.round(options.locationInfo.accuracy)}m)` : '';
        const area = options.locationInfo.areaName || (options.locationInfo.isWithinRadius ? 'Bandara Halim Perdanakusuma' : 'Terverifikasi GPS');
        line4 = `📍 GPS: ${lat}, ${lng}${acc} • ${area}`;
      }

      // Soft, subtle bottom gradient for text contrast (covers 4 lines)
      const lineCount = 4;
      const gradientHeight = (lineSpacing * lineCount) + paddingBottom + Math.round(fontSize * 0.8);
      const gradientY = height - gradientHeight;
      const grad = ctx.createLinearGradient(0, gradientY, 0, height);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(0.3, 'rgba(0, 0, 0, 0.4)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gradientY, width, gradientHeight);

      // Render clean, legible text from bottom up
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.2));
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      const yLine4 = height - paddingBottom;
      const yLine3 = yLine4 - lineSpacing;
      const yLine2 = yLine3 - lineSpacing;
      const yLine1 = yLine2 - lineSpacing;

      // Line 1 (Technician & Shift)
      ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", Roboto, sans-serif, Arial`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line1, paddingX, yLine1);

      // Line 2 (Hari & Tanggal : Hari, DD Bulan YYYY)
      ctx.font = `500 ${Math.max(11, Math.round(fontSize * 0.92))}px "Plus Jakarta Sans", Roboto, sans-serif, Arial`;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(line2, paddingX, yLine2);

      // Line 3 (Jam : HH.MM WIB)
      ctx.font = `500 ${Math.max(11, Math.round(fontSize * 0.92))}px "Plus Jakarta Sans", Roboto, sans-serif, Arial`;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(line3, paddingX, yLine3);

      // Line 4 (GPS & Location)
      ctx.font = `500 ${Math.max(10, Math.round(fontSize * 0.88))}px "Plus Jakarta Sans", monospace, sans-serif`;
      ctx.fillStyle = options.locationInfo?.isWithinRadius ? '#a7f3d0' : '#fef08a';
      ctx.fillText(line4, paddingX, yLine4);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      canvas.width = 0;
      canvas.height = 0;
      resolve(dataUrl);
    };

    img.onload = () => process();
    img.onerror = (err) => {
      console.warn('Watermark error, returning raw input:', err);
      if (typeof input === 'string') resolve(input);
      else reject(err);
    };

    if (typeof input === 'string') {
      img.src = input;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          img.src = e.target.result as string;
        } else {
          reject(new Error('Failed to read photo file'));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(input);
    }
  });
}

