/**
 * Centralized Application Logger with Asia/Jakarta (WIB) Timestamping
 * Format: [YYYY-MM-DD HH:mm:ss WIB] [LEVEL] [CONTEXT]: Message
 */

export const JAKARTA_TIMEZONE = 'Asia/Jakarta';

/**
 * Returns formatted timestamp in Jakarta Time (WIB)
 * Example: "2026-10-03 23:14:05 WIB"
 */
export function getJakartaLogTimestamp(dateInput?: Date | number | string): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const safeDate = isNaN(d.getTime()) ? new Date() : d;

  try {
    const parts = new Intl.DateTimeFormat('id-ID', {
      timeZone: JAKARTA_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(safeDate);

    const map: Record<string, string> = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });

    const day = map.day || '01';
    const month = map.month || '01';
    const year = map.year || '2026';
    const hour = map.hour || '00';
    const minute = map.minute || '00';
    const second = map.second || '00';

    return `${year}-${month}-${day} ${hour}:${minute}:${second} WIB`;
  } catch (_) {
    // Fallback manual offset (+7 hours)
    const utc = safeDate.getTime() + safeDate.getTimezoneOffset() * 60000;
    const jkt = new Date(utc + 7 * 3600000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${jkt.getFullYear()}-${pad(jkt.getMonth() + 1)}-${pad(jkt.getDate())} ${pad(jkt.getHours())}:${pad(jkt.getMinutes())}:${pad(jkt.getSeconds())} WIB`;
  }
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  details?: any;
  stack?: string;
}

export function formatLogEntry(level: LogLevel, context: string, message: string, details?: any): string {
  const timestamp = getJakartaLogTimestamp();
  let detailsStr = '';
  if (details !== undefined && details !== null) {
    if (details instanceof Error) {
      detailsStr = ` | Error: ${details.message}${details.stack ? `\nStack: ${details.stack}` : ''}`;
    } else if (typeof details === 'object') {
      try {
        detailsStr = ` | Data: ${JSON.stringify(details)}`;
      } catch (_) {
        detailsStr = ` | Data: [Circular/Unserializable]`;
      }
    } else {
      detailsStr = ` | Details: ${String(details)}`;
    }
  }

  return `[${timestamp}] [${level}] [${context}]: ${message}${detailsStr}`;
}

/**
 * Sends critical errors to the backend for persistent file logging in /logs/error.log
 */
async function sendErrorToBackend(entry: LogEntry): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/logs/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch (_) {
    // Suppress secondary network error to prevent recursive logging loops
  }
}

export const logger = {
  info(context: string, message: string, details?: any): void {
    const formatted = formatLogEntry('INFO', context, message, details);
    console.log(formatted);
  },

  warn(context: string, message: string, details?: any): void {
    const formatted = formatLogEntry('WARN', context, message, details);
    console.warn(formatted);
  },

  error(context: string, message: string, errorOrDetails?: any): void {
    const formatted = formatLogEntry('ERROR', context, message, errorOrDetails);
    console.error(formatted);

    const stack = errorOrDetails instanceof Error ? errorOrDetails.stack : undefined;
    const entry: LogEntry = {
      timestamp: getJakartaLogTimestamp(),
      level: 'ERROR',
      context,
      message,
      details: errorOrDetails instanceof Error ? { message: errorOrDetails.message, name: errorOrDetails.name } : errorOrDetails,
      stack,
    };

    sendErrorToBackend(entry);
  },

  debug(context: string, message: string, details?: any): void {
    if (process.env.NODE_ENV !== 'production') {
      const formatted = formatLogEntry('DEBUG', context, message, details);
      console.debug(formatted);
    }
  },
};
