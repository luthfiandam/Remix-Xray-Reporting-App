-- Supabase Table & RLS Schema for Shift Schedules (Jadwal Shift)
-- Run this script in the Supabase SQL Editor (https://app.supabase.com/project/_/sql)

-- 1. Create shift_schedules Table
CREATE TABLE IF NOT EXISTS public.shift_schedules (
  id TEXT PRIMARY KEY, -- doc_id format: dataset_id_schedule_date_shift (e.g., 'february_2026_2026-02-01_PS')
  dataset_id TEXT NOT NULL,
  schedule_date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('PS', 'M')),
  assignments JSONB NOT NULL DEFAULT '{}'::jsonb, -- Map of technician_id -> { technician_name: string, status: string }
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  schema_version INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Performance Indices
CREATE INDEX IF NOT EXISTS idx_shift_schedules_dataset_date 
  ON public.shift_schedules(dataset_id, schedule_date);

CREATE INDEX IF NOT EXISTS idx_shift_schedules_date 
  ON public.shift_schedules(schedule_date);

-- 3. Auto-update updated_at Trigger
CREATE OR REPLACE FUNCTION public.handle_shift_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_shift_schedules_updated_at ON public.shift_schedules;
CREATE TRIGGER set_shift_schedules_updated_at
  BEFORE UPDATE ON public.shift_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_shift_schedules_updated_at();

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Allow reading shift schedules
DROP POLICY IF EXISTS "Allow read shift_schedules for all users" ON public.shift_schedules;
CREATE POLICY "Allow read shift_schedules for all users"
  ON public.shift_schedules
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow inserting shift schedules
DROP POLICY IF EXISTS "Allow insert shift_schedules" ON public.shift_schedules;
CREATE POLICY "Allow insert shift_schedules"
  ON public.shift_schedules
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Allow updating shift schedules
DROP POLICY IF EXISTS "Allow update shift_schedules" ON public.shift_schedules;
CREATE POLICY "Allow update shift_schedules"
  ON public.shift_schedules
  FOR UPDATE
  TO authenticated, anon
  USING (true);

-- Allow deleting shift schedules
DROP POLICY IF EXISTS "Allow delete shift_schedules" ON public.shift_schedules;
CREATE POLICY "Allow delete shift_schedules"
  ON public.shift_schedules
  FOR DELETE
  TO authenticated, anon
  USING (true);
