import { Technician, ShiftType, CorrectiveReport } from '../types';
import { ShiftScheduleV2, ScheduleStatus, ON_DUTY_STATUSES } from '../services/scheduleService';
import { isWeekdayOfficeHour, isSupervisorUser, isOfficeHourStaff } from '../services/scheduleCsvService';
import { getJakartaDateString } from './dateTimeUtils';

export interface OperationalShiftInfo {
  shift: ShiftType;
  shiftCode: 'PS' | 'M';
  operationalDate: string; // YYYY-MM-DD
  startDateTime: Date;
  endDateTime: Date;
}

/**
  * Centralized Operational Shift Resolver for Asia/Jakarta (WIB) timezone.
  *
  * Business Rules:
  * - 07:00:00 to 18:59:59 WIB -> Shift Pagi (PS), operationalDate = current calendar date
  * - 19:00:00 to 23:59:59 WIB -> Shift Malam (M), operationalDate = current calendar date
  * - 00:00:00 to 06:59:59 WIB -> Shift Malam (M), operationalDate = PREVIOUS calendar date (yesterday)
  */
export function getOperationalShift(dateInput?: Date | string | number): OperationalShiftInfo {
  let now: Date;
  if (!dateInput) {
    now = new Date();
  } else if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (trimmed.length === 10 && trimmed.includes('-')) {
      // Date string "YYYY-MM-DD", default to noon WIB
      const isoStr = `${trimmed}T12:00:00+07:00`;
      now = new Date(isoStr);
    } else if (trimmed.includes(' ') || trimmed.includes('T')) {
      // Could be "YYYY-MM-DD HH:mm"
      const normalized = trimmed.replace(' ', 'T');
      if (!normalized.includes('+') && !normalized.includes('Z')) {
        now = new Date(`${normalized}+07:00`);
      } else {
        now = new Date(normalized);
      }
    } else {
      now = new Date(trimmed);
    }
  } else {
    now = new Date(dateInput);
  }

  if (isNaN(now.getTime())) {
    now = new Date();
  }

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

  const parts = formatter.formatToParts(now);
  const partMap: Record<string, string> = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') {
      partMap[p.type] = p.value;
    }
  });

  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10); // 1-12
  const day = parseInt(partMap.day, 10); // 1-31
  const hour = parseInt(partMap.hour, 10); // 0-23
  const minute = parseInt(partMap.minute, 10);
  const second = parseInt(partMap.second, 10);

  let shift: ShiftType = 'Pagi';
  let shiftCode: 'PS' | 'M' = 'PS';

  let opYear = year;
  let opMonth = month;
  let opDay = day;

  if (hour >= 7 && hour < 19) {
    // 07:00:00 - 18:59:59 -> Shift Pagi (PS), operationalDate = today
    shift = 'Pagi';
    shiftCode = 'PS';
  } else if (hour >= 19) {
    // 19:00:00 - 23:59:59 -> Shift Malam (M), operationalDate = today
    shift = 'Malam';
    shiftCode = 'M';
  } else {
    // 00:00:00 - 06:59:59 -> Shift Malam (M), PREVIOUS calendar date (yesterday)
    shift = 'Malam';
    shiftCode = 'M';

    // Subtract 1 day from Jakarta date
    const prevDate = new Date(Date.UTC(year, month - 1, day - 1));
    opYear = prevDate.getUTCFullYear();
    opMonth = prevDate.getUTCMonth() + 1;
    opDay = prevDate.getUTCDate();
  }

  const pad = (num: number) => String(num).padStart(2, '0');
  const operationalDate = `${opYear}-${pad(opMonth)}-${pad(opDay)}`;

  // Start and End UTC timestamps for this operational shift window
  let startUtc: Date;
  let endUtc: Date;

  if (shift === 'Pagi') {
    // Start: opDate 07:00:00 WIB = opDate 00:00:00 UTC
    startUtc = new Date(Date.UTC(opYear, opMonth - 1, opDay, 0, 0, 0));
    // End: opDate 18:59:59.999 WIB = opDate 11:59:59.999 UTC
    endUtc = new Date(Date.UTC(opYear, opMonth - 1, opDay, 11, 59, 59, 999));
  } else {
    // Shift Malam:
    // Start: opDate 19:00:00 WIB = opDate 12:00:00 UTC
    startUtc = new Date(Date.UTC(opYear, opMonth - 1, opDay, 12, 0, 0));
    // End: (opDate + 1 day) 06:59:59.999 WIB = (opDate) 23:59:59.999 UTC
    // Note: opDate 23:59:59.999 UTC corresponds to 06:59:59.999 WIB on next day (UTC+7)!
    endUtc = new Date(Date.UTC(opYear, opMonth - 1, opDay, 23, 59, 59, 999));
  }

  return {
    shift,
    shiftCode,
    operationalDate,
    startDateTime: startUtc,
    endDateTime: endUtc,
  };
}

/**
 * Helper to get local date string YYYY-MM-DD for Asia/Jakarta timezone.
 */
export function getLocalDateString(dateInput: Date = new Date()): string {
  return getJakartaDateString(dateInput);
}

/**
  * Resolves the operational shift for a CorrectiveReport based on its date & start_time.
  */
export function getOperationalShiftForCorrective(report: Partial<CorrectiveReport>): OperationalShiftInfo {
  let dateStr = report.corrective_date; // "YYYY-MM-DD"
  let timeStr = report.start_time;       // "HH:mm" or "HH.mm"

  if (!dateStr || !timeStr) {
    if (report.created_at && report.created_at.includes(' ')) {
      const [cDate, cTime] = report.created_at.trim().split(/\s+/);
      if (!dateStr && cDate && cDate.includes('-')) dateStr = cDate;
      if (!timeStr && cTime && (cTime.includes(':') || cTime.includes('.'))) timeStr = cTime;
    }
  }

  const explicitDateProvided = Boolean(dateStr && dateStr.trim().length === 10);
  if (!dateStr) dateStr = getLocalDateString();
  if (!timeStr) timeStr = '00:00';

  timeStr = timeStr.replace('.', ':');
  const timeParts = timeStr.split(':');
  const hhNum = parseInt(timeParts[0] || '0', 10);
  const hh = String(isNaN(hhNum) ? 0 : hhNum).padStart(2, '0');

  const isoStr = `${dateStr}T${hh}:00:00+07:00`;
  const dt = new Date(isoStr);

  if (isNaN(dt.getTime())) {
    return getOperationalShift(dateStr);
  }

  const resolved = getOperationalShift(dt);

  if (explicitDateProvided && dateStr) {
    const shift = (hhNum >= 7 && hhNum < 19) ? 'Pagi' : 'Malam';
    const shiftCode = shift === 'Pagi' ? 'PS' : 'M';
    return {
      ...resolved,
      shift,
      shiftCode,
      operationalDate: dateStr,
    };
  }

  return resolved;
}

export function getDefaultTechniciansForShift(
  technicians: Technician[],
  shift: ShiftType,
  dateStr: string
): number[] {
  const shiftCode = shift === 'Pagi' ? 'PS' : 'M';
  const resolved = resolveActiveSessionStaff(technicians, shiftCode, dateStr, null);
  return resolved.onDutyIds;
}

/**
 * Resolves active session staff (technicians and supervisor) for a given operational date, shift, and schedule.
 *
 * CANONICAL RULES:
 * 1. PS Shift on Monday–Friday (Senin–Jumat): Supervisor (Office Hour) + on-duty PS Technicians.
 * 2. PS Shift on Saturday–Sunday (Sabtu–Minggu): ONLY on-duty PS Technicians (Supervisor defaults to Libur/off).
 * 3. M Shift on any day: ONLY on-duty M Technicians (Supervisor is NEVER automatically scheduled on M).
 * 4. Assignments with status 'off' (Libur), 'leave' (Cuti), 'sick' (Sakit), 'permission' (Izin) MUST NOT enter active session.
 * 5. If manual override was set on draft/firestore (e.g. Supervisor Cuti/Sakit on weekday PS, or Supervisor Lembur on weekend PS),
 *    the active session respects the actual on-duty statuses ('scheduled', 'backup', 'overtime').
 */
export function resolveActiveSessionStaff(
  technicians: Technician[],
  shiftCode: 'PS' | 'M',
  operationalDate: string,
  scheduleDoc?: ShiftScheduleV2 | null
): {
  onDutyIds: number[];
  onDutyNames: string[];
  supervisorOnDuty: boolean;
  technicianIds: number[];
  technicianNames: string[];
} {
  const isWeekday = isWeekdayOfficeHour(operationalDate);
  const activeTechs = technicians.filter((t) => t.active);
  const onDutyIds: number[] = [];
  const onDutyNames: string[] = [];
  const technicianIds: number[] = [];
  const technicianNames: string[] = [];
  let supervisorOnDuty = false;

  if (scheduleDoc && scheduleDoc.assignments && Object.keys(scheduleDoc.assignments).length > 0) {
    // Read directly from published or draft schedule document assignments
    Object.entries(scheduleDoc.assignments).forEach(([techIdStr, assign]) => {
      if (ON_DUTY_STATUSES.includes(assign.status as ScheduleStatus)) {
        const tId = Number(techIdStr);
        const techObj = activeTechs.find((t) =>
          t.id === tId ||
          String(t.id) === techIdStr ||
          (t.name && assign.technician_name && t.name.toLowerCase().trim() === assign.technician_name.toLowerCase().trim())
        );
        const resolvedId = techObj?.id || (!isNaN(tId) && tId > 0 ? tId : null);
        const name = techObj?.name || assign.technician_name || `Tech ${techIdStr}`;
        const isSup = isSupervisorUser(techObj || { role: undefined, id: resolvedId || tId, name }, technicians);

        if (resolvedId && !onDutyIds.includes(resolvedId)) {
          onDutyIds.push(resolvedId);
          onDutyNames.push(name);
        }

        if (isSup) {
          supervisorOnDuty = true;
        } else if (resolvedId) {
          if (!technicianIds.includes(resolvedId)) {
            technicianIds.push(resolvedId);
            technicianNames.push(name);
          }
        }
      }
    });
  } else {
    // Fallback when no schedule doc exists
    activeTechs.forEach((t) => {
      const isSup = isSupervisorUser(t, technicians);
      const isOfficeHour = isOfficeHourStaff(t, technicians);
      if (isOfficeHour) {
        if (shiftCode === 'PS' && isWeekday) {
          onDutyIds.push(t.id);
          onDutyNames.push(t.name);
          if (isSup) {
            supervisorOnDuty = true;
          } else {
            technicianIds.push(t.id);
            technicianNames.push(t.name);
          }
        }
      }
    });
  }

  return {
    onDutyIds,
    onDutyNames,
    supervisorOnDuty,
    technicianIds,
    technicianNames,
  };
}

