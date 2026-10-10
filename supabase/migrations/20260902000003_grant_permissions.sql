-- ==============================================================================
-- FIX "permission denied" & RLS FOR ALL TABLES IN SUPABASE
-- Run this in the Supabase SQL Editor:
-- ==============================================================================

-- 1. Grant usage on schemas
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Grant table permissions
GRANT ALL ON TABLE public.lokasi TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.jenis_mesin TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.equipment TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.preventive_records TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.corrective_records TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.shift_schedules TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;

-- 3. Grant sequence permissions (for BIGSERIAL / AUTO_INCREMENT IDs)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 4. Enable Row Level Security with permissive policies for testing & operation
ALTER TABLE public.lokasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to lokasi" ON public.lokasi;
CREATE POLICY "Allow full access to lokasi" ON public.lokasi FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.jenis_mesin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to jenis_mesin" ON public.jenis_mesin;
CREATE POLICY "Allow full access to jenis_mesin" ON public.jenis_mesin FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to equipment" ON public.equipment;
CREATE POLICY "Allow full access to equipment" ON public.equipment FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.preventive_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to preventive_records" ON public.preventive_records;
CREATE POLICY "Allow full access to preventive_records" ON public.preventive_records FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.corrective_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to corrective_records" ON public.corrective_records;
CREATE POLICY "Allow full access to corrective_records" ON public.corrective_records FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to shift_schedules" ON public.shift_schedules;
CREATE POLICY "Allow full access to shift_schedules" ON public.shift_schedules FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
CREATE POLICY "Allow full access to profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
