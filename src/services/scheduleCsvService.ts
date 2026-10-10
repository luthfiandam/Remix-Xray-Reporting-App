import { Technician } from '../types';
import {
  ScheduleStatus,
  ShiftAssignmentV2,
  ShiftScheduleV2,
  ON_DUTY_STATUSES,
} from './scheduleService';

export interface CsvParsedRow {
  rowIndex: number;
  schedule_date: string;
  shift: 'PS' | 'M';
  assignments: Record<string, ShiftAssignmentV2>;
  actionType: 'created' | 'updated' | 'unchanged';
  errors: string[];
}

export interface CsvParseResult {
  valid: boolean;
  rows: CsvParsedRow[];
  summary: {
    totalRows: number;
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    errorCount: number;
  };
  allErrors: string[];
  headerTechNames: string[];
}

// Canonical Indonesian Status to Canonical DB Status
export const STATUS_ID_MAP: Record<string, ScheduleStatus> = {
  dinas: 'scheduled',
  scheduled: 'scheduled',
  backup: 'backup',
  lembur: 'overtime',
  overtime: 'overtime',
  libur: 'off',
  off: 'off',
  cuti: 'leave',
  leave: 'leave',
  sakit: 'sick',
  sick: 'sick',
  izin: 'permission',
  permission: 'permission',
};

// Canonical DB Status to Indonesian Display Label for CSV Export
export const STATUS_TO_ID_LABEL: Record<ScheduleStatus, string> = {
  scheduled: 'Dinas',
  backup: 'Backup',
  overtime: 'Lembur',
  off: 'Libur',
  day_off: 'Libur',
  leave: 'Cuti',
  sick: 'Sakit',
  permission: 'Izin',
};

/**
 * Normalizes string tokens for CSV comparison
 */
function normalizeToken(str: string): string {
  return str.trim().toLowerCase();
}

/**
 * Parses and validates CSV content for monthly schedule import.
 */
export function parseScheduleCsv(
  csvContent: string,
  activeTechnicians: Technician[],
  targetYear: number,
  targetMonth: number,
  existingSchedules: ShiftScheduleV2[]
): CsvParseResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const allErrors: string[] = [];
  const rows: CsvParsedRow[] = [];

  if (lines.length < 2) {
    allErrors.push('File CSV kosong atau tidak memiliki baris data.');
    return {
      valid: false,
      rows: [],
      summary: { totalRows: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, errorCount: 1 },
      allErrors,
      headerTechNames: [],
    };
  }

  // Parse header line
  const headerCols = lines[0].split(',').map((col) => col.trim());
  if (headerCols.length < 3) {
    allErrors.push('Header CSV tidak valid. Minimal harus memiliki schedule_date, shift, dan nama teknisi.');
    return {
      valid: false,
      rows: [],
      summary: { totalRows: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, errorCount: 1 },
      allErrors,
      headerTechNames: [],
    };
  }

  const dateColIdx = headerCols.findIndex((c) => normalizeToken(c) === 'schedule_date' || normalizeToken(c) === 'tanggal');
  const shiftColIdx = headerCols.findIndex((c) => normalizeToken(c) === 'shift');

  if (dateColIdx === -1 || shiftColIdx === -1) {
    allErrors.push("Header CSV harus menyertakan kolom 'schedule_date' dan 'shift'.");
    return {
      valid: false,
      rows: [],
      summary: { totalRows: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, errorCount: 1 },
      allErrors,
      headerTechNames: [],
    };
  }

  // Map technician columns
  const techColMap: { colIdx: number; name: string; technician: Technician }[] = [];
  const seenTechIds = new Set<number>();
  const seenHeaderNames = new Set<string>();

  for (let i = 0; i < headerCols.length; i++) {
    if (i === dateColIdx || i === shiftColIdx) continue;
    const colName = headerCols[i];
    if (!colName) continue;

    const normalizedName = normalizeToken(colName);
    if (seenHeaderNames.has(normalizedName)) {
      allErrors.push(`Kolom teknisi '${colName}' terduplikasi di header.`);
      continue;
    }
    seenHeaderNames.add(normalizedName);

    const matchedTech = activeTechnicians.find(
      (t) => normalizeToken(t.name) === normalizedName || normalizeToken(t.code) === normalizedName
    );

    if (!matchedTech) {
      allErrors.push(`Teknisi '${colName}' pada header tidak ditemukan dalam daftar teknisi aktif.`);
    } else {
      if (seenTechIds.has(matchedTech.id)) {
        allErrors.push(`Teknisi '${matchedTech.name}' terpetakan lebih dari satu kali.`);
      } else {
        seenTechIds.add(matchedTech.id);
        techColMap.push({ colIdx: i, name: colName, technician: matchedTech });
      }
    }
  }

  if (techColMap.length === 0 && allErrors.length === 0) {
    allErrors.push('Tidak ada kolom teknisi valid yang terdeteksi di header CSV.');
  }

  const targetMonthStr = String(targetMonth).padStart(2, '0');
  const targetPrefix = `${targetYear}-${targetMonthStr}`;
  const seenDateShifts = new Set<string>();

  // Parse data rows
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    const cols = line.split(',').map((c) => c.trim());
    const rowErrors: string[] = [];
    const rowIndex = r + 1; // 1-indexed for human readability

    const dateStr = cols[dateColIdx] || '';
    const rawShift = (cols[shiftColIdx] || '').toUpperCase();

    // 1. Date Validation
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      rowErrors.push(`Baris ${rowIndex}: Format tanggal '${dateStr}' tidak valid (wajib YYYY-MM-DD).`);
    } else if (!dateStr.startsWith(targetPrefix)) {
      rowErrors.push(
        `Baris ${rowIndex}: Tanggal '${dateStr}' tidak berada pada bulan aktif (${targetYear}-${targetMonthStr}).`
      );
    } else {
      const parsedDate = new Date(dateStr);
      if (isNaN(parsedDate.getTime())) {
        rowErrors.push(`Baris ${rowIndex}: Tanggal '${dateStr}' bukan tanggal kalender yang valid.`);
      }
    }

    // 2. Shift Validation
    const shift = (rawShift === 'PS' || rawShift === 'PAGI' ? 'PS' : rawShift === 'M' || rawShift === 'MALAM' ? 'M' : null) as
      | 'PS'
      | 'M'
      | null;
    if (!shift) {
      rowErrors.push(`Baris ${rowIndex}: Shift '${rawShift}' tidak valid (harus PS atau M).`);
    }

    // 3. Duplicate Date+Shift check in CSV
    if (dateStr && shift) {
      const dateShiftKey = `${dateStr}_${shift}`;
      if (seenDateShifts.has(dateShiftKey)) {
        rowErrors.push(`Baris ${rowIndex}: Kombinasi tanggal '${dateStr}' dan shift '${shift}' terduplikasi di file.`);
      } else {
        seenDateShifts.add(dateShiftKey);
      }
    }

    // 4. Assignments Validation
    const assignments: Record<string, ShiftAssignmentV2> = {};
    let onDutyCount = 0;

    // Fill all active technicians default to 'off'
    for (const tech of activeTechnicians) {
      assignments[String(tech.id)] = {
        technician_name: tech.name,
        status: 'off',
      };
    }

    // Process provided columns
    for (const { colIdx, technician } of techColMap) {
      const rawVal = cols[colIdx] || 'Libur';
      const normVal = normalizeToken(rawVal);
      const mappedStatus = STATUS_ID_MAP[normVal];

      if (!mappedStatus) {
        rowErrors.push(
          `Baris ${rowIndex}: Status '${rawVal}' untuk teknisi '${technician.name}' tidak valid (Gunakan Dinas, Backup, Lembur, Libur, Cuti, Sakit, Izin).`
        );
      } else {
        assignments[String(technician.id)] = {
          technician_name: technician.name,
          status: mappedStatus,
        };
        if (ON_DUTY_STATUSES.includes(mappedStatus)) {
          onDutyCount++;
        }
      }
    }

    // 5. Minimal 1 on-duty technician requirement
    if (rowErrors.length === 0 && onDutyCount === 0) {
      rowErrors.push(`Baris ${rowIndex}: Shift ${shift} tanggal ${dateStr} tidak memiliki minimal 1 teknisi on-duty (Dinas/Backup/Lembur).`);
    }

    // 6. Action Type Determination (Created / Updated / Unchanged)
    let actionType: 'created' | 'updated' | 'unchanged' = 'created';
    if (dateStr && shift) {
      const existingDoc = existingSchedules.find(
        (s) => s.schedule_date === dateStr && s.shift === shift
      );
      if (existingDoc) {
        let isIdentical = true;
        for (const [techId, assign] of Object.entries(assignments)) {
          const existingAssign = existingDoc.assignments?.[techId];
          if (!existingAssign || existingAssign.status !== assign.status) {
            isIdentical = false;
            break;
          }
        }
        actionType = isIdentical ? 'unchanged' : 'updated';
      }
    }

    if (rowErrors.length > 0) {
      allErrors.push(...rowErrors);
    }

    rows.push({
      rowIndex,
      schedule_date: dateStr,
      shift: shift || 'PS',
      assignments,
      actionType,
      errors: rowErrors,
    });
  }

  const createdCount = rows.filter((r) => r.errors.length === 0 && r.actionType === 'created').length;
  const updatedCount = rows.filter((r) => r.errors.length === 0 && r.actionType === 'updated').length;
  const unchangedCount = rows.filter((r) => r.errors.length === 0 && r.actionType === 'unchanged').length;
  const errorCount = allErrors.length;

  return {
    valid: errorCount === 0,
    rows,
    summary: {
      totalRows: rows.length,
      createdCount,
      updatedCount,
      unchangedCount,
      errorCount,
    },
    allErrors,
    headerTechNames: techColMap.map((t) => t.name),
  };
}

/**
 * Generates CSV string for the active month (either template or exported data).
 */
export function generateScheduleCsv(
  technicians: Technician[],
  year: number,
  month: number,
  existingSchedules: ShiftScheduleV2[] = []
): string {
  const activeTechs = technicians.filter((t) => t.active);
  const daysInMonth = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = pad(month);

  // Header: schedule_date,shift,Tech1,Tech2,...
  const header = ['schedule_date', 'shift', ...activeTechs.map((t) => t.name)].join(',');
  const lines: string[] = [header];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${monthStr}-${pad(day)}`;

    for (const shift of ['PS', 'M'] as const) {
      const match = existingSchedules.find((s) => s.schedule_date === dateStr && s.shift === shift);
      const rowCols = [dateStr, shift];

      for (const tech of activeTechs) {
        const assignment = match?.assignments?.[String(tech.id)];
        const status = assignment?.status || 'off';
        rowCols.push(STATUS_TO_ID_LABEL[status] || 'Libur');
      }

      lines.push(rowCols.join(','));
    }
  }

  return lines.join('\n');
}

export type PatternPhase = 'work_1' | 'work_2' | 'off_1' | 'off_2';

export const PATTERN_PHASE_LABELS: Record<PatternPhase, string> = {
  work_1: 'Kerja-1 (Hari Ke-1)',
  work_2: 'Kerja-2 (Hari Ke-2)',
  off_1: 'Libur-1 (Hari Ke-1)',
  off_2: 'Libur-2 (Hari Ke-2)',
};

export const PATTERN_PHASE_ORDER: PatternPhase[] = ['work_1', 'work_2', 'off_1', 'off_2'];

/**
 * 4-Cycle Rotation Position Definition (Canonical Operational Rules):
 * Cycle Index 0: PS (Shift Pagi/Siang: 07:00 - 18:59)
 * Cycle Index 1: M (Shift Malam: 19:00 - 06:59)
 * Cycle Index 2: Libur Hari 1
 * Cycle Index 3: Libur Hari 2
 */
export type CyclePosition = 'PS' | 'M' | 'L1' | 'L2';

export const CYCLE_POSITIONS: CyclePosition[] = ['PS', 'M', 'L1', 'L2'];

export const CYCLE_POSITION_LABELS: Record<CyclePosition, string> = {
  PS: 'PS (Pagi/Siang)',
  M: 'M (Malam)',
  L1: 'Libur Hari 1',
  L2: 'Libur Hari 2',
};

export const CYCLE_INDEX_MAP: Record<CyclePosition, number> = {
  PS: 0,
  M: 1,
  L1: 2,
  L2: 3,
};

export const INDONESIAN_MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export const INDONESIAN_DAY_NAMES = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

/**
 * Formats a YYYY-MM-DD string into unambiguous Indonesian date format.
 * Example: "2026-08-01" -> "1 Agustus 2026" (or "Sabtu, 1 Agustus 2026" if includeDay is true).
 */
export function formatIndonesianDate(dateStr: string, includeDay = false): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const monthName = INDONESIAN_MONTH_NAMES[m - 1] || '';
  const formatted = `${d} ${monthName} ${y}`;
  if (includeDay) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayName = INDONESIAN_DAY_NAMES[dt.getUTCDay()];
    return `${dayName}, ${formatted}`;
  }
  return formatted;
}

/**
 * Checks if a given date is Monday to Friday (Office Hour for Supervisor).
 */
export function isWeekdayOfficeHour(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * Mathematical modulo that guarantees non-negative results for negative operands.
 */
export function safeModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Calculates calendar day difference (targetDate - anchorDate) in days.
 */
export function getCalendarDayDiff(targetDateStr: string, anchorDateStr: string): number {
  const [tY, tM, tD] = targetDateStr.split('-').map(Number);
  const [aY, aM, aD] = anchorDateStr.split('-').map(Number);
  const targetUtc = Date.UTC(tY, tM - 1, tD);
  const anchorUtc = Date.UTC(aY, aM - 1, aD);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((targetUtc - anchorUtc) / MS_PER_DAY);
}

/**
 * Checks if a user is a supervisor, strictly identified by role === 'supervisor'.
 */
export function isSupervisorUser(
  tech: { role?: string; id?: number | string; name?: string },
  masterTechnicians?: Technician[]
): boolean {
  if (tech.role === 'supervisor') return true;
  if (tech.id !== undefined && masterTechnicians && masterTechnicians.length > 0) {
    const found = masterTechnicians.find((t) => String(t.id) === String(tech.id));
    if (found?.role === 'supervisor') return true;
  }
  if (tech.name && masterTechnicians && masterTechnicians.length > 0) {
    const found = masterTechnicians.find(
      (t) => t.name.toLowerCase().trim() === tech.name?.toLowerCase().trim()
    );
    if (found?.role === 'supervisor') return true;
  }
  return false;
}

/**
 * Checks if a user is an admin (e.g. Desi), dynamically identified by role or master data.
 */
export function isAdminUser(
  tech: { role?: string; id?: number | string; name?: string },
  masterTechnicians?: Technician[]
): boolean {
  if (tech.role === 'admin') return true;
  if (tech.id !== undefined && masterTechnicians && masterTechnicians.length > 0) {
    const found = masterTechnicians.find((t) => String(t.id) === String(tech.id));
    if (found?.role === 'admin') return true;
  }
  if (tech.name && masterTechnicians && masterTechnicians.length > 0) {
    const found = masterTechnicians.find(
      (t) => t.name.toLowerCase().trim() === tech.name?.toLowerCase().trim()
    );
    if (found?.role === 'admin') return true;
  }
  return Boolean(tech.name && tech.name.toLowerCase().trim() === 'desi');
}

/**
 * Checks if a user is an Office Hour staff (Senin-Jumat Pagi, Sabtu-Minggu Libur: e.g. Luthfi & Desi).
 */
export function isOfficeHourStaff(
  tech: { role?: string; id?: number | string; name?: string },
  masterTechnicians?: Technician[]
): boolean {
  const nameClean = (tech.name || '').toLowerCase().trim();
  if (nameClean === 'luthfi' || nameClean === 'desi') return true;
  return isSupervisorUser(tech, masterTechnicians) || isAdminUser(tech, masterTechnicians);
}

/**
 * Returns only active technicians participating in shift rotation (excludes office hour staff).
 */
export function getRotationTechnicians(technicians: Technician[]): Technician[] {
  return technicians.filter((t) => t.active && !isOfficeHourStaff(t, technicians));
}

/**
 * Resolves a technician's cycle position on a target date given the anchor date and anchor position.
 */
export function getTechnicianCyclePositionOnDate(
  targetDateStr: string,
  anchorDateStr: string,
  anchorPosition: CyclePosition
): CyclePosition {
  const dayDiff = getCalendarDayDiff(targetDateStr, anchorDateStr);
  const anchorIndex = CYCLE_INDEX_MAP[anchorPosition] ?? 0;
  const targetIndex = safeModulo(anchorIndex + dayDiff, 4);
  return CYCLE_POSITIONS[targetIndex];
}

export interface TechnicianPatternConfig {
  technicianId: string;
  technicianName: string;
  anchorPosition?: CyclePosition;
  initialShift?: 'PS' | 'M';
  startPhase?: PatternPhase;
}

export interface DayPatternPreview {
  date: string;
  formattedDate: string;
  psTechs: string[];
  mTechs: string[];
  libur1Techs: string[];
  libur2Techs: string[];
  onDutyCount: number;
  supervisorInfo: string;
}

export interface PatternGenerationResult {
  valid: boolean;
  emptyShifts: Array<{ date: string; shift: 'PS' | 'M'; formattedDate: string }>;
  docs: ShiftScheduleV2[];
  previewDays: DayPatternPreview[];
  errorMessage?: string;
}

/**
 * Generates configurable 4-day cycle rotation pattern per technician and assigns supervisor office-hour defaults.
 *
 * CANONICAL RULES:
 * 1. Rotation Technicians follow 4-cycle sequence: PS -> M -> Libur Hari 1 -> Libur Hari 2 -> repeat.
 * 2. Supervisor (Luthfi):
 *    - Monday–Friday (Senin–Jumat): Automatically scheduled on Shift PS (Office Hour), off on Shift M.
 *    - Saturday–Sunday (Sabtu–Minggu): Defaults to Libur (off) on Shift PS and Shift M.
 *    - Supervisor NEVER automatically scheduled on Shift M.
 * 3. Validation:
 *    - Requires >= 1 technician (role technician) on Shift PS and Shift M.
 *    - Supervisor is strictly excluded from satisfying technician coverage.
 *    - Supervisor is displayed as on-duty PS on Monday–Friday.
 */
export function generate2On2OffConfigurablePattern(
  configs: TechnicianPatternConfig[],
  year: number,
  month: number,
  anchorDateStr: string,
  datasetId = 'default',
  masterTechnicians?: Technician[]
): PatternGenerationResult {
  // Filter out any office hour staff (Luthfi & Desi) from rotation cycle
  const rotationConfigs = configs.filter(
    (c) => !isOfficeHourStaff({ id: c.technicianId, name: c.technicianName }, masterTechnicians)
  );

  // Identify office hour staff dynamically from masterTechnicians or configs
  const officeHourList: Array<{ id: string; name: string }> = [];
  if (masterTechnicians && masterTechnicians.length > 0) {
    masterTechnicians
      .filter((t) => t.active && isOfficeHourStaff(t, masterTechnicians))
      .forEach((staff) => {
        officeHourList.push({ id: String(staff.id), name: staff.name });
      });
  } else {
    // If masterTechnicians not passed, check configs
    configs
      .filter((c) => isOfficeHourStaff({ id: c.technicianId, name: c.technicianName }))
      .forEach((staff) => {
        if (!officeHourList.some((s) => s.id === staff.technicianId)) {
          officeHourList.push({ id: staff.technicianId, name: staff.technicianName });
        }
      });
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = pad(month);

  const docs: ShiftScheduleV2[] = [];
  const emptyShifts: Array<{ date: string; shift: 'PS' | 'M'; formattedDate: string }> = [];
  const previewDays: DayPatternPreview[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${monthStr}-${pad(day)}`;
    const formattedDate = formatIndonesianDate(dateStr, true);
    const isWeekday = isWeekdayOfficeHour(dateStr);

    const psTechs: string[] = [];
    const mTechs: string[] = [];
    const libur1Techs: string[] = [];
    const libur2Techs: string[] = [];

    const psAssignments: Record<string, ShiftAssignmentV2> = {};
    const mAssignments: Record<string, ShiftAssignmentV2> = {};

    // 1. Assign Rotation Technicians
    for (const config of rotationConfigs) {
      let anchorPos: CyclePosition = config.anchorPosition || 'PS';
      if (!config.anchorPosition && config.startPhase) {
        if (config.startPhase === 'work_1') {
          anchorPos = config.initialShift === 'M' ? 'M' : 'PS';
        } else if (config.startPhase === 'work_2') {
          anchorPos = config.initialShift === 'M' ? 'L1' : 'M';
        } else if (config.startPhase === 'off_1') {
          anchorPos = 'L1';
        } else if (config.startPhase === 'off_2') {
          anchorPos = 'L2';
        }
      }

      const currentPos = getTechnicianCyclePositionOnDate(dateStr, anchorDateStr, anchorPos);

      if (currentPos === 'PS') {
        psTechs.push(config.technicianName);
        psAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'scheduled',
        };
        mAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'off',
        };
      } else if (currentPos === 'M') {
        mTechs.push(config.technicianName);
        psAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'off',
        };
        mAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'scheduled',
        };
      } else if (currentPos === 'L1') {
        libur1Techs.push(config.technicianName);
        psAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'off',
        };
        mAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'off',
        };
      } else if (currentPos === 'L2') {
        libur2Techs.push(config.technicianName);
        psAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'off',
        };
        mAssignments[config.technicianId] = {
          technician_name: config.technicianName,
          status: 'off',
        };
      }
    }

    // 2. Assign Office Hour Staff (Luthfi & Desi - Canonical: Weekday PS Scheduled, Weekend PS Off, M Off)
    for (const staff of officeHourList) {
      if (isWeekday) {
        psAssignments[staff.id] = {
          technician_name: staff.name,
          status: 'scheduled',
        };
        mAssignments[staff.id] = {
          technician_name: staff.name,
          status: 'off',
        };
      } else {
        psAssignments[staff.id] = {
          technician_name: staff.name,
          status: 'off',
        };
        mAssignments[staff.id] = {
          technician_name: staff.name,
          status: 'off',
        };
      }
    }

    // 3. Strict Validation: At least one technician with role technician must be on-duty on PS and M.
    // Supervisor does NOT count towards technician coverage.
    if (psTechs.length === 0) {
      emptyShifts.push({ date: dateStr, shift: 'PS', formattedDate });
    }
    if (mTechs.length === 0) {
      emptyShifts.push({ date: dateStr, shift: 'M', formattedDate });
    }

    docs.push({
      dataset_id: datasetId,
      schedule_date: dateStr,
      shift: 'PS',
      assignments: psAssignments,
      schema_version: 2,
    });

    docs.push({
      dataset_id: datasetId,
      schedule_date: dateStr,
      shift: 'M',
      assignments: mAssignments,
      schema_version: 2,
    });

    const officeNames = officeHourList.map((s) => s.name).join(' & ') || 'Desi & Luthfi';
    previewDays.push({
      date: dateStr,
      formattedDate,
      psTechs,
      mTechs,
      libur1Techs,
      libur2Techs,
      onDutyCount:
        psTechs.length +
        mTechs.length +
        (isWeekday && officeHourList.length > 0 ? officeHourList.length : 0),
      supervisorInfo: isWeekday
        ? `${officeNames} (Office Hour): Masuk PS`
        : `${officeNames} (Office Hour): Libur (Weekend)`,
    });
  }

  const valid = emptyShifts.length === 0;
  let errorMessage: string | undefined;
  if (!valid) {
    const sample = emptyShifts
      .slice(0, 3)
      .map((e) => `Shift ${e.shift} pada ${e.formattedDate}`)
      .join(', ');
    errorMessage = `Pola menghasilkan ${emptyShifts.length} shift tanpa teknisi bertugas (${sample}). Pastikan posisi tanggal acuan disebar merata sehingga minimal 1 teknisi bertugas di setiap shift PS dan M setiap hari (supervisor tidak dihitung sebagai coverage teknisi).`;
  }

  return {
    valid,
    emptyShifts,
    docs,
    previewDays,
    errorMessage,
  };
}

/**
 * Applies a newly generated schedule pattern onto existing shift documents,
 * preserving manual exception assignments (Cuti, Sakit, Izin, Lembur, or manual changes) if requested.
 */
export function applyPatternWithOverrides(
  existingDocs: ShiftScheduleV2[],
  generatedDocs: ShiftScheduleV2[],
  preserveManualOverrides = true
): ShiftScheduleV2[] {
  if (!preserveManualOverrides || !existingDocs || existingDocs.length === 0) {
    return generatedDocs;
  }

  const existingMap = new Map<string, ShiftScheduleV2>();
  existingDocs.forEach((d) => {
    existingMap.set(`${d.schedule_date}_${d.shift}`, d);
  });

  return generatedDocs.map((genDoc) => {
    const key = `${genDoc.schedule_date}_${genDoc.shift}`;
    const existing = existingMap.get(key);
    if (!existing || !existing.assignments) {
      return genDoc;
    }

    const mergedAssignments: Record<string, ShiftAssignmentV2> = { ...genDoc.assignments };

    // Check existing assignments for manual overrides
    Object.entries(existing.assignments).forEach(([techId, existAssign]) => {
      const isManualException =
        existAssign.status === 'leave' ||
        existAssign.status === 'sick' ||
        existAssign.status === 'permission' ||
        existAssign.status === 'overtime' ||
        existAssign.status === 'backup';

      if (isManualException) {
        mergedAssignments[techId] = { ...existAssign };
      }
    });

    return {
      ...genDoc,
      assignments: mergedAssignments,
    };
  });
}

/**
 * Generates a 2-on 2-off rotation pattern for the active month (Group-based convenience).
 * Excludes supervisor from shift rotation.
 */
export function generate2On2OffPatternPreview(
  technicians: Technician[],
  year: number,
  month: number,
  groupAIds: string[],
  groupBIds: string[],
  datasetId = 'default'
): ShiftScheduleV2[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = pad(month);
  const rotationTechs = getRotationTechnicians(technicians);

  const result: ShiftScheduleV2[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${monthStr}-${pad(day)}`;
    const cycleDay = (day - 1) % 4;
    const isGroupAPagi = cycleDay === 0 || cycleDay === 1;

    for (const shift of ['PS', 'M'] as const) {
      const isPS = shift === 'PS';
      const onDutyGroup = (isPS && isGroupAPagi) || (!isPS && !isGroupAPagi) ? groupAIds : groupBIds;

      const assignments: Record<string, ShiftAssignmentV2> = {};

      for (const tech of rotationTechs) {
        const techIdStr = String(tech.id);
        const isOnDuty = onDutyGroup.includes(techIdStr);
        assignments[techIdStr] = {
          technician_name: tech.name,
          status: isOnDuty ? 'scheduled' : 'off',
        };
      }

      result.push({
        dataset_id: datasetId,
        schedule_date: dateStr,
        shift,
        assignments,
        schema_version: 2,
      });
    }
  }

  return result;
}

/**
 * Generates preview of copied schedules from previous month to current month.
 * Excludes supervisor from shift rotation assignments.
 */
export function copyPreviousMonthSchedulesPreview(
  prevMonthSchedules: ShiftScheduleV2[],
  targetYear: number,
  targetMonth: number,
  technicians: Technician[],
  datasetId = 'default'
): ShiftScheduleV2[] {
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = pad(targetMonth);
  const rotationTechs = getRotationTechnicians(technicians);

  const result: ShiftScheduleV2[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const targetDateStr = `${targetYear}-${monthStr}-${pad(day)}`;

    for (const shift of ['PS', 'M'] as const) {
      const prevMatch = prevMonthSchedules.find((s) => {
        const prevDay = parseInt(s.schedule_date.split('-')[2], 10);
        return prevDay === day && s.shift === shift;
      });

      const assignments: Record<string, ShiftAssignmentV2> = {};

      for (const tech of rotationTechs) {
        const techIdStr = String(tech.id);
        const prevAssignment = prevMatch?.assignments?.[techIdStr];
        assignments[techIdStr] = {
          technician_name: tech.name,
          status: prevAssignment ? prevAssignment.status : 'off',
        };
      }

      result.push({
        dataset_id: datasetId,
        schedule_date: targetDateStr,
        shift,
        assignments,
        schema_version: 2,
      });
    }
  }

  return result;
}
