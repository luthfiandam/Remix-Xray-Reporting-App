import { PreventiveEntry, PreventiveEvidence, Equipment, EquipmentType } from '../types';
import { FirestorePreventiveRecord, CanonicalShift, DriveEvidence, buildPreventiveDocumentId } from '../types/firestore';
import { normalizeShift } from '../utils/contextFilter';
import { getPeriodKey } from '../utils/periodUtils';
import { sanitizePreventiveEvidencesForSupabase } from './evidenceService';
import {
  normalizeOperationalDate,
  normalizeSubmittedDateTime,
  normalizeHistoricalTimestamp,
} from '../utils/dateTimeUtils';

/**
 * Normalizes any string or domain shift to canonical database shift: 'PS' | 'M'.
 */
export function toFirestoreCanonicalShift(shiftStr?: string): CanonicalShift {
  const norm = normalizeShift(shiftStr);
  return norm === 'M' ? 'M' : 'PS';
}

/**
 * Maps a domain PreventiveEntry to a FirestorePreventiveRecord.
 * Ensures zero `undefined` values so Firestore writes never fail.
 */
export function domainToFirestoreRecord(
  entry: PreventiveEntry,
  equipments: Equipment[] = [],
  equipmentTypes: EquipmentType[] = []
): FirestorePreventiveRecord {
  const eq = equipments.find((e) => e.id === Number(entry.equipment_id));
  const eqType = eq ? equipmentTypes.find((t) => t.id === eq.equipment_type_id) : undefined;
  const canonicalShift = toFirestoreCanonicalShift(entry.shift);
  const now = new Date().toISOString();

  const datasetId = (entry.dataset_id || 'default').trim();
  const freqId = Number(entry.checklist_frequency_id) || 1;
  const rawDateOrPeriod = entry.period_key || entry.operational_date || now.split('T')[0];
  const periodKey = getPeriodKey(freqId, rawDateOrPeriod).trim();
  const recordId = String(entry.id || Date.now());

  // Canonical business date: YYYY-MM-DD
  const operationalDate = normalizeOperationalDate(entry.operational_date || rawDateOrPeriod);

  // Normalized submission datetime (prevents 1899/1900 spreadsheet epoch artifacts)
  const submittedAt = normalizeSubmittedDateTime(entry.submitted_at, operationalDate, canonicalShift);

  // Historical created / updated timestamps
  const createdAt = normalizeHistoricalTimestamp(entry.created_at || entry.submitted_at, operationalDate, canonicalShift);
  const updatedAt = normalizeHistoricalTimestamp(entry.updated_at || entry.submitted_at, operationalDate, canonicalShift);

  // Map and sanitize evidences - NEVER include Base64
  const cleanEvidences = sanitizePreventiveEvidencesForSupabase(entry.evidences || []);
  const evidences: DriveEvidence[] = cleanEvidences.map((ev, idx) => ({
    drive_file_id: ev.file_id || '',
    drive_url: ev.drive_url || ev.file_path || '',
    file_name: `evidence_${idx + 1}.jpg`,
    type: 'evidence',
    caption: ev.caption || '',
    uploaded_at: now,
  }));

  // Sanitize checklist results
  const checklistResults = (entry.checklist_results || []).map((cr) => ({
    checklist_item_id: Number(cr.checklist_item_id),
    description: cr.description || '',
    status: cr.status || 'OK',
    note: cr.note || '',
  }));

  // Sanitize measurements
  const measurements = (entry.measurements || []).map((m) => ({
    generator: m.generator || 'A',
    positive_high_voltage: m.positive_high_voltage !== undefined ? Number(m.positive_high_voltage) : 0,
    negative_high_voltage: m.negative_high_voltage !== undefined ? Number(m.negative_high_voltage) : 0,
    heater_current: m.heater_current !== undefined ? Number(m.heater_current) : 0,
    anode_current: m.anode_current !== undefined ? Number(m.anode_current) : 0,
  }));

  return {
    record_id: recordId,
    dataset_id: datasetId,
    equipment_id: Number(entry.equipment_id),
    equipment_code: eq?.equipment_code || `EQ-${entry.equipment_id}`,
    equipment_name: eq?.name || 'Security Equipment',
    equipment_type: eqType?.name || 'XRAY',
    checklist_frequency_id: Number(entry.checklist_frequency_id),
    period_key: periodKey,
    operational_date: operationalDate,
    shift: canonicalShift,
    preventive_session_id: entry.preventive_session_id ? Number(entry.preventive_session_id) : 101,
    sequence: entry.sequence ? Number(entry.sequence) : 1,
    submitted_at: submittedAt,
    submitted_by_technician_ids: (entry.submitted_by_technician_ids || []).map(String),
    status: entry.status || 'OK',
    notes: entry.notes || '',
    checklist_results: checklistResults,
    measurements: measurements,
    evidences: evidences,
    created_at: createdAt,
    updated_at: updatedAt,
    schema_version: 1,
  };
}

/**
 * Maps a FirestorePreventiveRecord back to a domain PreventiveEntry.
 */
export function firestoreRecordToDomain(doc: FirestorePreventiveRecord): PreventiveEntry {
  const domainShift = doc.shift === 'M' ? 'Malam' : 'Pagi';

  const evidences: PreventiveEvidence[] = (doc.evidences || []).map((ev, idx) => ({
    id: idx + 1,
    file_path: ev.file_name || '',
    caption: ev.caption || '',
    drive_url: ev.drive_url || '',
    file_id: ev.drive_file_id || '',
  }));

  const numId = Number(doc.record_id);
  const entryId = !isNaN(numId) && numId > 0 ? numId : Date.now();

  return {
    id: entryId,
    dataset_id: doc.dataset_id || 'default',
    preventive_session_id: doc.preventive_session_id || 101,
    equipment_id: Number(doc.equipment_id),
    checklist_frequency_id: Number(doc.checklist_frequency_id),
    sequence: Number(doc.sequence || 1),
    submitted_at: doc.submitted_at || '',
    submitted_by_technician_ids: (doc.submitted_by_technician_ids || []).map(Number),
    notes: doc.notes || '',
    status: (doc.status as any) || 'OK',
    checklist_results: doc.checklist_results || [],
    measurements: doc.measurements || [],
    evidences: evidences,
    operational_date: doc.operational_date || '',
    shift: domainShift,
    period_key: doc.period_key || '',
    created_at: doc.created_at || '',
    updated_at: doc.updated_at || '',
    synced: true,
  };
}
