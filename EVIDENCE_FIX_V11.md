# DOKUMENTASI PERBAIKAN EVIDENCE & WHATSAPP REPORT V11

## Overview
Dokumen ini mencatat seluruh hasil perbaikan, audit, serta pengujian sistem evidence foto, pembuatan kolase corrective, pengelolaan cache S3, dan autentikasi pengiriman laporan WhatsApp/WAHA.

---

## 1. Daftar File yang Diperbaiki (12 File)

### 1. `src/services/whatsappService.ts`
- **Masalah**: Fungsi-fungsi pemicu API WhatsApp (`sendWhatsAppDirectText`, `sendWhatsAppDirectPhoto`, `getWhatsAppStatus`, `sendWhatsAppDirectDocument`, `sendWhatsAppWahaFile`, dll) tidak menyertakan Authorization Header `Bearer <token>`.
- **Perbaikan**: Mengintegrasikan `getAuthHeaders()` pada semua request HTTP ke endpoint `/api/whatsapp/*`. Menambahkan penanganan error HTTP 401/403 yang informatif.

### 2. `src/components/CorrectiveView.tsx`
- **Masalah**: Risiko duplikasi kolase saat edit laporan tanpa perubahan foto, penanganan upload parsial foto yang menggantung, perbandingan shift yang salah (`resolvedShift === 'M'`), dan tipe pengembalian sync.
- **Perbaikan**:
  - Implementasi hashing daftar foto original untuk mendeteksi perubahan foto sebelum membuat kolase baru.
  - Penanganan upload parsial dengan retry antrean foto yang belum berhasil diunggah.
  - Perbaikan logika perbandingan shift (`resolvedShift === 'Malam'`).
  - Penyesuaian panggilan `onAddCorrective` terhadap status simpan cloud/IndexedDB.

### 3. `src/components/PreventiveView.tsx`
- **Masalah**: ReferenceError pada variabel `cap` yang dipanggil sebelum dideklarasikan pada parsing caption foto.
- **Perbaikan**: Mendeduksi variabel `cap` secara aman: `const cap = (ev.caption || '').toLowerCase();`.

### 4. `src/components/S3Image.tsx`
- **Masalah**: Menampilkan thumbnail/gambar lama saat prop `objectKey` atau `src` berubah sebelum gambar baru selesai dimuat.
- **Perbaikan**: Mereset state gambar dan blob URL saat prop sumber gambar mengalami perubahan.

### 5. `src/components/preventive/PhotoDocumentationSection.tsx`
- **Masalah**: Menggunakan tag `<img src="...">` langsung untuk foto privat S3 tanpa otentikasi.
- **Perbaikan**: Menggunakan komponen `<S3Image>` agar foto privat dimuat melalui authenticated proxy URL.

### 6. `src/components/report/WhatsAppReportSection.tsx`
- **Masalah**: Penanganan array evidence yang undefined (`item.evidences.forEach`) dan salah menghitung foto yang gagal disiapkan.
- **Perbaikan**: Menambahkan null-checking pada `item.evidences` dan penanganan hitung kegagalan media secara akurat sebelum pengiriman.

### 7. `src/hooks/useAppDataSync.ts`
- **Masalah**: Tipe pengembalian `handleAddCorrective` tidak mengembalikan objek `{ cloudSynced, queued }` yang diharapkan oleh komponen penanggan laporan.
- **Perbaikan**: Memperbarui signature `handleAddCorrective` agar mengembalikan `Promise<{ cloudSynced: boolean; queued: boolean }>`.

### 8. `src/pdf/CorrectivePdfDocument.tsx`
- **Masalah**: Gambar dokumentasi S3 privat tidak dapat dimuat langsung oleh renderer PDF tanpa otentikasi.
- **Perbaikan**: Menyesuaikan penanganan gambar dokumentasi agar mendukung Data URL terautentikasi.

### 9. `src/pdf/correctivePdfService.ts`
- **Masalah**: Mengunduh gambar publik secara langsung tanpa menyertakan auth token S3.
- **Perbaikan**: Menggunakan `fetchAuthenticatedImageBlob` untuk mengonversi foto privat S3 menjadi Data URL sebelum dirender ke dalam PDF.

### 10. `src/services/evidenceService.ts`
- **Masalah**: Tipe `CorrectiveEvidenceBatchResult` tidak menyimpan status hasil per-foto (`uploaded_results`), menyebabkan upload parsial tidak dapat melacak foto mana yang sukses/gagal.
- **Perbaikan**: Menambahkan bidang `uploaded_results?: (string | null)[]` pada interface dan return statement fungsi upload batch.

### 11. `src/utils/collageService.ts`
- **Masalah**: Menggunakan gambar placeholder/fallback jika pemuatan foto asli gagal, menghasilkan kolase tidak lengkap yang seolah-olah valid.
- **Perbaikan**: Membatalkan pembuatan kolase jika ada foto asli yang gagal dimuat, serta menyimpan daftar foto yang gagal untuk proses retry.

### 12. `src/utils/evidenceUtils.ts`
- **Masalah**: Cache local presigned URL tidak memeriksa expiry token, serta penanganan error 401/403 yang kurang baik.
- **Perbaikan**: Memperbaiki validasi expiry cache presigned URL, memastikan pembersihan Blob URL saat logout/pindah identitas, dan menggunakan authenticated proxy URL.

---

## 2. File Baru Dibuat

1. `/EVIDENCE_FIX_V11.md` — Dokumentasi komprehensif seluruh perbaikan V11.
2. `/scripts/testEvidenceRepair.mjs` — Skrip pengujian otomatis unit & logika evidence, hashing kolase, dan cache S3.

---

## 3. Verifikasi Status (`lint_applet`)
- **Command**: `npm run lint` (`tsc --noEmit`)
- **Hasil**: **PASS (0 Error)**
