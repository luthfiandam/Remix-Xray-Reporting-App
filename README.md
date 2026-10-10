# Sistem Laporan Pemeliharaan & Inspeksi Peralatan Bandara

[![Version](https://img.shields.io/badge/version-0.7.0-blue.svg)](CHANGELOG.md)
[![React](https://img.shields.io/badge/React-19.0.1-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2.3-646cff.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1.14-06b6d4.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20Auth-3ecf8e.svg)](https://supabase.com/)
[![IDCloudHost](https://img.shields.io/badge/Storage-IDCloudHost%20S3-orange.svg)](https://idcloudhost.com/)

Aplikasi web operasional internal **PT Nararya Teknologi Indonesia** untuk pencatatan *Preventive Maintenance* harian & berkala, serta *Corrective Maintenance* peralatan keamanan penerbangan (*X-Ray*, *Walk-Through Metal Detector*, *Hand-Held Metal Detector*, *Explosive Trace Detector*) di fasilitas bandara.

Aplikasi dirancang dengan antarmuka yang sangat responsif, optimal untuk **Desktop Monitoring Dashboard** maupun **Mobile Web Interface** pada ponsel pintar teknisi di lapangan.

---

## 🌟 Fitur Utama

### 1. Preventive Maintenance Reporting
- Formulir checklist inspeksi terstruktur (Harian, Mingguan, Bulanan, Triwulan, Semesteran, Tahunan).
- Pengukuran parameter generator X-Ray (*High Voltage kV*, *Heater Current mA*, *Anode Current uA*) untuk mode *Single View* dan *Dual View*.
- Otomatisasi pemberian *watermark* GPS dan stempel waktu presisi pada setiap foto dokumentasi.
- Kompresi gambar cerdas (1280px, ~150KB) sebelum diunggah ke cloud storage.

### 2. Corrective Maintenance & Linimasa Gangguan
- Pencatatan insiden kerusakan, tindakan penanganan teknisi, riwayat penggantian komponen, dan status akhir (*Resolved*, *Pending Sparepart*, *Temporary Fix*).
- Riwayat linimasa pemeliharaan alat (*Equipment Timeline*) terintegrasi yang menggabungkan seluruh catatan preventif dan korektif.

### 3. Presensi & Verifikasi Kehadiran Teknisi
- Verifikasi kehadiran teknisi berbasis *Geolocation (GPS)* dengan validasi radius area kerja bandara.
- Pengambilan foto selfie langsung dari kamera perangkat (*live-cam*) yang langsung diarsipkan ke cloud storage.

### 4. Penyimpanan Evidence Foto via IDCloudHost Object Storage S3
- Terintegrasi langsung dengan **IDCloudHost Object Storage (S3-Compatible)** di datacenter Indonesia dengan latensi sangat rendah.
- Struktur folder otomatis yang rapi:
  - `attendance/YYYY-MM-DD/` (Foto presensi kehadiran)
  - `preventive/YYYY-MM-DD/` (Foto bukti checklist preventif)
  - `corrective/YYYY-MM-DD/` (Foto bukti kerusakan & perbaikan)
  - `reports/YYYY-MM-DD/` (Arsip salinan dokumen PDF)
- URL publik S3 disimpan permanen ke database Supabase PostgreSQL.

### 5. Ekspor Dokumen & Notifikasi Operasional
- **Client-Side Vector PDF Generator (`@react-pdf/renderer`)**: Menghasilkan dokumen PDF A4 berstandar formal penerbangan langsung di browser (tajam, vector murni, dan hemat bandwidth).
- **Ekspor Excel Multi-Sheet (.xlsx)**: Pembuatan rekapitulasi data pemeliharaan dalam format Excel via *ExcelJS*.
- **Ringkasan Teks WhatsApp**: Pembuatan format ringkasan laporan otomatis yang siap disalin dan dikirim ke grup koordinasi teknisi.
- **Telegram Bot Integration**: Broadcast otomatis Daily Briefing, notifikasi presensi, dan *alert* alat rusak langsung ke grup Telegram operasional.

### 6. Autentikasi Fleksibel & Keamanan
- Login cepat berbasis daftar akun teknisi atau input manual nama / kode ID.
- Fitur **Toggle Intip Kata Sandi (Eye Icon)** di semua kolom input password untuk kemudahan pengetikan di ponsel.
- Otoritas verifikasi khusus Supervisor untuk mengelola master data dan pengaturan sistem.

---

## 🛠️ Arsitektur & Tech Stack

### Frontend
- **Framework**: React `v19.0.1` (Single Page Application, Functional Components, Hooks)
- **Bahasa**: TypeScript `~5.8.2`
- **Build Tool**: Vite `v6.2.3`
- **Styling**: Tailwind CSS `v4.1.14` (`@tailwindcss/vite`)
- **Ikon & Animasi**: Lucide React `v0.546.0`, Motion `v12.23.24`
- **Grafik & Tren**: Recharts `v3.10.1`

### Backend & Cloud Infrastructure
- **Database Utama**: Supabase PostgreSQL dengan Row Level Security (RLS)
- **Object Storage**: IDCloudHost Object Storage S3 (`https://is3.cloudhost.id`) via `@aws-sdk/client-s3`
- **Backend API Server**: Node.js `v22.x` + Express `v4.21.2` (`server.ts`)
- **Offline / Local Cache**: IndexedDB + LocalStorage fallback
- **Notifikasi**: Telegram Bot API

---

## 📁 Struktur Direktori

```
├── public/                    # Asset statis publik (manifest.json, logopt.png)
├── src/
│   ├── assets/                # Asset gambar dan logo internal
│   ├── components/            # Komponen UI React
│   │   ├── corrective/        # Komponen modul Corrective Maintenance
│   │   ├── preventive/        # Komponen modul Preventive Maintenance
│   │   ├── report/            # Komponen tampilan laporan, PDF, dan Excel
│   │   ├── AttendanceScreen.tsx # Modul Presensi Selfie Cam + GPS Radius
│   │   ├── DashboardView.tsx  # Dashboard Monitoring & Status Alat
│   │   ├── LoginScreen.tsx    # Layar Login Akun + Toggle Eye Icon
│   │   ├── MasterDataView.tsx # Manajemen Master Data & Akun
│   │   ├── StorageConfigModal.tsx # Panel Konfigurasi IDCloudHost S3
│   │   ├── SupervisorLoginModal.tsx # Modal Akses Supervisor
│   │   └── TelegramBotModal.tsx # Panel Konfigurasi Bot Telegram
│   ├── hooks/                 # Custom React hooks (useAppDataSync)
│   ├── lib/                   # Klien Supabase
│   ├── pdf/                   # Template layout & generator PDF Vector
│   ├── services/              # Logika bisnis (Supabase, S3 Storage, Telegram, PDF, Excel)
│   ├── types/                 # Definisi antarmuka TypeScript
│   ├── utils/                 # Utilitas watermark, kompresi gambar, jadwal
│   ├── App.tsx                # Komponen root aplikasi
│   ├── main.tsx               # Titik masuk React DOM
│   └── index.css              # Konfigurasi Tailwind CSS v4
├── supabase/                  # Skrip skema database SQL & RLS
├── server.ts                  # Server Express untuk S3 Presigned Upload Proxy, Telegram, dan API Backend
├── .env.example               # Template environment variables
├── package.json               # Konfigurasi dependensi dan skrip npm
├── tsconfig.json              # Konfigurasi TypeScript
└── vite.config.ts             # Konfigurasi Vite bundler
```

---

## 🚀 Panduan Memulai

### 1. Kloning & Instalasi Dependensi
```bash
npm install
```

### 2. Salin Konfigurasi Environment
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Lengkapi variabel lingkungan:
- `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (Koneksi Supabase)
- `IDCLOUDHOST_ACCESS_KEY` dan `IDCLOUDHOST_SECRET_KEY` (Kredensial S3 IDCloudHost)
- `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` (Integrasi Telegram)

### 3. Jalankan Mode Development
```bash
npm run dev
```
Aplikasi akan berjalan di `http://localhost:3000`.

### 4. Build untuk Lingkungan Produksi (PM2 / Systemd)
```bash
# 1. Install dependensi
npm install

# 2. Build frontend SPA
npm run build

# 3. Jalankan server produksi via PM2
pm2 start "npm run start" --name "xray-reporting-app"
# atau restart instance PM2
pm2 restart "xray-reporting-app"
```

---

## 📄 Lisensi
Proyek internal dikembangkan khusus untuk **PT Nararya Teknologi Indonesia**. Seluruh hak cipta dilindungi.
