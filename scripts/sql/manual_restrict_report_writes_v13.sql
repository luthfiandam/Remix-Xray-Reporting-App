-- SQL Script Version 13: Optional Row Level Security (RLS) Policy
-- Restricts direct table mutations on corrective_records and external_error_reports from client SDK.
-- Enforcement is primarily performed server-side in server.ts API endpoints.

-- 1. Enable RLS on corrective_records
ALTER TABLE IF EXISTS public.corrective_records ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access for authenticated users
DROP POLICY IF EXISTS "Allow read access for corrective records" ON public.corrective_records;
CREATE POLICY "Allow read access for corrective records"
  ON public.corrective_records FOR SELECT
  TO authenticated
  USING (true);

-- 2. Enable RLS on external_error_reports
ALTER TABLE IF EXISTS public.external_error_reports ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access for external_error_reports
DROP POLICY IF EXISTS "Allow read access for external error reports" ON public.external_error_reports;
CREATE POLICY "Allow read access for external error reports"
  ON public.external_error_reports FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow insert access for public AVSEC reports
DROP POLICY IF EXISTS "Allow public insert for external error reports" ON public.external_error_reports;
CREATE POLICY "Allow public insert for external error reports"
  ON public.external_error_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
