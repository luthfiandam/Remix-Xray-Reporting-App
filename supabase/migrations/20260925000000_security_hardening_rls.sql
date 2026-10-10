-- ==============================================================================
-- PHASE 1: SECURITY HARDENING — SUPABASE RLS & ACCESS CONTROL MIGRATION
-- File: supabase/migrations/20260925000000_security_hardening_rls.sql
-- ==============================================================================

-- 1. Create Private Security Schema
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- 2. Helper Security Functions (locked search_path for SECURITY DEFINER safety)
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

GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_active_supervisor() TO authenticated, service_role;

-- 3. REVOKE DANGEROUS PERMISSIONS FROM ANON
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.technicians FROM anon;
REVOKE ALL ON TABLE public.lokasi FROM anon;
REVOKE ALL ON TABLE public.jenis_mesin FROM anon;
REVOKE ALL ON TABLE public.equipment FROM anon;
REVOKE ALL ON TABLE public.preventive_records FROM anon;
REVOKE ALL ON TABLE public.corrective_records FROM anon;
REVOKE ALL ON TABLE public.shift_schedules FROM anon;
REVOKE ALL ON TABLE public.component_replacements FROM anon;

-- Revoke dangerous global sequence grants
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 4. GRANT CONTROLLED READ & OPERATIONAL PERMISSIONS
-- Public tables required for operational view
GRANT SELECT ON TABLE public.lokasi TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.jenis_mesin TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.equipment TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shift_schedules TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.preventive_records TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corrective_records TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.component_replacements TO anon, authenticated, service_role;

-- Technicians table: SELECT granted for user discovery, but mutations strictly restricted
GRANT SELECT ON TABLE public.technicians TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.technicians TO authenticated, service_role;

-- Operational records write access
GRANT INSERT, UPDATE ON TABLE public.preventive_records TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE public.corrective_records TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE public.shift_schedules TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE public.component_replacements TO anon, authenticated, service_role;

-- Sequences for ID generation
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 5. ROW LEVEL SECURITY (RLS) POLICIES HARDENING

-- A. PROFILES (Strictly authenticated & supervisor controlled)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Supervisors can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Supervisors can manage profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Supervisors can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_supervisor()));

CREATE POLICY "Supervisors can manage profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

-- B. TECHNICIANS TABLE (Allow SELECT for login/attendance, protect mutation)
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow read technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow supervisor manage technicians" ON public.technicians;

CREATE POLICY "Allow read technicians"
  ON public.technicians
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow supervisor manage technicians"
  ON public.technicians
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

-- C. LOKASI & JENIS MESIN MASTER TABLES
ALTER TABLE public.lokasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to lokasi" ON public.lokasi;
DROP POLICY IF EXISTS "Allow read lokasi" ON public.lokasi;
DROP POLICY IF EXISTS "Allow supervisor manage lokasi" ON public.lokasi;

CREATE POLICY "Allow read lokasi"
  ON public.lokasi
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow supervisor manage lokasi"
  ON public.lokasi
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

ALTER TABLE public.jenis_mesin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to jenis_mesin" ON public.jenis_mesin;
DROP POLICY IF EXISTS "Allow read jenis_mesin" ON public.jenis_mesin;
DROP POLICY IF EXISTS "Allow supervisor manage jenis_mesin" ON public.jenis_mesin;

CREATE POLICY "Allow read jenis_mesin"
  ON public.jenis_mesin
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow supervisor manage jenis_mesin"
  ON public.jenis_mesin
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

-- D. EQUIPMENT MASTER TABLE
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to equipment" ON public.equipment;
DROP POLICY IF EXISTS "Allow read equipment" ON public.equipment;
DROP POLICY IF EXISTS "Allow supervisor manage equipment" ON public.equipment;

CREATE POLICY "Allow read equipment"
  ON public.equipment
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow supervisor manage equipment"
  ON public.equipment
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_active_supervisor()))
  WITH CHECK ((SELECT private.is_active_supervisor()));

-- E. PREVENTIVE RECORDS
ALTER TABLE public.preventive_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to preventive_records" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow read preventive_records" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow insert preventive_records" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow update preventive_records" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow supervisor delete preventive_records" ON public.preventive_records;

CREATE POLICY "Allow read preventive_records"
  ON public.preventive_records
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow insert preventive_records"
  ON public.preventive_records
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update preventive_records"
  ON public.preventive_records
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow supervisor delete preventive_records"
  ON public.preventive_records
  FOR DELETE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()));

-- F. CORRECTIVE RECORDS
ALTER TABLE public.corrective_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to corrective_records" ON public.corrective_records;
DROP POLICY IF EXISTS "Allow read corrective_records" ON public.corrective_records;
DROP POLICY IF EXISTS "Allow insert corrective_records" ON public.corrective_records;
DROP POLICY IF EXISTS "Allow update corrective_records" ON public.corrective_records;
DROP POLICY IF EXISTS "Allow supervisor delete corrective_records" ON public.corrective_records;

CREATE POLICY "Allow read corrective_records"
  ON public.corrective_records
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow insert corrective_records"
  ON public.corrective_records
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update corrective_records"
  ON public.corrective_records
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow supervisor delete corrective_records"
  ON public.corrective_records
  FOR DELETE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()));

-- G. SHIFT SCHEDULES
ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to shift_schedules" ON public.shift_schedules;
DROP POLICY IF EXISTS "Allow read shift_schedules" ON public.shift_schedules;
DROP POLICY IF EXISTS "Allow save shift_schedules" ON public.shift_schedules;
DROP POLICY IF EXISTS "Allow supervisor delete shift_schedules" ON public.shift_schedules;

CREATE POLICY "Allow read shift_schedules"
  ON public.shift_schedules
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow save shift_schedules"
  ON public.shift_schedules
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update shift_schedules"
  ON public.shift_schedules
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow supervisor delete shift_schedules"
  ON public.shift_schedules
  FOR DELETE
  TO authenticated
  USING ((SELECT private.is_active_supervisor()));

-- H. COMPONENT REPLACEMENTS
ALTER TABLE public.component_replacements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to component_replacements" ON public.component_replacements;
DROP POLICY IF EXISTS "Allow read component_replacements" ON public.component_replacements;
DROP POLICY IF EXISTS "Allow save component_replacements" ON public.component_replacements;

CREATE POLICY "Allow read component_replacements"
  ON public.component_replacements
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow save component_replacements"
  ON public.component_replacements
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update component_replacements"
  ON public.component_replacements
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
