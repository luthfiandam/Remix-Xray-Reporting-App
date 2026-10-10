import { normalizeShift } from './contextFilter';

export const APP_TIME_ZONE = 'Asia/Jakarta';

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  januari: '01', februari: '02', maret: '03', april: '04', mei: '05', juni: '06',
  juli: '07', agustus: '08', september: '09', oktober: '10', november: '11', desember: '12'
};

/**
 * Returns canonical Jakarta calendar date in YYYY-MM-DD format.
 */
export function getJakartaDateString(dateInput?: Date | string | number | null): string {
  if (!dateInput) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date());
  }

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch && parseInt(isoMatch[1], 10) >= 2000 && !trimmed.includes('T') && !trimmed.includes(' ')) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
  }

  let d: Date;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else {
    d = new Date(dateInput);
  }

  if (isNaN(d.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date());
  }

  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(d);
}

/**
 * Returns Date object localized in Asia/Jakarta timezone.
 */
export function getJakartaDate(dateInput: Date = new Date()): Date {
  const jakartaTimeString = dateInput.toLocaleString('en-US', { timeZone: APP_TIME_ZONE });
  return new Date(jakartaTimeString);
}

/**
 * Computes exact UTC boundary ISO strings for a Jakarta calendar day (YYYY-MM-DD).
 * Jakarta 00:00:00+07:00 -> UTC 17:00:00.000Z previous day
 * Next Jakarta 00:00:00+07:00 -> UTC 17:00:00.000Z current day
 */
export function getJakartaDayBoundariesUTC(dateStr: string): { startIsoUTC: string; endIsoUTC: string } {
  const cleanDate = getJakartaDateString(dateStr);
  const [year, month, day] = cleanDate.split('-').map((n) => parseInt(n, 10));

  // Jakarta 00:00:00+07:00 is (day - 1) 17:00:00 UTC
  const startUtc = new Date(Date.UTC(year, month - 1, day - 1, 17, 0, 0, 0));
  // Next Jakarta 00:00:00+07:00 is (day) 17:00:00 UTC
  const endUtc = new Date(Date.UTC(year, month - 1, day, 17, 0, 0, 0));

  return {
    startIsoUTC: startUtc.toISOString(),
    endIsoUTC: endUtc.toISOString(),
  };
}

/**
 * Formats date into Indonesian localized string in Asia/Jakarta timezone.
 * e.g., "27 September 2026" or "Minggu, 27 September 2026"
 */
export function formatIndonesianDate(
  dateInput?: Date | string | number | null,
  options?: { includeDayName?: boolean }
): string {
  if (!dateInput) return '-';
  const cleanDate = getJakartaDateString(dateInput);
  const [yyyy, mm, dd] = cleanDate.split('-');
  const monthIdx = parseInt(mm, 10) - 1;
  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const formatted = `${dd} ${MONTH_NAMES[monthIdx]} ${yyyy}`;

  if (options?.includeDayName) {
    const d = new Date(`${cleanDate}T12:00:00+07:00`);
    const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dayName = DAY_NAMES[d.getDay()];
    return `${dayName}, ${formatted}`;
  }

  return formatted;
}

/**
 * Formats date and time into Indonesian localized string in Asia/Jakarta timezone.
 * e.g., "27 September 2026 19:19 WIB"
 */
export function formatIndonesianDateTime(
  dateInput?: Date | string | number | null,
  options?: { includeSeconds?: boolean }
): string {
  if (!dateInput) return '-';
  let d: Date;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else {
    d = new Date(dateInput);
  }

  if (isNaN(d.getTime())) return String(dateInput);

  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: options?.includeSeconds ? '2-digit' : undefined,
  });

  return `${formatter.format(d)} WIB`;
}

/**
 * Gets time component (HH:mm or HH:mm:ss) in Asia/Jakarta timezone.
 */
export function getJakartaTimeString(
  dateInput?: Date | string | number | null,
  options?: { includeSeconds?: boolean }
): string {
  let d = new Date();
  if (dateInput) {
    d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) d = new Date();
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: options?.includeSeconds ? '2-digit' : undefined,
    hour12: false,
  });

  return formatter.format(d);
}

/**
 * Gets current or specified moment in time as ISO-8601 string with explicit Asia/Jakarta offset (+07:00).
 * NOTE: Do NOT use this for PostgreSQL/Supabase timestamptz columns (e.g. created_at/updated_at).
 * Those must store canonical UTC instants (e.g. new Date().toISOString()).
 * Use getJakartaISOString only when an explicit +07:00 formatted string/payload is needed.
 */
export function getJakartaISOString(dateInput?: Date | string | number | null): string {
  let d = new Date();
  if (dateInput) {
    d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) d = new Date();
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}.${ms}+07:00`;
}

/**
 * Checks if a string or date contains a spreadsheet base epoch artifact (e.g. 1899 or 1900).
 */
export function isSpreadsheetEpochArtifact(input?: string | null): boolean {
  if (!input) return false;
  const s = String(input);
  return s.includes('1899') || s.includes('1900') || s.includes('Dec 30') || s.includes('1899-12-30');
}

/**
 * Normalizes an operational date to canonical YYYY-MM-DD representation.
 * Always resolves calendar date in Asia/Jakarta context without UTC day-shifting.
 *
 * Examples:
 * - "2026-08-18" -> "2026-08-18"
 * - "Tue Aug 18 2026 00:00:00 GMT+0700 (Western Indonesia Time)" -> "2026-08-18"
 * - "18/08/2026" -> "2026-08-18"
 * - "2026-08-18T04:33:00.000Z" -> "2026-08-18"
 */
export function normalizeOperationalDate(input?: string | Date | null): string {
  if (!input) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  }

  if (input instanceof Date) {
    if (isNaN(input.getTime()) || input.getFullYear() < 2000) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(input);
  }

  const str = String(input).trim();
  if (!str) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  }

  // 1. Direct ISO Date pattern: YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch && parseInt(isoMatch[1], 10) >= 2000) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. Localized format: DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (ddmmyyyyMatch && parseInt(ddmmyyyyMatch[3], 10) >= 2000) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // 3. String like "Tue Aug 18 2026 00:00:00 GMT+0700..."
  const textDateMatch = str.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (textDateMatch) {
    const monthKey = textDateMatch[1].toLowerCase();
    const monthNum = MONTH_MAP[monthKey];
    const day = textDateMatch[2].padStart(2, '0');
    const year = textDateMatch[3];
    if (monthNum && parseInt(year, 10) >= 2000) {
      return `${year}-${monthNum}-${day}`;
    }
  }

  // 4. Fallback: Parse via Date object with Jakarta timezone formatting
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(parsed);
  }

  // Fallback to today in Jakarta
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/**
 * Extracts time components (HH:mm:ss) from various formats localized in Asia/Jakarta timezone.
 * Explicitly respects ISO timestamps with UTC/other offsets (e.g. "2026-10-09T07:10:00Z" -> 14:10:00 WIB).
 */
export function extractTimeComponent(input?: string | Date | null): {
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string;
} {
  const pad = (n: number) => String(n).padStart(2, '0');

  if (!input) {
    const d = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const h = parseInt(map.hour === '24' ? '0' : map.hour, 10);
    const m = parseInt(map.minute, 10);
    const s = parseInt(map.second, 10);
    return {
      hours: h,
      minutes: m,
      seconds: s,
      formatted: `${pad(h)}:${pad(m)}:${pad(s)}`,
    };
  }

  if (input instanceof Date) {
    if (isNaN(input.getTime())) {
      return extractTimeComponent(null);
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(input);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const h = parseInt(map.hour === '24' ? '0' : map.hour, 10);
    const m = parseInt(map.minute, 10);
    const s = parseInt(map.second, 10);
    return {
      hours: h,
      minutes: m,
      seconds: s,
      formatted: `${pad(h)}:${pad(m)}:${pad(s)}`,
    };
  }

  const str = String(input).trim();

  // 1. Spreadsheet epoch artifact (year < 2000, e.g. 1899-12-30T14:10:00.000Z):
  // In spreadsheets, time was entered as raw wall-clock time without time zone intent.
  if (isSpreadsheetEpochArtifact(str)) {
    const timeMatch = str.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
    if (timeMatch) {
      const h = Math.min(23, Math.max(0, parseInt(timeMatch[1], 10)));
      const m = Math.min(59, Math.max(0, parseInt(timeMatch[2], 10)));
      const s = timeMatch[3] ? Math.min(59, Math.max(0, parseInt(timeMatch[3], 10))) : 0;
      return {
        hours: h,
        minutes: m,
        seconds: s,
        formatted: `${pad(h)}:${pad(m)}:${pad(s)}`,
      };
    }
  }

  // 2. Full datetime string with year >= 2000 (e.g. ISO-8601 with or without UTC offset)
  // Must convert the instant into Asia/Jakarta time (e.g. 07:10:00Z -> 14:10:00 WIB)
  const isFullDate = /^\d{4}-\d{2}-\d{2}/.test(str) || (str.includes('T') && str.includes('-'));
  if (isFullDate) {
    const hasExplicitTz = str.endsWith('Z') || /[+-]\d{2}(:\d{2})?$/.test(str) || str.includes('Z+') || str.includes('+00');
    const parseable = hasExplicitTz ? str : `${str.replace(' ', 'T')}+07:00`;
    const parsedDate = new Date(parseable);
    if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() >= 2000) {
      return extractTimeComponent(parsedDate);
    }
  }

  // 3. Simple time-only format: HH:mm:ss or HH:mm or HH.mm
  const timeMatch = str.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  if (timeMatch) {
    const h = Math.min(23, Math.max(0, parseInt(timeMatch[1], 10)));
    const m = Math.min(59, Math.max(0, parseInt(timeMatch[2], 10)));
    const s = timeMatch[3] ? Math.min(59, Math.max(0, parseInt(timeMatch[3], 10))) : 0;
    return {
      hours: h,
      minutes: m,
      seconds: s,
      formatted: `${pad(h)}:${pad(m)}:${pad(s)}`,
    };
  }

  return extractTimeComponent(null);
}

/**
 * Normalizes submitted_at to a canonical ISO-8601 moment-in-time timestamp (UTC+07:00).
 *
 * CRITICAL REQUIREMENTS:
 * 1. If input is ALREADY a valid ISO timestamp with full date (year >= 2000), preserve the exact instant!
 *    Converts it to Asia/Jakarta representation (+07:00) without repeatedly subtracting or adding 7 hours.
 * 2. If input is a local time string (e.g. "14:10" from getTrustedJakartaTimeString), binds to operationalDate
 *    (or operationalDate + 1 day for Shift Malam between 00:00 and 06:59:59).
 * 3. Resolves spreadsheet epoch artifacts (1899/1900) by extracting time and binding to operationalDate.
 */
export function normalizeSubmittedDateTime(
  submittedInput?: string | Date | null,
  operationalDateInput?: string | Date | null,
  shiftStr?: string
): string {
  // If input is ALREADY a full date ISO timestamp (year >= 2000) and not an 1899 spreadsheet artifact:
  if (submittedInput && !isSpreadsheetEpochArtifact(String(submittedInput))) {
    if (submittedInput instanceof Date && !isNaN(submittedInput.getTime()) && submittedInput.getFullYear() >= 2000) {
      return getJakartaISOString(submittedInput);
    }
    const str = String(submittedInput).trim();
    const isIsoOrFullDate = /^\d{4}-\d{2}-\d{2}/.test(str) || (str.includes('T') && str.includes('-'));
    if (isIsoOrFullDate) {
      const hasExplicitTz = str.endsWith('Z') || /[+-]\d{2}(:\d{2})?$/.test(str) || str.includes('Z+') || str.includes('+00');
      const parseable = hasExplicitTz ? str : `${str.replace(' ', 'T')}+07:00`;
      const parsed = new Date(parseable);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
        // Return canonical Jakarta ISO string (+07:00). Guaranteed IDEMPOTENT.
        return getJakartaISOString(parsed);
      }
    }
  }

  // Otherwise, input is a time-only string (e.g. "14:10"), spreadsheet artifact, or null/empty:
  const cleanOpDate = normalizeOperationalDate(operationalDateInput);
  const timeComp = extractTimeComponent(submittedInput);
  const normShift = normalizeShift(shiftStr);

  const [opYear, opMonth, opDay] = cleanOpDate.split('-').map((n) => parseInt(n, 10));

  let calendarYear = opYear;
  let calendarMonth = opMonth;
  let calendarDay = opDay;

  // If Shift Malam and submission was between 00:00 and 06:59:59, submission is on next calendar day
  if (normShift === 'Malam' && timeComp.hours < 7) {
    const nextDayUtc = new Date(Date.UTC(opYear, opMonth - 1, opDay + 1));
    calendarYear = nextDayUtc.getUTCFullYear();
    calendarMonth = nextDayUtc.getUTCMonth() + 1;
    calendarDay = nextDayUtc.getUTCDate();
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const calDateStr = `${calendarYear}-${pad(calendarMonth)}-${pad(calendarDay)}`;

  return `${calDateStr}T${timeComp.formatted}+07:00`;
}

/**
 * Normalizes created_at / updated_at historical timestamps.
 * Preserves existing valid ISO timestamps (year >= 2020).
 * Reconstructs from operational date if invalid or infected with 1899/1900 spreadsheet artifact.
 */
export function normalizeHistoricalTimestamp(
  timestampInput?: string | Date | null,
  fallbackOperationalDate?: string | Date | null,
  fallbackShift?: string
): string {
  if (!timestampInput) {
    return normalizeSubmittedDateTime(null, fallbackOperationalDate, fallbackShift);
  }

  if (isSpreadsheetEpochArtifact(String(timestampInput))) {
    return normalizeSubmittedDateTime(timestampInput, fallbackOperationalDate, fallbackShift);
  }

  if (timestampInput instanceof Date) {
    if (isNaN(timestampInput.getTime()) || timestampInput.getFullYear() < 2020) {
      return normalizeSubmittedDateTime(timestampInput, fallbackOperationalDate, fallbackShift);
    }
    return timestampInput.toISOString();
  }

  const str = String(timestampInput).trim();

  // If already full ISO-8601 with year >= 2020 (e.g. 2026-08-18T...)
  const isoMatch = str.match(/^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  if (isoMatch && parseInt(isoMatch[1], 10) >= 2020) {
    return str;
  }

  // Attempt standard Date parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2020) {
    return parsed.toISOString();
  }

  return normalizeSubmittedDateTime(str, fallbackOperationalDate, fallbackShift);
}
