-- ==============================================================================
-- NARARYAAPPS: MANUAL CORRECTION SCRIPT UNTUK RECORD HISTORIS PREVENTIF
-- Tanggal Operasional: 2026-10-09 | Shift: PS (Pagi)
-- ==============================================================================
-- PERHATIAN:
-- JANGAN EKSEKUSI SCRIPT INI SECARA OTOMATIS!
-- File ini disiapkan hanya untuk audit dan persetujuan manual oleh Database Administrator / Lead Engineer.
--
-- DESKRIPSI AKAR MASALAH:
-- Record preventif pada tanggal operasional 2026-10-09 mengalami konversi berulang UTC ke WIB
-- akibat pemrosesan timezone legacy (-7 jam sekali atau dua kali):
-- 1. ID 232: created_wib 14:05 (created_at 07:05 UTC), submitted_wib 00:05 (disimpan 17:05 UTC kemarin = -14 jam)
-- 2. ID 234: created_wib 14:10 (created_at 07:10 UTC), submitted_wib 07:10 (disimpan 00:10 UTC hari ini = -7 jam)
-- 3. ID 231: created_wib 13:37 (created_at 06:37 UTC), submitted_wib 23:35 (disimpan 16:35 UTC kemarin = -14 jam)
--
-- Akibatnya kalkulasi min/max tanpa filter anomalitas menghasilkan rentang tidak wajar: "00.05 s/d 23.35 WIB".
--
-- WAKTU SEHARUSNYA:
-- Waktu submit sebenarnya adalah saat pekerjaan selesai pada jam kerja shift PS:
-- ID 231 -> 13:35 WIB (06:35:00 UTC)
-- ID 232 -> 14:05 WIB (07:05:00 UTC)
-- ID 234 -> 14:10 WIB (07:10:00 UTC)
-- Rentang kerja yang benar: 13.35 s/d 14.10 WIB.
-- ==============================================================================

-- 1. AUDIT CHECK SEBELUM KOREKSI (VERIFIKASI DATA EXISTING)
SELECT 
    id,
    record_id,
    equipment_code,
    equipment_name,
    operational_date,
    shift,
    submitted_at,
    submitted_at AT TIME ZONE 'Asia/Jakarta' AS submitted_wib,
    created_at,
    created_at AT TIME ZONE 'Asia/Jakarta' AS created_wib
FROM public.preventive_records
WHERE id IN (231, 232, 234)
ORDER BY id ASC;

-- 2. QUERY KOREKSI TRANSAKSIONAL (JALANKAN HANYA SETELAH DISETUJUI)
BEGIN;

-- Koreksi ID 231: Waktu submit diubah dari 23:35 WIB kemarin ke 13:35:00 WIB (06:35:00 UTC)
UPDATE public.preventive_records
SET 
    submitted_at = '2026-10-09 06:35:00+00'::timestamptz,
    updated_at = NOW()
WHERE id = 231 
  AND operational_date = '2026-10-09' 
  AND shift = 'PS';

-- Koreksi ID 232: Waktu submit diubah dari 00:05 WIB ke 14:05:00 WIB (07:05:00 UTC)
UPDATE public.preventive_records
SET 
    submitted_at = '2026-10-09 07:05:00+00'::timestamptz,
    updated_at = NOW()
WHERE id = 232 
  AND operational_date = '2026-10-09' 
  AND shift = 'PS';

-- Koreksi ID 234: Waktu submit diubah dari 07:10 WIB ke 14:10:00 WIB (07:10:00 UTC)
UPDATE public.preventive_records
SET 
    submitted_at = '2026-10-09 07:10:00+00'::timestamptz,
    updated_at = NOW()
WHERE id = 234 
  AND operational_date = '2026-10-09' 
  AND shift = 'PS';

-- 3. AUDIT CHECK SETELAH KOREKSI (VERIFIKASI HASIL)
SELECT 
    id,
    record_id,
    equipment_code,
    operational_date,
    shift,
    submitted_at,
    submitted_at AT TIME ZONE 'Asia/Jakarta' AS submitted_wib,
    created_at AT TIME ZONE 'Asia/Jakarta' AS created_wib
FROM public.preventive_records
WHERE id IN (231, 232, 234)
ORDER BY id ASC;

-- 4. SIMULASI RENTANG WAKTU SHIFT PS 2026-10-09:
-- Min: 13:35:00 WIB -> dibulatkan ke bawah per 5 menit: 13:35 WIB
-- Max: 14:10:00 WIB -> dibulatkan ke atas per 5 menit: 14:10 WIB
-- Hasil Laporan: "Jam : 13.35 s/d 14.10 WIB"

-- Pastikan hasil SELECT di langkah 3 sesuai sebelum COMMIT
COMMIT;
-- Jika ada keraguan, jalankan: ROLLBACK;
