import { getJakartaDate, getJakartaDateString } from '../utils/dateTimeUtils';
import { ShiftScheduleV2, ScheduleStatus, ON_DUTY_STATUSES } from './scheduleService';
import { AttendanceRecord } from '../types';
import {
  ShiftCategory,
  WorkShiftRule,
  StaffWorkPattern,
  DEFAULT_WORK_SHIFT_RULES,
  DEFAULT_STAFF_WORK_PATTERNS,
} from './workShiftRulesService';

export type ScheduleType = 'OFFICE' | 'PS' | 'M' | 'LIBUR';

export type OperationalState =
  | 'PRE_SHIFT'               // Check-in window open before shift start, read-only for reports
  | 'ON_DUTY'                 // Shift active, full Preventive & Corrective input allowed
  | 'POST_SHIFT_ATTENDANCE'  // Shift ended, check-out window open, read-only for reports
  | 'OFF_DUTY';               // Outside shift windows / Libur, read-only

export type AttendanceState =
  | 'CAN_CHECK_IN'           // Check-in window open (Normal / Tepat Waktu)
  | 'CAN_CHECK_IN_LATE'      // Check-in window open (Late / Terlambat)
  | 'MISSED_CHECK_IN'        // Check-in window passed without check-in ("TIDAK ABSEN MASUK")
  | 'CHECKED_IN'             // Checked in, waiting for check-out
  | 'CAN_CHECK_OUT'          // Check-out window open
  | 'CHECKED_OUT'            // Checked out, attendance completed
  | 'MISSED_CHECK_OUT'       // Passed check-out window without check-out ("TIDAK ABSEN PULANG")
  | 'EXPIRED';               // Outside attendance window

export interface GenericScheduleDoc {
  dataset_id?: string;
  schedule_date: string;
  shift: string;
  assignments?: Record<string, any>;
  [key: string]: any;
}

export interface OperationalPermissions {
  canRead: boolean;
  canSubmitPreventive: boolean;
  canSubmitCorrective: boolean;
  canCheckIn: boolean;
  canCheckInLate: boolean;
  canCheckOut: boolean;
}

export interface PermissionCheckResult {
  role: 'system_admin' | 'operations_admin' | 'supervisor' | 'technician' | 'admin';
  schedule: ScheduleType;
  operationalState: OperationalState;
  attendanceState: AttendanceState;
  operationalDate: string; // YYYY-MM-DD
  shiftCode: 'OFFICE' | 'PS' | 'M' | null;
  permissions: OperationalPermissions;
  reason: string;
  checkInRecord?: AttendanceRecord | null;
  checkOutRecord?: AttendanceRecord | null;
}

// Canonical 4-day continuous rotation cycle per technician: PS -> M -> LIBUR -> LIBUR
const ROTATION_CYCLE: ScheduleType[] = ['PS', 'M', 'LIBUR', 'LIBUR'];

/**
 * Calculates previous calendar day string YYYY-MM-DD
 */
export function getPreviousDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const py = prev.getUTCFullYear();
  const pm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const pd = String(prev.getUTCDate()).padStart(2, '0');
  return `${py}-${pm}-${pd}`;
}

/**
 * Calculates next calendar day string YYYY-MM-DD
 */
export function getNextDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/**
 * Resolves schedule for a technician on a specific operationalDate (YYYY-MM-DD).
 * Priority:
 * 1. Explicit DB published schedule documents on shift_schedules (PS, M, OFFICE).
 *    If published schedule exists for this date, DO NOT activate via rotation fallback!
 * 2. Staff Work Patterns configuration (OFFICE for Desi & Luthfi every day; ROTATING for shift techs).
 * 3. Continuous 4-day rotation cycle (PS -> M -> LIBUR -> LIBUR) based on technician anchor date.
 */
export function resolveTechnicianSchedule(params: {
  technicianName?: string;
  technicianId?: number | string;
  operationalDate: string; // YYYY-MM-DD
  scheduleDocPS?: ShiftScheduleV2 | null;
  scheduleDocM?: ShiftScheduleV2 | null;
  scheduleDocOffice?: ShiftScheduleV2 | null;
  staffPatterns?: StaffWorkPattern[];
}): { schedule: ScheduleType; isExplicitFromDb: boolean } {
  const {
    technicianName,
    technicianId,
    operationalDate,
    scheduleDocPS,
    scheduleDocM,
    scheduleDocOffice,
    staffPatterns = DEFAULT_STAFF_WORK_PATTERNS,
  } = params;

  const techIdStr = technicianId !== undefined && technicianId !== null ? String(technicianId) : '';
  const cleanName = (technicianName || '').trim().toUpperCase();

  // 1. Check if DB explicitly has schedule documents on operationalDate
  const checkAssignmentStatus = (doc: ShiftScheduleV2 | null): ScheduleStatus | null => {
    if (!doc?.assignments) return null;
    if (techIdStr && doc.assignments[techIdStr]) {
      return doc.assignments[techIdStr].status;
    }
    const match = Object.entries(doc.assignments).find(([k, a]) => {
      if (techIdStr && (k === techIdStr || String(a.technician_id) === techIdStr)) return true;
      if (cleanName && a.technician_name) {
        const assignUpper = a.technician_name.trim().toUpperCase();
        return assignUpper === cleanName || assignUpper.includes(cleanName) || cleanName.includes(assignUpper);
      }
      return false;
    });
    return match ? match[1].status : null;
  };

  const psStatus = checkAssignmentStatus(scheduleDocPS);
  const mStatus = checkAssignmentStatus(scheduleDocM);
  const officeStatus = checkAssignmentStatus(scheduleDocOffice);

  if (officeStatus && ON_DUTY_STATUSES.includes(officeStatus)) {
    return { schedule: 'OFFICE', isExplicitFromDb: true };
  }
  if (psStatus && ON_DUTY_STATUSES.includes(psStatus)) {
    return { schedule: 'PS', isExplicitFromDb: true };
  }
  if (mStatus && ON_DUTY_STATUSES.includes(mStatus)) {
    return { schedule: 'M', isExplicitFromDb: true };
  }
  if (
    (psStatus && ['off', 'day_off', 'leave', 'sick', 'permission'].includes(psStatus)) ||
    (mStatus && ['off', 'day_off', 'leave', 'sick', 'permission'].includes(mStatus)) ||
    (officeStatus && ['off', 'day_off', 'leave', 'sick', 'permission'].includes(officeStatus))
  ) {
    return { schedule: 'LIBUR', isExplicitFromDb: true };
  }

  // 2. Determine Candidate Rotation / Pattern Schedule
  let candidateSchedule: ScheduleType = 'LIBUR';

  const pattern = staffPatterns.find((p) => {
    if (!p.is_active) return false;
    if (techIdStr && p.technician_id !== undefined && String(p.technician_id) === techIdStr) return true;
    if (cleanName && p.staff_name) {
      const pUpper = p.staff_name.trim().toUpperCase();
      return pUpper === cleanName || cleanName.includes(pUpper) || pUpper.includes(cleanName);
    }
    return false;
  });

  if (pattern) {
    if (pattern.work_pattern === 'OFFICE') {
      // OFFICE: Jam kerja setiap hari (Senin-Minggu) kecuali jika dibatasi active_days
      const d = new Date(`${operationalDate}T12:00:00+07:00`);
      const dayOfWeek = d.getDay(); // 0: Sun, 6: Sat
      if (pattern.active_days && !pattern.active_days.includes(dayOfWeek)) {
        candidateSchedule = 'LIBUR';
      } else {
        candidateSchedule = 'OFFICE';
      }
    } else if (pattern.work_pattern === 'ROTATING') {
      const anchorDateStr = pattern.anchor_date || '2026-10-01';
      const anchorUtc = Date.UTC(
        parseInt(anchorDateStr.slice(0, 4), 10),
        parseInt(anchorDateStr.slice(5, 7), 10) - 1,
        parseInt(anchorDateStr.slice(8, 10), 10)
      );
      const targetUtc = Date.UTC(
        parseInt(operationalDate.slice(0, 4), 10),
        parseInt(operationalDate.slice(5, 7), 10) - 1,
        parseInt(operationalDate.slice(8, 10), 10)
      );
      const diffDays = Math.floor((targetUtc - anchorUtc) / (1000 * 60 * 60 * 24));

      let baseOffset = 0;
      if (pattern.anchor_phase === 'M') baseOffset = 1;
      else if (pattern.anchor_phase === 'LIBUR1') baseOffset = 2;
      else if (pattern.anchor_phase === 'LIBUR2') baseOffset = 3;

      const cycleIdx = (((diffDays + baseOffset) % 4) + 4) % 4;
      candidateSchedule = ROTATION_CYCLE[cycleIdx];
    } else if (pattern.work_pattern === 'MANUAL') {
      candidateSchedule = 'LIBUR';
    }
  } else {
    // 3. Fallback: 4-day continuous rotation cycle per technician (PS -> M -> LIBUR -> LIBUR)
    const defaultAnchorMap: Record<string, string> = {
      ZAKY: '2026-05-01',
      YOAN: '2026-10-01',
      FARIZ: '2026-10-02',
      REZA: '2026-10-03',
    };
    const anchorDateStr = defaultAnchorMap[cleanName] || '2026-10-01';
    const anchorUtc = Date.UTC(
      parseInt(anchorDateStr.slice(0, 4), 10),
      parseInt(anchorDateStr.slice(5, 7), 10) - 1,
      parseInt(anchorDateStr.slice(8, 10), 10)
    );
    const targetUtc = Date.UTC(
      parseInt(operationalDate.slice(0, 4), 10),
      parseInt(operationalDate.slice(5, 7), 10) - 1,
      parseInt(operationalDate.slice(8, 10), 10)
    );
    const diffDays = Math.floor((targetUtc - anchorUtc) / (1000 * 60 * 60 * 24));
    const cycleIdx = ((diffDays % 4) + 4) % 4;
    candidateSchedule = ROTATION_CYCLE[cycleIdx];
  }

  // Check if the specific candidate shift's published schedule doc omitted this technician
  if (candidateSchedule === 'PS' && scheduleDocPS && scheduleDocPS.status === 'published' && Object.keys(scheduleDocPS.assignments || {}).length > 0) {
    return { schedule: 'LIBUR', isExplicitFromDb: true };
  }
  if (candidateSchedule === 'M' && scheduleDocM && scheduleDocM.status === 'published' && Object.keys(scheduleDocM.assignments || {}).length > 0) {
    return { schedule: 'LIBUR', isExplicitFromDb: true };
  }
  if (candidateSchedule === 'OFFICE' && scheduleDocOffice && scheduleDocOffice.status === 'published' && Object.keys(scheduleDocOffice.assignments || {}).length > 0) {
    return { schedule: 'LIBUR', isExplicitFromDb: true };
  }

  return { schedule: candidateSchedule, isExplicitFromDb: false };
}

/**
 * Single Authoritative Source of Truth for:
 * 1. Operational Shift Schedule (OFFICE, PS, M, LIBUR)
 * 2. Operational State (PRE_SHIFT, ON_DUTY, POST_SHIFT_ATTENDANCE, OFF_DUTY)
 * 3. Attendance State (CAN_CHECK_IN, CAN_CHECK_IN_LATE, MISSED_CHECK_IN, CHECKED_IN, CAN_CHECK_OUT, CHECKED_OUT, MISSED_CHECK_OUT)
 * 4. Input Permissions (canRead, canSubmitPreventive, canSubmitCorrective, canCheckIn, canCheckInLate, canCheckOut)
 *
 * Rules:
 * - Timezone: Asia/Jakarta (WIB, UTC+7).
 * - Exact seconds precision without gaps or overlaps.
 * - Shift M uses operational_date of the shift start date across midnight.
 * - Attendance in and out are completely independent.
 * - TERLAMBAT status does NOT reduce report input rights during ON DUTY.
 * - Supervisor/Admin have unrestricted oversight privileges.
 */
export function evaluateOperationalPermissions(params: {
  userRole?: 'system_admin' | 'operations_admin' | 'supervisor' | 'technician' | 'admin';
  technician?: { id?: number; name?: string; code?: string } | null;
  nowDate?: Date;
  scheduleDocs?: Array<GenericScheduleDoc | ShiftScheduleV2> | null;
  scheduleDocPS?: ShiftScheduleV2 | null;
  scheduleDocM?: ShiftScheduleV2 | null;
  scheduleDocOffice?: ShiftScheduleV2 | null;
  attendanceHistory?: AttendanceRecord[];
  rules?: Record<ShiftCategory, WorkShiftRule>;
  staffPatterns?: StaffWorkPattern[];
}): PermissionCheckResult {
  const {
    userRole = 'technician',
    technician,
    nowDate,
    scheduleDocs,
    scheduleDocPS,
    scheduleDocM,
    scheduleDocOffice,
    attendanceHistory = [],
    rules = DEFAULT_WORK_SHIFT_RULES,
    staffPatterns = DEFAULT_STAFF_WORK_PATTERNS,
  } = params;

  // 1. Get current Asia/Jakarta Date & Time
  const jkt = nowDate
    ? new Date(nowDate.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
    : getJakartaDate();

  const year = jkt.getFullYear();
  const month = String(jkt.getMonth() + 1).padStart(2, '0');
  const day = String(jkt.getDate()).padStart(2, '0');
  const calendarDate = `${year}-${month}-${day}`;
  const hour = jkt.getHours();
  const minute = jkt.getMinutes();
  const second = jkt.getSeconds();
  const totalSeconds = hour * 3600 + minute * 60 + second;

  // 2. Determine Active Operational Shift & Operational Date
  let activeShiftCode: 'PS' | 'M';
  let operationalDate: string;

  if (totalSeconds >= 7 * 3600 && totalSeconds < 19 * 3600) {
    // 07:00:00 - 18:59:59 WIB -> Shift Pagi (PS), operationalDate = calendarDate
    activeShiftCode = 'PS';
    operationalDate = calendarDate;
  } else if (totalSeconds >= 19 * 3600) {
    // 19:00:00 - 23:59:59 WIB -> Shift Malam (M), operationalDate = calendarDate
    activeShiftCode = 'M';
    operationalDate = calendarDate;
  } else {
    // 00:00:00 - 06:59:59 WIB -> Shift Malam (M), operationalDate = yesterday
    activeShiftCode = 'M';
    operationalDate = getPreviousDateString(calendarDate);
  }

  // 3. Resolve Technician Schedule for current operationalDate
  const techName = technician?.name || '';
  const techId = technician?.id;

  const resolvedDocPS = scheduleDocPS !== undefined
    ? scheduleDocPS
    : ((scheduleDocs?.find((d) => d.schedule_date === operationalDate && d.shift === 'PS') as ShiftScheduleV2) || null);
  const resolvedDocM = scheduleDocM !== undefined
    ? scheduleDocM
    : ((scheduleDocs?.find((d) => d.schedule_date === operationalDate && d.shift === 'M') as ShiftScheduleV2) || null);
  const resolvedDocOffice = scheduleDocOffice !== undefined
    ? scheduleDocOffice
    : ((scheduleDocs?.find((d) => d.schedule_date === operationalDate && (d.shift as string) === 'OFFICE') as ShiftScheduleV2) || null);

  const { schedule } = resolveTechnicianSchedule({
    technicianName: techName,
    technicianId: techId,
    operationalDate,
    scheduleDocPS: resolvedDocPS,
    scheduleDocM: resolvedDocM,
    scheduleDocOffice: resolvedDocOffice,
    staffPatterns,
  });

  const isStaffOnDutySchedule = schedule === 'OFFICE' || schedule === 'PS' || schedule === 'M';

  // 3b. Role Override logic
  const isSystemAdmin = userRole === 'system_admin' || userRole === 'admin';
  const isSupervisor = userRole === 'supervisor';
  const isOperationsAdmin = userRole === 'operations_admin';

  if ((isSystemAdmin || isSupervisor) && !isStaffOnDutySchedule) {
    return {
      role: userRole,
      schedule: activeShiftCode === 'PS' ? 'PS' : 'M',
      operationalState: 'ON_DUTY',
      attendanceState: 'EXPIRED',
      operationalDate,
      shiftCode: activeShiftCode,
      permissions: {
        canRead: true,
        canSubmitPreventive: true,
        canSubmitCorrective: true,
        canCheckIn: false,
        canCheckInLate: false,
        canCheckOut: false,
      },
      reason: `${isSystemAdmin ? 'System Administrator' : 'Supervisor'} memiliki hak akses penuh pengawasan & penginputan laporan.`,
    };
  }

  if (isOperationsAdmin && !isStaffOnDutySchedule) {
    return {
      role: userRole,
      schedule: 'OFFICE',
      operationalState: 'ON_DUTY',
      attendanceState: 'EXPIRED',
      operationalDate,
      shiftCode: 'OFFICE',
      permissions: {
        canRead: true,
        canSubmitPreventive: false,
        canSubmitCorrective: false,
        canCheckIn: false,
        canCheckInLate: false,
        canCheckOut: false,
      },
      reason: 'Operations Administrator berwenang mengelola master data, jadwal, dan rekapitulasi laporan.',
    };
  }

  // Default permissions: READ ONLY
  const isElevatedReportRole = isSystemAdmin || isSupervisor;
  const permissions: OperationalPermissions = {
    canRead: true,
    canSubmitPreventive: isElevatedReportRole,
    canSubmitCorrective: isElevatedReportRole,
    canCheckIn: false,
    canCheckInLate: false,
    canCheckOut: false,
  };

  // 5. Look up existing attendance records for technician on operationalDate
  const techCleanName = techName.trim().toUpperCase();
  const techIdStr = techId !== undefined && techId !== null ? String(techId) : '';

  const matchingRecords = attendanceHistory.filter((r) => {
    if (!r) return false;
    const rNameUpper = (r.technician_name || '').trim().toUpperCase();
    const rIdStr = r.technician_id !== undefined && r.technician_id !== null ? String(r.technician_id) : '';
    const isTechMatch = (techIdStr && rIdStr === techIdStr) ||
      (techCleanName && (rNameUpper === techCleanName || rNameUpper.includes(techCleanName) || techCleanName.includes(rNameUpper)));
    return isTechMatch && (r.attendance_date === operationalDate || r.attendance_date === calendarDate);
  });

  const checkInRecord = matchingRecords.find((r) => (r.attendance_type || 'masuk') === 'masuk') || null;
  const checkOutRecord = matchingRecords.find((r) => r.attendance_type === 'pulang') || null;

  // 6. Scheduled LIBUR / OFF
  if (schedule === 'LIBUR') {
    return {
      role: 'technician',
      schedule: 'LIBUR',
      operationalState: 'OFF_DUTY',
      attendanceState: 'EXPIRED',
      operationalDate,
      shiftCode: null,
      permissions,
      reason: 'Anda sedang LIBUR / tidak terjadwal bertugas pada shift ini. Hak akses: READ ONLY.',
      checkInRecord,
      checkOutRecord,
    };
  }

  // 7. Evaluate OFFICE, PS, or M
  let operationalState: OperationalState = 'OFF_DUTY';
  let attendanceState: AttendanceState = 'EXPIRED';
  let reason = '';

  // ==========================================
  // CASE A: SCHEDULE OFFICE (08:00:00 - 17:00:00 WIB)
  // Masuk: 06:00:00 - 08:15:00 WIB TEPAT WAKTU, > 08:15:00 TERLAMBAT
  // Pulang: 16:30:00 - 20:00:00 WIB DIIZINKAN, di luar rentang ini TOMBOL TERDISABLE
  // ==========================================
  if (schedule === 'OFFICE') {
    const SEC_06_00 = 6 * 3600;
    const SEC_08_00 = 8 * 3600;
    const SEC_08_15 = 8 * 3600 + 15 * 60;
    const SEC_10_00 = 10 * 3600;
    const SEC_16_30 = 16 * 3600 + 30 * 60;
    const SEC_17_00 = 17 * 3600;
    const SEC_20_00 = 20 * 3600;

    if (totalSeconds < SEC_06_00) {
      operationalState = 'OFF_DUTY';
      attendanceState = 'EXPIRED';
      reason = 'Jam kerja Office belum dimulai. Presensi masuk dibuka pukul 06:00 WIB.';
    } else if (totalSeconds < SEC_08_00) {
      // 06:00:00 - 07:59:59 WIB -> PRE_SHIFT
      operationalState = 'PRE_SHIFT';
      reason = 'Masa persiapan Office. Presensi masuk dibuka (06:00 - 08:15 WIB). Penginputan dibuka pukul 08:00 WIB.';
      if (checkOutRecord) {
        attendanceState = 'CHECKED_OUT';
      } else if (checkInRecord) {
        attendanceState = 'CHECKED_IN';
      } else {
        attendanceState = 'CAN_CHECK_IN';
        permissions.canCheckIn = true;
      }
    } else if (totalSeconds < SEC_17_00) {
      // 08:00:00 - 16:59:59 WIB -> ON_DUTY
      operationalState = 'ON_DUTY';
      permissions.canSubmitPreventive = true;
      permissions.canSubmitCorrective = true;

      if (checkOutRecord) {
        attendanceState = 'CHECKED_OUT';
        reason = 'Jam kerja Office berlangsung. Anda sudah melakukan presensi pulang.';
      } else if (checkInRecord) {
        if (totalSeconds >= SEC_16_30) {
          attendanceState = 'CAN_CHECK_OUT';
          permissions.canCheckOut = true;
          reason = 'Office aktif. Window presensi pulang telah dibuka (16:30 - 20:00 WIB).';
        } else {
          attendanceState = 'CHECKED_IN';
          permissions.canCheckOut = false;
          reason = 'Tombol Absen Pulang Terdisable: Presensi pulang dibuka pukul 16:30 WIB.';
        }
      } else {
        // Belum check in
        if (totalSeconds <= SEC_08_15) {
          attendanceState = 'CAN_CHECK_IN';
          permissions.canCheckIn = true;
          reason = 'Office aktif. Silakan lakukan presensi masuk tepat waktu (06:00 - 08:15 WIB).';
        } else if (totalSeconds <= SEC_10_00) {
          attendanceState = 'CAN_CHECK_IN_LATE';
          permissions.canCheckInLate = true;
          reason = 'Office aktif. Presensi masuk TERLAMBAT (Lewat dari 08:15 WIB).';
        } else {
          attendanceState = 'MISSED_CHECK_IN';
          reason = 'Office aktif. Status: TIDAK ABSEN MASUK. Anda tetap memiliki hak input laporan selama jam kerja.';
          if (totalSeconds >= SEC_16_30) {
            attendanceState = 'CAN_CHECK_OUT';
            permissions.canCheckOut = true;
            reason = 'Office aktif. Status: TIDAK ABSEN MASUK. Window presensi pulang telah dibuka (16:30 - 20:00 WIB).';
          }
        }
      }
    } else if (totalSeconds <= SEC_20_00) {
      // 17:00:00 - 20:00:00 WIB -> POST_SHIFT_ATTENDANCE
      operationalState = 'POST_SHIFT_ATTENDANCE';
      permissions.canSubmitPreventive = false;
      permissions.canSubmitCorrective = false;

      if (checkOutRecord) {
        attendanceState = 'CHECKED_OUT';
        reason = 'Jam kerja operasional Office telah selesai pukul 17:00 WIB. Presensi pulang telah tercatat.';
      } else {
        attendanceState = 'CAN_CHECK_OUT';
        permissions.canCheckOut = true;
        reason = 'Jam operasional Office selesai pukul 17:00 WIB. Window presensi pulang tersedia s/d 20:00 WIB.';
      }
    } else {
      // > 20:00:00 WIB -> OFF_DUTY
      operationalState = 'OFF_DUTY';
      attendanceState = checkOutRecord ? 'CHECKED_OUT' : 'MISSED_CHECK_OUT';
      permissions.canCheckOut = false;
      reason = checkOutRecord
        ? 'Jam kerja Office dan window presensi telah berakhir (20:00 WIB).'
        : 'Tombol Absen Pulang Terdisable: Batas waktu presensi pulang (20:00 WIB) telah terlewati.';
    }

    const isSystemAdminOrSpv = userRole === 'system_admin' || userRole === 'admin' || userRole === 'supervisor';
    return {
      role: userRole,
      schedule: 'OFFICE',
      operationalState,
      attendanceState,
      operationalDate,
      shiftCode: 'OFFICE',
      permissions: {
        ...permissions,
        canSubmitPreventive: isSystemAdminOrSpv ? true : permissions.canSubmitPreventive,
        canSubmitCorrective: isSystemAdminOrSpv ? true : permissions.canSubmitCorrective,
      },
      reason,
      checkInRecord,
      checkOutRecord,
    };
  }

  // ==========================================
  // CASE B: SHIFT PS (PAGI) 07:00:00 - 18:59:59 WIB
  // Masuk: 06:00:00 - 07:15:00 WIB TEPAT WAKTU, > 07:15:00 TERLAMBAT
  // Pulang: 18:00:00 - 20:00:00 WIB DIIZINKAN, di luar rentang ini TOMBOL TERDISABLE
  // ==========================================
  if (schedule === 'PS') {
    const SEC_06_00 = 6 * 3600;
    const SEC_07_00 = 7 * 3600;
    const SEC_07_15 = 7 * 3600 + 15 * 60;
    const SEC_10_00 = 10 * 3600;
    const SEC_18_00 = 18 * 3600;
    const SEC_19_00 = 19 * 3600;
    const SEC_20_00 = 20 * 3600;

    if (calendarDate < operationalDate) {
      operationalState = 'OFF_DUTY';
      attendanceState = 'EXPIRED';
      reason = 'Shift PS belum dimulai.';
    } else if (calendarDate === operationalDate) {
      if (totalSeconds < SEC_06_00) {
        operationalState = 'OFF_DUTY';
        attendanceState = 'EXPIRED';
        reason = 'Presensi Shift PS dibuka pukul 06:00 WIB.';
      } else if (totalSeconds < SEC_07_00) {
        operationalState = 'PRE_SHIFT';
        reason = 'Masa persiapan shift. Presensi masuk dibuka (06:00 - 07:15 WIB). Penginputan laporan dibuka pukul 07:00 WIB.';
        if (checkOutRecord) {
          attendanceState = 'CHECKED_OUT';
        } else if (checkInRecord) {
          attendanceState = 'CHECKED_IN';
        } else {
          attendanceState = 'CAN_CHECK_IN';
          permissions.canCheckIn = true;
        }
      } else if (totalSeconds < SEC_19_00) {
        operationalState = 'ON_DUTY';
        permissions.canSubmitPreventive = true;
        permissions.canSubmitCorrective = true;

        if (checkOutRecord) {
          attendanceState = 'CHECKED_OUT';
          reason = 'Shift PS sedang berlangsung. Anda sudah melakukan presensi pulang.';
        } else if (checkInRecord) {
          if (totalSeconds >= SEC_18_00) {
            attendanceState = 'CAN_CHECK_OUT';
            permissions.canCheckOut = true;
            reason = 'Shift PS aktif. Window presensi pulang telah dibuka (18:00 - 20:00 WIB).';
          } else {
            attendanceState = 'CHECKED_IN';
            permissions.canCheckOut = false;
            reason = 'Tombol Absen Pulang Terdisable: Presensi pulang dibuka pukul 18:00 WIB.';
          }
        } else {
          if (totalSeconds <= SEC_07_15) {
            attendanceState = 'CAN_CHECK_IN';
            permissions.canCheckIn = true;
            reason = 'Shift PS aktif. Silakan lakukan presensi masuk tepat waktu (06:00 - 07:15 WIB).';
          } else if (totalSeconds <= SEC_10_00) {
            attendanceState = 'CAN_CHECK_IN_LATE';
            permissions.canCheckInLate = true;
            reason = 'Shift PS aktif. Presensi masuk TERLAMBAT (Lewat dari 07:15 WIB).';
          } else {
            attendanceState = 'MISSED_CHECK_IN';
            reason = 'Shift PS aktif. Status: TIDAK ABSEN MASUK. Anda tetap berhak menginput laporan selama shift berlangsung.';
            if (totalSeconds >= SEC_18_00) {
              attendanceState = 'CAN_CHECK_OUT';
              permissions.canCheckOut = true;
              reason = 'Shift PS aktif. Status: TIDAK ABSEN MASUK. Window presensi pulang telah dibuka (18:00 - 20:00 WIB).';
            }
          }
        }
      } else if (totalSeconds <= SEC_20_00) {
        operationalState = 'POST_SHIFT_ATTENDANCE';
        permissions.canSubmitPreventive = false;
        permissions.canSubmitCorrective = false;

        if (checkOutRecord) {
          attendanceState = 'CHECKED_OUT';
          reason = 'Shift PS telah selesai. Presensi pulang telah tercatat.';
        } else {
          attendanceState = 'CAN_CHECK_OUT';
          permissions.canCheckOut = true;
          reason = 'Shift PS operasional telah selesai pukul 19:00 WIB. Window presensi pulang tersedia s/d 20:00 WIB.';
        }
      } else {
        operationalState = 'OFF_DUTY';
        attendanceState = checkOutRecord ? 'CHECKED_OUT' : 'MISSED_CHECK_OUT';
        permissions.canCheckOut = false;
        reason = checkOutRecord
          ? 'Shift PS dan window presensi telah berakhir (20:00 WIB). Hak akses: READ ONLY.'
          : 'Tombol Absen Pulang Terdisable: Batas waktu presensi pulang (20:00 WIB) telah terlewati. Hak akses: READ ONLY.';
      }
    } else {
      operationalState = 'OFF_DUTY';
      attendanceState = checkOutRecord ? 'CHECKED_OUT' : 'MISSED_CHECK_OUT';
      reason = 'Shift PS tanggal operasional ini telah berakhir. Hak akses: READ ONLY.';
    }

    const isSystemAdminOrSpv = userRole === 'system_admin' || userRole === 'admin' || userRole === 'supervisor';
    return {
      role: userRole,
      schedule: 'PS',
      operationalState,
      attendanceState,
      operationalDate,
      shiftCode: 'PS',
      permissions: {
        ...permissions,
        canSubmitPreventive: isSystemAdminOrSpv ? true : permissions.canSubmitPreventive,
        canSubmitCorrective: isSystemAdminOrSpv ? true : permissions.canSubmitCorrective,
      },
      reason,
      checkInRecord,
      checkOutRecord,
    };
  }

  // ==========================================
  // CASE C: SHIFT M (MALAM) 19:00:00 - 06:59:59 WIB (keesokan harinya)
  // Masuk: 18:00:00 - 19:15:00 WIB TEPAT WAKTU, > 19:15:00 TERLAMBAT
  // Pulang: 06:00:00 - 08:00:00 WIB keesokan harinya DIIZINKAN, di luar rentang ini TOMBOL TERDISABLE
  // Operational date SELALU tanggal dimulainya shift (D).
  // ==========================================
  if (schedule === 'M') {
    const nextDayDate = getNextDateString(operationalDate);
    const SEC_06_00 = 6 * 3600;
    const SEC_07_00 = 7 * 3600;
    const SEC_08_00 = 8 * 3600;
    const SEC_18_00 = 18 * 3600;
    const SEC_19_00 = 19 * 3600;
    const SEC_19_15 = 19 * 3600 + 15 * 60;
    const SEC_22_00 = 22 * 3600;

    if (calendarDate === operationalDate) {
      if (totalSeconds < SEC_18_00) {
        operationalState = 'PRE_SHIFT';
        attendanceState = 'EXPIRED';
        reason = 'Jadwal Anda hari ini: Shift Malam. Presensi masuk dibuka pukul 18:00 WIB.';
      } else if (totalSeconds < SEC_19_00) {
        operationalState = 'PRE_SHIFT';
        reason = 'Masa persiapan shift. Presensi masuk dibuka (18:00 - 19:15 WIB). Penginputan laporan dibuka pukul 19:00 WIB.';
        if (checkOutRecord) {
          attendanceState = 'CHECKED_OUT';
        } else if (checkInRecord) {
          attendanceState = 'CHECKED_IN';
        } else {
          attendanceState = 'CAN_CHECK_IN';
          permissions.canCheckIn = true;
        }
      } else {
        // 19:00:00 - 23:59:59 WIB on Day D -> ON_DUTY
        operationalState = 'ON_DUTY';
        permissions.canSubmitPreventive = true;
        permissions.canSubmitCorrective = true;

        if (checkOutRecord) {
          attendanceState = 'CHECKED_OUT';
          reason = 'Shift M sedang berlangsung. Presensi pulang telah tercatat.';
        } else if (checkInRecord) {
          attendanceState = 'CHECKED_IN';
          permissions.canCheckOut = false;
          reason = 'Tombol Absen Pulang Terdisable: Presensi pulang dibuka pukul 06:00 WIB esok harinya.';
        } else {
          if (totalSeconds <= SEC_19_15) {
            attendanceState = 'CAN_CHECK_IN';
            permissions.canCheckIn = true;
            reason = 'Shift M aktif. Silakan lakukan presensi masuk tepat waktu (18:00 - 19:15 WIB).';
          } else if (totalSeconds <= SEC_22_00) {
            attendanceState = 'CAN_CHECK_IN_LATE';
            permissions.canCheckInLate = true;
            reason = 'Shift M aktif. Presensi masuk TERLAMBAT (Lewat dari 19:15 WIB).';
          } else {
            attendanceState = 'MISSED_CHECK_IN';
            reason = 'Shift M aktif. Status: TIDAK ABSEN MASUK. Anda tetap berhak menginput laporan selama shift aktif.';
          }
        }
      }
    } else if (calendarDate === nextDayDate) {
      if (totalSeconds < SEC_07_00) {
        // 00:00:00 - 06:59:59 WIB next day -> STILL ON_DUTY ACROSS MIDNIGHT!
        operationalState = 'ON_DUTY';
        permissions.canSubmitPreventive = true;
        permissions.canSubmitCorrective = true;

        if (checkOutRecord) {
          attendanceState = 'CHECKED_OUT';
          reason = 'Shift M malam berjalan. Presensi pulang telah tercatat.';
        } else if (checkInRecord || attendanceState === 'MISSED_CHECK_IN') {
          if (totalSeconds >= SEC_06_00) {
            attendanceState = 'CAN_CHECK_OUT';
            permissions.canCheckOut = true;
            reason = 'Shift M aktif lintas tengah malam. Window presensi pulang telah dibuka (06:00 - 08:00 WIB).';
          } else {
            attendanceState = 'CHECKED_IN';
            permissions.canCheckOut = false;
            reason = 'Tombol Absen Pulang Terdisable: Presensi pulang dibuka pukul 06:00 WIB esok harinya.';
          }
        } else {
          attendanceState = 'MISSED_CHECK_IN';
          reason = 'Shift M aktif lintas tengah malam. Status: TIDAK ABSEN MASUK. Anda tetap dapat menginput laporan.';
          if (totalSeconds >= SEC_06_00) {
            attendanceState = 'CAN_CHECK_OUT';
            permissions.canCheckOut = true;
            reason = 'Shift M aktif lintas tengah malam. Status: TIDAK ABSEN MASUK. Window presensi pulang telah dibuka (06:00 - 08:00 WIB).';
          }
        }
      } else if (totalSeconds <= SEC_08_00) {
        // 07:00:00 - 08:00:00 WIB next day -> POST_SHIFT_ATTENDANCE
        operationalState = 'POST_SHIFT_ATTENDANCE';
        permissions.canSubmitPreventive = false;
        permissions.canSubmitCorrective = false;

        if (checkOutRecord) {
          attendanceState = 'CHECKED_OUT';
          reason = 'Shift M telah selesai. Presensi pulang telah tercatat.';
        } else {
          attendanceState = 'CAN_CHECK_OUT';
          permissions.canCheckOut = true;
          reason = 'Shift M operasional telah selesai pukul 07:00 WIB. Window presensi pulang tersedia s/d 08:00 WIB.';
        }
      } else {
        // > 08:00:00 WIB next day -> OFF_DUTY
        operationalState = 'OFF_DUTY';
        attendanceState = checkOutRecord ? 'CHECKED_OUT' : 'MISSED_CHECK_OUT';
        permissions.canCheckOut = false;
        reason = checkOutRecord
          ? 'Shift M dan window presensi telah berakhir (08:00 WIB). Hak akses: READ ONLY.'
          : 'Tombol Absen Pulang Terdisable: Batas waktu presensi pulang (08:00 WIB) telah terlewati. Hak akses: READ ONLY.';
      }
    } else {
      operationalState = 'OFF_DUTY';
      attendanceState = checkOutRecord ? 'CHECKED_OUT' : 'MISSED_CHECK_OUT';
      reason = 'Shift M tanggal operasional ini telah berakhir. Hak akses: READ ONLY.';
    }

    const isSystemAdminOrSpv = userRole === 'system_admin' || userRole === 'admin' || userRole === 'supervisor';
    return {
      role: userRole,
      schedule: 'M',
      operationalState,
      attendanceState,
      operationalDate,
      shiftCode: 'M',
      permissions: {
        ...permissions,
        canSubmitPreventive: isSystemAdminOrSpv ? true : permissions.canSubmitPreventive,
        canSubmitCorrective: isSystemAdminOrSpv ? true : permissions.canSubmitCorrective,
      },
      reason,
      checkInRecord,
      checkOutRecord,
    };
  }

  return {
    role: 'technician',
    schedule,
    operationalState,
    attendanceState,
    operationalDate,
    shiftCode: null,
    permissions,
    reason: 'Jadwal tidak dikenali.',
    checkInRecord,
    checkOutRecord,
  };
}
