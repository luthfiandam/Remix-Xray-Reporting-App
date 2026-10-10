-- ====================================================================
-- SUPABASE POSTGRESQL MIGRATION: EQUIPMENT MASTER & PREVENTIVE RECORDS
-- Migration: 20260902000000_equipment_preventive.sql
-- ====================================================================

-- 1. NON-EXPOSED PRIVATE SCHEMA & SECURITY DEFINER HELPERS
CREATE SCHEMA IF NOT EXISTS private;

-- Explicit schema permissions
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Helper security functions in private schema with locked search_path
CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.is_active_supervisor()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'supervisor'
      AND active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

-- Drop obsolete public helper functions if they exist
DROP FUNCTION IF EXISTS public.is_active_user();
DROP FUNCTION IF EXISTS public.is_active_supervisor();

-- 2. REUSABLE SET_UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backward compatibility alias
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. MASTER TABLES: LOKASI & JENIS MESIN
CREATE TABLE IF NOT EXISTS public.lokasi (
  id SERIAL PRIMARY KEY,
  kode_lokasi VARCHAR(50) UNIQUE NOT NULL,
  nama_lokasi VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_lokasi_updated_at ON public.lokasi;
CREATE TRIGGER set_lokasi_updated_at
  BEFORE UPDATE ON public.lokasi
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.jenis_mesin (
  id SERIAL PRIMARY KEY,
  kode_jenis VARCHAR(50) UNIQUE NOT NULL,
  nama_jenis VARCHAR(255) NOT NULL,
  priority INTEGER DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_jenis_mesin_updated_at ON public.jenis_mesin;
CREATE TRIGGER set_jenis_mesin_updated_at
  BEFORE UPDATE ON public.jenis_mesin
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4. CHECKLIST FREQUENCIES MASTER TABLE (IDs 1-6)
CREATE TABLE IF NOT EXISTS public.checklist_frequencies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  sort_order INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_checklist_frequencies_updated_at ON public.checklist_frequencies;
CREATE TRIGGER set_checklist_frequencies_updated_at
  BEFORE UPDATE ON public.checklist_frequencies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed canonical IDs 1–6 safely with ON CONFLICT DO UPDATE
INSERT INTO public.checklist_frequencies (id, name, code, sort_order, active)
VALUES
  (1, 'Harian', 'HARIAN', 1, true),
  (2, 'Mingguan', 'MINGGUAN', 2, true),
  (3, 'Bulanan', 'BULANAN', 3, true),
  (4, 'Triwulan', 'TRIWULAN', 4, true),
  (5, 'Semesteran', 'SEMESTERAN', 5, true),
  (6, 'Tahunan', 'TAHUNAN', 6, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active,
  updated_at = NOW();

-- 5. CHECKLIST ITEMS MASTER TABLE (Master configuration only)
CREATE TABLE IF NOT EXISTS public.checklist_items (
  id INTEGER PRIMARY KEY,
  equipment_type_id INTEGER NOT NULL REFERENCES public.jenis_mesin(id) ON DELETE RESTRICT,
  checklist_frequency_id INTEGER NOT NULL REFERENCES public.checklist_frequencies(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_checklist_items_updated_at ON public.checklist_items;
CREATE TRIGGER set_checklist_items_updated_at
  BEFORE UPDATE ON public.checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_checklist_items_eq_freq 
  ON public.checklist_items(equipment_type_id, checklist_frequency_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_active 
  ON public.checklist_items(active);

-- Seed canonical checklist items (IDs 1–78) safely with ON CONFLICT DO UPDATE
INSERT INTO public.checklist_items (id, equipment_type_id, checklist_frequency_id, description, sequence, active)
VALUES
  -- X-RAY (Type ID: 1) - Harian (Freq ID: 1)
  (1, 1, 1, 'Pemeriksaan lead curtain', 1, true),
  (2, 1, 1, 'Pemeriksaan lead shielding', 2, true),
  (3, 1, 1, 'Pemeriksaan conveyor belt', 3, true),
  (4, 1, 1, 'Pemeriksaan conveyor roller', 4, true),
  (5, 1, 1, 'Pemeriksaan housing panel', 5, true),
  (6, 1, 1, 'Pemeriksaan kabel-kabel dan konektor yang terlihat', 6, true),
  (7, 1, 1, 'Leakage radiation test', 7, true),
  (8, 1, 1, 'Pembersihan unit bagian luar', 8, true),
  (9, 1, 1, 'Pembersihan monitor', 9, true),
  (10, 1, 1, 'Pembersihan UPS', 10, true),
  (11, 1, 1, 'Pembersihan lokasi sekitar penempatan peralatan x-ray', 11, true),
  (12, 1, 1, 'Pemeriksaan control elements key switch', 12, true),
  (13, 1, 1, 'Pemeriksaan control elements power on/off key', 13, true),
  (14, 1, 1, 'Pemeriksaan control elements emergency stop keys', 14, true),
  (15, 1, 1, 'Pemeriksaan control elements tuts key / keyboard', 15, true),
  (16, 1, 1, 'Pemeriksaan control elements mouse pad / mouse roller', 16, true),
  (17, 1, 1, 'Pemeriksaan control elements forward / reverse', 17, true),
  (18, 1, 1, 'Pemeriksaan supply voltage, main input voltage', 18, true),
  (19, 1, 1, 'Pemeriksaan supply voltage, Output voltage UPS', 19, true),
  (20, 1, 1, 'Pemeriksaan indicator lamp, Power-on lamp', 20, true),
  (21, 1, 1, 'Pemeriksaan indicator lamp, X-ray generator on lamp', 21, true),
  (22, 1, 1, 'Pemeriksaan safety rollers (spring roller) pada sisi input dan output', 22, true),
  (23, 1, 1, 'Pemeriksaan monitor, Tombol pengendali monitor', 23, true),
  (24, 1, 1, 'Pemeriksaan monitor; Brightness, Sharpness, Contrast', 24, true),
  -- X-RAY (Type ID: 1) - Mingguan (Freq ID: 2)
  (25, 1, 2, 'Pembersihan dan pemeriksaan light barriers', 1, true),
  (26, 1, 2, 'Pemeriksaan PE (protective earth) Wiring', 2, true),
  (27, 1, 2, 'Pemeriksaan emergency stop switches', 3, true),
  -- X-RAY (Type ID: 1) - Bulanan (Freq ID: 3)
  (28, 1, 3, 'Pemeriksaan seluruh functional test - Organic & inorganic stripping', 1, true),
  (29, 1, 3, 'Pemeriksaan seluruh functional test - Zoom-in / zoom-out', 2, true),
  (30, 1, 3, 'Pemeriksaan seluruh functional test - Automatic threat detection system', 3, true),
  (31, 1, 3, 'Pemeriksaan seluruh functional test - Image density / high resolution', 4, true),
  (32, 1, 3, 'Pemeriksaan seluruh functional test - Black and white image', 5, true),
  (33, 1, 3, 'Pemeriksaan seluruh functional test - Threat image protection', 6, true),
  (34, 1, 3, 'Pemeriksaan seluruh functional test - Image archives / image recall', 7, true),
  (35, 1, 3, 'Pemeriksaan kapasitas harddisk', 8, true),
  (36, 1, 3, 'Pemeriksaan UPS - Automatic change over facility', 9, true),
  -- X-RAY (Type ID: 1) - Triwulan (Freq ID: 4)
  (37, 1, 4, 'Pembersihan unit bagian dalam', 1, true),
  (38, 1, 4, 'Pemeriksaan interlock system', 2, true),
  (39, 1, 4, 'Pemeriksaan unit configuration, meliputi antara lain pengaturan tanggal, bulan, tahun, image orientation', 3, true),
  -- X-RAY (Type ID: 1) - Semesteran (Freq ID: 5)
  (40, 1, 5, 'Pemeriksaan x-ray beam alignment', 1, true),
  (41, 1, 5, 'Pemeriksaan power supply fan', 2, true),
  -- X-RAY (Type ID: 1) - Tahunan (Freq ID: 6)
  (42, 1, 6, 'Pemeriksaan drum motor', 1, true),
  (43, 1, 6, 'Pemeriksaan generator control', 2, true),
  (44, 1, 6, 'Pemeriksan x-ray generator', 3, true),
  -- WTMD (Type ID: 2) - Harian (Freq ID: 1)
  (45, 2, 1, 'Pembersihan - Main unit', 1, true),
  (46, 2, 1, 'Pembersihan - UPS', 2, true),
  (47, 2, 1, 'Pembersihan - Lokasi sekitar penempatan peralatan', 3, true),
  (48, 2, 1, 'Pemeriksaan supply voltage - Main supply voltage', 4, true),
  (49, 2, 1, 'Pemeriksaan supply voltage - Output voltage UPS', 5, true),
  (50, 2, 1, 'Pemeriksaan kabel-kabel dan konektor yang terlihat', 6, true),
  -- WTMD (Type ID: 2) - Mingguan (Freq ID: 2)
  (51, 2, 2, 'Pemeriksaan alert system - Audible', 1, true),
  (52, 2, 2, 'Pemeriksaan alert system - Visible', 2, true),
  -- WTMD (Type ID: 2) - Bulanan (Freq ID: 3)
  (53, 2, 3, 'Pemeriksaan interferensi - Mekanikal', 1, true),
  (54, 2, 3, 'Pemeriksaan interferensi - Elektrikal', 2, true),
  (55, 2, 3, 'Pemeriksaan tingkat sensitivitas', 3, true),
  (56, 2, 3, 'Pengujian kinerja secara berkala dengan menggunakan OTP', 4, true),
  (57, 2, 3, 'Pemeriksaan UPS - Automatic change over facility', 5, true),
  (58, 2, 3, 'Pemeriksaan UPS - Expected back up time', 6, true),
  (59, 2, 3, 'Pemeriksaan UPS - Fan', 7, true),
  -- WTMD (Type ID: 2) - Triwulan (Freq ID: 4)
  (60, 2, 4, 'Pemeriksaan control unit', 1, true),
  -- WTMD (Type ID: 2) - Semesteran (Freq ID: 5)
  (61, 2, 5, 'Pemeriksaan display indicator - Ready light', 1, true),
  (62, 2, 5, 'Pemeriksaan display indicator - Alarm light', 2, true),
  (63, 2, 5, 'Pemeriksaan display indicator - LCD panel', 3, true),
  (64, 2, 5, 'Pemeriksaan display indicator - LED bar graph', 4, true),
  -- WTMD (Type ID: 2) - Tahunan (Freq ID: 6)
  (65, 2, 6, 'Pemeriksaan system programming', 1, true),
  (66, 2, 6, 'Line up seluruh sistem', 2, true),
  -- HHMD (Type ID: 3) - Harian (Freq ID: 1)
  (67, 3, 1, 'Pembersihan main unit', 1, true),
  (68, 3, 1, 'Pemeriksaan battery voltage', 2, true),
  -- HHMD (Type ID: 3) - Mingguan (Freq ID: 2)
  (69, 3, 2, 'Pemeriksaan fungsi switch / tombol on/off', 1, true),
  (70, 3, 2, 'Pemeriksaan alert system : Audible', 2, true),
  (71, 3, 2, 'Pemeriksaan alert system : Visible', 3, true),
  -- HHMD (Type ID: 3) - Bulanan (Freq ID: 3)
  (72, 3, 1, 'Pemeriksaan sensitivitas', 1, true),
  (73, 3, 3, 'Pengujian kinerja secara berkala dengan menggunakan OTP', 2, true),
  (74, 3, 3, 'Pemeriksaan peralatan dari kerusakan fisik', 3, true),
  -- HHMD (Type ID: 3) - Tahunan (Freq ID: 6)
  (75, 3, 6, 'Line up seluruh sistem', 1, true),
  -- ETD (Type ID: 4)
  (76, 4, 1, 'Pembersihan main unit & casing', 1, true),
  (77, 4, 4, 'Pemeriksaan persediaan consumable sample trap', 2, true),
  (78, 4, 1, 'Self-check verification & internal calibration', 3, true)
ON CONFLICT (id) DO UPDATE SET
  equipment_type_id = EXCLUDED.equipment_type_id,
  checklist_frequency_id = EXCLUDED.checklist_frequency_id,
  description = EXCLUDED.description,
  sequence = EXCLUDED.sequence,
  active = EXCLUDED.active,
  updated_at = NOW();

-- 6. EQUIPMENT MASTER TABLE
CREATE TABLE IF NOT EXISTS public.equipment (
  id SERIAL PRIMARY KEY,
  equipment_code VARCHAR(50) UNIQUE NOT NULL,
  equipment_name VARCHAR(255) NOT NULL,
  brand VARCHAR(255) NOT NULL,
  type VARCHAR(255),
  model VARCHAR(255),
  serial_number VARCHAR(255) NOT NULL,
  equipment_type_id INTEGER REFERENCES public.jenis_mesin(id) ON DELETE RESTRICT,
  location_id INTEGER REFERENCES public.lokasi(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  default_view_type VARCHAR(20) CHECK (default_view_type IS NULL OR default_view_type IN ('single', 'dual')),
  default_measurements JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe column adjustment in case table already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'default_measurements'
  ) THEN
    ALTER TABLE public.equipment ADD COLUMN default_measurements JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  -- Create appropriate indexes depending on column names (jenis_equipment_id vs equipment_type_id, lokasi_id vs location_id)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'jenis_equipment_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_equipment_jenis_id ON public.equipment(jenis_equipment_id);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'equipment_type_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_equipment_type_id ON public.equipment(equipment_type_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'lokasi_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_equipment_lokasi_id ON public.equipment(lokasi_id);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'location_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_equipment_location_id ON public.equipment(location_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_equipment_updated_at ON public.equipment;
CREATE TRIGGER set_equipment_updated_at
  BEFORE UPDATE ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_equipment_code ON public.equipment(equipment_code);
CREATE INDEX IF NOT EXISTS idx_equipment_active ON public.equipment(active);

-- 7. PREVENTIVE RECORDS TABLE
CREATE TABLE IF NOT EXISTS public.preventive_records (
  id BIGSERIAL PRIMARY KEY,
  record_id TEXT UNIQUE NOT NULL,
  dataset_id TEXT NOT NULL DEFAULT 'default',
  equipment_id INTEGER NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  equipment_code TEXT,
  equipment_name TEXT,
  equipment_type TEXT,
  view_type TEXT CHECK (view_type IS NULL OR view_type IN ('single', 'dual')),
  checklist_frequency_id INTEGER NOT NULL REFERENCES public.checklist_frequencies(id) ON DELETE RESTRICT,
  period_key TEXT NOT NULL,
  operational_date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('PS', 'M')),
  preventive_session_id INTEGER,
  sequence INTEGER NOT NULL DEFAULT 1,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by_technician_ids INTEGER[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'OK' CHECK (status IN ('OK', 'NG', 'NEEDS_REPAIR')),
  notes TEXT DEFAULT '',
  checklist_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  measurements JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidences JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT uq_preventive_record UNIQUE (
    dataset_id,
    equipment_id,
    checklist_frequency_id,
    period_key,
    shift
  )
);

-- Ensure foreign key constraint exists on checklist_frequency_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_prev_rec_checklist_frequency' 
      AND table_name = 'preventive_records'
  ) THEN
    BEGIN
      ALTER TABLE public.preventive_records 
        ADD CONSTRAINT fk_prev_rec_checklist_frequency 
        FOREIGN KEY (checklist_frequency_id) 
        REFERENCES public.checklist_frequencies(id) 
        ON DELETE RESTRICT;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_preventive_records_updated_at ON public.preventive_records;
CREATE TRIGGER set_preventive_records_updated_at
  BEFORE UPDATE ON public.preventive_records
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Practical Indexes
CREATE INDEX IF NOT EXISTS idx_prev_rec_operational_date 
  ON public.preventive_records(operational_date);

CREATE INDEX IF NOT EXISTS idx_prev_rec_equipment_id 
  ON public.preventive_records(equipment_id);

CREATE INDEX IF NOT EXISTS idx_prev_rec_date_shift 
  ON public.preventive_records(operational_date, shift);

CREATE INDEX IF NOT EXISTS idx_prev_rec_freq_period_shift 
  ON public.preventive_records(checklist_frequency_id, period_key, shift);

CREATE INDEX IF NOT EXISTS idx_prev_rec_eq_submitted_desc 
  ON public.preventive_records(equipment_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_prev_rec_dataset_equipment 
  ON public.preventive_records(dataset_id, equipment_id);

-- 8. REVOKE ALL ANONYMOUS ACCESS EXPLICITLY
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.lokasi FROM anon;
REVOKE ALL ON TABLE public.jenis_mesin FROM anon;
REVOKE ALL ON TABLE public.checklist_frequencies FROM anon;
REVOKE ALL ON TABLE public.checklist_items FROM anon;
REVOKE ALL ON TABLE public.equipment FROM anon;
REVOKE ALL ON TABLE public.preventive_records FROM anon;

-- Explicitly revoke execution on private helper functions from public/anon
REVOKE ALL ON FUNCTION private.is_active_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_active_supervisor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_active_supervisor() TO authenticated;

-- 9. EXPLICIT AUTHENTICATED TABLE GRANTS
-- Read-only grants on master tables for authenticated
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.lokasi TO authenticated;
GRANT SELECT ON TABLE public.jenis_mesin TO authenticated;
GRANT SELECT ON TABLE public.checklist_frequencies TO authenticated;
GRANT SELECT ON TABLE public.checklist_items TO authenticated;
GRANT SELECT ON TABLE public.equipment TO authenticated;

-- Master modification grants for supervisor (INSERT/UPDATE only, NO DELETE)
GRANT INSERT, UPDATE ON TABLE public.lokasi TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.jenis_mesin TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.checklist_frequencies TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.checklist_items TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.equipment TO authenticated;
GRANT UPDATE ON TABLE public.profiles TO authenticated;

-- Master sequence grants for authenticated supervisor INSERT operations
GRANT USAGE, SELECT ON SEQUENCE public.lokasi_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.jenis_mesin_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.equipment_id_seq TO authenticated;

-- Operational grants on preventive_records (SELECT, INSERT, UPDATE only, NO DELETE)
GRANT SELECT, INSERT, UPDATE ON TABLE public.preventive_records TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.preventive_records_id_seq TO authenticated;

-- 10. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_frequencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preventive_records ENABLE ROW LEVEL SECURITY;

-- 11. RLS POLICIES FOR CHECKLIST FREQUENCIES
DROP POLICY IF EXISTS "Allow read checklist_frequencies for active users" ON public.checklist_frequencies;
DROP POLICY IF EXISTS "Allow supervisor manage checklist_frequencies" ON public.checklist_frequencies;
DROP POLICY IF EXISTS "Allow supervisor insert checklist_frequencies" ON public.checklist_frequencies;
DROP POLICY IF EXISTS "Allow supervisor update checklist_frequencies" ON public.checklist_frequencies;

CREATE POLICY "Allow read checklist_frequencies for active users"
  ON public.checklist_frequencies
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

CREATE POLICY "Allow supervisor insert checklist_frequencies"
  ON public.checklist_frequencies
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_supervisor()));

CREATE POLICY "Allow supervisor update checklist_frequencies"
  ON public.checklist_frequencies
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

-- 12. RLS POLICIES FOR CHECKLIST ITEMS
DROP POLICY IF EXISTS "Allow read checklist_items for active users" ON public.checklist_items;
DROP POLICY IF EXISTS "Allow supervisor manage checklist_items" ON public.checklist_items;
DROP POLICY IF EXISTS "Allow supervisor insert checklist_items" ON public.checklist_items;
DROP POLICY IF EXISTS "Allow supervisor update checklist_items" ON public.checklist_items;

CREATE POLICY "Allow read checklist_items for active users"
  ON public.checklist_items
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

CREATE POLICY "Allow supervisor insert checklist_items"
  ON public.checklist_items
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_supervisor()));

CREATE POLICY "Allow supervisor update checklist_items"
  ON public.checklist_items
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

-- 13. RLS POLICIES FOR EQUIPMENT MASTER
DROP POLICY IF EXISTS "Allow read equipment for active users" ON public.equipment;
DROP POLICY IF EXISTS "Allow supervisor manage equipment" ON public.equipment;
DROP POLICY IF EXISTS "Allow supervisor insert equipment" ON public.equipment;
DROP POLICY IF EXISTS "Allow supervisor update equipment" ON public.equipment;

CREATE POLICY "Allow read equipment for active users"
  ON public.equipment
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

CREATE POLICY "Allow supervisor insert equipment"
  ON public.equipment
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_supervisor()));

CREATE POLICY "Allow supervisor update equipment"
  ON public.equipment
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

-- 14. RLS POLICIES FOR PREVENTIVE RECORDS
DROP POLICY IF EXISTS "Allow read preventive_records for active users" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow insert preventive_records for active users" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow update preventive_records for active users" ON public.preventive_records;

CREATE POLICY "Allow read preventive_records for active users"
  ON public.preventive_records
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

CREATE POLICY "Allow insert preventive_records for active users"
  ON public.preventive_records
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_user()));

CREATE POLICY "Allow update preventive_records for active users"
  ON public.preventive_records
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

-- NO DELETE policies on master data or preventive_records
