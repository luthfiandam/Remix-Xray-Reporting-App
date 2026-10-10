import { PreventiveEntry, CorrectiveReport, ShiftType } from '../types';
import { getPeriodKey } from './periodUtils';

/**
 * Normalizes shift string representation (e.g. 'PS' / 'Pagi' -> 'Pagi', 'M' / 'Malam' -> 'Malam').
 */
export function normalizeShift(shiftStr?: string): string {
  if (!shiftStr) return '';
  const s = String(shiftStr).trim().toUpperCase();
  if (s === 'PAGI' || s === 'PS' || s === 'SHIFT 1' || s === 'P' || s === 'MORNING') return 'Pagi';
  if (s === 'MALAM' || s === 'M' || s === 'SHIFT 2' || s === 'NIGHT') return 'Malam';
  return String(shiftStr).trim();
}

/**
 * Returns the canonical two-letter shift code ('PS' for Pagi / Shift 1, 'M' for Malam / Shift 2).
 */
export function toCanonicalShiftCode(shiftStr?: string): 'PS' | 'M' {
  const norm = normalizeShift(shiftStr);
  return norm === 'Malam' ? 'M' : 'PS';
}

export interface ActiveContext {
  datasetId?: string;
  operationalDate: string;
  shift: string | ShiftType;
  frequencyId?: number;
}

/**
 * Checks if a PreventiveEntry belongs strictly to the current active context
 * (matching active dataset, shift, frequency, and operational date/period_key).
 */
export function isRecordInActiveContext(
  record: PreventiveEntry,
  context: ActiveContext,
  debugLog = false
): boolean {
  if (!record) return false;

  // 1. Dataset ID match (defaults to 'default')
  const recordDs = (record.dataset_id || 'default').trim();
  const targetDs = (context.datasetId || 'default').trim();
  if (recordDs !== targetDs) {
    if (debugLog) {
      console.log(`[CloudSync] Rejected record ${record.id}: dataset mismatch (record: '${recordDs}', active: '${targetDs}')`);
    }
    return false;
  }

  // 2. Shift match (must be present and match)
  const recordShift = normalizeShift(record.shift);
  const targetShift = normalizeShift(context.shift);
  if (!recordShift || !targetShift || recordShift !== targetShift) {
    if (debugLog) {
      console.log(`[CloudSync] Rejected record ${record.id}: shift mismatch (record: '${recordShift}', active: '${targetShift}')`);
    }
    return false;
  }

  // 3. Frequency match if context specifies frequencyId
  const freqId = Number(record.checklist_frequency_id || 1);
  if (context.frequencyId !== undefined && Number(context.frequencyId) !== freqId) {
    if (debugLog) {
      console.log(`[CloudSync] Rejected record ${record.id}: frequency mismatch (record: ${freqId}, target: ${context.frequencyId})`);
    }
    return false;
  }

  // 4. Period Key match
  const targetPeriodKey = getPeriodKey(freqId, context.operationalDate);
  let recordPeriodKey = (record.period_key || '').trim();
  if (!recordPeriodKey && record.operational_date) {
    recordPeriodKey = getPeriodKey(freqId, record.operational_date);
  }

  if (!recordPeriodKey || !targetPeriodKey || recordPeriodKey !== targetPeriodKey) {
    if (debugLog) {
      console.log(`[CloudSync] Rejected record ${record.id}: period_key mismatch (record: '${recordPeriodKey}', target: '${targetPeriodKey}')`);
    }
    return false;
  }

  // 5. Operational Date match rule:
  // For active shift context and shift reports, an entry belongs to this operational shift
  // ONLY if it was actually performed on this shift's operational_date!
  if (record.operational_date) {
    if (record.operational_date !== context.operationalDate) {
      if (debugLog) {
        console.log(`[CloudSync] Rejected record ${record.id}: operational_date mismatch (record: '${record.operational_date}', target: '${context.operationalDate}')`);
      }
      return false;
    }
  }

  return true;
}

/**
 * Deduplicates Preventive entries in memory based on canonical identity:
 * (dataset_id, equipment_id, checklist_frequency_id, period_key, normalized shift).
 * Keeps the newest record (preferring updated_at, then submitted_at, then created_at, then highest ID).
 */
export function dedupePreventiveRecords(records: PreventiveEntry[]): PreventiveEntry[] {
  if (!Array.isArray(records)) return [];
  const map = new Map<string, PreventiveEntry>();

  for (const record of records) {
    if (!record) continue;
    const ds = (record.dataset_id || 'default').trim();
    const eq = Number(record.equipment_id);
    const freq = Number(record.checklist_frequency_id || 1);
    const shift = normalizeShift(record.shift);
    let periodKey = (record.period_key || '').trim();
    if (!periodKey && record.operational_date) {
      periodKey = getPeriodKey(freq, record.operational_date);
    }

    const key = `${ds}|${eq}|${freq}|${periodKey}|${shift}`;

    if (!map.has(key)) {
      map.set(key, record);
    } else {
      const existing = map.get(key)!;
      const existingTime = existing.updated_at || existing.submitted_at || existing.created_at || '';
      const newTime = record.updated_at || record.submitted_at || record.created_at || '';

      if (newTime && (!existingTime || newTime >= existingTime)) {
        map.set(key, record);
      } else if (!existingTime && !newTime && (Number(record.id) || 0) > (Number(existing.id) || 0)) {
        map.set(key, record);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Filter preventive entries to those in active context AND deduplicated in memory.
 */
export function getActivePreventiveRecords(
  records: PreventiveEntry[],
  context: ActiveContext,
  debugLog = false
): PreventiveEntry[] {
  if (!Array.isArray(records)) return [];
  const filtered = records.filter((r) => isRecordInActiveContext(r, context, debugLog));
  return dedupePreventiveRecords(filtered);
}

/**
 * Filter corrective reports to those in active context (matching active dataset, date, shift).
 */
export function getActiveCorrectiveReports(
  reports: CorrectiveReport[],
  context: ActiveContext
): CorrectiveReport[] {
  if (!Array.isArray(reports)) return [];
  const targetDs = (context.datasetId || 'default').trim();
  const targetShift = normalizeShift(context.shift);

  return reports.filter((r) => {
    if (!r) return false;
    const rDs = (r.dataset_id || 'default').trim();
    if (rDs !== targetDs) return false;

    const rDate = r.corrective_date || '';
    if (rDate && rDate !== context.operationalDate) return false;

    const rShift = normalizeShift(r.shift);
    if (rShift && targetShift && rShift !== targetShift) return false;

    return true;
  });
}
