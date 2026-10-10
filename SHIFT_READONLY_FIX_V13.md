# DOKUMENTASI PERBAIKAN SHIFT & READ-ONLY MODE (VERSION 13)

## Ringkasan Perbaikan

Versi 13 menyempurnakan sistem otorisasi operasional shift dan penguncian mode **Read-Only / Pemantau** di seluruh modul aplikasi pelaporan X-Ray.

---

## 1. Perubahan & Perbaikan yang Dilakukan

### A. Backend & Keamanan (`server.ts`, `services/supabaseCorrectiveService.ts`)
- Mengunci endpoint API penulisan dan broadcast laporan (`/api/preventive/save`, `/api/corrective/save`, `/api/whatsapp/send-*`, `/api/send*`) dengan otorisasi shift server-authoritative (`requireOperationalReportWrite`).
- Menutup fallback penulisan langsung dari browser ke Supabase yang berpotensi melompati aturan jadwal shift.
- Mencegah teknisi *off-duty* mengirimkan pesan laporan atau mengunggah bukti perbaikan baru tanpa izin aktif.

### B. Antarmuka Pengguna & Frontend (`src/App.tsx`, `CorrectiveView.tsx`, `AvsecReportsView.tsx`, `ReportView.tsx`, `WhatsAppReportSection.tsx`, `PdfExportSection.tsx`)
- Meneruskan status `isViewerOnly` secara konsisten dari konteks jadwal `App.tsx` ke seluruh sub-komponen.
- Menonaktifkan tombol submit, edit, konversi laporan AVSEC, dan tombol kirim WhatsApp/Share saat teknisi dalam mode *Read-Only* (libur / di luar shift).
- Menyediakan spanduk pemberitahuan mode pemantau (*Read-Only Banner*) yang informatif bagi teknisi.

### C. Modul Preventif & Progress Upload (`PreventiveView.tsx`, `EquipmentSelectionSection.tsx`)
- Memperbaiki perhitungan indikator border hijau dan status selesai agar terisolasi dengan tepat per unit, interval, dan shift operasional.
- Menyempurnakan siklus hidup modal progress upload sehingga tertutup otomatis secara bersih setelah proses simpan selesai.

### D. PenandaNotifikasi Absensi (`services/whatsappService.ts`)
- Membedakan jenis pengiriman notifikasi foto presensi (`type: 'attendance'`) agar tidak terpengaruh oleh opsi penonaktifan laporan rutin.

---

## 2. File yang Ditingkatkan (12 Files)

1. `server.ts`
2. `src/App.tsx`
3. `src/components/CorrectiveView.tsx`
4. `src/components/AvsecReportsView.tsx`
5. `src/components/PreventiveView.tsx`
6. `src/components/preventive/EquipmentSelectionSection.tsx`
7. `src/components/ReportView.tsx`
8. `src/components/report/WhatsAppReportSection.tsx`
9. `src/components/report/PdfExportSection.tsx`
10. `src/components/report/types.ts`
11. `src/services/supabaseCorrectiveService.ts`
12. `src/services/whatsappService.ts`

---

## 3. File Baru (3 Files)

1. `SHIFT_READONLY_FIX_V13.md` — Dokumentasi perbaikan dan langkah verifikasi.
2. `scripts/testShiftReadOnlyV13.mjs` — Pengujian logika shift, izin backend, dan indikator interval.
3. `scripts/sql/manual_restrict_report_writes_v13.sql` — SQL opsional untuk mengunci penulisan langsung ke tabel Corrective dan AVSEC.

---

## 4. Instruksi Pengujian Manual

1. **Pengujian Shift Aktif (On-Duty)**:
   - Login sebagai teknisi bertugas pada shift aktif.
   - Buka menu Preventif / Corrective / AVSEC.
   - Pastikan tombol input, edit, simpan, dan kirim WA berfungsi normal.

2. **Pengujian Off-Duty (Read-Only)**:
   - Buka aplikasi saat teknisi tidak terdaftar di shift aktif (misal status Libur/Off-Duty).
   - Pastikan spanduk Mode Pemantau (*Read-Only*) tampil.
   - Pastikan seluruh tombol input, edit, konversi AVSEC, dan kirim WA terkunci / disabled.

3. **Verifikasi Sintaks**:
   - Jalankan `npm run lint` / `tsc --noEmit` untuk memastikan tidak ada kesalahan tipe.
