-- ==============================================================================
-- PHASE 2: DATA RELIABILITY — ATTENDANCE, REPORT ARCHIVE & UPLOAD STATUS
-- File: supabase/migrations/20260925000001_data_reliability_archive_attendance.sql
-- ==============================================================================

-- 1. ATTENDANCE TABLE (Persistent Supabase storage for technician attendance)
CREATE TABLE IF NOT EXISTS public.attendance (
  id BIGSERIAL PRIMARY KEY,
  attendance_id TEXT UNIQUE,
  technician_id INTEGER REFERENCES public.technicians(id) ON DELETE SET NULL,
  technician_name TEXT NOT NULL,
  operational_date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('Pagi', 'Malam', 'PS', 'M')),
  attendance_type TEXT NOT NULL DEFAULT 'masuk' CHECK (attendance_type IN ('masuk', 'pulang', 'bypass', 'grace_period', 'off_duty')),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attendance_time TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  distance_meters INTEGER,
  is_within_radius BOOLEAN DEFAULT true,
  photo_object_key TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'Tepat Waktu',
  verification_status TEXT DEFAULT 'verified' CHECK (verification_status IN ('verified', 'unverified', 'verification_failed', 'supervisor_override')),
  liveness_confidence NUMERIC(4, 3),
  is_bypassed BOOLEAN DEFAULT false,
  is_off_duty BOOLEAN DEFAULT false,
  notes TEXT DEFAULT '',
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index to ensure "masuk" and "pulang" never overwrite each other
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_tech_date_type
  ON public.attendance(operational_date, LOWER(technician_name), attendance_type);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(operational_date);
CREATE INDEX IF NOT EXISTS idx_attendance_tech_id ON public.attendance(technician_id);
CREATE INDEX IF NOT EXISTS idx_attendance_type ON public.attendance(attendance_type);
CREATE INDEX IF NOT EXISTS idx_attendance_timestamp ON public.attendance(timestamp DESC);

DROP TRIGGER IF EXISTS set_attendance_updated_at ON public.attendance;
CREATE TRIGGER set_attendance_updated_at
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 2. REPORT FILES CATALOG TABLE (Actual IDCloudHost archived reports)
CREATE TABLE IF NOT EXISTS public.report_files (
  id BIGSERIAL PRIMARY KEY,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'semester', 'yearly', 'adhoc', 'corrective', 'attendance')),
  operational_date DATE NOT NULL,
  shift TEXT,
  frequency_id INTEGER REFERENCES public.checklist_frequencies(id) ON DELETE SET NULL,
  object_key TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  content_type TEXT DEFAULT 'application/pdf',
  checksum TEXT,
  bucket TEXT,
  generated_by TEXT DEFAULT 'System',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_files_date ON public.report_files(operational_date);
CREATE INDEX IF NOT EXISTS idx_report_files_type ON public.report_files(report_type);
CREATE INDEX IF NOT EXISTS idx_report_files_freq ON public.report_files(frequency_id);
CREATE INDEX IF NOT EXISTS idx_report_files_date_shift ON public.report_files(operational_date, shift);

DROP TRIGGER IF EXISTS set_report_files_updated_at ON public.report_files;
CREATE TRIGGER set_report_files_updated_at
  BEFORE UPDATE ON public.report_files
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3. EVIDENCE UPLOAD RELIABILITY COLUMNS ON PREVENTIVE & CORRECTIVE
ALTER TABLE public.preventive_records
  ADD COLUMN IF NOT EXISTS expected_evidence_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uploaded_evidence_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_status TEXT DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS last_upload_error TEXT;

ALTER TABLE public.corrective_records
  ADD COLUMN IF NOT EXISTS expected_evidence_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uploaded_evidence_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_status TEXT DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS last_upload_error TEXT;

-- 4. RLS & PRIVILEGES HARDENING FOR NEW TABLES
REVOKE ALL ON TABLE public.attendance FROM anon;
REVOKE ALL ON TABLE public.report_files FROM anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.attendance TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.report_files TO authenticated, service_role;
GRANT SELECT ON TABLE public.report_files TO anon;

GRANT USAGE, SELECT ON SEQUENCE public.attendance_id_seq TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.report_files_id_seq TO anon, authenticated, service_role;

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_files ENABLE ROW LEVEL SECURITY;

-- Attendance RLS: Allow active reading, submission, and update
DROP POLICY IF EXISTS "Allow read attendance" ON public.attendance;
DROP POLICY IF EXISTS "Allow save attendance" ON public.attendance;
DROP POLICY IF EXISTS "Allow update attendance" ON public.attendance;
DROP POLICY IF EXISTS "Allow supervisor delete attendance" ON public.attendance;

CREATE POLICY "Allow read attendance"
  ON public.attendance
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow save attendance"
  ON public.attendance
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update attendance"
  ON public.attendance
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow supervisor delete attendance"
  ON public.attendance
  FOR DELETE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()));

-- Report Files RLS: Anyone can view report metadata, only authenticated users can save/update
DROP POLICY IF EXISTS "Allow read report_files" ON public.report_files;
DROP POLICY IF EXISTS "Allow save report_files" ON public.report_files;
DROP POLICY IF EXISTS "Allow update report_files" ON public.report_files;
DROP POLICY IF EXISTS "Allow supervisor delete report_files" ON public.report_files;

CREATE POLICY "Allow read report_files"
  ON public.report_files
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow save report_files"
  ON public.report_files
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update report_files"
  ON public.report_files
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow supervisor delete report_files"
  ON public.report_files
  FOR DELETE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()));
