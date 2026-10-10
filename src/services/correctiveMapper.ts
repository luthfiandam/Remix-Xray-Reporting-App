import { CorrectiveReport, Equipment, Location } from '../types';
import {
  FirestoreCorrectiveRecord,
  CanonicalShift,
  generateCorrectiveEventId,
  buildCorrectiveDocumentId,
} from '../types/firestore';
import { normalizeShift } from '../utils/contextFilter';
import { sanitizeCorrectiveEvidencesForSupabase } from './evidenceService';
import {
  normalizeOperationalDate,
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
 * Normalizes time string to canonical HH:mm format.
 * Examples:
 * - "13.30" -> "13:30"
 * - "13:30:00" -> "13:30"
 * - "9:5" -> "09:05"
 * - "" -> ""
 */
export function normalizeTimeString(timeStr?: string): string {
  if (!timeStr || timeStr.trim() === '') return '';
  const clean = timeStr.trim().replace('WIB', '').replace('wib', '').trim();
  const match = clean.match(/^(\d{1,2})[:.](\d{1,2})/);
  if (match) {
    const hh = match[1].padStart(2, '0');
    const mm = match[2].padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return clean;
}

/**
 * Helper to derive a stable numeric ID for legacy compatibility.
 * IMPORTANT: This numeric ID is purely for legacy client/UI compatibility (React key/state).
 * It is NEVER used as canonical Firestore technical identity (`event_id` and `document_id` remain strictly string).
 */
export function deriveLegacyNumericId(recordId?: number | string): number {
  if (typeof recordId === 'number' && !isNaN(recordId) && recordId > 0) {
    return recordId;
  }
  if (typeof recordId === 'string') {
    const parsed = parseInt(recordId, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

/**
 * Invariant Boundary: Maximum possible sequential database ID for historical Sheets-era records.
 * 
 * Rationale:
 * 1. Historical sequential primary keys in Google Sheets start at 1 and increment by 1.
 *    Even in very large scale industrial settings, the total record count in a single sheet
 *    will never approach 1 billion (10^9).
 * 2. On the other hand, newly generated client-side IDs use Date.now() timestamp-based keys,
 *    which in millisecond-precision represents values like 1.78 * 10^12 (greater than 1.7 trillion).
 * 3. Therefore, 1,000,000,000 (1 billion) is a mathematically perfect, non-arbitrary boundary
 *    that safely segregates sequential Sheets-era database IDs from millisecond-precision timestamps.
 */
export const MAX_LEGACY_SEQUENTIAL_ID = 1000000000;

/**
 * Helper to normalize and reconcile corrective record identities generics.
 * Handles:
 * Case A - canonical Firestore record (already has event_id and document_id)
 * Case B - legacy historical Sheets record (has id or record_id but no event_id/document_id)
 * Case C - genuinely new post-cutover record (no legacy id, generates fresh UUID and document_id)
 */
export function normalizeCorrectiveIdentity(
  record: any,
  datasetId: string = 'default'
): { event_id: string; document_id: string } {
  const cleanDs = (datasetId || record.dataset_id || 'default').trim();

  // Case A — already canonical Firestore record
  if (record.event_id && record.document_id) {
    return {
      event_id: String(record.event_id).trim(),
      document_id: String(record.document_id).trim(),
    };
  }

  // Case B — historical legacy record
  const legacyId = record.record_id ?? record.id;
  if (legacyId !== undefined && legacyId !== null) {
    const idNum = Number(legacyId);
    if (!isNaN(idNum) && idNum > 0 && idNum < MAX_LEGACY_SEQUENTIAL_ID) {
      const event_id = `legacy_${idNum}`;
      const document_id = buildCorrectiveDocumentId(cleanDs, event_id);
      return { event_id, document_id };
    }
  }

  // Case C — genuinely NEW post-cutover report
  const event_id = record.event_id ? String(record.event_id).trim() : generateCorrectiveEventId();
  const document_id = record.document_id ? String(record.document_id).trim() : buildCorrectiveDocumentId(cleanDs, event_id);
  return { event_id, document_id };
}

/**
 * Maps a domain CorrectiveReport to a FirestoreCorrectiveRecord.
 * Ensures zero `undefined` values so Firestore writes never fail.
 */
export function domainToFirestoreCorrectiveRecord(
  entry: CorrectiveReport,
  equipments: Equipment[] = [],
  locations: Location[] = [],
  authUid?: string
): FirestoreCorrectiveRecord {
  const eq = equipments.find((e) => e.id === Number(entry.equipment_id));
  const loc = locations.find((l) => l.id === Number(entry.location_id));

  const datasetId = (entry.dataset_id || 'default').trim();
  const { event_id: eventId, document_id: docId } = normalizeCorrectiveIdentity(entry, datasetId);
  const canonicalShift = toFirestoreCanonicalShift(entry.shift);
  const nowIso = new Date().toISOString();

  // Canonical business date: YYYY-MM-DD
  const operationalDate = normalizeOperationalDate(entry.corrective_date || entry.created_at || nowIso);

  // Normalized timestamps
  const createdAt = normalizeHistoricalTimestamp(entry.created_at, operationalDate, canonicalShift);
  const updatedAt = nowIso;

  // Normalized times
  const startTime = normalizeTimeString(entry.start_time);
  const endTime = normalizeTimeString(entry.end_time);

  // Sanitize technicians & created_by
  const technicians = Array.isArray(entry.technicians) ? entry.technicians.map(String) : [];
  const createdBy = entry.created_by || (technicians.length > 0 ? technicians.join(', ') : 'Teknisi');

  // Sanitize evidences (array of Google Drive URLs only, NEVER Base64)
  const evidences = sanitizeCorrectiveEvidencesForSupabase(entry.evidences || []);

  return {
    document_id: docId,
    event_id: eventId,
    dataset_id: datasetId,
    record_id: entry.id || deriveLegacyNumericId(entry.id),
    corrective_code: entry.corrective_code || '',
    operational_date: operationalDate,
    shift: canonicalShift,
    equipment_id: Number(entry.equipment_id) || (eq?.id ? eq.id : 0),
    equipment_code: eq?.equipment_code || `EQ-${entry.equipment_id}`,
    equipment_name: eq?.name || 'Equipment',
    equipment_type: eq?.equipment_type_id ? String(eq.equipment_type_id) : 'XRAY',
    location_id: Number(entry.location_id) || (loc?.id ? loc.id : (eq?.location_id ? eq.location_id : 0)),
    location_name: loc?.name || '',
    problem_description: entry.problem_description || '',
    action_taken: entry.action_taken || '',
    result: entry.result || 'Resolved',
    result_text: entry.result_text || '',
    start_time: startTime,
    end_time: endTime,
    technicians: technicians,
    created_by: createdBy,
    notes: entry.notes || '',
    evidences: evidences,
    submitted_by_uid: authUid || '',
    updated_by_uid: authUid || '',
    created_at: createdAt,
    updated_at: updatedAt,
    schema_version: 1,
  };
}

/**
 * Maps a FirestoreCorrectiveRecord back to a domain CorrectiveReport.
 */
export function firestoreCorrectiveRecordToDomain(doc: any): CorrectiveReport {
  const domainShift = doc.shift === 'M' ? 'Malam' : 'Pagi';
  const legacyId = deriveLegacyNumericId(doc.record_id);

  // Helper to normalize created_at / updated_at whether Firestore Timestamp or ISO string
  const formatTimestamp = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val.toDate === 'function') {
      try {
        return val.toDate().toISOString();
      } catch {
        return '';
      }
    }
    if (val._seconds !== undefined) {
      try {
        return new Date(val._seconds * 1000).toISOString();
      } catch {
        return '';
      }
    }
    if (val instanceof Date) return val.toISOString();
    return String(val);
  };

  return {
    id: legacyId,
    event_id: doc.event_id,
    document_id: doc.document_id,
    dataset_id: doc.dataset_id || 'default',
    corrective_code: doc.corrective_code || '',
    corrective_date: doc.operational_date || '',
    shift: domainShift,
    equipment_id: Number(doc.equipment_id),
    location_id: Number(doc.location_id),
    problem_description: doc.problem_description || '',
    action_taken: doc.action_taken || '',
    result: doc.result || 'Resolved',
    result_text: doc.result_text || '',
    technicians: doc.technicians || [],
    start_time: doc.start_time || '',
    end_time: doc.end_time || '',
    notes: doc.notes || '',
    created_by: doc.created_by || '',
    created_at: formatTimestamp(doc.created_at),
    updated_at: formatTimestamp(doc.updated_at),
    evidences: doc.evidences || [],
    synced: true,
  };
}
