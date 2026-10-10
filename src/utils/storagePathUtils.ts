import { sanitizeFileNamePart } from './watermark';
import { getJakartaDateString, getJakartaTimeString } from './dateTimeUtils';

export const STORAGE_ROOT = '!Kantor';
export const LAPORAN_ROOT = '!Kantor/1. Laporan';
export const FOTO_ROOT = '!Kantor/2. Foto Laporan';
export const ABSEN_ROOT = '!Kantor/3. Absen';

const INDONESIAN_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export function getIndonesianMonthName(monthZeroIndexedOrDate: number | Date | string): string {
  let mIdx = 0;
  if (typeof monthZeroIndexedOrDate === 'number') {
    mIdx = Math.max(0, Math.min(11, monthZeroIndexedOrDate));
  } else {
    const d = new Date(monthZeroIndexedOrDate);
    mIdx = isNaN(d.getTime()) ? 0 : d.getMonth();
  }
  return INDONESIAN_MONTHS[mIdx];
}

/**
 * 1. LAPORAN OBJECT KEY GENERATOR
 * !Kantor/1. Laporan/
 * ├── 1. Laporan Harian/
 * ├── 2. Laporan Mingguan/
 * ├── 3. Laporan Bulanan/
 * ├── 4. Laporan Triwulan/
 * ├── 5. Laporan Semester/
 * ├── 6. Laporan Tahunan/
 * └── 7. Laporan Corrective/
 */
export function getReportFolderPathAndFileName(params: {
  reportType: string | number; // 1 | 2 | 3 | 4 | 5 | 6 | 7 or 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semester' | 'yearly' | 'corrective'
  dateStr?: string; // "2026-09-25"
  shift?: string;   // "Pagi" | "Malam" | "PS" | "M"
  fileName?: string;
}): { folderPath: string; fileName: string; objectKey: string } {
  const cleanDate = getJakartaDateString(params.dateStr);
  const [yyyyStr, mmStr, ddStr] = cleanDate.split('-');
  const yyyy = parseInt(yyyyStr, 10);
  const mIdx = Math.max(0, Math.min(11, parseInt(mmStr, 10) - 1));
  const monthName = INDONESIAN_MONTHS[mIdx];
  const mm = mmStr;
  const dd = ddStr;
  const monthFolder = `${mm}. ${monthName}`;

  let shiftCode = 'PS';
  const sUpper = (params.shift || '').toUpperCase();
  if (sUpper.includes('MALAM') || sUpper === 'M') {
    shiftCode = 'M';
  }

  const typeStr = String(params.reportType).toLowerCase();
  let subDir = '1. Laporan Harian';
  let useMonthFolder = true;
  let freqName = 'Harian';

  if (typeStr === '1' || typeStr === 'daily' || typeStr.includes('harian')) {
    subDir = '1. Laporan Harian';
    useMonthFolder = true;
    freqName = 'Harian';
  } else if (typeStr === '2' || typeStr === 'weekly' || typeStr.includes('minggu')) {
    subDir = '2. Laporan Mingguan';
    useMonthFolder = true;
    freqName = 'Mingguan';
  } else if (typeStr === '3' || typeStr === 'monthly' || typeStr.includes('bulan')) {
    subDir = '3. Laporan Bulanan';
    useMonthFolder = true;
    freqName = 'Bulanan';
  } else if (typeStr === '4' || typeStr === 'quarterly' || typeStr.includes('triwulan')) {
    subDir = '4. Laporan Triwulan';
    useMonthFolder = false;
    freqName = 'Triwulan';
  } else if (typeStr === '5' || typeStr === 'semester' || typeStr.includes('semester')) {
    subDir = '5. Laporan Semester';
    useMonthFolder = false;
    freqName = 'Semester';
  } else if (typeStr === '6' || typeStr === 'yearly' || typeStr.includes('tahun')) {
    subDir = '6. Laporan Tahunan';
    useMonthFolder = false;
    freqName = 'Tahunan';
  } else if (typeStr === '7' || typeStr === 'corrective' || typeStr.includes('corrective')) {
    subDir = '7. Laporan Corrective';
    useMonthFolder = true;
    freqName = 'Corrective';
  }

  const folderPath = useMonthFolder
    ? `${LAPORAN_ROOT}/${subDir}/${yyyy}/${monthFolder}`
    : `${LAPORAN_ROOT}/${subDir}/${yyyy}`;

  const fileName = params.fileName || `${dd} ${monthName} ${yyyy} (${shiftCode}) - ${freqName}.pdf`;
  const objectKey = `${folderPath}/${fileName}`;

  return { folderPath, fileName, objectKey };
}

export function getReportObjectKey(params: Parameters<typeof getReportFolderPathAndFileName>[0]): string {
  return getReportFolderPathAndFileName(params).objectKey;
}

/**
 * 2. ABSEN OBJECT KEY GENERATOR
 * !Kantor/3. Absen/<TAHUN>/<BULAN>/<TANGGAL>/<Shift>_<TechnicianID>_<Nama Teknisi>_<Jenis Absen>.<ext>
 * Contoh: !Kantor/3. Absen/2026/September/25/Shift Pagi_1_Luthfianda Muzaki Sulaeman_Absen Masuk.jpg
 */
export function getAttendanceFolderPathAndFileName(params: {
  dateStr?: string;       // "2026-09-25"
  shift?: string;         // "Pagi" | "Malam" | "Shift Pagi" | "Shift Malam" | "PS" | "M"
  technicianId?: number | string; // 1
  technicianName?: string;// "Luthfianda Muzaki Sulaeman"
  attendanceType?: 'masuk' | 'pulang' | 'grace_period' | 'bypass' | string;
  ext?: string;           // "jpg"
}): { folderPath: string; fileName: string; objectKey: string } {
  const cleanDate = getJakartaDateString(params.dateStr);
  const [yyyyStr, mmStr, ddStr] = cleanDate.split('-');
  const yyyy = parseInt(yyyyStr, 10);
  const mIdx = Math.max(0, Math.min(11, parseInt(mmStr, 10) - 1));
  const monthName = INDONESIAN_MONTHS[mIdx];
  const dd = ddStr;

  const folderPath = `${ABSEN_ROOT}/${yyyy}/${monthName}/${dd}`;

  // Shift formatting: "Shift Pagi" or "Shift Malam"
  let shiftStr = params.shift || 'Pagi';
  const sUpper = shiftStr.toUpperCase();
  if (!sUpper.startsWith('SHIFT')) {
    if (sUpper.includes('MALAM') || sUpper === 'M') {
      shiftStr = 'Shift Malam';
    } else if (sUpper.includes('SIANG')) {
      shiftStr = 'Shift Siang';
    } else {
      shiftStr = 'Shift Pagi';
    }
  }

  const techId = params.technicianId || '1';
  const rawTechName = params.technicianName || 'Teknisi';
  const sanitizedTechName = sanitizeFileNamePart(rawTechName) || 'Teknisi';

  let jenisAbsen = 'Absen Masuk';
  const attType = (params.attendanceType || 'masuk').toLowerCase();
  if (attType === 'pulang') {
    jenisAbsen = 'Absen Pulang';
  } else if (attType === 'masuk') {
    jenisAbsen = 'Absen Masuk';
  } else if (attType === 'grace_period') {
    jenisAbsen = 'Absen Grace Period';
  } else if (attType === 'bypass') {
    jenisAbsen = 'Absen Bypass';
  } else {
    jenisAbsen = `Absen ${sanitizeFileNamePart(attType)}`;
  }

  const safeExt = (params.ext || 'jpg').replace(/^\./, '');
  const timeTag = getJakartaTimeString().replace(/[^0-9]/g, '').slice(0, 6) || String(Date.now()).slice(-6);
  const fileName = `${shiftStr}_${techId}_${sanitizedTechName}_${jenisAbsen}_${timeTag}.${safeExt}`;
  const objectKey = `${folderPath}/${fileName}`;

  return { folderPath, fileName, objectKey };
}

export function getAttendanceObjectKey(params: Parameters<typeof getAttendanceFolderPathAndFileName>[0]): string {
  return getAttendanceFolderPathAndFileName(params).objectKey;
}
