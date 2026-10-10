import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { AttendanceRecord } from '../types';
import { ShiftScheduleV2, ShiftAssignmentV2 } from './scheduleService';
import {
  DaftarHadirPdfDocument,
  RosterDaySchedule,
  DaftarHadirPdfProps,
} from '../pdf/DaftarHadirPdfDocument';
import {
  ScheduleRosterPdfDocument,
  ScheduleRosterPdfProps,
} from '../pdf/ScheduleRosterPdfDocument';

export const ROSTER_TECHNICIANS_DEFAULT = [
  'LUTHFI',
  'DESI',
  'FARIZ',
  'ZAKY',
  'REZA',
  'YOAN',
];

const ID_DAY_NAMES: Record<number, { full: string; abbr: string; fullEn: string }> = {
  0: { full: 'Minggu', abbr: 'MG', fullEn: 'Sunday' },
  1: { full: 'Senin', abbr: 'SN', fullEn: 'Monday' },
  2: { full: 'Selasa', abbr: 'SL', fullEn: 'Tuesday' },
  3: { full: 'Rabu', abbr: 'RB', fullEn: 'Wednesday' },
  4: { full: 'Kamis', abbr: 'KM', fullEn: 'Thursday' },
  5: { full: 'Jumat', abbr: 'JM', fullEn: 'Friday' },
  6: { full: 'Sabtu', abbr: 'SB', fullEn: 'Saturday' },
};

const ID_MONTH_NAMES: Record<number, string> = {
  1: 'Januari',
  2: 'Februari',
  3: 'Maret',
  4: 'April',
  5: 'Mei',
  6: 'Juni',
  7: 'Juli',
  8: 'Agustus',
  9: 'September',
  10: 'Oktober',
  11: 'November',
  12: 'Desember',
};

const EN_MONTH_NAMES: Record<number, string> = {
  1: 'January',
  2: 'February',
  3: 'March',
  4: 'April',
  5: 'May',
  6: 'June',
  7: 'July',
  8: 'August',
  9: 'September',
  10: 'October',
  11: 'November',
  12: 'December',
};

const TECH_ID_NAME_MAP: Record<string, string> = {
  '1': 'LUTHFI',
  '2': 'DESI',
  '3': 'FARIZ',
  '4': 'ZAKY',
  '5': 'REZA',
  '6': 'YOAN',
};

function matchesTech(techKey: string, assignKey: string, assignment?: ShiftAssignmentV2): boolean {
  const kUpper = (assignKey || '').toUpperCase().trim();
  const nameUpper = (assignment?.technician_name || '').toUpperCase().trim();
  const idMappedName = TECH_ID_NAME_MAP[kUpper];

  if (kUpper === techKey || kUpper.includes(techKey) || techKey.includes(kUpper)) return true;
  if (nameUpper === techKey || nameUpper.includes(techKey) || techKey.includes(nameUpper)) return true;
  if (idMappedName === techKey) return true;
  return false;
}

/**
 * Builds array of RosterDaySchedule for the given month & year.
 * If scheduleDocs are provided from DB, maps assignments.
 * Otherwise uses the canonical 4-cycle schedule:
 * - Luthfi & Desi: Monday-Friday 'P', Saturday-Sunday '-'
 * - Fariz, Zaky, Reza, Yoan: 4-day cycle ['PS', 'M', '-', '-']
 */
export function buildRosterDays(
  year: number,
  month: number, // 1-12
  scheduleDocs: ShiftScheduleV2[] = [],
  technicianList: string[] = ROSTER_TECHNICIANS_DEFAULT
): RosterDaySchedule[] {
  const totalDays = new Date(year, month, 0).getDate();
  const days: RosterDaySchedule[] = [];

  // Index existing schedule docs by "YYYY-MM-DD"
  const docMap = new Map<string, ShiftScheduleV2>();
  scheduleDocs.forEach((d) => {
    const dateKey = d.schedule_date || (d as any).date || '';
    if (dateKey) {
      docMap.set(`${dateKey}_${d.shift}`, d);
    }
  });

  // Canonical cycle anchor reference for October 1, 2026:
  // On 2026-10-01:
  // Yoan: PS (idx 0)
  // Fariz: M (idx 1)
  // Reza: - (idx 2, Libur 1)
  // Zaky: - (idx 3, Libur 2)
  const ROTATION_CYCLE: Array<'PS' | 'M' | '-' | '-'> = ['PS', 'M', '-', '-'];
  const ROTATION_OFFSET: Record<string, number> = {
    YOAN: 0,  // On 2026-10-01: PS
    FARIZ: 1, // On 2026-10-01: M
    REZA: 2,  // On 2026-10-01: -
    ZAKY: 3,  // On 2026-10-01: -
  };

  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(year, month - 1, d);
    const dayOfWeek = dt.getDay(); // 0 is Sunday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayMeta = ID_DAY_NAMES[dayOfWeek];
    const monthId = ID_MONTH_NAMES[month];
    const monthEn = EN_MONTH_NAMES[month];
    const dateYmd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const fullDateStr = `${dayMeta.full}, ${String(d).padStart(2, '0')} ${monthId} ${year}`;

    const psDoc = docMap.get(`${dateYmd}_PS`);
    const mDoc = docMap.get(`${dateYmd}_M`);

    const shiftMap: Record<string, 'P' | 'PS' | 'M' | '-'> = {};
    const psDuty: Record<string, boolean> = {};
    const mDuty: Record<string, boolean> = {};

    // Calculate days passed from anchor date (2026-10-01) for continuous rotation across months
    const anchorDateUtc = Date.UTC(2026, 9, 1); // 2026-10-01 UTC (month 9 in 0-indexed JS is October)
    const currentDateUtc = Date.UTC(year, month - 1, d);
    const daysPassedFromAnchor = Math.floor((currentDateUtc - anchorDateUtc) / (1000 * 60 * 60 * 24));

    technicianList.forEach((techRaw) => {
      const techKey = techRaw.trim().toUpperCase();

      // 1. Office Hour Staff (LUTHFI & DESI): ALWAYS Monday-Friday 'P', Saturday-Sunday '-'
      if (techKey === 'LUTHFI' || techKey === 'DESI') {
        if (!isWeekend) {
          shiftMap[techKey] = 'P';
          psDuty[techKey] = true;
          mDuty[techKey] = false;
        } else {
          shiftMap[techKey] = '-';
          psDuty[techKey] = false;
          mDuty[techKey] = false;
        }
        return;
      }

      // 2. Rotation Technicians (FARIZ, ZAKY, REZA, YOAN)
      // Check if DB explicitly has assignments
      let explicitStatusPS: string | undefined;
      let explicitStatusM: string | undefined;

      if (psDoc && psDoc.assignments) {
        const found = Object.entries(psDoc.assignments).find(([k, v]) =>
          matchesTech(techKey, k, v as ShiftAssignmentV2)
        );
        if (found) {
          const assignment = found[1] as ShiftAssignmentV2;
          explicitStatusPS = assignment.status;
        }
      }

      if (mDoc && mDoc.assignments) {
        const found = Object.entries(mDoc.assignments).find(([k, v]) =>
          matchesTech(techKey, k, v as ShiftAssignmentV2)
        );
        if (found) {
          const assignment = found[1] as ShiftAssignmentV2;
          explicitStatusM = assignment.status;
        }
      }

      const isExplicitPS = explicitStatusPS === 'scheduled' || explicitStatusPS === 'overtime';
      const isExplicitM = explicitStatusM === 'scheduled' || explicitStatusM === 'overtime';

      if (isExplicitPS) {
        shiftMap[techKey] = 'PS';
        psDuty[techKey] = true;
        mDuty[techKey] = false;
      } else if (isExplicitM) {
        shiftMap[techKey] = 'M';
        psDuty[techKey] = false;
        mDuty[techKey] = true;
      } else if (ROTATION_OFFSET[techKey] !== undefined) {
        // Continuous 4-day cycle rolling from 2026-10-01
        const dayOffset = ((daysPassedFromAnchor + ROTATION_OFFSET[techKey]) % 4 + 4) % 4;
        const code = ROTATION_CYCLE[dayOffset];
        shiftMap[techKey] = code;
        psDuty[techKey] = code === 'PS';
        mDuty[techKey] = code === 'M';
      } else {
        shiftMap[techKey] = '-';
        psDuty[techKey] = false;
        mDuty[techKey] = false;
      }
    });

    days.push({
      dayNumber: d,
      dayNameEn: dayMeta.fullEn,
      dayNameId: dayMeta.full,
      dayAbbrId: dayMeta.abbr,
      fullDateStr,
      dateYmd,
      isWeekend,
      shifts: {
        PS: psDuty,
        M: mDuty,
      },
      technicianShiftMap: shiftMap,
    });
  }

  return days;
}

/**
 * Downloads Daftar Hadir PDF (persis contoh 3 halaman).
 */
export async function downloadDaftarHadirPdf(options: {
  year: number;
  month: number;
  technicians?: string[];
  scheduleDocs?: ShiftScheduleV2[];
  attendanceRecords?: AttendanceRecord[];
  mode?: 'blank' | 'filled';
  supervisorName?: string;
  supervisorTitle?: string;
}): Promise<void> {
  const {
    year,
    month,
    technicians = ROSTER_TECHNICIANS_DEFAULT,
    scheduleDocs = [],
    attendanceRecords = [],
    mode = 'blank',
    supervisorName = 'RIZKO ENDRA NUGRAHA',
    supervisorTitle = 'FACILITY MAINTENANCE - ELEKTRONIKA',
  } = options;

  const monthName = ID_MONTH_NAMES[month] || `Bulan ${month}`;
  const days = buildRosterDays(year, month, scheduleDocs, technicians);

  const totalDays = days.length;
  const startDateStr = `01 ${monthName} ${year}`;
  const endDateStr = `${String(totalDays).padStart(2, '0')} ${monthName} ${year}`;

  const doc = React.createElement(DaftarHadirPdfDocument, {
    monthName,
    year,
    startDateStr,
    endDateStr,
    technicians,
    days,
    attendanceRecords,
    mode,
    supervisorName,
    supervisorTitle,
  });

  const blob = await pdf(doc as any).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `DAFTAR_HADIR_OM_NTI_${monthName.toUpperCase()}_${year}_${mode === 'filled' ? 'REKAP' : 'BLANK'}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads Schedule Roster PDF (persis gambar matriks landscape).
 */
export async function downloadScheduleRosterPdf(options: {
  year: number;
  month: number;
  technicians?: string[];
  scheduleDocs?: ShiftScheduleV2[];
  supervisorName?: string;
  supervisorTitle?: string;
}): Promise<void> {
  const {
    year,
    month,
    technicians = ROSTER_TECHNICIANS_DEFAULT,
    scheduleDocs = [],
    supervisorName = 'RIZKO ENDRA NUGRAHA',
    supervisorTitle = 'FACILITY MAINTENANCE - ELEKTRONIKA',
  } = options;

  const monthName = ID_MONTH_NAMES[month] || `Bulan ${month}`;
  const days = buildRosterDays(year, month, scheduleDocs, technicians);

  const doc = React.createElement(ScheduleRosterPdfDocument, {
    monthName,
    year,
    technicians,
    days,
    supervisorName,
    supervisorTitle,
  });

  const blob = await pdf(doc as any).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SCHEDULE_OM_NTI_HALIM_${monthName.toUpperCase()}_${year}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
