-- ============================================================
-- DATABASE SCHEMA & INITIAL DATA SEEDING
-- UNTUK: LOKASI, JENIS MESIN, EQUIPMENT, TECHNICIANS,
-- PROFILES, PREVENTIVE, CORRECTIVE, SHIFT SCHEDULES & REPLACEMENTS
-- ============================================================

-- 1. TABEL LOKASI
CREATE TABLE IF NOT EXISTS lokasi (
    id SERIAL PRIMARY KEY,
    kode_lokasi VARCHAR(50) UNIQUE NOT NULL,
    nama_lokasi VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.lokasi ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.lokasi ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. TABEL JENIS MESIN (EQUIPMENT TYPES)
CREATE TABLE IF NOT EXISTS jenis_mesin (
    id SERIAL PRIMARY KEY,
    kode_jenis VARCHAR(50) UNIQUE NOT NULL,
    nama_jenis VARCHAR(255) NOT NULL,
    priority INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.jenis_mesin ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.jenis_mesin ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. TABEL EQUIPMENT
CREATE TABLE IF NOT EXISTS equipment (
    id SERIAL PRIMARY KEY,
    equipment_code VARCHAR(50) UNIQUE,
    jenis_equipment_id INTEGER NOT NULL REFERENCES jenis_mesin(id) ON DELETE CASCADE,
    lokasi_id INTEGER NOT NULL REFERENCES lokasi(id) ON DELETE CASCADE,
    nama VARCHAR(255) NOT NULL,
    merk VARCHAR(255) NOT NULL,
    tipe VARCHAR(255) NOT NULL,
    model VARCHAR(255) NULL,
    serial_number VARCHAR(255) NOT NULL,
    default_view VARCHAR(20) DEFAULT 'single',
    default_view_type VARCHAR(20) DEFAULT 'single',
    default_measurements JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS default_view VARCHAR(20) DEFAULT 'single';
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS default_view_type VARCHAR(20) DEFAULT 'single';
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS default_measurements JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. TABEL TECHNICIANS (TEKNISI & AKUN LOGIN)
CREATE TABLE IF NOT EXISTS technicians (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'technician',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 5. TABEL PROFILES (USER PROFILE & AUTH)
CREATE TABLE IF NOT EXISTS profiles (
    uid VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'technician',
    technician_id INTEGER NULL,
    active BOOLEAN DEFAULT TRUE,
    account_type VARCHAR(50) DEFAULT 'technician',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 6. TABEL PREVENTIVE RECORDS
CREATE TABLE IF NOT EXISTS preventive_records (
    id VARCHAR(255) PRIMARY KEY,
    record_id VARCHAR(255),
    dataset_id VARCHAR(100) DEFAULT 'default',
    equipment_id INTEGER NOT NULL,
    equipment_code VARCHAR(100),
    equipment_name VARCHAR(255) NOT NULL,
    equipment_type VARCHAR(100),
    view_type VARCHAR(20) DEFAULT 'single',
    frequency_id INTEGER DEFAULT 1,
    checklist_frequency_id INTEGER DEFAULT 1,
    period_key VARCHAR(100),
    operational_date VARCHAR(50) NOT NULL,
    shift VARCHAR(20) NOT NULL,
    preventive_session_id INTEGER,
    sequence INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'OK',
    technician_ids JSONB DEFAULT '[]'::jsonb,
    technician_names JSONB DEFAULT '[]'::jsonb,
    submitted_by_technician_ids JSONB DEFAULT '[]'::jsonb,
    items JSONB DEFAULT '[]'::jsonb,
    checklist_results JSONB DEFAULT '[]'::jsonb,
    measurements JSONB DEFAULT '[]'::jsonb,
    evidences JSONB DEFAULT '[]'::jsonb,
    kv_value NUMERIC NULL,
    ma_value NUMERIC NULL,
    notes TEXT NULL,
    schema_version INTEGER DEFAULT 1,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS record_id VARCHAR(255);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS equipment_code VARCHAR(100);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(100);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS view_type VARCHAR(20) DEFAULT 'single';
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS checklist_frequency_id INTEGER DEFAULT 1;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS period_key VARCHAR(100);
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS preventive_session_id INTEGER;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 1;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS submitted_by_technician_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS checklist_results JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS measurements JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS evidences JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1;
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.preventive_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 7. TABEL CORRECTIVE RECORDS
CREATE TABLE IF NOT EXISTS corrective_records (
    id VARCHAR(255) PRIMARY KEY,
    dataset_id VARCHAR(100) DEFAULT 'default',
    code VARCHAR(100),
    corrective_code VARCHAR(100),
    event_id VARCHAR(255),
    equipment_id INTEGER NOT NULL,
    equipment_code VARCHAR(100),
    equipment_name VARCHAR(255) NOT NULL,
    equipment_type VARCHAR(100),
    location_id INTEGER NULL,
    location_name VARCHAR(255) NULL,
    failure_description TEXT,
    problem_description TEXT,
    action_taken TEXT,
    result VARCHAR(50) DEFAULT 'Resolved',
    result_text TEXT NULL,
    technician_ids JSONB DEFAULT '[]'::jsonb,
    technician_names JSONB DEFAULT '[]'::jsonb,
    photos JSONB DEFAULT '[]'::jsonb,
    operational_date VARCHAR(50) NOT NULL,
    start_time VARCHAR(50) NULL,
    end_time VARCHAR(50) NULL,
    shift VARCHAR(20) NOT NULL,
    replaced_components JSONB DEFAULT '[]'::jsonb,
    created_by VARCHAR(255) NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS corrective_code VARCHAR(100);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS event_id VARCHAR(255);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS equipment_code VARCHAR(100);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(100);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS location_name VARCHAR(255);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS problem_description TEXT;
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS result_text TEXT;
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.corrective_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 8. TABEL SHIFT SCHEDULES
CREATE TABLE IF NOT EXISTS shift_schedules (
    id VARCHAR(255) PRIMARY KEY,
    period_key VARCHAR(50) NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    assignments JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) DEFAULT 'published',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. TABEL COMPONENT REPLACEMENTS
CREATE TABLE IF NOT EXISTS component_replacements (
    id VARCHAR(255) PRIMARY KEY,
    equipment_id INTEGER NOT NULL,
    equipment_name VARCHAR(255) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    replaced_at TIMESTAMPTZ NOT NULL,
    technician_names JSONB DEFAULT '[]'::jsonb,
    reason TEXT NULL,
    corrective_code VARCHAR(100) NULL,
    serial_number VARCHAR(100) NULL,
    origin VARCHAR(50) DEFAULT 'Baru',
    notes TEXT NULL,
    evidence_url TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- POPULATE DATA (SEED DATA)
-- ============================================================

-- A. INSERT LOKASI
INSERT INTO lokasi (id, kode_lokasi, nama_lokasi, active) VALUES
(1, 'LOC-001', 'BACK UP AREA', true),
(2, 'LOC-002', 'VVIP SMP SETNEG', true),
(3, 'LOC-003', 'HBSCP LINE C', true),
(4, 'LOC-004', 'HBSCP LINE D', true),
(5, 'LOC-005', 'CIP KARYAWAN', true),
(6, 'LOC-006', 'PINTU LAUD', true),
(7, 'LOC-007', 'MSCP EMERGENCY BATIK', true),
(8, 'LOC-008', 'BHS Line Batik', true),
(9, 'LOC-009', 'BHS Line Citilink', true),
(10, 'LOC-010', 'HBSCP LINE E', true),
(11, 'LOC-011', 'REKONSILIASI ROOM', true),
(12, 'LOC-012', 'ARRIVAL', true),
(13, 'LOC-013', 'RUANG ISTIRAHAT SCP 2', true)
ON CONFLICT (id) DO UPDATE 
SET kode_lokasi = EXCLUDED.kode_lokasi, nama_lokasi = EXCLUDED.nama_lokasi, active = EXCLUDED.active;

-- B. INSERT JENIS MESIN
INSERT INTO jenis_mesin (id, kode_jenis, nama_jenis, priority, active) VALUES
(1, 'XRAY', 'X-Ray Inspection System', 1, true),
(2, 'WTMD', 'Walk Through Metal Detector', 2, true),
(3, 'HHMD', 'Hand Held Metal Detector', 3, true),
(4, 'ETD', 'Explosive Trace Detector', 4, true)
ON CONFLICT (id) DO UPDATE 
SET kode_jenis = EXCLUDED.kode_jenis, nama_jenis = EXCLUDED.nama_jenis, priority = EXCLUDED.priority, active = EXCLUDED.active;

-- C. INSERT EQUIPMENT
INSERT INTO equipment (id, equipment_code, jenis_equipment_id, lokasi_id, nama, merk, tipe, model, serial_number, default_view, active) VALUES
(1, 'EQ-XRAY-01', 1, 1, 'BACK UP AREA', 'SMITHS DETECTION', 'Bagasi', '100100 T 2IS', '148753', 'dual', true),
(2, 'EQ-XRAY-02', 1, 8, 'BHS Line Batik', 'SMITHS DETECTION', 'Bagasi', '100100 T 2IS', '210018', 'dual', true),
(3, 'EQ-XRAY-03', 1, 9, 'BHS Line Citilink', 'SMITHS DETECTION', 'Bagasi', '100100 T 2IS', '209834', 'dual', true),
(4, 'EQ-XRAY-04', 1, 2, 'VVIP SMP SETNEG', 'SMITHS DETECTION', 'Bagasi', '100100 T 2IS', '148754', 'dual', true),
(5, 'EQ-XRAY-05', 1, 7, 'MSCP EMERGENCY BATIK', 'NUCHTECH', 'Kabin', 'CX 6040D', 'TFNAP-VIII-130007', 'single', true),
(6, 'EQ-XRAY-06', 1, 5, 'CIP KARYAWAN', 'SMITHS DETECTION', 'Kabin', '6040 2IS HR', '147751', 'dual', true),
(7, 'EQ-XRAY-07', 1, 3, 'HBSCP LINE C', 'SMITHS DETECTION', 'Kabin', '6040 2IS HR', '147754', 'dual', true),
(8, 'EQ-XRAY-08', 1, 4, 'HBSCP LINE D', 'SMITHS DETECTION', 'Kabin', '6040 2IS HR', '147752', 'dual', true),
(9, 'EQ-XRAY-09', 1, 10, 'HBSCP LINE E', 'SMITHS DETECTION', 'Kabin', '6040 2IS HR', '156261', 'dual', true),
(10, 'EQ-XRAY-10', 1, 6, 'PINTU LAUD', 'SMITHS DETECTION', 'Kabin', '6040 2IS HR', '147753', 'dual', true),
(11, 'EQ-ETD-01', 4, 11, 'REKONSILIASI ROOM', 'HIKVISION', 'ETD Portable', 'ISD-SE311H', '30185276703', 'single', true),
(12, 'EQ-WTMD-01', 2, 1, 'BACK UP AREA', 'CEIA', 'Walkthrough', 'HIPE/PZ', '21706016247', 'single', true),
(13, 'EQ-WTMD-02', 2, 5, 'CIP KARYAWAN', 'CEIA', 'Walkthrough', 'HIPE/PZ', '21606043131', 'single', true),
(14, 'EQ-WTMD-03', 2, 3, 'HBSCP LINE C', 'CEIA', 'Walkthrough', 'HIPE/PZ', '21706016221', 'single', true),
(15, 'EQ-WTMD-04', 2, 4, 'HBSCP LINE D', 'CEIA', 'Walkthrough', 'HIPE/PZ', '21706016238', 'single', true),
(16, 'EQ-WTMD-05', 2, 10, 'HBSCP LINE E', 'CEIA', 'Walkthrough', 'HIPE/PZ', '21706616222', 'single', true),
(17, 'EQ-WTMD-06', 2, 6, 'PINTU LAUD', 'CEIA', 'Walkthrough', 'HIPE/PZ', '21706016235', 'single', true),
(18, 'EQ-WTMD-07', 2, 2, 'VVIP SMP SETNEG', 'CEIA', 'Walkthrough', 'HIPE/PZ', '21607016236', 'single', true),
(19, 'EQ-HHMD-01', 3, 12, 'ARRIVAL', 'CEIA', 'Handheld', 'PD140E', '21710029254', 'single', true),
(20, 'EQ-HHMD-02', 3, 1, 'BACK UP AREA', 'CEIA', 'Handheld', 'PD140E', '31100381741', 'single', true),
(21, 'EQ-HHMD-03', 3, 5, 'CIP KARYAWAN', 'CEIA', 'Handheld', 'PD140E', '31100381734', 'single', true),
(22, 'EQ-HHMD-04', 3, 3, 'HBSCP LINE C', 'CEIA', 'Handheld', 'PD140E', '31100381737', 'single', true),
(23, 'EQ-HHMD-05', 3, 4, 'HBSCP LINE D', 'CEIA', 'Handheld', 'PD140E', '31100381736', 'single', true),
(24, 'EQ-HHMD-06', 3, 10, 'HBSCP LINE E', 'CEIA', 'Handheld', 'PD140E', '32100052281', 'single', true),
(25, 'EQ-HHMD-07', 3, 6, 'PINTU LAUD', 'CEIA', 'Handheld', 'PD140E', '31100381735', 'single', true),
(26, 'EQ-HHMD-08', 3, 11, 'REKONSILIASI ROOM', 'CEIA', 'Handheld', 'PD140E', '31100381738', 'single', true),
(27, 'EQ-HHMD-09', 3, 13, 'RUANG ISTIRAHAT SCP 2', 'CEIA', 'Handheld', 'PD140E', '32100058879', 'single', true)
ON CONFLICT (id) DO UPDATE 
SET equipment_code = EXCLUDED.equipment_code,
    jenis_equipment_id = EXCLUDED.jenis_equipment_id,
    lokasi_id = EXCLUDED.lokasi_id,
    nama = EXCLUDED.nama,
    merk = EXCLUDED.merk,
    tipe = EXCLUDED.tipe,
    model = EXCLUDED.model,
    serial_number = EXCLUDED.serial_number,
    default_view = EXCLUDED.default_view,
    active = EXCLUDED.active;

-- D. INSERT TECHNICIANS
INSERT INTO technicians (id, code, name, email, password, role, active) VALUES
(1, 'TECH-01', 'Luthfi', 'luthfi@bandara.id', '', 'supervisor', true),
(2, 'TECH-02', 'Zaky', 'zaky@bandara.id', '', 'technician', true),
(3, 'TECH-03', 'Reza', 'reza@bandara.id', '', 'technician', true),
(4, 'TECH-04', 'Yoan', 'yoan@bandara.id', '', 'technician', true),
(5, 'TECH-05', 'Fariz', 'fariz@bandara.id', '', 'technician', true)
ON CONFLICT (id) DO UPDATE
SET code = EXCLUDED.code,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    password = EXCLUDED.password,
    role = EXCLUDED.role,
    active = EXCLUDED.active;

-- ============================================================
-- 5. GRANT PERMISSIONS & ROW LEVEL SECURITY (SUPABASE)
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.lokasi TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.jenis_mesin TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.equipment TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.technicians TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.preventive_records TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.corrective_records TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.shift_schedules TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.component_replacements TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER TABLE public.lokasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to lokasi" ON public.lokasi;
CREATE POLICY "Allow full access to lokasi" ON public.lokasi FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.jenis_mesin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to jenis_mesin" ON public.jenis_mesin;
CREATE POLICY "Allow full access to jenis_mesin" ON public.jenis_mesin FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to equipment" ON public.equipment;
CREATE POLICY "Allow full access to equipment" ON public.equipment FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to technicians" ON public.technicians;
CREATE POLICY "Allow full access to technicians" ON public.technicians FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
CREATE POLICY "Allow full access to profiles" ON public.profiles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.preventive_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to preventive_records" ON public.preventive_records;
CREATE POLICY "Allow full access to preventive_records" ON public.preventive_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.corrective_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to corrective_records" ON public.corrective_records;
CREATE POLICY "Allow full access to corrective_records" ON public.corrective_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to shift_schedules" ON public.shift_schedules;
CREATE POLICY "Allow full access to shift_schedules" ON public.shift_schedules FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.component_replacements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to component_replacements" ON public.component_replacements;
CREATE POLICY "Allow full access to component_replacements" ON public.component_replacements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);


