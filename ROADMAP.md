# ROADMAP X-RAY REPORTING APP

**Last Updated:** 23 Agustus 2026

---

# CURRENT ARCHITECTURE

```text
React + Vite + Cloud Run (Port 3000)
          │
          ├── Firebase Auth & Firestore (Source of Truth)
          │       ├── users/{uid} (Otorisasi & Profil)
          │       ├── preventive_records (Preventive Reports)
          │       └── corrective_records (Corrective Reports)
          │
          ├── Google Apps Script (Asset Upload Bridge)
          │       └── Google Drive (Direct File Storage for photos/PDFs)
          │
          └── localStorage
                  └── CACHE ONLY
```

Saat ini:

```text
Cloud Firestore = SOURCE OF TRUTH (Data & Auth)
Google Drive    = FILE STORAGE (Evidence & Photos)
```

---

# v0.6.3 — FIRESTORE CUTOVER STABLE

**Status: STABLE / PRODUCTION VERIFIED**

Target:
- **Source of Truth**: Firestore is the full source of truth for both Preventive and Corrective records.
- **Cache-Only**: localStorage serves purely as a local cache, reconciled with remote records upon startup.
- **Zero Dual Writes**: Direct Sheet write API endpoints are completely disabled for the runtime.
- **Evidence Repository**: Photo evidence is managed directly via Apps Script's Drive upload bridge.

---

Menstabilkan arsitektur Google Sheets + Google Drive sebelum migrasi Firebase.

## Implementasi selesai

* [x] Google Sheets + Google Drive cloud integration
* [x] Preventive cloud sync
* [x] Corrective cloud sync
* [x] Context filtering
* [x] Cross-device reconstruction
* [x] Frontend submit lock
* [x] GAS `LockService`
* [x] Anti double-submit
* [x] Return ke Equipment List setelah Submit/Edit
* [x] Success modal → top toast
* [x] CloudSync logging cleanup
* [x] Unified Google Drive root
* [x] PDF Drive archive
* [x] PDF in-place overwrite
* [x] Logo PDF `public/logo_nti.png`
* [x] GitHub Pages `VITE_GAS_API_URL`
* [x] Browser title → `Xray Reporting App`

## Stabilisasi tambahan selesai

* [x] Startup cloud sync guard
* [x] Canonical record identity
* [x] Shift normalization
* [x] Period key normalization
* [x] ISO-8601 Week
* [x] Optimistic concurrency menggunakan `updated_at`
* [x] Conflict handling frontend
* [x] Audit image compression
* [x] Audit localStorage/base64
* [x] Public destructive GAS endpoint removed
* [x] PDF archive logic audit
* [x] TypeScript validation
* [x] Production build validation

## Acceptance test yang masih perlu dilakukan

* [ ] Spam Submit → tetap 1 record
* [ ] Dua browser submit record sama → tetap 1 record
* [ ] Concurrent edit → stale browser mendapatkan `CONFLICT`
* [ ] Preventive cross-device
* [ ] Corrective cross-device
* [ ] Completed badge seluruh interval
* [ ] Shift isolation
* [ ] Dataset isolation
* [ ] PDF create
* [ ] PDF edit → overwrite file yang sama
* [ ] Drive File ID tetap sama setelah overwrite
* [ ] WhatsApp report regression
* [ ] Mobile regression
* [ ] Tablet regression
* [ ] Desktop regression

## Release condition

Jika seluruh acceptance test lolos:

```text
v0.5.1 — STABLE
```

Kemudian buat backup/tag sebelum migrasi Firebase:

```text
v0.5.1
v0.5.1-pre-firebase
```

---

# v0.5.2-beta.1 — WEB SHARE EXPERIMENT

**Status: IMPLEMENTATION COMPLETE / MOBILE RUNTIME VALIDATION PENDING**

Dikerjakan hanya setelah v0.5.1 lolos acceptance test.

Target:

```text
WhatsApp text
+
gambar kolase
        ↓
Native Share Sheet
```

Implementasi:

```javascript
navigator.share({
  text,
  files
})
```

Scope:

* [x] Android & iPhone/iOS support
* [x] Web Share API integration (`src/utils/webShareUtils.ts`)
* [x] Image Collage File sharing (`src/utils/collageService.ts`)
* [x] Automatic fallback ke WhatsApp web/link jika file sharing tidak tersedia
* [x] Silent graceful handling saat user cancel share dialog

Rule:

```text
Tidak boleh mengganggu:
- WhatsApp report existing
- PDF
- kolase
- Drive archive
```

---

# v0.6.0 — FIREBASE MIGRATION

**Status: IN PROGRESS**

## Tujuan

Mengubah source of truth aplikasi dari:

```text
Google Sheets
```

menjadi:

```text
Firebase Firestore
```

Google Drive tetap digunakan sebagai penyimpanan file.

Target akhir:

```text
React + Vite + GitHub Pages
          │
          ├── Firebase Firestore
          │       ├── Preventive
          │       ├── Corrective
          │       ├── Master Data
          │       ├── Status
          │       └── Drive Metadata
          │
          └── Google Apps Script
                  │
                  └── Google Drive
                          ├── PDF
                          ├── Kolase
                          └── Foto
```

---

# v0.6.1 — FIREBASE FOUNDATION

**Status: IMPLEMENTATION COMPLETE / FIREBASE CONFIGURED / FIRESTORE FOUNDATION READY**

Setup:

* [x] Official Firebase Web SDK (`firebase`) installed
* [x] Environment configuration (`.env` & `.env.example`)
* [x] Official Firebase Web App configuration linked
* [x] Reusable single initialization module (`src/lib/firebase.ts`)
* [x] Environment validation with zero production crash impact
* [x] TypeScript Firestore Schema & Data Models (`src/types/firestore.ts`)
* [x] Firestore Security Rules baseline: DENY BY DEFAULT (`firestore.rules`)
* [x] Firestore index & tool config (`firestore.indexes.json`, `firebase.json`)

Collection schema ready:

```text
preventive_records
corrective_records

equipment
equipment_types
locations

checklist_templates
measurement_templates

settings
```

Pada tahap ini:

```text
Google Sheets masih SOURCE OF TRUTH
Google Drive masih FILE STORAGE
```

Firestore hanya fondasi/prototype.

Tidak ada dual-write production, runtime Firestore CRUD, realtime listener, atau Firebase Auth pada versi ini.

---

# v0.6.2 — PREVENTIVE → FIRESTORE

**Status: COMPLETE (PREVENTIVE RUNTIME CUTOVER VALIDATED / FIRESTORE SOURCE OF TRUTH / ZERO DUAL-WRITE)**

* [x] Audit & Repository Abstraction (`src/services/preventiveRepository.ts`)
* [x] Google Sheets Adapter (`SheetsPreventiveRepository`)
* [x] Firestore Adapter (`FirestorePreventiveRepository`)
* [x] Deterministic Document ID Generator (`buildPreventiveDocumentId`)
* [x] Optimistic Concurrency Protection via Firestore Transactions
* [x] Bidirectional Domain ↔ Firestore Mapper (`src/services/preventiveMapper.ts`)
* [x] One-Time Idempotent Migration Tool (`scripts/migratePreventiveToFirestore.ts`, `npm run migrate:preventive`)
* [x] v0.6.2A Secure Firebase Admin Initialization (`scripts/lib/firebaseAdmin.ts`)
* [x] v0.6.2A.1 Date & Time Normalization Utility (`src/utils/dateTimeUtils.ts`)
  - Canonical business date `YYYY-MM-DD` (`operational_date`)
  - Normalized submission ISO-8601 moment-in-time timestamp (`submitted_at`)
  - Complete elimination of 1899/1900 spreadsheet serial epoch artifacts
  - Night shift calendar day calculation (00:00–06:59 -> opDate + 1)
  - Historical timestamp preservation (`created_at`, `updated_at`)
* [x] v0.6.2B Secure Firestore Client Access Foundation
  - Identity separation: Firebase User (Principal) vs User Profile (`users/{uid}`) vs RBAC Role (`technician` | `supervisor`)
  - Centralized Auth Service (`src/services/authService.ts`, `src/types/auth.ts`, `src/lib/firebase.ts`)
  - Granular Firestore Security Rules with RBAC and Default Deny fallback (`firestore.rules`)
  - Zero client-side role or profile modification permissions (`users/{userId}` write denied for clients)
  - Admin User Provisioning CLI tool (`scripts/provisionUser.ts`, `npm run auth:provision`)
  - Automated Security Audit script (`scripts/testFirestoreAuth.ts`, `npm run auth:test`)
  - Zero private key / Admin SDK leak in browser bundle
* [x] v0.6.2B.1 Authorized User & RBAC Runtime Validation
  - Unauthenticated Access: DENIED
  - Unknown Authenticated User: DENIED
  - Inactive User: DENIED
  - Authenticated Active Technician: ALLOWED
  - Authenticated Active Supervisor: ALLOWED
  - Profile Client Write (Privilege Escalation): DENIED
  - Preventive Delete: DENIED
  - Public Access: NONE
* [x] Migration Dry-Run & JSON Audit Reporting (`migration-reports/`)
* [x] Security Gate Validation (Enforces `deny by default`, blocks unauthenticated browser writes)
* [x] Explicit Backend Selector (`VITE_PREVENTIVE_BACKEND=sheets`, production remains stable on Google Sheets)
* [x] Zero Dual-Write, Zero Public Access Bypass
* [x] v0.6.2C Preventive Runtime Cutover Complete
  - Live Firestore Read: PASS
  - No Dual Write: PASS
  - Preventive Firestore Write: PASS
  - Corrective Regression: PASS
  - Google Drive File Layer: PASS
  - Preventive Source of Truth: FIRESTORE
  - Corrective Source of Truth: GOOGLE SHEETS
  - Runtime Dual Write: NONE
  - Automatic Fallback: NONE

**v0.6.2 — PREVENTIVE → FIRESTORE: COMPLETE**
**v0.6.3 — CORRECTIVE → FIRESTORE: NOT STARTED**

Preventive menjadi modul pertama yang dimigrasikan.

Canonical identity:

```text
dataset_id
+
equipment_id
+
checklist_frequency_id
+
period_key
+
normalized_shift
```

Gunakan deterministic document ID.

Contoh:

```text
preventive_records/
└── default_9_1_2026-08-18_PS
```

Behavior:

```text
submit pertama
→ create document

submit berikutnya
→ update document yang sama
```

Tidak ada konsep append row.

Target migrated:

* Submit
* Edit
* Completed Badge
* Reports
* Dashboard
* Cross-device

---

# v0.6.3 — CORRECTIVE → FIRESTORE

**Status: IN PROGRESS (FOUNDATION STABILIZED / READY FOR MIGRATION v0.6.3D)**

* [x] v0.6.3A Corrective Existing Audit
  - Complete inventory of all Sheets columns & GAS payload contracts
  - Shift notation audit (`Pagi` / `Malam` vs canonical `PS` / `M`)
  - Concurrency mechanism audit (`LockService` in GAS vs `runTransaction` in Firestore)
  - Evidence photo flow audit (`uploadPhoto` vs `saveCorrectiveRecord`)
* [x] v0.6.3B Corrective Canonical Identity & Firestore Schema Design
  - Canonical Technical Identity: `event_id` (UUIDv4) and `document_id` (`${dataset_id}_cr_${event_id}`)
  - Secondary Business Identity: `corrective_code` (`CR-YYYYMMDD-XXX`)
  - Compatibility Key: `record_id` (legacy UI key)
  - Shift Storage Standard: `PS` | `M` in Firestore, `Pagi` | `Malam` in Domain
* [x] v0.6.3C Corrective Repository Foundation
  - Repository abstraction (`src/services/correctiveRepository.ts`)
  - Active Sheets Adapter (`SheetsCorrectiveRepository`)
  - Isolated Firestore Adapter (`FirestoreCorrectiveRepository`)
  - Mapper utility (`src/services/correctiveMapper.ts`)
  - Environment backend selector (`VITE_CORRECTIVE_BACKEND=sheets`)
* [x] v0.6.3C.1 Corrective Repository Foundation Stabilization
  - Strict string UUID `event_id` / `document_id` without integer conversions
  - Canonical `PS` | `M` shift normalization on Firestore boundary
  - Drive-only evidence upload path via GAS `uploadPhoto` action
  - Defense-in-depth base64 guard rejecting base64 storage in Firestore
  - Zero regression on active Sheets runtime (`VITE_CORRECTIVE_BACKEND=sheets`)
* [x] v0.6.3D.1 Corrective Migration Preflight + Dry Run
  - Tooling: `scripts/migrateCorrectiveToFirestore.ts` (`npm run migrate:corrective`)
  - Identity Strategy: `event_id = legacy_{record_id}`, `document_id = {dataset_id}_cr_legacy_{record_id}`
  - Zero writes to Firestore (`Firestore Writes: 0`)
  - Zero base64 evidence allowed into candidate documents
  - Strict field normalization (date, shift PS/M, time HH:mm, technicians, timestamps)
  - Deterministic content fingerprinting & 100% idempotency verification
  - Migration Gate: PASS
* [ ] v0.6.3D.2 Corrective Secure Admin Migration
* [ ] v0.6.3E Corrective Runtime Cutover Validation

Target collection:

```text
corrective_records/
└── default_cr_7f8e3b1c-9a20-41d8-8c1e-3b2a1c0d4e5f
```

---

# v0.6.4 — AUTOMATIC TECHNICIAN ON DUTY & MULTI-TECHNICIAN ROSTER

**Status: COMPLETE / PRODUCTION VERIFIED**

Implementations:
- **Automatic Shift & Operational Date Resolution**: Implemented robust timezone-aware (Asia/Jakarta, GMT+7) boundary calculation with a 07:00 WIB morning transition.
- **Roster & Multiple Technicians On Duty**: Developed a Firestore-based roster architecture supporting multiple concurrent technicians per shift.
- **Seven Distinct Assignment Statuses**: Supports `scheduled`, `backup`, `overtime`, `off`, `leave`, `sick`, `permission`.
- **Supervisor Override & Removal Semantics**: Built an interactive checkbox-based scheduling interface for supervisors, writing `status: 'off'` for removal (retaining immutability rules).
- **Hardcoded Fallback Removal**: No default technician names are used. Displays "Jadwal teknisi untuk shift ini belum tersedia" if no schedule is found.
- **Preventive & Corrective Integration**: On-duty technician snapshotting during report creations.
- **Dual-Suite Automated Verification**: Includes `npm run schedule:test` running 30 automated security (10) and functional boundary (20) validation cases with 100% success.

---

# v0.6.4 — REALTIME CROSS-DEVICE SYNC

**Status: DEFERRED FOR ROSTER MANAGEMENT**

Hapus flow kompleks:

```text
fetch Google Sheets
↓
merge localStorage
↓
context filtering
↓
reconstruction
```

Ganti dengan:

```text
Firestore
↓
Realtime Listener
↓
React State
```

Flow:

```text
Browser A
   │
   │ Submit
   ▼
Firestore
   │
   ├───────────────┐
   ▼               ▼
Browser A       Browser B
```

Expected:

```text
submit / edit
→ device lain langsung update
→ tanpa refresh
```

---

# v0.6.5 — LOCAL CACHE SIMPLIFICATION

**Status: PLANNED**

Setelah Firestore stabil:

hapus penggunaan localStorage sebagai database kedua.

localStorage hanya untuk:

```text
UI preferences
selected technician
selected dataset
temporary UI state
temporary form state
```

Data laporan:

```text
Firestore
```

Jika offline support dibutuhkan:

```text
Firestore Offline Persistence
```

bukan custom localStorage database.

---

# v0.6.6 — GOOGLE DRIVE FILE BRIDGE

**Status: PLANNED**

Google Apps Script tidak lagi menangani database record.

GAS hanya untuk operasi file.

Target endpoint:

```text
upload_photo
upload_pdf
upload_collage
update_pdf
```

Legacy CRUD berikut mulai dipensiunkan:

```text
savePreventiveRecord
getPreventiveRecords

saveCorrectiveRecord
getCorrectiveRecords

deduplicatePreventive
```

Struktur Google Drive tetap:

```text
XRAY REPORTING APP/
│
├── 1. Laporan/
│   ├── 1. Laporan Harian/
│   ├── 2. Laporan Mingguan/
│   ├── 3. Laporan Bulanan/
│   ├── 4. Laporan Triwulan/
│   ├── 5. Laporan Semesteran/
│   └── 6. Laporan Tahunan/
│
└── 2. Foto Laporan/
    ├── 1. Foto Laporan Harian/
    ├── 1.1 Foto Laporan Corrective/
    ├── 2. Foto Laporan Mingguan/
    ├── 3. Foto Laporan Bulanan/
    ├── 4. Foto Laporan Triwulan/
    ├── 5. Foto Laporan Semesteran/
    └── 6. Foto Laporan Tahunan/
```

---

# v0.6.7 — DRIVE METADATA IN FIRESTORE

**Status: PLANNED**

Firestore tidak menyimpan binary file.

Firestore hanya menyimpan metadata.

Contoh evidence:

```json
{
  "drive_file_id": "...",
  "drive_url": "...",
  "file_name": "...",
  "type": "photo"
}
```

PDF:

```json
{
  "drive_file_id": "...",
  "drive_url": "...",
  "file_name": "...",
  "updated_at": "..."
}
```

Prinsip:

```text
Firestore = metadata
Google Drive = binary file
```

---

# v0.6.8 — FIREBASE AUTH & SECURITY

**Status: PLANNED**

Setelah migration data stabil:

implementasikan:

* Firebase Authentication
* Technician role
* Supervisor role
* Firestore Security Rules
* write validation
* optional Firebase App Check

Target:

```text
Unknown User
→ DENIED

Technician
→ operational data

Supervisor
→ operational + administrative access
```

Supervisor password tidak lagi dibandingkan di React bundle.

---

# v0.6.9 — GOOGLE SHEETS OPTIONAL

**Status: PLANNED**

Setelah seluruh aplikasi membaca Firestore:

```text
Firestore = SOURCE OF TRUTH
```

Google Sheets tidak lagi menjadi database aplikasi.

Jika masih diperlukan kantor:

```text
Firestore
↓
Export / Mirror
↓
Google Sheets
```

Sheets digunakan hanya untuk:

* monitoring
* administrative export
* manual report
* backup tambahan

Tidak boleh menjadi database paralel.

---

# v0.7.0 — FIREBASE STABILIZATION

**Status: PLANNED**

Full regression:

* [ ] Preventive Harian
* [ ] Preventive Mingguan
* [ ] Preventive Bulanan
* [ ] Preventive Triwulan
* [ ] Preventive Semesteran
* [ ] Preventive Tahunan
* [ ] Corrective
* [ ] Edit Data
* [ ] Concurrent Edit
* [ ] Realtime Sync
* [ ] Offline → Online
* [ ] PDF
* [ ] Foto
* [ ] Kolase
* [ ] WhatsApp
* [ ] Excel
* [ ] Dashboard
* [ ] Master Data
* [ ] Mobile
* [ ] Tablet
* [ ] Desktop

Stress test:

```text
500 records
1.000 records
5.000 records
```

Tambahan test:

```text
multiple devices
network interruption
reload during submit
duplicate request
stale edit
Drive upload failure
Firestore write failure
```

---

# v0.8.0 — LEGACY BACKEND CLEANUP

**Status: PLANNED**

Dilakukan hanya setelah Firebase terbukti stabil.

Hapus runtime legacy:

* Google Sheets CRUD
* manual sheet dedupe
* old cloud merge
* legacy fetch retry
* stale localStorage migration
* unused GAS CRUD endpoint
* deprecated cloud helper
* dead compatibility code

Sebelum cleanup:

```text
create full backup
+
create Git tag
```

---

# v0.9.0 — PRODUCTION CANDIDATE

**Status: PLANNED**

Feature freeze.

Tidak ada fitur baru.

Fokus:

* bugs
* security
* performance
* data integrity
* UX regression
* recovery testing
* failure handling

Target:

```text
Release Candidate
```

---

# v1.0.0 — PRODUCTION

**Status: TARGET**

Final architecture:

```text
                    X-RAY REPORTING APP

React + Vite + GitHub Pages
             │
             ├────────────────────────────┐
             │                            │
             ▼                            ▼
     Firebase Firestore           Google Apps Script
        DATABASE                     FILE BRIDGE
             │                            │
             │                            ▼
             │                       Google Drive
             │                       ├── PDF
             │                       ├── Kolase
             │                       └── Foto
             │
             ▼
        Realtime Data
        ├── Preventive
        ├── Corrective
        ├── Master Data
        ├── Completion Status
        └── Drive Metadata
```

---

# MIGRATION RULE

Rule paling penting selama migrasi:

```text
JANGAN PERNAH:

Google Sheets = source of truth
+
Firestore = source of truth
```

Tidak boleh ada dua database utama.

Migration harus berupa:

```text
OLD

Google Sheets
SOURCE OF TRUTH
      │
      │ controlled migration
      ▼
Firestore
SOURCE OF TRUTH

NEW
```

Google Drive tidak perlu dimigrasikan.

Google Drive tetap menjadi file storage dari awal sampai production.

---

# CURRENT NEXT STEP

Posisi project sekarang:

```text
v0.6.2
PREVENTIVE → FIRESTORE
✅ COMPLETE

v0.6.2C.3
AUTH-AWARE FIRESTORE STARTUP HOTFIX
✅ COMPLETE

v0.6.3A
CORRECTIVE EXISTING AUDIT
✅ COMPLETE

v0.6.3B
CORRECTIVE CANONICAL IDENTITY & FIRESTORE SCHEMA DESIGN
✅ COMPLETE

v0.6.3C
CORRECTIVE REPOSITORY FOUNDATION
✅ COMPLETE (Sheets runtime active, Firestore repository ready)
```

### v0.6.3C Status
* **Corrective Repository Contract:** IMPLEMENTED (`ICorrectiveRepository`)
* **Sheets Backend Adapter:** IMPLEMENTED (`SheetsCorrectiveRepository`)
* **Firestore Backend Adapter:** IMPLEMENTED (`FirestoreCorrectiveRepository`)
* **Event & Document ID:** IMPLEMENTED (collision-resistant `event_id` + `{dataset}_cr_{event_id}`)
* **Corrective Mapper:** IMPLEMENTED (`src/services/correctiveMapper.ts`)
* **Backend Factory:** IMPLEMENTED (`getCorrectiveRepository()`, defaults to `sheets`)
* **Current Corrective Source of Truth:** GOOGLE SHEETS (Unchanged runtime)
* **Preventive Source of Truth:** FIRESTORE
* **Files / Drive Storage:** GOOGLE DRIVE

## Development Rule

```text
v0.6.3C COMPLETED
```

Prioritas selanjutnya:

```text
1. v0.6.3D: Corrective Data Migration Script & Preflight Dry-Run
2. v0.6.3E: Corrective Runtime Cutover & App Integration
3. v0.6.3F: Corrective Acceptance & Security Audit
```
