import { ChecklistResult, MeasurementValue, Equipment, EquipmentType, Location, ChecklistItem } from '../types';

/**
 * Canonical Shift Representation for Database Storage:
 * 'PS' -> Shift 1 / Pagi (Pagi-Siang)
 * 'M'  -> Shift 2 / Malam
 */
export type CanonicalShift = 'PS' | 'M';

/**
 * Storage Evidence Metadata Model
 * Binary files are stored in IDCloudHost Object Storage; Supabase PostgreSQL stores metadata and object references.
 */
export interface StorageEvidence {
  object_key?: string;
  drive_file_id?: string;
  storage_url?: string;
  drive_url?: string;
  file_name: string;
  type: string; // 'tegangan' | 'report' | 'sinyal_gen_a' | 'sinyal_gen_b' | 'bebersih' | 'evidence'
  caption?: string;
  uploaded_at?: string;
}

/**
 * Legacy compatibility type alias for StorageEvidence
 */
export type DriveEvidence = StorageEvidence;

/**
 * PDF Archive Metadata Model
 * Represents generated report PDFs stored in IDCloudHost Object Storage and Supabase database.
 */
export interface StoragePdfArchive {
  object_key?: string;
  drive_file_id?: string;
  storage_url?: string;
  drive_url?: string;
  file_name: string;
  period_key: string;
  checklist_frequency_id: number;
  operational_date: string;
  shift: CanonicalShift;
  created_at?: string;
  updated_at?: string;
}

/**
 * Legacy compatibility type alias for StoragePdfArchive
 */
export type DrivePdfArchive = StoragePdfArchive;

/**
 * Preventive Record Document Schema
 * Table/Collection: 'preventive_records'
 */
export interface PreventiveRecord {
  record_id: string;
  dataset_id: string;
  equipment_id: number;
  equipment_code: string;
  equipment_name: string;
  equipment_type: string;
  checklist_frequency_id: number;
  period_key: string; // Format e.g.: '2026-08-19' (Harian), '2026-W34' (Mingguan), '2026-08' (Bulanan)
  operational_date: string;
  shift: CanonicalShift;
  preventive_session_id?: number;
  sequence: number;
  submitted_at: string;
  submitted_by_technician_ids: string[];
  status: string; // 'OK' | 'NORMAL'
  notes: string;
  checklist_results: ChecklistResult[];
  measurements: MeasurementValue[];
  evidences: StorageEvidence[];
  created_at: string;
  updated_at: string;
  schema_version?: number;
  migrated_from?: string;
  migration_version?: number;
  migrated_at?: string;
}

/**
 * Legacy compatibility type alias for PreventiveRecord
 */
export type FirestorePreventiveRecord = PreventiveRecord;

/**
 * Helper to construct deterministic document ID for preventive records:
 * Format: `${dataset_id}_${equipment_id}_${checklist_frequency_id}_${period_key}_${shift}`
 * Example: `default_9_1_2026-08-19_PS`
 */
export function buildPreventiveDocumentId(
  datasetId: string,
  equipmentId: number,
  checklistFrequencyId: number,
  periodKey: string,
  shift: CanonicalShift
): string {
  const cleanDataset = (datasetId || 'default').trim();
  const cleanPeriod = (periodKey || '').trim();
  const cleanShift = (shift || 'PS').trim().toUpperCase();
  return `${cleanDataset}_${equipmentId}_${checklistFrequencyId}_${cleanPeriod}_${cleanShift}`;
}

/**
 * Helper to generate a collision-resistant unique event ID for corrective events.
 * Returns standard UUIDv4 string (e.g. '7f8e3b1c-9a20-41d8-8c1e-3b2a1c0d4e5f').
 */
export function generateCorrectiveEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Collision-resistant fallback
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-4${s4().substring(0, 3)}-${s4()}-${s4()}${s4()}${s4()}`;
}

/**
 * Helper to construct deterministic document ID for corrective records:
 * Format: `${normalized_dataset_id}_cr_${event_id}`
 * Example: `default_cr_7f8e3b1c9a2041d8`
 */
export function buildCorrectiveDocumentId(datasetId: string, eventId: string): string {
  const cleanDataset = (datasetId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const cleanEventId = (eventId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `${cleanDataset}_cr_${cleanEventId}`;
}

/**
 * Corrective Record Document Schema
 * Table/Collection: 'corrective_records'
 */
export interface CorrectiveRecord {
  document_id: string;
  event_id: string;
  dataset_id: string;
  record_id?: number | string; // legacy numeric or string record ID
  corrective_code: string;
  operational_date: string;
  shift: CanonicalShift;
  equipment_id: number;
  equipment_code?: string;
  equipment_name: string;
  equipment_type: string;
  location_id: number;
  location_name?: string;
  problem_description: string;
  action_taken: string;
  result: 'Resolved' | 'Pending Sparepart' | 'Temporary Fix';
  result_text?: string;
  start_time: string; // HH:mm canonical
  end_time: string; // HH:mm canonical
  technicians: string[];
  created_by: string;
  notes?: string;
  evidences: string[]; // Storage URLs or Object Keys
  submitted_by_uid?: string;
  updated_by_uid?: string;
  created_at: any; // ISO string
  updated_at: any; // ISO string
  schema_version?: number;
  migrated_from?: string;
  migrated_at?: any;
}

/**
 * Legacy compatibility type alias for CorrectiveRecord
 */
export type FirestoreCorrectiveRecord = CorrectiveRecord;

/**
 * Master Data Firestore Document Interfaces
 */
export interface FirestoreEquipment extends Equipment {
  created_at?: string;
  updated_at?: string;
}

export interface FirestoreEquipmentType extends EquipmentType {
  created_at?: string;
  updated_at?: string;
}

export interface FirestoreLocation extends Location {
  created_at?: string;
  updated_at?: string;
}

export interface FirestoreChecklistTemplate extends ChecklistItem {
  created_at?: string;
  updated_at?: string;
}

export interface FirestoreMeasurementTemplate {
  id: number;
  equipment_type_id: number;
  generator_type: 'A' | 'B';
  label: string;
  min_kv: number;
  max_kv: number;
  min_ma: number;
  max_ma: number;
  unit_kv: string;
  unit_ma: string;
  active: boolean;
}

export interface FirestoreAppSettings {
  id: string;
  organization_name: string;
  app_version: string;
  maintenance_mode: boolean;
  default_dataset_id: string;
  updated_at?: string;
}
