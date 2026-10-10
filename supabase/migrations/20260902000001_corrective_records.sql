-- ====================================================================
-- SUPABASE POSTGRESQL MIGRATION: CORRECTIVE RECORDS
-- Migration: 20260902000001_corrective_records.sql
-- ====================================================================

-- 1. CORRECTIVE RECORDS TABLE
CREATE TABLE IF NOT EXISTS public.corrective_records (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  corrective_code TEXT UNIQUE NOT NULL,
  dataset_id TEXT NOT NULL DEFAULT 'default',
  equipment_id INTEGER NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  equipment_code TEXT,
  equipment_name TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  location_id INTEGER REFERENCES public.lokasi(id) ON DELETE RESTRICT,
  location_name TEXT,
  operational_date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('PS', 'M')),
  problem_description TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'Resolved' CHECK (result IN ('Resolved', 'Pending Sparepart', 'Temporary Fix')),
  result_text TEXT DEFAULT '',
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  technician_ids INTEGER[] NOT NULL DEFAULT '{}',
  technicians TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT DEFAULT '',
  submitted_by_uid UUID,
  updated_by_uid UUID,
  notes TEXT DEFAULT '',
  evidences JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version INTEGER NOT NULL DEFAULT 1
);

-- 2. TRIGGER FOR UPDATED_AT
DROP TRIGGER IF EXISTS set_corrective_records_updated_at ON public.corrective_records;
CREATE TRIGGER set_corrective_records_updated_at
  BEFORE UPDATE ON public.corrective_records
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3. PRACTICAL PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_corr_rec_equipment_id 
  ON public.corrective_records(equipment_id);

CREATE INDEX IF NOT EXISTS idx_corr_rec_operational_date 
  ON public.corrective_records(operational_date);

CREATE INDEX IF NOT EXISTS idx_corr_rec_date_shift 
  ON public.corrective_records(operational_date, shift);

CREATE INDEX IF NOT EXISTS idx_corr_rec_eq_created_desc 
  ON public.corrective_records(equipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_corr_rec_dataset_equipment 
  ON public.corrective_records(dataset_id, equipment_id);

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.corrective_records ENABLE ROW LEVEL SECURITY;

-- Operational SELECT: active authenticated users can view corrective records
DROP POLICY IF EXISTS "Allow read corrective_records for active users" ON public.corrective_records;
CREATE POLICY "Allow read corrective_records for active users"
  ON public.corrective_records
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

-- Operational INSERT: active authenticated users can record corrective events
DROP POLICY IF EXISTS "Allow insert corrective_records for active users" ON public.corrective_records;
CREATE POLICY "Allow insert corrective_records for active users"
  ON public.corrective_records
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_user()));

-- Operational UPDATE: active authenticated users can update corrective events
DROP POLICY IF EXISTS "Allow update corrective_records for active users" ON public.corrective_records;
CREATE POLICY "Allow update corrective_records for active users"
  ON public.corrective_records
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

-- Explicitly NO DELETE policy (physical deletion is denied)

-- 5. EXPLICIT PRIVILEGES (GRANT / REVOKE)
-- Revoke all access from anonymous users
REVOKE ALL ON TABLE public.corrective_records FROM anon;

-- Explicit operational table grants for authenticated users (SELECT, INSERT, UPDATE only, NO DELETE)
GRANT SELECT, INSERT, UPDATE ON TABLE public.corrective_records TO authenticated;

-- Grant usage and select on the specific corrective sequence
GRANT USAGE, SELECT ON SEQUENCE public.corrective_records_id_seq TO authenticated;
