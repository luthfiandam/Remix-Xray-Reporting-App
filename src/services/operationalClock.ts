import { getOperationalShift } from '../utils/technicianSchedule';
import { roundTimeDown5Min, roundTimeUp5Min } from '../utils/timeFormat';

export interface OperationalContext {
  calendar_date: string;       // YYYY-MM-DD in Asia/Jakarta timezone
  operational_date: string;    // YYYY-MM-DD applying Midnight Rule
  shift: 'Pagi' | 'Malam';     // 'Pagi' | 'Malam'
  local_time: string;          // HH:mm format in WIB
}

/**
 * Server-Authoritative Clock Offset state (Anti-manipulation).
 * Protects against users modifying their device system clock in mobile/desktop settings.
 */
let clockOffsetMs = 0;
let isClockSynchronized = false;
let clockSyncPromise: Promise<void> | null = null;

/**
 * Synchronizes with the backend server clock to determine offset.
 */
export async function syncServerClock(): Promise<void> {
  try {
    const startReq = performance.now();
    const res = await fetch('/api/time', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const endReq = performance.now();
    const rtt = endReq - startReq;

    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.timestamp === 'number') {
        const serverEstimatedNow = data.timestamp + Math.round(rtt / 2);
        clockOffsetMs = serverEstimatedNow - Date.now();
        isClockSynchronized = true;
        return;
      }
    }

    // Fallback: check Date header if /api/time body didn't contain timestamp
    const dateHeader = res.headers.get('date');
    if (dateHeader) {
      const serverDate = new Date(dateHeader);
      if (!isNaN(serverDate.getTime())) {
        clockOffsetMs = (serverDate.getTime() + Math.round(rtt / 2)) - Date.now();
        isClockSynchronized = true;
      }
    }
  } catch {
    // If offline, preserve previous offset or 0
  }
}

/**
 * Initializes trusted clock sync on app startup and auto-refreshes periodically
 */
export function initTrustedClockSync(): void {
  if (typeof window === 'undefined') return;
  if (!clockSyncPromise) {
    clockSyncPromise = syncServerClock();
  }

  // Resync when window gains focus or online
  window.addEventListener('focus', () => {
    syncServerClock().catch(() => {});
  });
  window.addEventListener('online', () => {
    syncServerClock().catch(() => {});
  });
}

// Auto-run initialization
if (typeof window !== 'undefined') {
  initTrustedClockSync();
}

/**
 * Returns a JS Date representing the current trusted time (incorporating server sync offset).
 */
export function getJakartaNow(): Date {
  return new Date(Date.now() + clockOffsetMs);
}

/**
 * Returns formatted "HH:mm" time string in Asia/Jakarta timezone with optional 5-min rounding.
 * - 'down': rounds down to nearest 5 minutes (e.g. 20:23 -> 20:20)
 * - 'up': rounds up to nearest 5 minutes (e.g. 21:09 -> 21:10)
 * - 'none': unrounded true time
 */
export function getTrustedJakartaTimeString(rounding: 'down' | 'up' | 'none' = 'none'): string {
  const targetDate = getJakartaNow();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(targetDate);
  const partMap: Record<string, string> = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') {
      partMap[p.type] = p.value;
    }
  });

  const hour = partMap.hour === '24' ? '00' : partMap.hour;
  const rawTime = `${hour}:${partMap.minute}`;

  if (rounding === 'down') {
    return roundTimeDown5Min(rawTime);
  }
  if (rounding === 'up') {
    return roundTimeUp5Min(rawTime);
  }
  return rawTime;
}

/**
 * Resolves full operational context for a given date in Asia/Jakarta context.
 * 
 * Shift Logic:
 * - 07:00 - 18:59 = Shift Pagi (PS), operationalDate = calendarDate
 * - 19:00 - 23:59 = Shift Malam (M), operationalDate = calendarDate
 * - 00:00 - 06:59 = Shift Malam (M), operationalDate = previous calendarDate
 */
export function resolveOperationalContext(dateInput?: Date | string | number): OperationalContext {
  const targetDate = dateInput ? new Date(dateInput) : getJakartaNow();
  
  // Format into Asia/Jakarta timezone components
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(targetDate);
  const partMap: Record<string, string> = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') {
      partMap[p.type] = p.value;
    }
  });

  const year = partMap.year;
  const month = partMap.month;
  const day = partMap.day;
  const hour = partMap.hour === '24' ? '00' : partMap.hour;
  const minute = partMap.minute;

  const calendar_date = `${year}-${month}-${day}`;
  const local_time = `${hour}:${minute}`;

  const shiftInfo = getOperationalShift(targetDate);

  return {
    calendar_date,
    operational_date: shiftInfo.operationalDate,
    shift: shiftInfo.shift as 'Pagi' | 'Malam',
    local_time,
  };
}
