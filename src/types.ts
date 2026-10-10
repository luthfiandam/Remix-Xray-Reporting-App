export type Role = 'supervisor' | 'admin' | 'technician' | 'system_admin' | 'operations_admin';

export type NavigationTab =
  | 'dashboard'
  | 'preventive'
  | 'corrective'
  | 'reports'
  | 'master'
  | 'schedule'
  | 'timeline'
  | 'attendance'
  | 'storage_manager'
  | 'avsec_reports'
  | 'audit_logs'
  | 'health_diagnostic'
  | 'storage_config'
  | 'whatsapp_bot'
  | 'telegram_bot'
  | 'backup_manager'
  | 'auto_export';

export interface Technician {
  id: number;
  name: string;
  code: string;
  active: boolean;
  role?: Role;
  email?: string;
  password?: string;
}

export interface EquipmentType {
  id: number;
  name: string;
  code: string; // XRAY, WTMD, HHMD, ETD
  priority: number; // 1: XRAY, 2: WTMD, 3: HHMD, 4: ETD
  active: boolean;
}

export interface Location {
  id: number;
  name: string;
  code: string; // LOC-001, etc.
  active: boolean;
}

export interface Equipment {
  id: number;
  equipment_code?: string;
  equipment_name?: string;
  equipment_type_id: number;
  location_id: number;
  name: string;
  brand: string;
  type?: string;
  model: string | null;
  serial_number?: string;
  public_id?: string; // Static random public alphanumeric ID (e.g. N7PK2A9XQ) for AVSEC QR Sticker
  default_view?: 'single' | 'dual'; // For XRAY (backward compatible)
  default_view_type?: 'single' | 'dual'; // Canonical Supabase master design config
  default_measurements?: MeasurementValue[]; // Default X-Ray measurement configuration (Single View: Gen B only, Dual View: Gen A + Gen B)
  active: boolean;
}

export type ExternalReportStatus = 'NEW' | 'ACKNOWLEDGED' | 'CONVERTED_TO_CORRECTIVE' | 'CLOSED';

export interface ExternalErrorReport {
  id: string | number;
  report_number: string;
  equipment_id: number;
  public_equipment_id?: string;
  equipment_name?: string;
  equipment_code?: string;
  location_name?: string;
  reporter_name: string;
  reporter_unit: string;
  issue_type: string;
  description: string;
  photo_url?: string;
  photo_object_key?: string;
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy?: number | null;
  session_id?: string;
  status: ExternalReportStatus;
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_notes?: string | null;
  corrective_record_id?: string | number | null;
}

export interface ChecklistFrequency {
  id: number;
  name: string;
  code: string; // HARIAN, MINGGUAN, BULANAN, TRIWULAN, SEMESTERAN, TAHUNAN
  sort_order: number;
}

export interface ChecklistItem {
  id: number;
  equipment_type_id: number;
  checklist_frequency_id: number;
  description: string;
  sequence: number;
  active: boolean;
}

export type ShiftType = 'Pagi' | 'Malam';

export interface PreventiveSession {
  id: number;
  dataset_id?: string;
  operational_date: string; // YYYY-MM-DD
  shift: ShiftType;
  started_at: string; // HH:mm
  ended_at: string; // HH:mm
  status: 'active' | 'completed';
  technician_ids: number[];
  technician_names: string[];
}

export interface MeasurementValue {
  generator: 'A' | 'B';
  positive_high_voltage?: number; // kV
  negative_high_voltage?: number; // kV
  heater_current?: number; // mA
  anode_current?: number; // uA
}

export interface ChecklistResult {
  checklist_item_id: number;
  description: string;
  status: 'Baik' | 'Temuan' | 'OK' | 'NG' | 'N/A';
  note?: string;
}

export interface PreventiveEvidence {
  id: number;
  file_path: string;
  caption: string;
  drive_url?: string;
  file_id?: string;
  url?: string;
  dataUrl?: string;
  is_collage?: boolean;
}

export type ReportEvidenceItem =
  | string
  | PreventiveEvidence
  | {
      file_path?: string;
      drive_url?: string;
      url?: string;
      dataUrl?: string;
      caption?: string;
      is_collage?: boolean;
    };

export type EvidenceUploadStatus = 'pending' | 'uploading' | 'completed' | 'partial' | 'failed';

export interface PreventiveEntry {
  id: number;
  dataset_id?: string;
  preventive_session_id: number;
  equipment_id: number;
  equipment_code?: string;
  equipment_name?: string;
  checklist_frequency_id: number;
  view_type?: 'single' | 'dual';
  sequence: number; // Urutan submit dalam shift
  submitted_at: string; // HH:mm
  submitted_by_technician_ids: number[];
  notes: string;
  status: 'OK' | 'NG' | 'NEEDS_REPAIR';
  checklist_results: ChecklistResult[];
  measurements: MeasurementValue[];
  evidences: PreventiveEvidence[];
  expected_evidence_count?: number;
  uploaded_evidence_count?: number;
  upload_status?: EvidenceUploadStatus;
  last_upload_error?: string;
  folder_path?: string;
  folder_url?: string;
  drive_folder_url?: string;
  operational_date?: string;
  shift?: ShiftType;
  period_key?: string;
  created_at?: string;
  updated_at?: string;
  expected_updated_at?: string;
  synced?: boolean;
}

export interface CorrectiveReport {
  id: number;
  event_id?: string;
  document_id?: string;
  dataset_id?: string;
  corrective_code: string; // CR-20260807-001
  corrective_date: string; // YYYY-MM-DD
  shift?: ShiftType;
  equipment_id: number;
  location_id: number;
  problem_description: string;
  action_taken: string;
  result: 'Resolved' | 'Pending Sparepart' | 'Temporary Fix';
  result_text?: string;
  technicians?: string[];
  start_time?: string;
  end_time?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at?: string;
  expected_updated_at?: string;
  evidences: string[];
  collage_object_key?: string;
  collage_url?: string;
  expected_evidence_count?: number;
  uploaded_evidence_count?: number;
  upload_status?: EvidenceUploadStatus;
  last_upload_error?: string;
  synced?: boolean;
}

export interface CloudDataset {
  id: string;
  name: string;
  preventive_count: number;
  corrective_count: number;
  last_updated?: string;
}

export interface StructuredCorrectiveEntry {
  id: number;
  corrective_code: string;
  equipment_name: string;
  type_code: string;
  type_name?: string;
  brand?: string;
  model?: string | null;
  location_name: string;
  problem_description: string;
  action_taken: string;
  result: 'Resolved' | 'Pending Sparepart' | 'Temporary Fix';
  result_text?: string;
  start_time: string;
  end_time: string;
  time_range: string;
  notes: string;
  technicians: string[];
  evidences: string[];
  collage_object_key?: string;
  collage_url?: string;
}

export interface StructuredReportData {
  operational_date: string; // ISO YYYY-MM-DD
  display_date?: string;    // Formatted Indonesian date e.g. "Minggu, 27 September 2026"
  shift: ShiftType;
  start_time: string; // 08.45
  end_time: string; // 09.30
  technicians: string[];
  lines_by_type: {
    type_code: string;
    type_name: string;
    equipment_names: string[];
  }[];
  entries_by_type: {
    type_code: string;
    type_name: string;
    priority: number;
    entries: {
      id?: number | string;
      equipment_id?: number;
      equipment_name: string;
      location_name: string;
      view_type?: 'single' | 'dual';
      measurements: MeasurementValue[];
      notes: string;
      submitted_at: string;
      created_at?: string;
      updated_at?: string;
      sequence: number;
      evidences?: PreventiveEvidence[];
      checklist_frequency_id?: number;
    }[];
  }[];
  corrective_entries?: StructuredCorrectiveEntry[];
}

export interface ComponentReplacement {
  id: string;
  equipment_id: number;
  equipment_name?: string;
  component_name: string; // e.g. "Detector Board", "Generator B", "Conveyor Belt"
  replaced_at: string; // YYYY-MM-DD
  technician_names: string[];
  reason: string; // e.g. "No Signal / Putus"
  corrective_code?: string; // e.g. "CR-2026-0814"
  serial_number?: string;
  origin?: string; // "Baru" | "Kolekan Cadangan" | "Rekondisi"
  notes?: string;
  evidence_url?: string;
  created_at?: string;
}

export interface RecurringFault {
  equipment_id: number;
  equipment_name?: string;
  equipment_code?: string;
  fault_keyword: string; // e.g. "Error 0032", "Shutter error"
  occurrences_count: number;
  window_days: number;
  first_date: string;
  last_date: string;
  related_reports: CorrectiveReport[];
  recommendation: string;
}

export interface MeasurementTrendPoint {
  id: number;
  operational_date: string; // YYYY-MM-DD
  submitted_at?: string;
  shift?: ShiftType;
  display_label: string; // e.g. "14 Aug (PS)"
  genA_pos_hv?: number;
  genA_neg_hv?: number;
  genA_heater?: number;
  genA_anode?: number;
  genB_pos_hv?: number;
  genB_neg_hv?: number;
  genB_heater?: number;
  genB_anode?: number;
}

export interface MeasurementAnomalyAlert {
  id: string;
  equipment_id: number;
  equipment_name: string;
  parameter: string; // e.g. "Positive HV"
  generator: 'A' | 'B';
  currentValue: number;
  baselineAvg: number;
  percentDelta: number;
  unit: string;
  severity: 'warning' | 'critical';
  message: string;
}

export interface AttendanceLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  area_name?: string;
  distance_meters?: number;
  is_within_radius?: boolean;
}

export type AttendanceVerificationStatus =
  | 'verified'
  | 'unverified'
  | 'verification_failed'
  | 'supervisor_override';

export interface AttendanceRecord {
  id: string;
  technician_id?: number;
  technician_name: string;
  attendance_type?: 'masuk' | 'pulang' | 'bypass' | 'grace_period' | 'off_duty';
  shift: 'Pagi' | 'Malam' | 'Office' | 'PS' | 'M' | 'OFFICE';
  attendance_date: string; // YYYY-MM-DD
  attendance_time: string; // e.g. "06.48 WIB"
  status: 'Tepat Waktu' | 'Telat' | 'Terlambat' | 'Sangat Terlambat';
  verification_status?: AttendanceVerificationStatus;
  liveness_confidence?: number;
  notes?: string;
  is_bypassed?: boolean;
  is_off_duty?: boolean;
  photo_url?: string;
  photo_object_key?: string;
  location?: AttendanceLocation;
  expected_evidence_count?: number;
  uploaded_evidence_count?: number;
  upload_status?: EvidenceUploadStatus;
  last_upload_error?: string;
  created_at: string;
}

export interface AttendanceSessionState {
  hasAttended: boolean;
  isBypassed: boolean;
  isOffDuty: boolean;
  record?: AttendanceRecord;
}

export interface ReportFileItem {
  id: number;
  report_type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semester' | 'yearly' | 'adhoc' | 'corrective' | 'attendance';
  operational_date: string;
  shift?: string;
  frequency_id?: number;
  object_key: string;
  file_name: string;
  file_size?: number;
  content_type?: string;
  checksum?: string;
  bucket?: string;
  generated_by?: string;
  generated_at: string;
  version?: number;
  metadata?: Record<string, any>;
  signed_url?: string;
}

export type ReportFileMetadata = ReportFileItem;



