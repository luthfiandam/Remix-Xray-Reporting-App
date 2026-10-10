-- ==============================================================================
-- NARARYAAPPS DATABASE MIGRATION: RBAC PHASE 1 (ACCOUNTS & SECURITY HARDENING)
-- File: src/data/migration_20261009_rbac_phase1.sql
-- Status: IDEMPOTENT, TRANSAKSIONAL, FAIL-CLOSED, NON-DESTRUKTIF
-- Scope: HANYA RBAC & STATUS AKUN (TIDAK menyentuh schedules, attendance, atau work patterns)
-- ==============================================================================

-- ==============================================================================
-- BAGIAN 1: PREFLIGHT READ-ONLY CHECK (JALANKAN SEBELUM EKSEKUSI MIGRATION)
-- ==============================================================================
/*
-- 1A. Audit seluruh akun di public.profiles
SELECT 
    id, 
    email, 
    display_name, 
    technician_id, 
    role, 
    active, 
    account_type,
    created_at
FROM public.profiles
ORDER BY created_at ASC;

-- 1B. Audit seluruh personel di public.technicians
SELECT 
    id, 
    code, 
    name, 
    email, 
    role, 
    active,
    created_at
FROM public.technicians
ORDER BY id ASC;

-- 1C. Deteksi mapping admin@ntiapps.net:
-- Cek apakah profiles.technician_id = 6 memiliki baris valid di tabel technicians
SELECT 
    p.id AS profile_id,
    p.email AS profile_email,
    p.technician_id AS profile_tech_id,
    t.id AS matched_tech_id,
    t.code AS matched_tech_code,
    t.name AS matched_tech_name
FROM public.profiles p
LEFT JOIN public.technicians t ON p.technician_id = t.id
WHERE p.email = 'admin@ntiapps.net';

-- 1D. Cek apakah ada record technicians dengan kode TECH-07 atau email admin@ntiapps.net
SELECT id, code, name, email, role, active
FROM public.technicians
WHERE email = 'admin@ntiapps.net' OR code = 'TECH-07';

-- 1E. Cek policy RLS existing pada tabel profiles dan technicians
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('profiles', 'technicians');

-- 1F. Cek CHECK constraint existing pada role profiles dan technicians
SELECT tc.table_name, tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name IN ('profiles', 'technicians')
  AND tc.constraint_type = 'CHECK';
*/

-- ==============================================================================
-- BAGIAN 2: BLOK TRANSAKSI MIGRATION UTAMA
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- 1. SINKRONISASI AKUN & PERSIAPAN DATA SEBELUM CONSTRAINT
-- ------------------------------------------------------------------------------

-- 1A. Admin -> system_admin (Identifikasi berbasis email & UUID profil)
UPDATE public.profiles
SET role = 'system_admin',
    account_type = 'system_admin',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'admin@ntiapps.net' 
   OR id = '7f75e96e-6b40-4d91-9490-3ca5febb35c8';

UPDATE public.technicians
SET role = 'system_admin',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'admin@ntiapps.net';

-- 1B. Desi -> operations_admin
UPDATE public.profiles
SET role = 'operations_admin',
    account_type = 'operations_admin',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'desi@ntiapps.net' 
   OR id = '97aec10f-277a-4e5e-957c-3f06b3c394bc';

UPDATE public.technicians
SET role = 'operations_admin',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'desi@ntiapps.net';

-- 1C. Kamal -> NONAKTIF (active = FALSE, tanpa menghapus akun)
UPDATE public.profiles
SET active = FALSE,
    updated_at = NOW()
WHERE email = 'kamal@ntiapps.net' 
   OR id = 'ff6cbcec-3790-4b0e-8f7a-150eb502518c';

UPDATE public.technicians
SET active = FALSE,
    updated_at = NOW()
WHERE email = 'kamal@ntiapps.net';

-- 1D. Luthfi -> technician (bukan supervisor; pola kerja OFFICE tidak diubah pada fase ini)
UPDATE public.profiles
SET role = 'technician',
    account_type = 'technician',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'luthfi@ntiapps.net' 
   OR id = '3dff7dcc-5eef-46e7-bbf6-3cfb6e4f9c11';

UPDATE public.technicians
SET role = 'technician',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'luthfi@ntiapps.net';

-- 1E. Teknisi Lapangan (Zaky, Reza, Yoan, Fariz) -> technician
UPDATE public.profiles
SET role = 'technician',
    account_type = 'technician',
    active = TRUE,
    updated_at = NOW()
WHERE email IN ('zaky@ntiapps.net', 'reza@ntiapps.net', 'yoan@ntiapps.net', 'fariz@ntiapps.net');

UPDATE public.technicians
SET role = 'technician',
    active = TRUE,
    updated_at = NOW()
WHERE email IN ('zaky@ntiapps.net', 'reza@ntiapps.net', 'yoan@ntiapps.net', 'fariz@ntiapps.net');

-- 1F. Supervisor -> supervisor
UPDATE public.profiles
SET role = 'supervisor',
    account_type = 'supervisor',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'supervisor@ntiapps.net' 
   OR id = 'd0033f5a-6f06-4017-971f-7afc8b45d744';

-- 1G. Konversi seluruh record role 'admin' lama ke 'system_admin'
UPDATE public.profiles
SET role = 'system_admin',
    account_type = 'system_admin',
    updated_at = NOW()
WHERE role = 'admin';

UPDATE public.technicians
SET role = 'system_admin',
    updated_at = NOW()
WHERE role = 'admin';


-- ------------------------------------------------------------------------------
-- 2. ROLE CONSTRAINTS: ELIMINASI ALIAS 'admin' TANPA KEBUTUHAN TERBUKTI
-- ------------------------------------------------------------------------------
-- Canonical Roles: 'system_admin', 'operations_admin', 'supervisor', 'technician'

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('system_admin', 'operations_admin', 'supervisor', 'technician'));

ALTER TABLE public.technicians DROP CONSTRAINT IF EXISTS technicians_role_check;
ALTER TABLE public.technicians ADD CONSTRAINT technicians_role_check
    CHECK (role IN ('system_admin', 'operations_admin', 'supervisor', 'technician'));


-- ------------------------------------------------------------------------------
-- 3. FUNGSI KEAMANAN OTORISASI (SECURITY DEFINER / FAIL-CLOSED)
-- ------------------------------------------------------------------------------

-- Fungsi untuk memeriksa apakah request berasal dari System Admin aktif
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.profiles 
        WHERE id = auth.uid() 
          AND role = 'system_admin' 
          AND active = TRUE
    );
$$;

-- Fungsi untuk memeriksa apakah request berasal dari akun aktif
CREATE OR REPLACE FUNCTION public.is_active_account()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.profiles 
        WHERE id = auth.uid() 
          AND active = TRUE
    );
$$;


-- ------------------------------------------------------------------------------
-- 4. AUDIT & PERBAIKAN RLS: public.profiles
-- Hapus policy permisif (USING true WITH CHECK true) & cegah privilege escalation
-- ------------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop policy lama yang rentan / permisif
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow read access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow insert to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow update to profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;

-- 4A. SELECT: Akun authenticated yang aktif dapat membaca data profil
CREATE POLICY "profiles_select_authenticated"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    public.is_active_account()
);

-- 4B. INSERT: Pengguna baru hanya bisa mendaftarkan profilnya sendiri (auth.uid() = id).
-- CRITICAL ANTI-ESCALATION: Role wajib 'technician' dan akun tidak boleh langsung privileged!
CREATE POLICY "profiles_insert_self_technician_only"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = id 
    AND role = 'technician'
    AND account_type = 'technician'
);

-- 4C. UPDATE DIRI SENDIRI: Pengguna hanya boleh memperbarui display_name.
-- CRITICAL ANTI-ESCALATION: Dilarang mengubah role, active, account_type, atau technician_id!
CREATE POLICY "profiles_update_self_profile_only"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    auth.uid() = id AND public.is_active_account()
)
WITH CHECK (
    auth.uid() = id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND active = (SELECT p.active FROM public.profiles p WHERE p.id = auth.uid())
    AND account_type = (SELECT p.account_type FROM public.profiles p WHERE p.id = auth.uid())
);

-- 4D. FULL ACCESS UNTUK SYSTEM ADMIN:
-- System admin aktif memiliki hak penuh untuk insert, update role, mengaktifkan/menonaktifkan, atau delete
CREATE POLICY "profiles_manage_system_admin"
ON public.profiles
FOR ALL
TO authenticated
USING (
    public.is_system_admin()
)
WITH CHECK (
    public.is_system_admin()
);


-- ------------------------------------------------------------------------------
-- 5. AUDIT & PERBAIKAN RLS: public.technicians
-- Hapus policy permisif & proteksi tabel master personel
-- ------------------------------------------------------------------------------

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;

-- Drop policy lama yang rentan / permisif
DROP POLICY IF EXISTS "Allow full access to technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow read access to technicians" ON public.technicians;
DROP POLICY IF EXISTS "technicians_select_all" ON public.technicians;
DROP POLICY IF EXISTS "technicians_admin_all" ON public.technicians;

-- 5A. SELECT: Akun authenticated yang aktif dapat membaca daftar teknisi (untuk operasional/roster)
CREATE POLICY "technicians_select_authenticated"
ON public.technicians
FOR SELECT
TO authenticated
USING (
    public.is_active_account()
);

-- 5B. WRITE (INSERT, UPDATE, DELETE): HANYA System Admin aktif yang berhak memodifikasi tabel technicians
CREATE POLICY "technicians_manage_system_admin_only"
ON public.technicians
FOR ALL
TO authenticated
USING (
    public.is_system_admin()
)
WITH CHECK (
    public.is_system_admin()
);


-- ------------------------------------------------------------------------------
-- 6. AUDIT GRANTS: CABUT SELURUH HAK WRITE DARI ROLE ANON
-- ------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.technicians FROM anon;

GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.technicians TO authenticated;

COMMIT;

-- ==============================================================================
-- BAGIAN 3: POSTFLIGHT READ-ONLY CHECK (JALANKAN SETELAH EKSEKUSI MIGRATION)
-- ==============================================================================
/*
-- 3A. Verifikasi status dan role akun di public.profiles
SELECT id, email, display_name, role, active, account_type, technician_id
FROM public.profiles
ORDER BY role, email;

-- 3B. Verifikasi data di public.technicians
SELECT id, code, name, email, role, active
FROM public.technicians
ORDER BY id;

-- 3C. Verifikasi ketiadaan role 'admin' lama
SELECT COUNT(*) AS lingering_admin_profiles
FROM public.profiles
WHERE role = 'admin';

SELECT COUNT(*) AS lingering_admin_technicians
FROM public.technicians
WHERE role = 'admin';

-- 3D. Verifikasi status Kamal tetap ada tetapi nonaktif
SELECT 'profiles' AS tbl, email, role, active
FROM public.profiles
WHERE email = 'kamal@ntiapps.net'
UNION ALL
SELECT 'technicians' AS tbl, email, role, active
FROM public.technicians
WHERE email = 'kamal@ntiapps.net';

-- 3E. Verifikasi Luthfi adalah role 'technician'
SELECT 'profiles' AS tbl, email, role, active
FROM public.profiles
WHERE email = 'luthfi@ntiapps.net'
UNION ALL
SELECT 'technicians' AS tbl, email, role, active
FROM public.technicians
WHERE email = 'luthfi@ntiapps.net';

-- 3F. Verifikasi Desi adalah role 'operations_admin'
SELECT 'profiles' AS tbl, email, role, active
FROM public.profiles
WHERE email = 'desi@ntiapps.net'
UNION ALL
SELECT 'technicians' AS tbl, email, role, active
FROM public.technicians
WHERE email = 'desi@ntiapps.net';

-- 3G. Verifikasi policy RLS aktif
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename IN ('profiles', 'technicians');
*/
