-- ==============================================================================
-- MIGRATION: AVSEC QR ERROR REPORTING & PUBLIC ID EXTENSION
-- File: supabase/migrations/20260927000004_avsec_qr_error_reporting.sql
-- ==============================================================================

-- 1. Add public_id column to equipment table if not exists
ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(50);

-- Ensure explicit partial unique index on equipment.public_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_public_id_unique
  ON public.equipment(public_id)
  WHERE public_id IS NOT NULL;

-- 2. Pre-UPDATE Validation: Ensure all 27 mappings exist in public.equipment
DO $$
DECLARE
  pre_match_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pre_match_count
  FROM public.equipment AS eq
  INNER JOIN (VALUES
    ('EQ-XRAY-01', 1), ('EQ-XRAY-02', 2), ('EQ-XRAY-03', 3), ('EQ-XRAY-04', 4), ('EQ-XRAY-05', 5),
    ('EQ-XRAY-06', 6), ('EQ-XRAY-07', 7), ('EQ-XRAY-08', 8), ('EQ-XRAY-09', 9), ('EQ-XRAY-10', 10),
    ('EQ-ETD-01', 11),
    ('EQ-WTMD-01', 12), ('EQ-WTMD-02', 13), ('EQ-WTMD-03', 14), ('EQ-WTMD-04', 15), ('EQ-WTMD-05', 16),
    ('EQ-WTMD-06', 17), ('EQ-WTMD-07', 18),
    ('EQ-HHMD-01', 19), ('EQ-HHMD-02', 20), ('EQ-HHMD-03', 21), ('EQ-HHMD-04', 22), ('EQ-HHMD-05', 23),
    ('EQ-HHMD-06', 24), ('EQ-HHMD-07', 25), ('EQ-HHMD-08', 26), ('EQ-HHMD-09', 27)
  ) AS v(code, eq_id)
  ON eq.equipment_code = v.code AND eq.id = v.eq_id;

  IF pre_match_count <> 27 THEN
    RAISE EXCEPTION 'Pre-migration check failed: Expected exactly 27 matching equipment records (id + equipment_code), but found %.', pre_match_count;
  END IF;
END $$;

-- 3. Strict UPDATE with AND condition
UPDATE public.equipment AS eq
SET public_id = v.public_id
FROM (VALUES
  ('EQ-XRAY-01', 1, 'N7PK2A9XQ'),
  ('EQ-XRAY-02', 2, 'B8K2L4MP9'),
  ('EQ-XRAY-03', 3, 'X4R9T1ZQ2'),
  ('EQ-XRAY-04', 4, 'W7M3P5LD8'),
  ('EQ-XRAY-05', 5, 'H9B2C8LK4'),
  ('EQ-XRAY-06', 6, 'E5T1Q7NR6'),
  ('EQ-XRAY-07', 7, 'K3L8M2PX5'),
  ('EQ-XRAY-08', 8, 'J6N9P4RT1'),
  ('EQ-XRAY-09', 9, 'M2X8T5KQ7'),
  ('EQ-XRAY-10', 10, 'P4Q7L9ZM3'),
  ('EQ-ETD-01',  11, 'R9T2W4NL8'),
  ('EQ-WTMD-01', 12, 'T5K8P2XM4'),
  ('EQ-WTMD-02', 13, 'C7M4L9RQ2'),
  ('EQ-WTMD-03', 14, 'L2N8T6KP5'),
  ('EQ-WTMD-04', 15, 'D9P3K7MR1'),
  ('EQ-WTMD-05', 16, 'V4T8M2LP6'),
  ('EQ-WTMD-06', 17, 'S6K2P9TR4'),
  ('EQ-WTMD-07', 18, 'A3M7L5NQ8'),
  ('EQ-HHMD-01', 19, 'Z8K4P1TM5'),
  ('EQ-HHMD-02', 20, 'G2L9N4RQ7'),
  ('EQ-HHMD-03', 21, 'F7M3K8PT2'),
  ('EQ-HHMD-04', 22, 'Q4P8L2NM6'),
  ('EQ-HHMD-05', 23, 'Y9K5T3MR1'),
  ('EQ-HHMD-06', 24, 'U2M7P4LQ8'),
  ('EQ-HHMD-07', 25, 'W5L2K9RT4'),
  ('EQ-HHMD-08', 26, 'H8P4M1NQ6'),
  ('EQ-HHMD-09', 27, 'B3T7L9KM2')
) AS v(code, eq_id, public_id)
WHERE eq.equipment_code = v.code
  AND eq.id = v.eq_id;

-- 4. Post-UPDATE Validation: Ensure exactly 27 equipment records match seeded public_id
DO $$
DECLARE
  post_match_count INTEGER;
  dup_count INTEGER;
BEGIN
  -- Check for duplicates
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT public_id, COUNT(*)
    FROM public.equipment
    WHERE public_id IS NOT NULL AND public_id <> ''
    GROUP BY public_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Post-migration check failed: Duplicate public_id detected in equipment table!';
  END IF;

  -- Check exact count of updated equipment
  SELECT COUNT(*) INTO post_match_count
  FROM public.equipment AS eq
  INNER JOIN (VALUES
    ('EQ-XRAY-01', 1, 'N7PK2A9XQ'), ('EQ-XRAY-02', 2, 'B8K2L4MP9'), ('EQ-XRAY-03', 3, 'X4R9T1ZQ2'), ('EQ-XRAY-04', 4, 'W7M3P5LD8'), ('EQ-XRAY-05', 5, 'H9B2C8LK4'),
    ('EQ-XRAY-06', 6, 'E5T1Q7NR6'), ('EQ-XRAY-07', 7, 'K3L8M2PX5'), ('EQ-XRAY-08', 8, 'J6N9P4RT1'), ('EQ-XRAY-09', 9, 'M2X8T5KQ7'), ('EQ-XRAY-10', 10, 'P4Q7L9ZM3'),
    ('EQ-ETD-01', 11, 'R9T2W4NL8'),
    ('EQ-WTMD-01', 12, 'T5K8P2XM4'), ('EQ-WTMD-02', 13, 'C7M4L9RQ2'), ('EQ-WTMD-03', 14, 'L2N8T6KP5'), ('EQ-WTMD-04', 15, 'D9P3K7MR1'), ('EQ-WTMD-05', 16, 'V4T8M2LP6'),
    ('EQ-WTMD-06', 17, 'S6K2P9TR4'), ('EQ-WTMD-07', 18, 'A3M7L5NQ8'),
    ('EQ-HHMD-01', 19, 'Z8K4P1TM5'), ('EQ-HHMD-02', 20, 'G2L9N4RQ7'), ('EQ-HHMD-03', 21, 'F7M3K8PT2'), ('EQ-HHMD-04', 22, 'Q4P8L2NM6'), ('EQ-HHMD-05', 23, 'Y9K5T3MR1'),
    ('EQ-HHMD-06', 24, 'U2M7P4LQ8'), ('EQ-HHMD-07', 25, 'W5L2K9RT4'), ('EQ-HHMD-08', 26, 'H8P4M1NQ6'), ('EQ-HHMD-09', 27, 'B3T7L9KM2')
  ) AS v(code, eq_id, public_id)
  ON eq.equipment_code = v.code
 AND eq.id = v.eq_id
 AND eq.public_id = v.public_id;

  IF post_match_count <> 27 THEN
    RAISE EXCEPTION 'Post-migration check failed: Expected exactly 27 equipment records to match seeded public_id, but found %.', post_match_count;
  END IF;
END $$;

-- 5. Create external_error_reports table for AVSEC incident reports
CREATE TABLE IF NOT EXISTS public.external_error_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number VARCHAR(100) UNIQUE NOT NULL,
  equipment_id INTEGER REFERENCES public.equipment(id) ON DELETE RESTRICT,
  public_equipment_id VARCHAR(50),
  reporter_name VARCHAR(255) NOT NULL,
  reporter_unit VARCHAR(100) NOT NULL DEFAULT 'AVSEC',
  issue_type VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  photo_object_key TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_accuracy DOUBLE PRECISION,
  session_id VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'CONVERTED_TO_CORRECTIVE', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(255),
  review_notes TEXT,
  corrective_record_id VARCHAR(100)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_external_reports_eq_id ON public.external_error_reports(equipment_id);
CREATE INDEX IF NOT EXISTS idx_external_reports_status ON public.external_error_reports(status);
CREATE INDEX IF NOT EXISTS idx_external_reports_created ON public.external_error_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_external_reports_pub_eq_id ON public.external_error_reports(public_equipment_id);

-- Anti double-submit partial unique index on external_error_reports.session_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_reports_session_unique
  ON public.external_error_reports(session_id)
  WHERE session_id IS NOT NULL;

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.external_error_reports ENABLE ROW LEVEL SECURITY;

-- 7. STRICT SECURITY LOCKDOWN: Revoke ALL direct access from PUBLIC and anon!
-- Public browser MUST write via Express Backend API (/api/public/submit-error-report) + Express temporary report session.
REVOKE ALL ON TABLE public.external_error_reports FROM PUBLIC, anon;

-- Grant INSERT, SELECT, UPDATE to service_role and authenticated internal users ONLY
GRANT SELECT, INSERT, UPDATE ON TABLE public.external_error_reports TO service_role;
GRANT SELECT, UPDATE ON TABLE public.external_error_reports TO authenticated;

-- 8. RLS Policies
-- Allow service_role to INSERT (Express Backend Service Role)
DROP POLICY IF EXISTS "Allow backend insert external_error_reports" ON public.external_error_reports;
CREATE POLICY "Allow backend insert external_error_reports"
  ON public.external_error_reports
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow ONLY authenticated users (active technicians & supervisors) or service_role to SELECT
DROP POLICY IF EXISTS "Allow authenticated view external_error_reports" ON public.external_error_reports;
CREATE POLICY "Allow authenticated view external_error_reports"
  ON public.external_error_reports
  FOR SELECT
  TO authenticated, service_role
  USING (
    private.is_active_user() OR auth.role() = 'service_role'
  );

-- Allow ONLY authenticated users (active technicians & supervisors) or service_role to UPDATE
DROP POLICY IF EXISTS "Allow authenticated update external_error_reports" ON public.external_error_reports;
CREATE POLICY "Allow authenticated update external_error_reports"
  ON public.external_error_reports
  FOR UPDATE
  TO authenticated, service_role
  USING (
    private.is_active_user() OR auth.role() = 'service_role'
  );
