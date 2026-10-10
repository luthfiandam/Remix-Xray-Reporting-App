-- ==============================================================================
-- NARARYAAPPS DATABASE MIGRATION: ACCOUNT SYNCHRONIZATION, RBAC & SHIFT RULES
-- Version: 20261009_accounts_rbac_and_work_shift_rules_v3.sql
-- Status: IDEMPOTENT, TRANSAKSIONAL, FAIL-CLOSED, NON-DESTRUKTIF
-- ==============================================================================
-- PETUNJUK PENERAPAN:
-- 1. Jalankan PREFLIGHT SCRIPT terlebih dahulu di Supabase SQL Editor.
-- 2. Jika preflight bersih, jalankan BLOK TRANSAKSI UTAMA (BEGIN ... COMMIT).
-- 3. Jalankan POSTFLIGHT SCRIPT untuk memverifikasi hasil penerapan.
-- ==============================================================================

-- ==============================================================================
-- BAGIAN 1: PREFLIGHT READ-ONLY CHECK (JALANKAN INI SEBELUM MIGRATION)
-- ==============================================================================
/*
-- 1A. Cek duplikasi nama pada staff_work_patterns (jika tabel sudah ada)
SELECT staff_name, COUNT(*) AS count
FROM public.staff_work_patterns
GROUP BY staff_name
HAVING COUNT(*) > 1;

-- 1B. Cek duplikasi absensi pada tabel attendance
SELECT operational_date, LOWER(TRIM(technician_name)) AS tech_name, shift, attendance_type, COUNT(*) AS cnt
FROM public.attendance
GROUP BY operational_date, LOWER(TRIM(technician_name)), shift, attendance_type
HAVING COUNT(*) > 1;

-- 1C. Cek status akun existing di profiles & technicians
SELECT 'profiles' AS tbl, id::text AS uid, email, display_name, role, active, technician_id
FROM public.profiles
WHERE email IN ('admin@ntiapps.net', 'desi@ntiapps.net', 'kamal@ntiapps.net', 'luthfi@ntiapps.net', 'zaky@ntiapps.net', 'reza@ntiapps.net', 'yoan@ntiapps.net', 'fariz@ntiapps.net')
UNION ALL
SELECT 'technicians' AS tbl, id::text, email, name, role, active, id
FROM public.technicians;
*/

-- ==============================================================================
-- BAGIAN 2: BLOK TRANSAKSI MIGRATION UTAMA
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- 1. SINKRONISASI AKUN & PERBARUI ROLE CONSTRAINT
-- ------------------------------------------------------------------------------

-- A. Tambahkan constraint role pada public.profiles agar mendukung system_admin & operations_admin
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('system_admin', 'operations_admin', 'supervisor', 'technician', 'admin'));

-- B. Tambahkan constraint role pada public.technicians
ALTER TABLE public.technicians DROP CONSTRAINT IF EXISTS technicians_role_check;
ALTER TABLE public.technicians ADD CONSTRAINT technicians_role_check
    CHECK (role IN ('system_admin', 'operations_admin', 'supervisor', 'technician', 'admin'));

-- C. Sinkronisasi Akun Admin -> system_admin
UPDATE public.profiles
SET role = 'system_admin',
    account_type = 'system_admin',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'admin@ntiapps.net' OR id = '7f75e96e-6b40-4d91-9490-3ca5febb35c8';

UPDATE public.technicians
SET role = 'system_admin',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'admin@ntiapps.net' OR code = 'TECH-07';

-- D. Sinkronisasi Akun Desi -> operations_admin (Office hours)
UPDATE public.profiles
SET role = 'operations_admin',
    account_type = 'operations_admin',
    technician_id = 8,
    active = TRUE,
    updated_at = NOW()
WHERE email = 'desi@ntiapps.net' OR id = '97aec10f-277a-4e5e-957c-3f06b3c394bc';

UPDATE public.technicians
SET role = 'operations_admin',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'desi@ntiapps.net' OR id = 8;

-- E. Sinkronisasi Akun Kamal -> NONAKTIF (active = FALSE)
UPDATE public.profiles
SET active = FALSE,
    updated_at = NOW()
WHERE email = 'kamal@ntiapps.net' OR id = 'ff6cbcec-3790-4b0e-8f7a-150eb502518c';

UPDATE public.technicians
SET active = FALSE,
    updated_at = NOW()
WHERE email = 'kamal@ntiapps.net';

-- F. Sinkronisasi Akun Supervisor & Teknisi
UPDATE public.profiles
SET role = 'supervisor',
    active = TRUE,
    technician_id = 1,
    updated_at = NOW()
WHERE email = 'luthfi@ntiapps.net' OR id = '3dff7dcc-5eef-46e7-bbf6-3cfb6e4f9c11';

UPDATE public.technicians
SET role = 'supervisor',
    active = TRUE,
    updated_at = NOW()
WHERE id = 1 OR email = 'luthfi@ntiapps.net';

-- Pastikan teknisi shift aktif memiliki role technician
UPDATE public.profiles
SET role = 'technician', active = TRUE, updated_at = NOW()
WHERE email IN ('zaky@ntiapps.net', 'reza@ntiapps.net', 'yoan@ntiapps.net', 'fariz@ntiapps.net');

UPDATE public.technicians
SET role = 'technician', active = TRUE, updated_at = NOW()
WHERE email IN ('zaky@ntiapps.net', 'reza@ntiapps.net', 'yoan@ntiapps.net', 'fariz@ntiapps.net');

-- ------------------------------------------------------------------------------
-- 2. TABEL WORK_SHIFT_RULES (Aturan Shift & Windows Absensi Dinamis)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_shift_rules (
    id SERIAL PRIMARY KEY,
    shift_code VARCHAR(20) NOT NULL,
    shift_name VARCHAR(100) NOT NULL,
    start_time TIME WITHOUT TIME ZONE NOT NULL,
    duration_minutes INTEGER NOT NULL,
    check_in_start_offset INTEGER NOT NULL,      -- Menit relatif terhadap start_time (misal: -120 = 2 jam sebelum mulai)
    check_in_ontime_end_offset INTEGER NOT NULL, -- Menit batas tepat waktu (misal: +15 = s/d 15 menit setelah mulai)
    check_in_late_end_offset INTEGER NOT NULL,   -- Batas akhir toleransi terlambat (misal: +120 atau +180)
    check_out_start_offset INTEGER NOT NULL,     -- Menit awal window absen pulang
    check_out_end_offset INTEGER NOT NULL,       -- Menit batas akhir window absen pulang
    timezone VARCHAR(50) DEFAULT 'Asia/Jakarta',
    is_cross_day BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_work_shift_rules_code UNIQUE (shift_code)
);

-- Seed / Upsert Aturan Jam Kerja Baku
INSERT INTO public.work_shift_rules (
    shift_code, shift_name, start_time, duration_minutes,
    check_in_start_offset, check_in_ontime_end_offset, check_in_late_end_offset,
    check_out_start_offset, check_out_end_offset, timezone, is_cross_day, is_active
) VALUES
('OFFICE', 'Office Hour', '08:00:00', 540, -120, 15, 120, 480, 720, 'Asia/Jakarta', FALSE, TRUE),
('PS',     'Shift Pagi',  '07:00:00', 720,  -60, 15, 180, 690, 780, 'Asia/Jakarta', FALSE, TRUE),
('M',      'Shift Malam', '19:00:00', 720,  -60, 15, 180, 690, 780, 'Asia/Jakarta', TRUE,  TRUE)
ON CONFLICT (shift_code) DO UPDATE SET
    shift_name                 = EXCLUDED.shift_name,
    start_time                 = EXCLUDED.start_time,
    duration_minutes           = EXCLUDED.duration_minutes,
    check_in_start_offset      = EXCLUDED.check_in_start_offset,
    check_in_ontime_end_offset = EXCLUDED.check_in_ontime_end_offset,
    check_in_late_end_offset   = EXCLUDED.check_in_late_end_offset,
    check_out_start_offset     = EXCLUDED.check_out_start_offset,
    check_out_end_offset       = EXCLUDED.check_out_end_offset,
    timezone                   = EXCLUDED.timezone,
    is_cross_day               = EXCLUDED.is_cross_day,
    is_active                  = EXCLUDED.is_active,
    updated_at                 = NOW();

-- ------------------------------------------------------------------------------
-- 3. TABEL STAFF_WORK_PATTERNS (Pola Kerja Personel: OFFICE vs ROTATING)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_work_patterns (
    id SERIAL PRIMARY KEY,
    technician_id INTEGER NULL REFERENCES public.technicians(id) ON DELETE SET NULL,
    staff_name VARCHAR(255) NOT NULL,
    work_pattern VARCHAR(50) NOT NULL,     -- 'OFFICE', 'ROTATING', 'MANUAL'
    fixed_shift_code VARCHAR(20) DEFAULT 'OFFICE',
    anchor_date DATE NULL,
    anchor_phase VARCHAR(50) DEFAULT 'PS', -- 'PS', 'M', 'LIBUR1', 'LIBUR2'
    active_days JSONB DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pastikan kolom technician_id tersedia jika tabel sudah pernah dibuat sebelumnya
ALTER TABLE public.staff_work_patterns 
    ADD COLUMN IF NOT EXISTS technician_id INTEGER NULL REFERENCES public.technicians(id) ON DELETE SET NULL;

-- Tambahkan Unique Constraint pada staff_name secara aman tanpa asumsi
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'public.staff_work_patterns'::regclass 
          AND conname = 'uq_staff_work_patterns_staff_name'
    ) THEN
        -- Validasi tidak ada baris duplikat sebelum memasang constraint
        IF (SELECT COUNT(*) - COUNT(DISTINCT staff_name) FROM public.staff_work_patterns) = 0 THEN
            ALTER TABLE public.staff_work_patterns 
                ADD CONSTRAINT uq_staff_work_patterns_staff_name UNIQUE (staff_name);
        END IF;
    END IF;
END $$;

-- Seed / Upsert Data Pola Kerja Personel
INSERT INTO public.staff_work_patterns (
    staff_name, technician_id, work_pattern, fixed_shift_code, anchor_date, anchor_phase, active_days, is_active
)
SELECT 
    v.staff_name,
    t.id AS technician_id,
    v.work_pattern,
    v.fixed_shift_code,
    v.anchor_date::DATE,
    v.anchor_phase,
    v.active_days::jsonb,
    v.is_active
FROM (
    VALUES
    ('Desi',   'OFFICE',   'OFFICE', NULL,         NULL, '[0,1,2,3,4,5,6]', TRUE),
    ('Luthfi', 'OFFICE',   'OFFICE', NULL,         NULL, '[0,1,2,3,4,5,6]', TRUE),
    ('Zaky',   'ROTATING', NULL,     '2026-05-01', 'PS', '[0,1,2,3,4,5,6]', TRUE),
    ('Reza',   'ROTATING', NULL,     '2026-10-03', 'PS', '[0,1,2,3,4,5,6]', TRUE),
    ('Yoan',   'ROTATING', NULL,     '2026-10-01', 'PS', '[0,1,2,3,4,5,6]', TRUE),
    ('Fariz',  'ROTATING', NULL,     '2026-10-02', 'PS', '[0,1,2,3,4,5,6]', TRUE),
    ('Kamal',  'ROTATING', NULL,     NULL,         NULL, '[0,1,2,3,4,5,6]', FALSE)
) AS v(staff_name, work_pattern, fixed_shift_code, anchor_date, anchor_phase, active_days, is_active)
LEFT JOIN public.technicians t ON LOWER(TRIM(t.name)) = LOWER(TRIM(v.staff_name))
ON CONFLICT (staff_name) DO UPDATE SET
    technician_id    = COALESCE(EXCLUDED.technician_id, staff_work_patterns.technician_id),
    work_pattern     = EXCLUDED.work_pattern,
    fixed_shift_code = EXCLUDED.fixed_shift_code,
    anchor_date      = EXCLUDED.anchor_date,
    anchor_phase     = EXCLUDED.anchor_phase,
    active_days      = EXCLUDED.active_days,
    is_active        = EXCLUDED.is_active,
    updated_at       = NOW();

-- ------------------------------------------------------------------------------
-- 4. PERBAIKAN SCHEMA & UNIQUE INDEX TABEL ATTENDANCE (NO user_id COLUMN)
-- ------------------------------------------------------------------------------

-- A. Pastikan kolom pendukung tersedia
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS technician_id INTEGER NULL REFERENCES public.technicians(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS attendance_type TEXT DEFAULT 'masuk';

-- B. Perbarui Check Constraint shift (Mendukung 'OFFICE' serta kompatibel 'PS', 'M', 'Pagi', 'Malam')
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_shift_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_shift_check 
    CHECK (shift IN ('PS', 'M', 'OFFICE', 'Pagi', 'Malam'));

-- C. Perbarui Check Constraint attendance_type
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_attendance_type_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_attendance_type_check 
    CHECK (attendance_type IN ('masuk', 'pulang', 'bypass', 'grace_period', 'off_duty'));

-- D. Migrasi Unique Index Presensi
-- Index ini menggunakan kolom existing (operational_date, LOWER(TRIM(technician_name)), shift, attendance_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_person_date_shift_type
    ON public.attendance (operational_date, LOWER(TRIM(technician_name)), shift, attendance_type);

-- Drop index lama uq_attendance_tech_date_type setelah index baru terpasang
DROP INDEX IF EXISTS public.uq_attendance_tech_date_type;

-- ------------------------------------------------------------------------------
-- 5. AUDIT GRANT & KEAMANAN ROW LEVEL SECURITY (RLS) FAIL-CLOSED
-- ------------------------------------------------------------------------------

-- Anon HANYA berhak SELECT (tidak boleh INSERT/UPDATE/DELETE)
REVOKE ALL ON TABLE public.work_shift_rules FROM anon;
REVOKE ALL ON TABLE public.staff_work_patterns FROM anon;

GRANT SELECT ON TABLE public.work_shift_rules TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.staff_work_patterns TO anon, authenticated, service_role;

GRANT ALL ON TABLE public.work_shift_rules TO service_role;
GRANT ALL ON TABLE public.staff_work_patterns TO service_role;

-- Mutasi aturan konfigurasi shift & staf diberikan kepada authenticated, namun difilter ketat oleh RLS
GRANT INSERT, UPDATE, DELETE ON TABLE public.work_shift_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.staff_work_patterns TO authenticated;

-- RLS Policies untuk work_shift_rules (FAIL-CLOSED: TIDAK ADA USING(true) WITH CHECK(true) untuk mutasi)
ALTER TABLE public.work_shift_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read work_shift_rules" ON public.work_shift_rules;
CREATE POLICY "Allow read work_shift_rules" 
    ON public.work_shift_rules FOR SELECT 
    TO anon, authenticated 
    USING (true);

DROP POLICY IF EXISTS "Allow supervisor manage work_shift_rules" ON public.work_shift_rules;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_active_supervisor' AND pronamespace = 'private'::regnamespace) THEN
        EXECUTE 'CREATE POLICY "Allow supervisor manage work_shift_rules" ON public.work_shift_rules FOR ALL TO authenticated USING ((SELECT private.is_active_supervisor())) WITH CHECK ((SELECT private.is_active_supervisor()))';
    ELSE
        -- Fail-closed policy: Hanya role system_admin / supervisor yang tercatat aktif di tabel profiles
        EXECUTE 'CREATE POLICY "Allow supervisor manage work_shift_rules" ON public.work_shift_rules FOR ALL TO authenticated 
            USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN (''system_admin'', ''supervisor'', ''admin'') AND active = true))
            WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN (''system_admin'', ''supervisor'', ''admin'') AND active = true))';
    END IF;
END $$;

-- RLS Policies untuk staff_work_patterns (FAIL-CLOSED)
ALTER TABLE public.staff_work_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read staff_work_patterns" ON public.staff_work_patterns;
CREATE POLICY "Allow read staff_work_patterns" 
    ON public.staff_work_patterns FOR SELECT 
    TO anon, authenticated 
    USING (true);

DROP POLICY IF EXISTS "Allow supervisor manage staff_work_patterns" ON public.staff_work_patterns;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_active_supervisor' AND pronamespace = 'private'::regnamespace) THEN
        EXECUTE 'CREATE POLICY "Allow supervisor manage staff_work_patterns" ON public.staff_work_patterns FOR ALL TO authenticated USING ((SELECT private.is_active_supervisor())) WITH CHECK ((SELECT private.is_active_supervisor()))';
    ELSE
        -- Fail-closed policy: Hanya role system_admin / supervisor / operations_admin aktif yang dapat mengelola pola staf
        EXECUTE 'CREATE POLICY "Allow supervisor manage staff_work_patterns" ON public.staff_work_patterns FOR ALL TO authenticated 
            USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN (''system_admin'', ''supervisor'', ''operations_admin'', ''admin'') AND active = true))
            WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN (''system_admin'', ''supervisor'', ''operations_admin'', ''admin'') AND active = true))';
    END IF;
END $$;

COMMIT;

-- ==============================================================================
-- BAGIAN 3: POSTFLIGHT READ-ONLY CHECK (JALANKAN INI SETELAH MIGRATION)
-- ==============================================================================
/*
-- 3A. Verifikasi sinkronisasi akun
SELECT 'profiles' AS tbl, id::text AS uid, email, display_name, role, active, technician_id
FROM public.profiles
WHERE email IN ('admin@ntiapps.net', 'desi@ntiapps.net', 'kamal@ntiapps.net', 'luthfi@ntiapps.net', 'zaky@ntiapps.net', 'reza@ntiapps.net', 'yoan@ntiapps.net', 'fariz@ntiapps.net')
UNION ALL
SELECT 'technicians' AS tbl, id::text, email, name, role, active, id
FROM public.technicians;

-- 3B. Verifikasi isi tabel staff_work_patterns
SELECT id, staff_name, technician_id, work_pattern, fixed_shift_code, anchor_date, anchor_phase, is_active
FROM public.staff_work_patterns
ORDER BY id;

-- 3C. Verifikasi index aktif pada tabel attendance
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'attendance';

-- 3D. Verifikasi RLS policies
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename IN ('work_shift_rules', 'staff_work_patterns');
*/
