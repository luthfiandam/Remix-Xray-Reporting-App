-- ====================================================================
-- SUPABASE POSTGRESQL MIGRATION: ADDITIVE CORRECTIVE COLLAGE & S3 KEYS
-- Migration: 20261009000003_corrective_collage_and_legacy_s3_keys.sql
-- ====================================================================

-- 1. Add optional collage columns to public.corrective_records without altering existing data
ALTER TABLE public.corrective_records
  ADD COLUMN IF NOT EXISTS collage_object_key TEXT,
  ADD COLUMN IF NOT EXISTS collage_url TEXT;

-- Index for fast lookup of corrective collages
CREATE INDEX IF NOT EXISTS idx_corr_rec_collage_key
  ON public.corrective_records(collage_object_key)
  WHERE collage_object_key IS NOT NULL;

-- 2. Additive Helper Function: Safely extract S3 Object Key from legacy URLs
-- Note: This function is strictly non-destructive and idempotent.
CREATE OR REPLACE FUNCTION public.extract_s3_key_from_url(raw_url text)
RETURNS text AS $$
DECLARE
  marker text := '!Kantor/';
  idx integer;
  clean text;
BEGIN
  IF raw_url IS NULL OR raw_url = '' THEN
    RETURN NULL;
  END IF;
  
  idx := position(marker in raw_url);
  IF idx <= 0 THEN
    RETURN NULL;
  END IF;
  
  clean := substring(raw_url from idx);
  -- Strip query parameters if present
  IF position('?' in clean) > 0 THEN
    clean := split_part(clean, '?', 1);
  END IF;
  IF position('#' in clean) > 0 THEN
    clean := split_part(clean, '#', 1);
  END IF;
  
  RETURN clean;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
