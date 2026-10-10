# PROJECT HANDOFF DOCUMENTATION

**Current Version**: `v0.7.0 — SUPABASE POSTGRESQL & IDCLOUDHOST S3 OBJECT STORAGE STABLE`

Dokumen ini disusun sebagai panduan transfer konteks teknis dan arsitektural proyek **Sistem Laporan Maintenance & Inspection PT Nararya Teknologi Indonesia**. Dokumen ini bertujuan agar developer dan maintainer dapat melanjutkan pemeliharaan dan pengembangan tanpa kehilangan konteks, mematahkan fitur yang ada, atau merusak standar pelaporan operasional bandara yang telah disepakati.

---

## 1. PROJECT OVERVIEW

- **Version Status**: `v0.7.0 — SUPABASE POSTGRESQL & IDCLOUDHOST S3 OBJECT STORAGE STABLE`
  - **Database Utama**: 100% Supabase PostgreSQL (`preventive_records`, `corrective_records`, `attendance_records`, `technicians`, `equipments`, `locations`, `checklist_frequencies`, `checklist_items`).
  - **Penyimpanan Dokumentasi / Evidence Foto**: **IDCloudHost Object Storage S3** (`https://is3.cloudhost.id`) menggunakan `@aws-sdk/client-s3`.
  - **Autentikasi & Akun**: Supabase Auth + Tabel `technicians` mandiri (Supervisor / Teknisi) dilengkapi fitur **Toggle Show/Hide Password** di semua form login.
  - **Bot Notifikasi**: Telegram Bot API untuk broadcast Daily Briefing, Presensi Masuk/Pulang, dan Alert Kerusakan Alat.
  - **Engine Dokumen**: Vector PDF murni di sisi browser via `@react-pdf/renderer` & Server-side Puppeteer fallback, serta Rekap Excel via `ExcelJS`.

- **Nama / Tujuan Aplikasi**: System Maintenance & Inspection Reporting — PT Nararya Teknologi Indonesia. Aplikasi web operasional internal untuk mencatat *Preventive Maintenance* harian dan *Corrective Maintenance* peralatan keamanan penerbangan di bandara (XRAY, WTMD, HHMD, ETD) serta merangkumnya menjadi Laporan Format Teks WhatsApp, Laporan Resmi PDF siap cetak/share, dan rekapitulasi Excel.

- **User Utama**:
  1. **Teknisi On Duty**: Mengisi presensi kehadiran (GPS & live-cam selfie), mengisi form pemeliharaan preventif per alat, mengunggah foto dokumentasi/kolase ke IDCloudHost S3, mencatat gangguan/penanganan korektif.
  2. **Supervisor / Management**: Meninjau status peralatan di Dashboard, mengelola data master, memilih shift & teknisi piket, memverifikasi liveness/anomali, mengonfigurasi storage IDCloudHost & Telegram Bot, serta mengekspor/berbagi Laporan PDF, Excel, dan Teks WhatsApp.

- **Workflow Utama**:
  1. Login Akun (Pilih Teknisi Cepat / Input Manual / Tambah Akun Baru dengan Toggle Intip Sandi).
  2. Presensi Masuk Shift (Verifikasi GPS Radius Bandara & Foto Selfie Live Cam tersimpan ke S3).
  3. Input Checklist & Pengukuran Parameter Alat (Preventive) / Laporan Kerusakan (Corrective).
  4. Kompresi Gambar & Upload Otomatis ke Bucket IDCloudHost S3 (`preventive/YYYY-MM-DD/`, `corrective/YYYY-MM-DD/`).
  5. Preview Report Otomatis (Format Teks WhatsApp + Matrix PDF A4 Vector + Rekap Excel).
  6. Broadcast Notifikasi Otomatis ke Grup Telegram Operasional.

---

## 2. TECH STACK

### Frontend
- **React**: `v19.0.1` (Single Page Application dengan Functional Components & Hooks)
- **TypeScript**: `~5.8.2` (Strict type definition across models, props, and report structures)
- **Vite**: `v6.2.3` (Development server & production bundling engine)
- **Tailwind CSS**: `v4.1.14` (dengan `@tailwindcss/vite` v4.1.14 & `@import "tailwindcss";` di `src/index.css`)
- **Lucide React**: `v0.546.0` (UI Vector Icons)
- **Motion**: `v12.23.24` (Layout animations)
- **Recharts**: `v3.10.1` (Grafik tren parameter tegangan & arus generator X-Ray)

### Backend & Cloud Storage
- **Database Utama**: Supabase PostgreSQL dengan Row Level Security (RLS) & REST API `@supabase/supabase-js`
- **Object Storage S3**: IDCloudHost Object Storage (`https://is3.cloudhost.id`) via `@aws-sdk/client-s3` (`PutObjectCommand`, `ListBucketsCommand`, `CreateBucketCommand`)
- **Node.js Express Server**: `server.ts` (API storage proxy, Telegram webhook/polling, dan Puppeteer PDF generator)
- **Local Persistence & Offline Sync**: IndexedDB (`idb`) + LocalStorage fallback

### PDF & Document Engine
- **@react-pdf/renderer**: `^4.6.0` (Vector PDF rendering engine murni di browser client)
- **ExcelJS**: `^4.4.0` (Advanced Excel multi-sheet reporting)
- **Puppeteer**: Server-side Headless Chromium Vector PDF fallback

---

## 3. STRUKTUR PROJECT

```
/
├── .env.example                # Template variabel lingkungan (Supabase, IDCloudHost S3, Telegram)
├── index.html                  # HTML entry point Vite
├── metadata.json               # Metadata aplikasi Google AI Studio
├── package.json                # Dependensi npm & script build/dev
├── server.ts                   # Backend Express + IDCloudHost S3 Proxy + Telegram Bot + Puppeteer PDF
├── logopt.png                  # Asset logo resmi PT Nararya Teknologi Indonesia (Root copy)
├── public/
│   ├── logopt.png              # Asset logo publik untuk static serving
│   └── manifest.json           # PWA Manifest
├── src/
│   ├── App.tsx                 # Root State Controller, Router Tab, Modal Orchestrator
│   ├── main.tsx                # React DOM render entry point
│   ├── index.css               # Global CSS & Tailwind CSS v4 setup
│   ├── types.ts                # Definisi tipe TypeScript aplikasi
│   ├── lib/
│   │   └── supabase.ts         # Inisialisasi Supabase Client & Helper Status
│   ├── components/
│   │   ├── AttendanceScreen.tsx # Modul Presensi Selfie Cam + GPS Radius + Upload S3
│   │   ├── CorrectiveView.tsx   # Modul Penanganan Gangguan & Penggantian Komponen
│   │   ├── DashboardView.tsx    # Dashboard Status Kesiapan Alat & Shift Aktif
│   │   ├── Header.tsx           # Bar Navigasi Atas & Status Sinkronisasi
│   │   ├── LoginScreen.tsx      # Layar Login (Pilih Akun / Manual / Register + Toggle Eye Icon)
│   │   ├── MasterDataView.tsx   # Manajemen Data Master (Alat, Lokasi, Item Checklist, Akun)
│   │   ├── PreventiveView.tsx   # Form Inspeksi Checklist & Input Parameter X-Ray
│   │   ├── ReportView.tsx       # Preview & Ekspor Laporan (PDF Vector, Excel, WhatsApp)
│   │   ├── Sidebar.tsx          # Navigasi Menu & Quick Actions
│   │   ├── StorageConfigModal.tsx # Panel Konfigurasi IDCloudHost Object Storage S3
│   │   ├── SupervisorLoginModal.tsx # Modal Otoritas Supervisor (+ Toggle Eye Icon)
│   │   ├── TelegramBotModal.tsx # Panel Konfigurasi Bot Telegram & Tes Notifikasi
│   │   └── corrective/ & preventive/ # Sub-komponen form & galeri foto
│   ├── hooks/
│   │   └── useAppDataSync.ts    # Hook sinkronisasi data master & transaksi Supabase
│   ├── pdf/
│   │   ├── pdfService.ts        # Service pembuatan & pengunduhan PDF vector client + S3 archive
│   │   └── PdfDocument.tsx      # Template layout PDF berstandar formal A4
│   ├── services/
│   │   ├── attendanceService.ts # Logika presensi & sinkronisasi Supabase
│   │   ├── authService.ts       # Logika autentikasi Supabase & tabel technicians
│   │   ├── correctiveRepository.ts # Repository Corrective (Supabase PostgreSQL)
│   │   ├── evidenceService.ts   # Kompresi & Upload Evidence ke IDCloudHost S3
│   │   ├── excelReportGenerator.ts # Generator file Excel (.xlsx) via ExcelJS
│   │   ├── preventiveRepository.ts # Repository Preventive (Supabase PostgreSQL)
│   │   ├── reportService.ts     # Pemroses data terstruktur laporan & teks WA
│   │   ├── storageService.ts    # Klien service IDCloudHost Object Storage S3
│   │   └── telegramService.ts   # Klien service integrasi Telegram Bot API
│   └── utils/
│       ├── watermark.ts         # Pemberi stempel waktu, lokasi GPS & kompresor foto
│       ├── imageCompressor.ts   # Utilitas kompresi foto (1280px, JPEG 0.78)
│       └── technicianSchedule.ts # Logika resolusi jadwal & shift otomatis
└── supabase/                    # Skema SQL, migrasi, dan konfigurasi RLS
```

---

## 4. SISTEM PENYIMPANAN EVIDENCE FOTO (IDCLOUDHOST OBJECT STORAGE S3)

### Arsitektur Alur Penyimpanan Foto:
```
[ Kamera HP / File Upload ]
            │
            ▼
[ Watermark & Image Compressor ] ➔ Max 1280px, JPEG 78% (~100-200 KB)
            │
            ▼
[ POST /api/storage/upload ] ➔ Proxy Backend Express (Aman: Secret Key di Server)
            │
            ▼
[ AWS S3 Client SDK (@is3.cloudhost.id) ]
            │
    ┌───────┴───────────────────────┬────────────────────────┐
    ▼                               ▼                        ▼
attendance/YYYY-MM-DD/     preventive/YYYY-MM-DD/    corrective/YYYY-MM-DD/
    │                               │                        │
    └───────────────────────┬───────┴────────────────────────┘
                            ▼
      [ Public S3 URL Generated (ACL: public-read) ]
                            │
                            ▼
    [ Disimpan ke Supabase DB & Ditampilkan di Laporan PDF/Excel ]
```

### Konfigurasi Default IDCloudHost S3:
- **Endpoint**: `https://is3.cloudhost.id`
- **Region**: `us-east-1` (atau region default IDCloudHost)
- **Access Key ID**: Dikonfigurasi di `.env` / modal setting
- **Bucket**: `nti-evidence-storage` (dapat dibuat langsung via tombol `+ Buat Bucket` di modal aplikasi)
- **Path Style**: `forcePathStyle: true` (wajib untuk Ceph Object Storage IDCloudHost)

---

## 5. FITUR AUTENTIKASI & KEAMANAN

1. **Layar Login Multifungsi (`LoginScreen.tsx`)**:
   - **Tab 1 (Pilih Akun)**: Memilih cepat teknisi/supervisor yang terdaftar di tabel `technicians` Supabase.
   - **Tab 2 (Input ID Manual)**: Login menggunakan Nama, Kode ID (contoh: `TECH-01`), atau Email.
   - **Tab 3 (+ Akun Baru)**: Pendaftaran langsung akun baru ke tabel `technicians`.
   - **Toggle Show/Hide Password**: Ikon mata (`Eye` / `EyeOff`) pada setiap kolom kata sandi.

2. **Modal Verifikasi Supervisor (`SupervisorLoginModal.tsx`)**:
   - Membuka hak akses supervisor (manajemen data master, pengaturan bot Telegram, konfigurasi storage S3).
   - Dilengkapi toggle intip kata sandi untuk kenyamanan pengetikan di layar sentuh perangkat mobile.

---

## 6. SISTEM LAPORAN & DOKUMEN

1. **Client-Side Vector PDF (`src/pdf/`)**:
   - Menggunakan `@react-pdf/renderer` yang merender langsung di browser teknisi.
   - Halaman A4 portrait berstandar administrasi penerbangan dengan header resmi, grid teknisi dinamis, catatan pengukuran generator, dan grid foto bukti.
   - Otomatis mengarsipkan salinan PDF ke folder `reports/YYYY-MM-DD/` di IDCloudHost S3 secara *non-blocking*.

2. **Ekspor Excel Multi-Sheet (`excelReportGenerator.ts`)**:
   - Format `.xlsx` berstandar industri dengan styling cell, border, auto-fit column, dan header resmi PT Nararya Teknologi Indonesia.

3. **Format Pesan WhatsApp (`reportService.ts`)**:
   - Auto-formatting teks siap kirim ke grup WhatsApp koordinasi dengan tombol satu ketukan *Copy Text* dan *Open WhatsApp*.

4. **Notifikasi Telegram Bot (`telegramService.ts`)**:
   - Notifikasi otomatis Daily Briefing pagi/malam, alert status alat abnormal (NG), dan presensi kehadiran.

---

## 7. CARA MENJALANKAN PROJECT

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Konfigurasi Environment (`.env`)
Salin dari `.env.example` dan lengkapi:
```env
PORT=3000
NODE_ENV=development

# Supabase
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SECRET_KEY=""

# IDCloudHost S3
IDCLOUDHOST_ENDPOINT="https://is3.cloudhost.id"
IDCLOUDHOST_ACCESS_KEY="your-access-key"
IDCLOUDHOST_SECRET_KEY="your-secret-key"
IDCLOUDHOST_BUCKET="nti-evidence-storage"
IDCLOUDHOST_REGION="us-east-1"

# Telegram Bot
TELEGRAM_BOT_TOKEN="your-bot-token"
TELEGRAM_CHAT_ID="your-group-chat-id"
```

### 3. Menjalankan Server Development
```bash
npm run dev
```
Buka browser di `http://localhost:3000`.

### 4. Build untuk Produksi
```bash
npm run build
npm run start
```

---

## 8. ATURAN PENGEMBANGAN PENTING (RULES FOR MAINTAINER)

1. **TIDAK ADA Google Apps Script / Google Drive / Firebase**:
   - Seluruh kode GAS dan Google Drive telah dihapus sepenuhnya.
   - Jangan menambahkan kembali pustaka Google Drive atau Firebase. Seluruh penyimpanan foto **wajib** melalui IDCloudHost S3 (`storageService.ts` / `evidenceService.ts`).

2. **Sanitasi Base64 Sebelum Simpan ke Database**:
   - Fungsi `sanitizePreventiveEvidencesForSupabase` dan `sanitizeCorrectiveEvidencesForSupabase` memastikan tidak ada string Base64 raksasa yang masuk ke baris database PostgreSQL. Hanya URL S3 valid (`https://is3.cloudhost.id/...`) yang disimpan ke database.

3. **Kompresi Gambar Sebelum Upload**:
   - Semua gambar kamera wajib melewati `compressImage(base64, 1280, 0.78)` dan `addWatermarkToPhoto` sebelum diunggah agar ukuran file terjaga di kisaran ~100–200 KB.

4. **Keamanan Secret Key S3**:
   - Secret Access Key IDCloudHost S3 **tidak boleh** diekspos ke client bundle secara terbuka; selalu kirim upload via endpoint backend `/api/storage/upload`.
