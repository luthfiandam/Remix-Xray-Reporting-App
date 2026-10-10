-- ==============================================================================
-- NARARYAAPPS DATABASE MIGRATION: RBAC PHASE 1 (ACCOUNTS & SECURITY HARDENING)
-- File: supabase/migrations/20261009000002_rbac_phase1_accounts_and_security.sql
-- Status: IDEMPOTENT, TRANSAKSIONAL, FAIL-CLOSED, NON-DESTRUKTIF
-- Scope: HANYA RBAC & STATUS AKUN (TIDAK menyentuh schedules, attendance, atau work patterns)
-- ==============================================================================
-- PETUNJUK PENERAPAN:
-- 1. Jalankan BAGIAN 1 (PREFLIGHT SCRIPT) terlebih dahulu di Supabase SQL Editor.
-- 2. Verifikasi tidak ada anomali atau data corrupt.
-- 3. Jalankan BAGIAN 2 (BLOK TRANSAKSI MIGRATION UTAMA: BEGIN ... COMMIT).
-- 4. Jalankan BAGIAN 3 (POSTFLIGHT SCRIPT) untuk memvalidasi seluruh hasil.
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
-- 1. DROP CONSTRAINT TERLEBIH DAHULU (Mencegah Constraint Violation saat Update)
-- ------------------------------------------------------------------------------
-- Role constraint lama hanya mengizinkan ('technician', 'supervisor') atau memiliki alias 'admin'.
-- Constraint harus dicopot terlebih dahulu sebelum melakukan UPDATE akun ke role baru.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.technicians DROP CONSTRAINT IF EXISTS technicians_role_check;


-- ------------------------------------------------------------------------------
-- 2. SINKRONISASI AKUN & PEMETAAN ROLE BARU
-- ------------------------------------------------------------------------------

-- 2A. Admin -> system_admin
-- Catatan Audit: Pemetaan strictly berdasarkan email & UUID auth, tidak berasumsi pada TECH-07.
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

-- 2B. Desi -> operations_admin
-- Hak: Jadwal, monitoring, unduh laporan/evidence/arsip PDF/presensi.
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

-- 2C. Kamal -> NONAKTIF (active = FALSE, tanpa menghapus akun)
-- Data historis tetap terjaga, seluruh akses login dan API langsung diblokir.
UPDATE public.profiles
SET active = FALSE,
    updated_at = NOW()
WHERE email = 'kamal@ntiapps.net' 
   OR id = 'ff6cbcec-3790-4b0e-8f7a-150eb502518c';

UPDATE public.technicians
SET active = FALSE,
    updated_at = NOW()
WHERE email = 'kamal@ntiapps.net';

-- 2D. Luthfi -> technician (Bukan supervisor; pola kerja OFFICE tidak disentuh pada fase ini)
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

-- 2E. Teknisi Lapangan (Zaky, Reza, Yoan, Fariz) -> technician
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

-- 2F. Supervisor -> supervisor
UPDATE public.profiles
SET role = 'supervisor',
    account_type = 'supervisor',
    active = TRUE,
    updated_at = NOW()
WHERE email = 'supervisor@ntiapps.net' 
   OR id = 'd0033f5a-6f06-4017-971f-7afc8b45d744';

-- 2G. Konversi seluruh record role 'admin' lama ke 'system_admin'
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
-- 3. ROLE CONSTRAINTS KETAT: ELIMINASI ALIAS 'admin' TANPA KEBUTUHAN TERBUKTI
-- ------------------------------------------------------------------------------
-- Canonical Roles: 'system_admin', 'operations_admin', 'supervisor', 'technician'
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('system_admin', 'operations_admin', 'supervisor', 'technician'));

ALTER TABLE public.technicians ADD CONSTRAINT technicians_role_check
    CHECK (role IN ('system_admin', 'operations_admin', 'supervisor', 'technician'));


-- ------------------------------------------------------------------------------
-- 4. INVALIDASI SESI & BLOKIR AKSES LANGSUNG SUPABASE UNTUK AKUN NONAKTIF (KAMAL)
-- ------------------------------------------------------------------------------
-- Blokir pada level auth.users (Supabase GoTrue) jika kolom banned_until tersedia,
-- sehingga token JWT lama ditolak saat validasi dan sesi disegarkan.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'auth' 
          AND table_name = 'users' 
          AND column_name = 'banned_until'
    ) THEN
        UPDATE auth.users
        SET banned_until = '2099-01-01 00:00:00+00'
        WHERE email = 'kamal@ntiapps.net'
           OR id = 'ff6cbcec-3790-4b0e-8f7a-150eb502518c';
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 5. FUNGSI KEAMANAN OTORISASI (SECURITY DEFINER / FAIL-CLOSED / STABLE)
-- ------------------------------------------------------------------------------

-- 5A. Fungsi untuk memeriksa apakah request berasal dari System Admin aktif
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

-- 5B. Fungsi untuk memeriksa apakah request berasal dari Operations Admin aktif
CREATE OR REPLACE FUNCTION public.is_operations_admin()
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
          AND role = 'operations_admin' 
          AND active = TRUE
    );
$$;

-- 5C. Fungsi untuk memeriksa apakah request berasal dari akun aktif apa pun
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

-- 5D. Perbarui helper private.is_active_supervisor agar mengenali system_admin
-- Hal ini penting agar policy existing yang memanggil private.is_active_supervisor
-- tidak memblokir system_admin.
CREATE SCHEMA IF NOT EXISTS private;

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
      AND role IN ('supervisor', 'system_admin')
      AND active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_active_supervisor() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_operations_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_account() TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 6. TRIGGER KEAMANAN ANTI-ESKALASI HAK AKSES PADA public.profiles
-- Mencegah eskalasi role, perubahan active, technician_id, email, atau account_type
-- saat pengguna biasa memperbarui profil mereka sendiri.
-- Mencegah ketergantungan pada subquery RLS yang rawan rekursi!
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_prevent_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Jika caller BUKAN system_admin aktif, cegah mutasi pada kolom sensitif
    IF NOT public.is_system_admin() THEN
        -- 1. Larang perubahan role
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Akses ditolak: role pengguna tidak dapat diubah sendiri.';
        END IF;

        -- 2. Larang perubahan status aktif (mencegah akun nonaktif mengaktifkan diri sendiri)
        IF NEW.active IS DISTINCT FROM OLD.active THEN
            RAISE EXCEPTION 'Akses ditolak: status akun (active) tidak dapat diubah sendiri.';
        END IF;

        -- 3. Larang perubahan account_type
        IF NEW.account_type IS DISTINCT FROM OLD.account_type THEN
            RAISE EXCEPTION 'Akses ditolak: account_type tidak dapat diubah sendiri.';
        END IF;

        -- 4. Larang perubahan technician_id
        IF NEW.technician_id IS DISTINCT FROM OLD.technician_id THEN
            RAISE EXCEPTION 'Akses ditolak: technician_id tidak dapat diubah sendiri.';
        END IF;

        -- 5. Larang perubahan email profil
        IF NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'Akses ditolak: email profil tidak dapat diubah sendiri.';
        END IF;

        -- 6. Larang perubahan ID profil
        IF NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Akses ditolak: id profil tidak dapat dimodifikasi.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_prevent_escalation ON public.profiles;
CREATE TRIGGER trg_profile_prevent_escalation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_prevent_profile_privilege_escalation();


-- ------------------------------------------------------------------------------
-- 7. AUDIT & PURGE SELURUH POLICY RLS LAMA (PROFILES & TECHNICIANS)
-- Hapus semua policy permisif (USING true / WITH CHECK true), policy signup lama,
-- dan bersihkan seluruh variasi nama policy yang mungkin aktif.
-- ------------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;

-- 7A. Explicit drop untuk semua variasi nama policy lama yang teridentifikasi
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow read access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow insert to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow update to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow profile insert during signup" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Supervisors can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Supervisors can manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own non-sensitive profile fields" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self_technician_only" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self_profile_only" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_manage_system_admin" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

DROP POLICY IF EXISTS "Allow full access to technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow read access to technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow read technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow supervisor manage technicians" ON public.technicians;
DROP POLICY IF EXISTS "technicians_select_all" ON public.technicians;
DROP POLICY IF EXISTS "technicians_admin_all" ON public.technicians;
DROP POLICY IF EXISTS "technicians_select_authenticated" ON public.technicians;
DROP POLICY IF EXISTS "technicians_manage_system_admin_only" ON public.technicians;
DROP POLICY IF EXISTS "technicians_manage_admin_only" ON public.technicians;

-- 7B. Pembersihan menyeluruh dinamis: Drop SEMUA policy yang masih tersisa
-- pada kedua tabel agar tidak ada policy permisif yang tertinggal.
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' AND tablename IN ('profiles', 'technicians')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;


-- ------------------------------------------------------------------------------
-- 8. PEMBUATAN POLICY RLS BARU YANG AMAN & OTORITATIF
-- ------------------------------------------------------------------------------

-- 8A. public.profiles: SELECT
-- Hanya akun authenticated yang aktif yang boleh membaca profil.
-- Akun nonaktif (seperti Kamal) tidak akan menerima baris apa pun.
CREATE POLICY "profiles_select_authenticated"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    public.is_active_account()
);

-- 8B. public.profiles: UPDATE OLEH PENGGUNA SENDIRI
-- Pengguna hanya boleh meng-update baris profil miliknya sendiri (auth.uid() = id).
-- TIDAK MENGGUNAKAN SUBQUERY REKURSIF! Proteksi kolom sensitif (role, active,
-- technician_id, email, account_type) ditangani secara fail-closed oleh trigger BEFORE UPDATE.
CREATE POLICY "profiles_update_self_non_sensitive"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    auth.uid() = id AND public.is_active_account()
)
WITH CHECK (
    auth.uid() = id AND public.is_active_account()
);

-- 8C. public.profiles: MANAGE SYSTEM ADMIN (FULL ACCESS)
-- Hanya System Admin aktif yang berhak melakukan INSERT akun baru, memodifikasi role,
-- mengubah status akun (aktif/nonaktif), atau menghapus profil.
-- TIDAK ADA JALUR INSERT/SIGNUP CLIENT BIASA! Seluruh pembuatan profil melalui jalur tepercaya.
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

-- 8D. public.technicians: SELECT
-- Hanya akun authenticated yang aktif yang dapat melihat daftar teknisi untuk keperluan roster/jadwal.
CREATE POLICY "technicians_select_authenticated"
ON public.technicians
FOR SELECT
TO authenticated
USING (
    public.is_active_account()
);

-- 8E. public.technicians: MANAGE SYSTEM ADMIN ONLY
-- Mutasi master teknisi (INSERT, UPDATE, DELETE) strictly dibatasi untuk System Admin aktif.
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
-- 9. AUDIT PERMISSIONS / GRANTS: CABUT SELURUH HAK WRITE DARI ANON
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

-- 3G. Verifikasi policy RLS aktif dan tidak ada policy liar
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename IN ('profiles', 'technicians')
ORDER BY tablename, policyname;

-- 3H. Verifikasi trigger proteksi eskalasi hak akses terpasang
SELECT trigger_name, event_manipulation, event_object_table, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'profiles' 
  AND trigger_name = 'trg_profile_prevent_escalation';
*/
