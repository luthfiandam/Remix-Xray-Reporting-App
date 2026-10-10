import {
  PreventiveSession,
  PreventiveEntry,
  Equipment,
  EquipmentType,
  Technician,
  Location,
  CorrectiveReport,
  StructuredReportData,
  StructuredCorrectiveEntry,
  ShiftType,
} from '../types';
import { getOperationalShiftForCorrective } from '../utils/technicianSchedule';
import { formatIndonesianDate, formatTimeShort, formatTimeRange, roundTimeDown5Min, roundTimeUp5Min, parseHoursAndMinutes } from '../utils/timeFormat';
import { getActivePreventiveRecords, getActiveCorrectiveReports, normalizeShift } from '../utils/contextFilter';
import { normalizeOperationalDate, isSpreadsheetEpochArtifact } from '../utils/dateTimeUtils';
import {
  resolveTechnicianNames,
  findEquipmentById,
  findLocationById,
  findEquipmentTypeById,
  formatPersonName,
} from '../utils/entityLookup';

export function formatDateIndonesian(dateString: string): string {
  return formatIndonesianDate(dateString, { includeDayName: true });
}

/**
 * Resolves a validated Jakarta time for a preventive entry within its operational shift.
 * Validates against operational shift windows:
 * - Shift Pagi (PS): 06:00 to 19:30 WIB
 * - Shift Malam (M): 18:00 WIB (operational date) to 08:00 WIB (next calendar day)
 *
 * Anomaly Detection & Recovery:
 * 1. Checks if submitted_at was corrupted by the legacy -7h timezone bug:
 *    - submitted_at is outside the shift window (e.g. 00:05 or 23:35 for Shift PS)
 *    - OR created_at is more than 2 hours later than submitted_at (database row created hours after submit)
 * 2. If anomalous, recovers using created_at (if created_at is within shift window) and emits a diagnostic warning.
 * 3. Excludes completely unrecoverable outlier times to avoid corrupting min/max report time range.
 */
export function resolveValidatedEntryTime(
  entry: {
    id?: number | string;
    equipment_code?: string;
    equipment_id?: number | string;
    submitted_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  },
  operationalDate: string,
  isNightShift: boolean
): { timeStr: string; minuteValue: number } | null {
  const evaluateCandidate = (candidate?: string | null): { hours: number; minutes: number } | null => {
    if (!candidate) return null;
    return parseHoursAndMinutes(candidate);
  };

  const isWithinShiftWindow = (hm: { hours: number; minutes: number }): boolean => {
    if (isNightShift) {
      // Shift Malam: 18:00 - 23:59 or 00:00 - 08:00
      return hm.hours >= 18 || hm.hours <= 8;
    } else {
      // Shift Pagi (PS): 06:00 - 19:30
      if (hm.hours >= 6 && hm.hours < 19) return true;
      if (hm.hours === 19 && hm.minutes <= 30) return true;
      return false;
    }
  };

  const toMinuteValue = (hm: { hours: number; minutes: number }): number => {
    const normHours = isNightShift && hm.hours < 8 ? hm.hours + 24 : hm.hours;
    return normHours * 60 + hm.minutes;
  };

  const formatHm = (hm: { hours: number; minutes: number }): string => {
    return `${String(hm.hours).padStart(2, '0')}:${String(hm.minutes).padStart(2, '0')}`;
  };

  const subHm = evaluateCandidate(entry.submitted_at);
  const createdHm = evaluateCandidate(entry.created_at);

  // Check for signature of -7h corruption:
  // 1. submitted_at falls outside the shift window (e.g. 00:05 or 23:35 for Shift PS)
  // 2. OR createdHm is >= 3 hours later than subHm (e.g. 07:10 vs 14:10 due to UTC to WIB offset glitch)
  // 3. OR created_at is > 2h later than submitted_at
  let isSubAnomalous = false;
  if (subHm) {
    if (!isWithinShiftWindow(subHm)) {
      isSubAnomalous = true;
    } else if (createdHm && isWithinShiftWindow(createdHm)) {
      const diffMin = (createdHm.hours * 60 + createdHm.minutes) - (subHm.hours * 60 + subHm.minutes);
      if (diffMin >= 180) {
        isSubAnomalous = true;
      }
    } else if (entry.submitted_at && entry.created_at) {
      const subMs = new Date(entry.submitted_at).getTime();
      const crMs = new Date(entry.created_at).getTime();
      if (!isNaN(subMs) && !isNaN(crMs) && crMs - subMs > 2 * 3600 * 1000) {
        isSubAnomalous = true;
      }
    }
  } else {
    isSubAnomalous = true;
  }

  // If anomalous, attempt recovery from created_at
  if (isSubAnomalous) {
    if (createdHm && isWithinShiftWindow(createdHm)) {
      console.warn(
        `[Timestamp Audit] Entry ID ${entry.id || 'N/A'} (${entry.equipment_code || entry.equipment_id}) memiliki waktu submitted_at abnormal ("${entry.submitted_at}"). Berhasil dipulihkan dari created_at: "${entry.created_at}" -> ${formatHm(createdHm)} WIB.`
      );
      return {
        timeStr: formatHm(createdHm),
        minuteValue: toMinuteValue(createdHm),
      };
    }
    const updatedHm = evaluateCandidate(entry.updated_at);
    if (updatedHm && isWithinShiftWindow(updatedHm)) {
      console.warn(
        `[Timestamp Audit] Entry ID ${entry.id || 'N/A'} memiliki waktu submitted_at abnormal ("${entry.submitted_at}"). Dipulihkan dari updated_at: ${formatHm(updatedHm)} WIB.`
      );
      return {
        timeStr: formatHm(updatedHm),
        minuteValue: toMinuteValue(updatedHm),
      };
    }

    if (entry.submitted_at) {
      console.warn(
        `[Timestamp Audit] Entry ID ${entry.id || 'N/A'} memiliki waktu abnormal di luar batas shift ("${entry.submitted_at}"). Dikecualikan dari perhitungan rentang jam laporan.`
      );
    }
    return null;
  }

  // submitted_at is valid and within shift window
  if (subHm) {
    return {
      timeStr: formatHm(subHm),
      minuteValue: toMinuteValue(subHm),
    };
  }

  return null;
}

/**
 * Computes start and end time range for a list of entries with 5-minute rounding:
 * - Start time rounded DOWN to nearest 5 min
 * - End time rounded UP to nearest 5 min
 */
export function calculatePreventiveTimeRange(
  entries: Array<{
    id?: number | string;
    equipment_code?: string;
    equipment_id?: number | string;
    submitted_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>,
  operationalDate: string,
  shift: string,
  fallbackStart?: string,
  fallbackEnd?: string
): { startTime: string; endTime: string; timeRangeText: string } {
  const isNightShift = normalizeShift(shift) === 'Malam';
  const resolved = entries
    .map((e) => resolveValidatedEntryTime(e, operationalDate, isNightShift))
    .filter((r): r is { timeStr: string; minuteValue: number } => Boolean(r));

  if (resolved.length === 0) {
    const parsedStart = fallbackStart ? parseHoursAndMinutes(fallbackStart) : null;
    const parsedEnd = fallbackEnd ? parseHoursAndMinutes(fallbackEnd) : null;
    const isStartValid = parsedStart ? (isNightShift ? (parsedStart.hours >= 18 || parsedStart.hours <= 8) : (parsedStart.hours >= 6 && parsedStart.hours <= 20)) : false;
    const isEndValid = parsedEnd ? (isNightShift ? (parsedEnd.hours >= 18 || parsedEnd.hours <= 8) : (parsedEnd.hours >= 6 && parsedEnd.hours <= 20)) : false;

    const s = isStartValid && fallbackStart ? roundTimeDown5Min(fallbackStart) : '-';
    const e = isEndValid && fallbackEnd ? roundTimeUp5Min(fallbackEnd) : '-';
    return {
      startTime: s,
      endTime: e,
      timeRangeText: formatTimeRange(s, e),
    };
  }

  resolved.sort((a, b) => a.minuteValue - b.minuteValue);

  const rawStart = resolved[0].timeStr;
  const rawEnd = resolved[resolved.length - 1].timeStr;

  const startTime = roundTimeDown5Min(rawStart);
  const endTime = roundTimeUp5Min(rawEnd);

  return {
    startTime,
    endTime,
    timeRangeText: formatTimeRange(startTime, endTime),
  };
}

export function buildStructuredReportData(
  session: PreventiveSession,
  entries: PreventiveEntry[],
  equipments: Equipment[],
  equipmentTypes: EquipmentType[],
  technicians: Technician[],
  correctiveReports: CorrectiveReport[] = [],
  locations: Location[] = []
): StructuredReportData {
  // Ensure we only process entries and corrective reports that belong strictly to the session's active context and deduplicate in memory
  const sanitizedEntries = getActivePreventiveRecords(entries, {
    datasetId: session.dataset_id,
    operationalDate: session.operational_date,
    shift: session.shift,
  });

  const sanitizedCorrectives = getActiveCorrectiveReports(correctiveReports, {
    datasetId: session.dataset_id,
    operationalDate: session.operational_date,
    shift: session.shift,
  });

  const techNames = resolveTechnicianNames(session.technician_ids, technicians);

  // Compute validated start and end times without letting corrupted outlier timestamps stretch report time range
  // Operational Rule: Start time rounded DOWN to nearest 5 min, End time rounded UP to nearest 5 min
  const timeRangeCalc = calculatePreventiveTimeRange(
    sanitizedEntries,
    session.operational_date,
    session.shift,
    session.started_at,
    session.ended_at
  );
  const startTime = timeRangeCalc.startTime;
  const endTime = timeRangeCalc.endTime;

  // Group entries by Equipment Type Priority (1: XRAY, 2: WTMD, 3: HHMD, 4: ETD)
  const sortedTypes = [...equipmentTypes].sort((a, b) => a.priority - b.priority);

  const linesByType: StructuredReportData['lines_by_type'] = [];
  const entriesByType: StructuredReportData['entries_by_type'] = [];

  for (const type of sortedTypes) {
    // Find all entries of this equipment type
    const typeEntries = sanitizedEntries
      .filter((e) => {
        const eq = findEquipmentById(equipments, e.equipment_id);
        return eq?.equipment_type_id === type.id;
      })
      .sort((a, b) => a.sequence - b.sequence); // ORDER BY sequence chronological

    if (typeEntries.length === 0) continue;

    const eqNames = typeEntries
      .map((e) => findEquipmentById(equipments, e.equipment_id)?.name)
      .filter(Boolean) as string[];

    linesByType.push({
      type_code: type.code,
      type_name: type.name,
      equipment_names: eqNames,
    });

    entriesByType.push({
      type_code: type.code,
      type_name: type.name,
      priority: type.priority,
      entries: typeEntries.map((e) => {
        const eq = findEquipmentById(equipments, e.equipment_id);
        return {
          id: e.id,
          equipment_id: Number(e.equipment_id),
          equipment_name: eq?.name || 'Equipment',
          location_name: eq?.name || '',
          view_type: e.view_type || eq?.default_view || 'single',
          measurements: e.measurements || [],
          notes: e.notes || 'Sudah dilakukan pembersihan dan bisa digunakan dengan normal.',
          submitted_at: e.submitted_at,
          created_at: e.created_at,
          updated_at: e.updated_at,
          sequence: e.sequence,
          evidences: e.evidences || [],
          checklist_frequency_id: Number(e.checklist_frequency_id),
        };
      }),
    });
  }

  // Filter corrective reports for this operational shift
  const filteredCorrectives = (sanitizedCorrectives || []).filter((report) => {
    const shiftInfo = getOperationalShiftForCorrective(report);
    return (
      shiftInfo.operationalDate === session.operational_date &&
      shiftInfo.shift === session.shift
    );
  });

  // Sort ascending chronologically by actual datetime of start_time within shift window
  filteredCorrectives.sort((a, b) => {
    const getTimestamp = (r: CorrectiveReport) => {
      const d = r.corrective_date || session.operational_date;
      const t = (r.start_time || '00:00').replace('.', ':');
      const parts = t.split(':');
      const hh = String(parseInt(parts[0] || '0', 10)).padStart(2, '0');
      const mm = String(parseInt(parts[1] || '0', 10)).padStart(2, '0');
      const ts = new Date(`${d}T${hh}:${mm}:00+07:00`).getTime();
      return isNaN(ts) ? 0 : ts;
    };
    return getTimestamp(a) - getTimestamp(b);
  });

  const correctiveEntries: StructuredCorrectiveEntry[] = filteredCorrectives.map((report) => {
    const eq = findEquipmentById(equipments, report.equipment_id);
    const eqType = findEquipmentTypeById(equipmentTypes, eq?.equipment_type_id);
    const loc = findLocationById(locations, report.location_id || eq?.location_id);

    const sTime = formatTimeShort(report.start_time, false);
    const eTime = formatTimeShort(report.end_time, false);
    const timeRange = formatTimeRange(report.start_time, report.end_time);

    return {
      id: report.id,
      corrective_code: report.corrective_code,
      equipment_name: eq?.name || 'Equipment',
      type_code: eqType?.code || 'XRAY',
      type_name: eqType?.name || (eqType?.code === 'XRAY' ? 'X-Ray System' : eqType?.code || 'Peralatan'),
      brand: eq?.brand || (report as any).brand || '',
      model: eq?.model || (report as any).model || null,
      location_name: loc?.name || eq?.name || '',
      problem_description: report.problem_description,
      action_taken: report.action_taken,
      result: report.result,
      result_text: report.result_text,
      start_time: sTime,
      end_time: eTime || sTime,
      time_range: timeRange,
      notes: report.notes || '-',
      technicians: report.technicians || [report.created_by],
      evidences: report.evidences || [],
      collage_object_key: report.collage_object_key || (report as any).collage_object_key,
      collage_url: report.collage_url || (report as any).collage_url,
    };
  });

  const isoOperationalDate = normalizeOperationalDate(session.operational_date);
  const displayDate = formatDateIndonesian(session.operational_date);

  return {
    operational_date: isoOperationalDate,
    display_date: displayDate,
    shift: session.shift,
    start_time: formatTimeShort(startTime, false),
    end_time: formatTimeShort(endTime, false),
    technicians: (techNames.length > 0 ? techNames : session.technician_names || []).map((name) =>
      formatPersonName(name)
    ),
    lines_by_type: linesByType,
    entries_by_type: entriesByType,
    corrective_entries: correctiveEntries,
  };
}

function cleanLocationName(rawName: string, typeCode: string): string {
  let name = rawName.trim();
  const regex = new RegExp(`^${typeCode}\\s*`, 'i');
  name = name.replace(regex, '').trim();

  if (name === name.toUpperCase()) {
    name = name
      .toLowerCase()
      .split(' ')
      .map((word) => {
        if (['vip', 'vvip', 'cip', 'bhs', 'hbscp', 'mscp', 'etd', 'wtmd', 'hhmd', 'xray'].includes(word)) {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }
  return name;
}

function isBottomExcludedXRay(item: {
  equipment_id?: number;
  equipment_name?: string;
  notes?: string;
  measurements?: any[];
}): boolean {
  const id = Number(item.equipment_id);
  if (id === 2 || id === 3 || id === 9) return true;

  const name = (item.equipment_name || '').toLowerCase();
  if (name.includes('bhs')) return true;
  if (name.includes('line e') || name.includes('hbscp line e') || name.includes('scp 2 line e')) return true;

  const hasMeasurements =
    Array.isArray(item.measurements) &&
    item.measurements.length > 0 &&
    item.measurements.some((m) => m.positive_high_voltage || m.heater_current || m.anode_current);

  if (!hasMeasurements && (name.includes('line c') || name.includes('scp 2 line c'))) {
    return true;
  }

  return false;
}

export function generateWhatsAppReportText(data: StructuredReportData, targetFrequencyId?: number): string {
  // Map of interval names
  const INTERVAL_NAMES: Record<number, string> = {
    1: 'HARIAN',
    2: 'MINGGUAN',
    3: 'BULANAN',
    4: 'TRIWULAN',
    5: 'SEMESTERAN',
    6: 'TAHUNAN',
  };

  // Extract all entries across all types
  const allEntries = data.entries_by_type.flatMap((g) => g.entries);

  // Find which intervals were actually submitted
  const submittedFrequencyIds = Array.from(
    new Set(allEntries.map((e) => e.checklist_frequency_id).filter(Boolean) as number[])
  ).sort((a, b) => a - b);

  // If a targetFrequencyId is provided, only generate text for that specific interval
  const activeFrequencies =
    targetFrequencyId !== undefined
      ? [targetFrequencyId]
      : submittedFrequencyIds.length > 0
      ? submittedFrequencyIds
      : [1];

  // Sort technicians so Luthfi always comes first if present
  const sortedTechnicians = [...(data.technicians || [])].sort((a, b) => {
    const aIsLuthfi = a.toLowerCase().includes('luthfi');
    const bIsLuthfi = b.toLowerCase().includes('luthfi');
    if (aIsLuthfi && !bIsLuthfi) return -1;
    if (!aIsLuthfi && bIsLuthfi) return 1;
    return 0;
  });

  const fullDateFormatted = formatIndonesianDate(data.operational_date, { includeDayName: true });
  const shiftText = data.shift ? (data.shift.toLowerCase().includes('shift') ? data.shift : `Shift ${data.shift}`) : 'Shift Pagi';
  const timeRangeText = formatTimeRange(data.start_time, data.end_time);

  let text = '';

  activeFrequencies.forEach((freqId, fIdx) => {
    if (fIdx > 0) text += '\n\n---------------------------------------\n\n';

    // Filter type groups that have entries in this frequency
    const activeGroups = data.entries_by_type
      .map((group) => ({
        ...group,
        entries: group.entries.filter((e) => e.checklist_frequency_id === freqId),
      }))
      .filter((group) => group.entries.length > 0);

    const freqEntries = activeGroups.flatMap((group) => group.entries);
    const freqTimeCalc = calculatePreventiveTimeRange(
      freqEntries,
      data.operational_date,
      data.shift,
      data.start_time,
      data.end_time
    );
    const freqTimeRangeText = freqTimeCalc.timeRangeText !== '-' ? freqTimeCalc.timeRangeText : timeRangeText;

    if (freqId === 4 || freqId === 5) {
      // --- TRIWULAN & SEMESTERAN ---
      text += `LAPORAN PREVENTIVE MAINTENANCE TRIWULAN & SEMESTERAN\n\n`;

      // 1. Line lists first for Triwulan & Semesteran
      activeGroups.forEach((group) => {
        text += `Berikut Lokasi Line ${group.type_name || group.type_code}:\n`;
        group.entries.forEach((item) => {
          text += `• ${item.equipment_name}\n`;
        });
        text += `\n`;
      });

      // 2. Metadata: Tanggal & Jam
      text += `Tanggal : ${fullDateFormatted} (${shiftText})\n`;
      text += `Jam : ${freqTimeRangeText}\n\n`;

      // 3. Teknisi
      text += `Teknisi :\n`;
      for (const tech of sortedTechnicians) {
        text += `⦁ *${tech}*\n`;
      }
      text += `\n`;

      // 4. Notes
      text += `Notes :\n`;
      const allNotesList: string[] = [];
      activeGroups.forEach((group) => {
        group.entries.forEach((e) => {
          if (e.notes) {
            // Split by newline or bullet points if present
            const lines = e.notes.split('\n');
            lines.forEach((l) => {
              const cleanedLine = l.replace(/^[⦁•*]\s*/, '').trim();
              if (cleanedLine && !allNotesList.includes(cleanedLine)) {
                allNotesList.push(cleanedLine);
              }
            });
          }
        });
      });

      if (allNotesList.length > 0) {
        allNotesList.forEach((n) => {
          text += `⦁ ${n}\n`;
        });
      } else {
        text += `⦁ Sudah dilakukan pembersihan dan pemeriksaan komponen internal. Berfungsi normal.\n`;
      }

    } else if (freqId === 2) {
      // --- MINGGUAN ---
      text += `*LAPORAN PREVENTIVE MAINTENANCE MINGGUAN*\n\n`;

      // 1. Line lists
      activeGroups.forEach((group) => {
        text += `Berikut Lokasi Line ${group.type_code}:\n`;
        group.entries.forEach((item) => {
          text += `•${item.equipment_name}\n`;
        });
        text += `\n`;
      });

      // 2. Metadata: Hari/Tanggal & Jam & Teknisi
      text += `Hari/Tanggal : ${fullDateFormatted} (${shiftText.toUpperCase()})\n`;
      text += `Jam : ${freqTimeRangeText}\n`;
      text += `Teknisi :\n`;
      for (const tech of sortedTechnicians) {
        text += `*${tech}*\n`;
      }
      text += `\n--------------------------\n`;

      // 3. Notes grouped per equipment type
      text += `Notes :\n`;
      activeGroups.forEach((group, gIdx) => {
        const cleanedNames = group.entries.map((e) => cleanLocationName(e.equipment_name, group.type_code));
        let joinedLocations = '';
        if (cleanedNames.length === 1) {
          joinedLocations = cleanedNames[0];
        } else if (cleanedNames.length === 2) {
          joinedLocations = `${cleanedNames[0]} dan ${cleanedNames[1]}`;
        } else {
          joinedLocations = `${cleanedNames.slice(0, -1).join(', ')} dan ${cleanedNames[cleanedNames.length - 1]}`;
        }

        const typeLabel = group.type_code === 'XRAY' ? 'Xray' : group.type_code;
        text += `* *${typeLabel} ${joinedLocations}*\n`;

        const firstNote = group.entries[0]?.notes || 'Hasil dari pengecekan, pemeriksaan keadaanya baik berjalan dengan normal.';
        text += `${firstNote}\n`;

        if (gIdx < activeGroups.length - 1) {
          text += `\n`;
        }
      });

    } else if (freqId === 3) {
      // --- BULANAN ---
      text += `*LAPORAN PREVENTIVE MAINTENANCE BULANAN*\n\n`;

      // 1. Metadata: Hari / Tanggal & Jam & Teknisi
      text += `Hari / Tanggal : ${fullDateFormatted} ${shiftText}.\n`;
      text += `Jam : ${freqTimeRangeText}\n\n`;

      text += `*Teknisi :\n`;
      for (const tech of sortedTechnicians) {
        text += `⦁ ${tech}\n`;
      }
      text = text.trimEnd() + `*\n\n`;

      // 2. Line lists
      activeGroups.forEach((group) => {
        text += `Berikut Lokasi Line ${group.type_code.toUpperCase()}:\n`;
        group.entries.forEach((item) => {
          const locClean = cleanLocationName(item.equipment_name, group.type_code).toUpperCase();
          text += `* ${locClean}\n`;
        });
        text += `\n`;
      });

      // 3. Notes grouped per equipment type
      text += `Notes :\n`;
      activeGroups.forEach((group, gIdx) => {
        const cleanedNames = group.entries.map((e) => cleanLocationName(e.equipment_name, group.type_code).toUpperCase());
        let joinedLocations = '';
        if (cleanedNames.length === 1) {
          joinedLocations = cleanedNames[0];
        } else if (cleanedNames.length === 2) {
          joinedLocations = `${cleanedNames[0]}, ${cleanedNames[1]}`;
        } else {
          joinedLocations = cleanedNames.join(', ');
        }

        const typeLabel = group.type_code === 'XRAY' ? 'Xray' : group.type_code;
        text += `⦁ *${typeLabel} ${joinedLocations}*\n`;

        const firstNote = group.entries[0]?.notes || 'Sudah dilakukan Preventive Bulanan. Hasil Normal tidak ada kendala.';
        text += `${firstNote}\n`;

        if (gIdx < activeGroups.length - 1) {
          text += `_____________\n`;
        }
      });

    } else {
      // --- HARIAN (FREQ 1) & DEFAULT ---
      const intervalName = INTERVAL_NAMES[freqId] || 'HARIAN';
      text += `*LAPORAN PREVENTIVE MAINTENANCE ${intervalName}*\n\n`;
      text += `Hari / Tanggal : ${fullDateFormatted} ${shiftText}.\n`;
      text += `Jam : ${freqTimeRangeText}\n\n`;

      text += `*Teknisi :*\n`;
      for (const tech of sortedTechnicians) {
        text += `⦁ *${tech}*\n`;
      }
      text += `\n`;

      // Line lists
      activeGroups.forEach((group) => {
        text += `Berikut Lokasi Line ${group.type_code}:\n`;
        const sortedEntries =
          group.type_code === 'XRAY'
            ? [...group.entries].sort((a, b) => {
                const aBottom = isBottomExcludedXRay(a) ? 1 : 0;
                const bBottom = isBottomExcludedXRay(b) ? 1 : 0;
                if (aBottom !== bBottom) return aBottom - bBottom;
                return (a.sequence || 0) - (b.sequence || 0);
              })
            : group.entries;

        sortedEntries.forEach((item) => {
          text += `• ${item.equipment_name}\n`;
        });
        text += `\n`;
      });

      // Notes
      text += `Notes :\n`;
      const totalGroups = activeGroups.length;

      activeGroups.forEach((group, groupIdx) => {
        if (group.type_code === 'XRAY') {
          const standardXrayEntries = group.entries.filter((e) => !isBottomExcludedXRay(e));
          const bottomXrayEntries = group.entries.filter((e) => isBottomExcludedXRay(e));

          const totalXraySections = standardXrayEntries.length + (bottomXrayEntries.length > 0 ? 1 : 0);
          let renderedXrayCount = 0;

          standardXrayEntries.forEach((item) => {
            renderedXrayCount++;
            text += `⦁ *${item.equipment_name}*\n`;
            text += `Hasil pengecekan\n`;

            if (item.measurements && item.measurements.length > 0) {
              text += `*Positive high voltage & Negative high Voltage*\n`;
              item.measurements.forEach((m) => {
                const pos = m.positive_high_voltage !== undefined ? `${m.positive_high_voltage}kV` : '-';
                const neg = m.negative_high_voltage !== undefined ? `${m.negative_high_voltage}kV` : '-';
                text += `(Gen ${m.generator} ${pos} & ${neg})\n`;
              });

              text += `1. *Heater current*\n`;
              const heaterParts = item.measurements.map((m) => {
                const h = m.heater_current !== undefined ? `${m.heater_current}mA` : '-';
                return `(Gen ${m.generator}: ${h})`;
              });
              text += `${heaterParts.join(' ')}\n`;

              text += `2. *Anode Current*\n`;
              const anodeParts = item.measurements.map((m) => {
                const a = m.anode_current !== undefined ? `${m.anode_current}uA` : '-';
                return `(Gen ${m.generator}: ${a})`;
              });
              text += `${anodeParts.join(' ')}\n`;
            }

            text += `${item.notes}\n`;

            if (renderedXrayCount < totalXraySections || groupIdx < totalGroups - 1) {
              text += `_______________________________________\n`;
            }
          });

          if (bottomXrayEntries.length > 0) {
            renderedXrayCount++;
            const cleanedNames = bottomXrayEntries.map((e) => {
              const raw = cleanLocationName(e.equipment_name, 'XRAY').trim();
              return raw.toUpperCase();
            });

            let joinedNames = cleanedNames.join(', ');
            text += `⦁ *XRAY ${joinedNames}*\n`;

            const firstNote = bottomXrayEntries[0]?.notes;
            const allSameNote = bottomXrayEntries.every((e) => e.notes === firstNote);
            const noteText =
              allSameNote && firstNote && !firstNote.toLowerCase().includes('bisa digunakan dengan normal')
                ? firstNote
                : 'Sudah dilakukan pengecekan dan pembersihan. Equipment bisa digunakan dengan normal.';

            text += `${noteText}\n`;

            if (groupIdx < totalGroups - 1) {
              text += `_______________________________________\n`;
            }
          }
        } else {
          const firstNote = group.entries[0]?.notes;
          const allSameNote = group.entries.every((e) => e.notes === firstNote);

          if (allSameNote && group.entries.length > 1) {
            const cleanedNames = group.entries.map((e) => cleanLocationName(e.equipment_name, group.type_code));
            let joinedNames = cleanedNames.slice(0, -1).join(', ') + ' dan ' + cleanedNames[cleanedNames.length - 1];
            text += `⦁ *${group.type_code} ${joinedNames}*\n`;
            text += `${firstNote}\n`;
          } else {
            group.entries.forEach((item, itemIdx) => {
              const cleaned = cleanLocationName(item.equipment_name, group.type_code);
              text += `⦁ *${group.type_code} ${cleaned}*\n`;
              text += `${item.notes}\n`;

              if (itemIdx < group.entries.length - 1) {
                text += `_______________________________________\n`;
              }
            });
          }

          if (groupIdx < totalGroups - 1) {
            text += `_______________________________________\n`;
          }
        }
      });
    }
  });

  const footer = `\n\n*_sent from nararyaapps.net_*`;
  return text.trim() ? (text.trim() + footer) : '';
}

export function generateCorrectiveWhatsAppReportText(data: StructuredReportData): string {
  const fullDateFormatted = formatIndonesianDate(data.operational_date, { includeDayName: true });
  const shiftText = data.shift ? ` Shift ${data.shift}.` : '.';
  const fullDate = `${fullDateFormatted}${shiftText}`;
  const techNames = (data.technicians && data.technicians.length > 0)
    ? data.technicians.join(', ')
    : 'Teknisi';

  const formatWibTime = (t?: string) => {
    if (!t || t.trim() === '-' || t.trim() === '') return '-';
    const clean = t.trim().replace(':', '.');
    return clean.toUpperCase().includes('WIB') ? clean : `${clean} WIB`;
  };

  const footer = `\n\n*_sent from nararyaapps.net_*`;

  if (!data.corrective_entries || data.corrective_entries.length === 0) {
    let text = `*LAPORAN CORRECTIVE MAINTENANCE*\n`;
    text += `--------------------------\n`;
    text += `*Hari / Tanggal* : ${fullDate}\n`;
    text += `*Teknisi* : ${techNames}\n`;
    text += `*Jam Mulai* : ${formatWibTime(data.start_time)}\n`;
    text += `*Jam Selesai* : ${formatWibTime(data.end_time)}\n`;
    text += `*Lokasi Alat* : -\n`;
    text += `*Uraian Masalah* : \n-\n`;
    text += `*Tindakan* : \n-\n`;
    text += `*Hasil* : Nihil / Tidak ada kendala corrective.${footer}`;
    return text.trim();
  }

  const reports = data.corrective_entries.map((c) => {
    let locAlat = '-';
    const eqName = (c.equipment_name || '').trim();
    const locName = (c.location_name || '').trim();
    if (eqName && locName) {
      if (eqName.toLowerCase() === locName.toLowerCase()) {
        locAlat = eqName;
      } else if (eqName.toLowerCase().includes(locName.toLowerCase())) {
        locAlat = eqName;
      } else if (locName.toLowerCase().includes(eqName.toLowerCase())) {
        locAlat = locName;
      } else {
        locAlat = `${eqName} ${locName}`;
      }
    } else {
      locAlat = eqName || locName || '-';
    }

    const rawAction = c.action_taken || '-';
    const actionLines = rawAction.split('\n').map((l) => l.trim()).filter(Boolean);
    const formattedAction = actionLines
      .map((l) => (l.startsWith('-') || l.startsWith('•') ? l : `- ${l}`))
      .join('\n');

    // Jenis Alat & Tipe/Model
    const jenisAlat = c.type_name || (c.type_code ? (c.type_code === 'XRAY' ? 'X-Ray System' : c.type_code === 'WTMD' ? 'Walk Through Metal Detector' : c.type_code === 'HHMD' ? 'Hand Held Metal Detector' : c.type_code === 'ETD' ? 'Explosive Trace Detector' : c.type_code) : 'X-Ray System');
    const tipeModel = [c.brand, c.model].filter(Boolean).join(' - ') || (c as any).type || '-';

    let text = `*LAPORAN CORRECTIVE MAINTENANCE*\n`;
    text += `--------------------------\n`;
    text += `*Hari / Tanggal* : ${fullDate}\n`;
    text += `*Teknisi* : ${techNames}\n`;
    text += `*Jam Mulai* : ${formatWibTime(c.start_time || data.start_time)}\n`;
    text += `*Jam Selesai* : ${formatWibTime(c.end_time || data.end_time)}\n`;
    text += `*Jenis Alat* : ${jenisAlat}\n`;
    text += `*Tipe / Model* : ${tipeModel}\n`;
    text += `*Lokasi Alat* : ${locAlat}\n`;
    text += `*Uraian Masalah* : \n${c.problem_description || '-'}\n`;
    text += `*Tindakan* : \n${formattedAction}\n`;
    text += `*Hasil* : ${c.result_text || c.result || 'Xray sudah bisa di Gunakan dengan Normal.'}${footer}`;
    return text.trim();
  });

  return reports.join('\n\n_______________________________________\n\n');
}

export interface HistoricalReportSummary {
  dateKey: string; // YYYY-MM-DD___Shift
  rawDate: string; // YYYY-MM-DD
  formattedDate: string; // e.g. Minggu, 20 September 2026
  shift: ShiftType;
  preventiveCount: number;
  preventiveEquipmentsCount: number;
  correctiveCount: number;
  correctiveResolvedCount: number;
  technicianNames: string[];
  frequenciesPresent: number[];
  firstSubmittedAt?: string;
  lastSubmittedAt?: string;
  isCurrentSession?: boolean;
}

export function getHistoricalReportList(
  entries: PreventiveEntry[],
  correctiveReports: CorrectiveReport[],
  technicians: Technician[],
  currentSession?: PreventiveSession
): HistoricalReportSummary[] {
  const map = new Map<string, {
    rawDate: string;
    shift: ShiftType;
    entries: PreventiveEntry[];
    correctives: CorrectiveReport[];
    techNamesSet: Set<string>;
    freqSet: Set<number>;
    timestamps: string[];
  }>();

  const getOrInitKey = (date: string, shiftVal: ShiftType | string) => {
    const canonicalShift = (normalizeShift(shiftVal) || 'Pagi') as ShiftType;
    const key = `${date}___${canonicalShift}`;
    if (!map.has(key)) {
      map.set(key, {
        rawDate: date,
        shift: canonicalShift,
        entries: [],
        correctives: [],
        techNamesSet: new Set(),
        freqSet: new Set(),
        timestamps: [],
      });
    }
    return map.get(key)!;
  };

  /**
   * Helper to safely split and deduplicate technician names
   */
  const addUniqueTechnicianName = (set: Set<string>, rawName?: string | null) => {
    if (!rawName || typeof rawName !== 'string') return;
    // Split on comma, semicolon, or slash in case of combined strings like "Luthfi, Yoan"
    const parts = rawName.split(/[,;/]/);
    for (const part of parts) {
      const clean = formatPersonName(part.trim());
      if (clean.length >= 2) {
        // Case-insensitive deduplication
        const alreadyExists = Array.from(set).some(
          (existing) => existing.trim().toLowerCase() === clean.toLowerCase()
        );
        if (!alreadyExists) {
          set.add(clean);
        }
      }
    }
  };

  // 1. Process Preventive Entries
  entries.forEach((e) => {
    const origDate = e.operational_date || e.period_key || (e.submitted_at ? e.submitted_at.split('T')[0] : '');
    if (!origDate || String(origDate).trim() === '' || isSpreadsheetEpochArtifact(origDate)) return;
    const rawDate = normalizeOperationalDate(origDate);
    if (!rawDate || rawDate.includes('1899')) return;
    const shift = (normalizeShift(e.shift) || 'Pagi') as ShiftType;
    const item = getOrInitKey(rawDate, shift);
    item.entries.push(e);
    if (e.checklist_frequency_id) item.freqSet.add(Number(e.checklist_frequency_id));

    // Resolve technician names from submitted_by_technician_ids
    if (Array.isArray(e.submitted_by_technician_ids) && e.submitted_by_technician_ids.length > 0) {
      e.submitted_by_technician_ids.forEach((id) => {
        const found = technicians.find((t) => Number(t.id) === Number(id));
        if (found && found.name) {
          addUniqueTechnicianName(item.techNamesSet, found.name);
        }
      });
    }
    if ((e as any).submitted_by) {
      addUniqueTechnicianName(item.techNamesSet, (e as any).submitted_by);
    }
    if (Array.isArray((e as any).technician_names)) {
      (e as any).technician_names.forEach((t: string) => addUniqueTechnicianName(item.techNamesSet, t));
    }

    // Capture validated submission timestamps (excludes corrupted outlier times)
    const resolvedTime = resolveValidatedEntryTime(e, rawDate, shift === 'Malam');
    if (resolvedTime) {
      item.timestamps.push(`${rawDate}T${resolvedTime.timeStr}:00+07:00`);
    } else {
      const subAt = e.submitted_at || e.created_at;
      if (subAt && typeof subAt === 'string' && !subAt.includes('1899')) {
        const parsed = parseHoursAndMinutes(subAt);
        if (parsed) {
          const isNight = shift === 'Malam';
          const valid = isNight ? (parsed.hours >= 18 || parsed.hours <= 8) : (parsed.hours >= 6 && parsed.hours <= 20);
          if (valid) {
            const validTs = subAt.includes('T') || subAt.includes(' ') || subAt.includes('-')
              ? subAt
              : `${rawDate}T${subAt.length === 5 ? subAt + ':00' : subAt}`;
            item.timestamps.push(validTs);
          }
        }
      }
    }
  });

  // 2. Process Corrective Reports
  correctiveReports.forEach((c) => {
    const origDate = c.corrective_date || (c as any).operational_date || (c.created_at ? c.created_at.split('T')[0] : '');
    if (!origDate || String(origDate).trim() === '' || isSpreadsheetEpochArtifact(origDate)) return;
    const rawDate = normalizeOperationalDate(origDate);
    if (!rawDate || rawDate.includes('1899')) return;
    const shift = (normalizeShift(c.shift || getOperationalShiftForCorrective(c).shift) || 'Pagi') as ShiftType;
    const item = getOrInitKey(rawDate, shift);
    item.correctives.push(c);

    // Add technicians carefully with deduplication (splits comma strings like "Luthfi, Yoan")
    if (Array.isArray(c.technicians)) {
      c.technicians.forEach((t) => addUniqueTechnicianName(item.techNamesSet, t));
    }
    if (c.created_by) {
      addUniqueTechnicianName(item.techNamesSet, c.created_by);
    }
    if (Array.isArray((c as any).technician_names)) {
      (c as any).technician_names.forEach((t: string) => addUniqueTechnicianName(item.techNamesSet, t));
    }

    const createdAt = c.created_at || (c as any).submitted_at;
    if (createdAt && typeof createdAt === 'string' && !createdAt.includes('1899')) {
      const validTs = createdAt.includes('T') || createdAt.includes(' ') || createdAt.includes('-')
        ? createdAt
        : `${rawDate}T${createdAt.length === 5 ? createdAt + ':00' : createdAt}`;
      item.timestamps.push(validTs);
    }
  });

  // 3. Ensure current session is present
  if (currentSession && currentSession.operational_date) {
    const normDate = normalizeOperationalDate(currentSession.operational_date);
    const normShift = (normalizeShift(currentSession.shift) || 'Pagi') as ShiftType;
    const item = getOrInitKey(normDate, normShift);
    if (Array.isArray(currentSession.technician_names)) {
      currentSession.technician_names.forEach((t) => addUniqueTechnicianName(item.techNamesSet, t));
    }
    // Note: We deliberately do NOT push raw session times (like "07:00") into timestamps
    // so empty/active sessions without submissions don't show an "Invalid Date"
  }

  // 4. Build output list
  const result: HistoricalReportSummary[] = [];

  map.forEach((item, key) => {
    const uniqueEquipments = new Set(item.entries.map((e) => e.equipment_id));
    const validTimestamps = item.timestamps
      .filter((ts) => Boolean(ts) && !isNaN(new Date(ts).getTime()))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const resolvedCorrectives = item.correctives.filter(
      (c) => c.result === 'Resolved' || c.result_text === 'Resolved' || (c as any).status === 'Selesai'
    ).length;

    const techList = Array.from(item.techNamesSet).filter(Boolean);

    const isCurr =
      currentSession &&
      item.rawDate === normalizeOperationalDate(currentSession.operational_date) &&
      normalizeShift(item.shift) === normalizeShift(currentSession.shift);

    // CRITICAL FIX: Only fallback to currentSession technician names for the CURRENT session!
    // Never attribute historical past dates to the currently logged in user session!
    let resolvedTechnicians: string[] = [];
    if (techList.length > 0) {
      resolvedTechnicians = techList;
    } else if (isCurr && currentSession?.technician_names?.length) {
      resolvedTechnicians = currentSession.technician_names.filter(Boolean);
    } else {
      resolvedTechnicians = ['Teknisi Tidak Tercatat'];
    }

    result.push({
      dateKey: key,
      rawDate: item.rawDate,
      formattedDate: formatIndonesianDate(item.rawDate, { includeDayName: true }),
      shift: item.shift,
      preventiveCount: item.entries.length,
      preventiveEquipmentsCount: uniqueEquipments.size,
      correctiveCount: item.correctives.length,
      correctiveResolvedCount: resolvedCorrectives,
      technicianNames: resolvedTechnicians,
      frequenciesPresent: Array.from(item.freqSet).sort((a, b) => a - b),
      firstSubmittedAt: validTimestamps.length > 0 ? validTimestamps[0] : undefined,
      lastSubmittedAt: validTimestamps.length > 0 ? validTimestamps[validTimestamps.length - 1] : undefined,
      isCurrentSession: !!isCurr,
    });
  });

  // Urutan dari yang paling baru ke paling lama (Newest to Oldest)
  return result.sort((a, b) => {
    // 1. Newest calendar date first
    const timeA = new Date(a.rawDate).getTime();
    const timeB = new Date(b.rawDate).getTime();
    if (!isNaN(timeA) && !isNaN(timeB) && timeB !== timeA) {
      return timeB - timeA;
    }
    const dateCmp = b.rawDate.localeCompare(a.rawDate);
    if (dateCmp !== 0) return dateCmp;

    // 2. Shift order: Malam (3) > Siang (2) > Pagi (1)
    const shiftWeight = (s: string) => {
      const norm = normalizeShift(s);
      if (norm === 'Malam') return 3;
      if (norm === 'Siang') return 2;
      return 1;
    };
    return shiftWeight(b.shift) - shiftWeight(a.shift);
  });
}
