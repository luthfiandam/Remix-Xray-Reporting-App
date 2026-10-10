/**
 * Calculates the ISO-8601 week number and ISO week-numbering year.
 * In ISO-8601:
 * - Weeks start on Monday (Day 1) and end on Sunday (Day 7).
 * - Week 1 of a year is the week containing the first Thursday of that year (or Jan 4).
 * - Correctly handles year boundary transitions (e.g. Dec 29-31 or Jan 1-3).
 */
export function getIsoWeekString(date: Date): string {
  // Target date copy to avoid mutation
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  
  // ISO day of week: Monday is 1, Sunday is 7
  const dayNr = (target.getUTCDay() + 6) % 7 + 1;
  
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's dayNr 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNr);
  
  // Get first day of year
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7 + 1;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDayNr);
  
  // Calculate full weeks to nearest Thursday
  const weekNo = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Generates a standard canonical period key for an operational date based on frequency ID.
 * - Freq 1 (Harian): YYYY-MM-DD
 * - Freq 2 (Mingguan): YYYY-Www (ISO-8601 Week)
 * - Freq 3 (Bulanan): YYYY-MM
 * - Freq 4 (Triwulan): YYYY-Q1 .. YYYY-Q4
 * - Freq 5 (Semesteran): YYYY-S1 .. YYYY-S2
 * - Freq 6 (Tahunan): YYYY
 */
export function getPeriodKey(frequencyId: number, dateStr: string): string {
  if (!dateStr) return '';
  
  // Default values
  let year = 2026;
  let month = 7; // August (0-indexed)
  let day = 6;
  
  const matches = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (matches) {
    year = parseInt(matches[1], 10);
    month = parseInt(matches[2], 10) - 1;
    day = parseInt(matches[3], 10);
  } else {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear();
      month = d.getMonth();
      day = d.getDate();
    } else {
      return dateStr; // fallback
    }
  }
  
  const dateObj = new Date(year, month, day);
  const monthStr = String(month + 1).padStart(2, '0');
  
  switch (frequencyId) {
    case 1: // Harian: YYYY-MM-DD
      return `${year}-${monthStr}-${String(day).padStart(2, '0')}`;
      
    case 2: // Mingguan: ISO-8601 Week YYYY-Www
      return getIsoWeekString(dateObj);
    
    case 3: // Bulanan: YYYY-MM
      return `${year}-${monthStr}`;
      
    case 4: { // Triwulan: YYYY-Q1 .. YYYY-Q4
      const q = Math.ceil((month + 1) / 3);
      return `${year}-Q${q}`;
    }
    
    case 5: { // Semesteran: YYYY-S1 .. YYYY-S2
      const s = month < 6 ? 1 : 2;
      return `${year}-S${s}`;
    }
    
    case 6: // Tahunan: YYYY
      return String(year);
      
    default:
      return dateStr;
  }
}

/**
 * Provides standard SOP default notes according to inspection frequency and equipment type.
 */
export function getDefaultNotesForFrequency(frequencyId: number, equipmentTypeCode?: string): string {
  const freq = Number(frequencyId);
  const typeCode = (equipmentTypeCode || '').toUpperCase();

  if (freq === 2) {
    // Mingguan
    if (typeCode === 'XRAY') {
      return 'Hasil dari pengecekan , Pemeriksaan Light Barriers, Pemeriksaan PE (Protective Eart) Wiring, dan Pemeriksaan Emergency Stop Switches semua keadaanya baik berjalan dengan normal.';
    }
    if (typeCode === 'WTMD') {
      return 'Sudah dilakukan pengecekan alert system audible yang bisa terdengar dan visible yang bisa terlihat oleh mata (indikator led), semua berjalan normal.';
    }
    return 'Hasil dari pengecekan dan pemeriksaan mingguan semua keadaanya baik berjalan dengan normal.';
  }

  if (freq === 3) {
    // Bulanan
    if (typeCode === 'XRAY') {
      return 'Sudah dilakukan Preventive Bulanan untuk fitur gambar meliputi Zoom in dan zoom out, High Material, Black&White, Organic Stripping, In Organic Stripping, Negative Image, dan pengecekan kapasitas harddisk. \nHasil Normal tidak ada kendala.';
    }
    if (typeCode === 'WTMD') {
      return 'sudah di lakukan Peventive Bulanan meliputi pengecekan interferensi elektrikal, interferensi mekanikal, pengecekan UPS Fan, UPS Backup Time. Hasil Normal tidak ada kendala.';
    }
    if (typeCode === 'HHMD') {
      return 'sudah di lakukan Peventive Bulanan meliputi Pemeriksaan sensitivitas dan pengecekan fisik HHMD.';
    }
    return 'Sudah dilakukan Preventive Bulanan. Hasil Normal tidak ada kendala.';
  }

  if (freq === 4 || freq === 5) {
    // Triwulan & Semesteran
    if (typeCode === 'XRAY') {
      return '⦁ Sudah dilakukan pembersihan bagian dalam body mesin X-Ray.\n⦁ Interlock berfungsi normal semua.\n⦁ Konfigurasi jam dan tanggal sudah disesuaikan dengan real-time.\n⦁ Pemeriksaan power supply fan xray , hasil normal.';
    }
    if (typeCode === 'WTMD') {
      return '⦁ Sudah dilakukan pengecekan Control Unit, ready light and alarm light, LCD Panel, dan LED Bar Graph pada WTMD. Berfungsi Normal.';
    }
    return '⦁ Sudah dilakukan pembersihan dan pemeriksaan komponen internal. Berfungsi normal.';
  }

  // Default Harian (freq 1) or Tahunan (freq 6)
  return 'Sudah dilakukan kalibrasi dan pembersihan. Equipment bisa digunakan dengan normal.';
}
