/**
 * Standard Time & Date Presentation Utilities for NTI Preventive/Corrective System.
 * Ensures clean, concise, and consistent formatting across reports, exports, tables, and UI cards.
 *
 * Examples:
 * - Date: "10 Agustus 2026" or "Senin, 10 Agustus 2026"
 * - Single Time: "21.30 WIB"
 * - Time Range: "21.30 - 23.15 WIB"
 * - Date + Time: "10 Agustus 2026, 21.30 WIB"
 */

const MONTHS_INDONESIAN_FULL = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const MONTHS_INDONESIAN_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'
];

const DAYS_INDONESIAN = [
  'Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'
];

/**
 * Formats a date string (e.g. "2026-08-10" or ISO string) to concise Indonesian date ("10 Agustus 2026").
 */
export function formatIndonesianDate(
  dateStr?: string,
  options: { includeDayName?: boolean; shortMonth?: boolean } = {}
): string {
  if (!dateStr || dateStr.trim() === '') return '-';

  const cleanStr = dateStr.trim();

  // If already formatted like "10 Agustus 2026" or "Senin, 10 Agustus 2026"
  if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(cleanStr)) {
    return cleanStr;
  }

  let dateObj: Date | null = null;

  if (/^\d{4}-\d{2}-\d{2}/.test(cleanStr)) {
    const parts = cleanStr.split('T')[0].split(' ')[0].split('-');
    if (parts.length === 3) {
      dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
  }

  if (!dateObj || isNaN(dateObj.getTime())) {
    dateObj = new Date(cleanStr);
  }

  if (!dateObj || isNaN(dateObj.getTime())) {
    return cleanStr; // fallback to original if unparseable
  }

  const dayNum = String(dateObj.getDate()).padStart(2, '0');
  const monthList = options.shortMonth ? MONTHS_INDONESIAN_SHORT : MONTHS_INDONESIAN_FULL;
  const monthName = monthList[dateObj.getMonth()];
  const yearNum = dateObj.getFullYear();

  if (options.includeDayName) {
    const dayName = DAYS_INDONESIAN[dateObj.getDay()];
    return `${dayName}, ${dayNum} ${monthName} ${yearNum}`;
  }

  return `${dayNum} ${monthName} ${yearNum}`;
}

/**
 * Normalizes a time string or ISO timestamp (e.g. "2026-09-21T08:27:00Z", "15:30:00", "15:30", "15.30") to "15.30 WIB".
 */
export function formatTimeShort(timeStr?: string, withWibSuffix: boolean = true): string {
  if (!timeStr || timeStr.trim() === '') return '-';

  let clean = timeStr.trim().replace(/WIB/gi, '').trim();

  // If this is an ISO timestamp with full date or timezone (e.g. 2026-09-21T15:35:00Z, 2026-09-21T22:35:00+07:00)
  if (clean.includes('T') || (clean.includes('-') && (clean.includes(':') || clean.includes('Z')))) {
    const hasExplicitTz = clean.endsWith('Z') || /[+-]\d{2}(:\d{2})?$/.test(clean) || clean.includes('Z+');
    const parseable = hasExplicitTz ? clean : `${clean.replace(' ', 'T')}+07:00`;
    const d = new Date(parseable);
    if (!isNaN(d.getTime())) {
      try {
        const formatter = new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        const parts = formatter.formatToParts(d);
        const hour = parts.find((p) => p.type === 'hour')?.value.padStart(2, '0') || '00';
        const minute = parts.find((p) => p.type === 'minute')?.value.padStart(2, '0') || '00';
        const formatted = `${hour}.${minute}`;
        return withWibSuffix ? `${formatted} WIB` : formatted;
      } catch {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const formatted = `${hh}.${mm}`;
        return withWibSuffix ? `${formatted} WIB` : formatted;
      }
    }
  }

  // Extract HH:mm or HH.mm from string
  const timeMatch = clean.match(/(\d{1,2})[:.](\d{2})/);
  if (timeMatch) {
    const hh = timeMatch[1].padStart(2, '0');
    const mm = timeMatch[2];
    clean = `${hh}.${mm}`;
  } else {
    // If only number like "21"
    const num = parseInt(clean, 10);
    if (!isNaN(num)) {
      clean = `${String(num).padStart(2, '0')}.00`;
    }
  }

  return withWibSuffix ? `${clean} WIB` : clean;
}

/**
 * Parses hours and minutes from various time formats (HH:mm, HH.mm, ISO string, etc.) in Asia/Jakarta timezone.
 */
export function parseHoursAndMinutes(timeStr?: string): { hours: number; minutes: number } | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const clean = timeStr.trim().replace(/WIB/gi, '').trim();

  // If ISO or contains date separator
  if (clean.includes('T') || (clean.includes('-') && clean.includes(':'))) {
    const hasExplicitTz = clean.endsWith('Z') || /[+-]\d{2}(:\d{2})?$/.test(clean) || clean.includes('Z+');
    const parseable = hasExplicitTz ? clean : `${clean.replace(' ', 'T')}+07:00`;
    const d = new Date(parseable);
    if (!isNaN(d.getTime())) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Jakarta',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
        });
        const parts = formatter.formatToParts(d);
        const h = Number(parts.find((p) => p.type === 'hour')?.value ?? d.getHours());
        const m = Number(parts.find((p) => p.type === 'minute')?.value ?? d.getMinutes());
        return { hours: h === 24 ? 0 : h, minutes: m };
      } catch {
        return { hours: d.getHours(), minutes: d.getMinutes() };
      }
    }
  }

  const match = clean.match(/(\d{1,2})[:.](\d{2})/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (!isNaN(h) && !isNaN(m)) {
      return { hours: h % 24, minutes: m % 60 };
    }
  }
  return null;
}

/**
 * Rounds a time string (HH:mm, HH.mm, or ISO) DOWN to nearest 5-minute interval.
 * Example: 20:23 -> 20:20, 20:28 -> 20:25, 08:04 -> 08:00
 */
export function roundTimeDown5Min(timeStr?: string): string {
  if (!timeStr || timeStr === '-') return '-';
  const parsed = parseHoursAndMinutes(timeStr);
  if (!parsed) return timeStr;

  let { hours, minutes } = parsed;
  minutes = Math.floor(minutes / 5) * 5;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Rounds a time string (HH:mm, HH.mm, or ISO) UP to nearest 5-minute interval.
 * Example: 21:09 -> 21:10, 21:02 -> 21:05, 14:58 -> 15:00
 */
export function roundTimeUp5Min(timeStr?: string): string {
  if (!timeStr || timeStr === '-') return '-';
  const parsed = parseHoursAndMinutes(timeStr);
  if (!parsed) return timeStr;

  let { hours, minutes } = parsed;
  minutes = Math.ceil(minutes / 5) * 5;
  if (minutes >= 60) {
    minutes = 0;
    hours = (hours + 1) % 24;
  }

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Formats start and end times into concise time range: "21.30 s/d 23.15 WIB".
 */
export function formatTimeRange(startTime?: string, endTime?: string): string {
  const sTime = formatTimeShort(startTime, false);
  const eTime = formatTimeShort(endTime, false);

  if (sTime === '-' && eTime === '-') return '-';
  if (sTime !== '-' && (eTime === '-' || eTime === sTime)) {
    return `${sTime} WIB`;
  }
  return `${sTime} s/d ${eTime} WIB`;
}

/**
 * Formats a full date-time string (e.g. "2026-08-10T08:27:00Z" or "2026-08-10 21:30:00") to "10 Agustus 2026, 21.30 WIB".
 */
export function formatDateTimeShort(dateTimeStr?: string): string {
  if (!dateTimeStr || dateTimeStr.trim() === '') return '-';

  const clean = dateTimeStr.trim();
  const dateFormatted = formatIndonesianDate(clean, { shortMonth: false });
  const timeFormatted = formatTimeShort(clean, true);

  if (dateFormatted !== '-' && timeFormatted !== '-') {
    return `${dateFormatted}, ${timeFormatted}`;
  }
  if (dateFormatted !== '-') return dateFormatted;
  return clean;
}
