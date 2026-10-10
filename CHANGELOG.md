# CHANGELOG

All notable changes to the **System Maintenance & Inspection Reporting — PT Nararya Teknologi Indonesia** will be documented in this file.

---

## [0.6.5A] - 2026-08-23

### Verified & Audited
- **Final Runtime Verification**: Ran complete verification and regression testing on v0.6.5 cache isolation and state hardening modifications.
- **Test Suite Acceptance**: Passed 18/18 Cache isolation tests (`npm run cache:test`), 30/30 Technician schedule tests (`npm run schedule:test`), 41/41 Security rules tests (`npm run rules:test`), and 5/5 Cutover tests (`npm run cutover:test`).
- **Stable Integration**: Confirmed no regression in Firebase Auth startup sequence, Firestore authority, operational clock timezone calculations, or multi-technician shift snap-shotted schedules.

## [0.6.5] - 2026-08-23

### Completed
- **Cache Isolation**: Created `/src/services/localCache.ts` with strict UID and Dataset namespaced caching (`nti_v1_user_{uid}_ds_{datasetId}_{key}`) to prevent cross-user leakage on shared workstations.
- **Client State Hardening**: Added malformed/truncated JSON healing, quota-exceeded write tolerance, and automatic Base64 image payload removal for synced data.
- **Async Session Race Protection**: Implemented fetch-first race guards in `syncFromCloud` to verify session and user match upon asynchronous resolutions, preventing late-resolving data from corrupting active or new sessions.

---

## [0.6.4A] - 2026-08-23

### Refactored & Completed
- **Multi-Technician Schedule Identity**: Shifted from single-document-per-shift schema to per-technician-assignment document identity (`{dataset_id}_{schedule_date}_{shift}_{technician_id}`).
- **Seven Valid Assignment Statuses**: Implemented full schema support for seven distinct technician assignment statuses (`scheduled`, `backup', `overtime`, `off`, `leave`, `sick`, `permission`).
- **Removal Semantics (Delete Denial Bypass)**: Enforced removal semantics by writing `status: 'off'` rather than attempting document deletion, respecting strict Firestore security rules (`allow delete: if false;`).
- **No-Schedule Fallback Safety**: Completely removed hardcoded default technician names from runtime scheduling logic. If no schedule exists in Firestore for the current shift/date, the resolver safely returns `[]` technicians, disables scheduling states (`scheduleAvailable = false`), and displays "Jadwal teknisi untuk shift ini belum tersedia."
- **Interactive Multi-Select Supervisor UI**: Upgraded the Supervisor Schedule Management workspace to support multi-select checkboxes and status dropdowns for all active technicians. Supervisors can configure complex rosters and commit them cleanly.
- **Preventive & Corrective Integration**: Configured report submissions to fully snapshot all currently resolved, on-duty technicians' IDs and names at the moment of creation.
- **Automated Verification**: Engineered a dual-suite comprehensive schedule verification runner (`npm run schedule:test`) checking 10 Security Rules (Suite A) and 20 critical functional boundary/shift/midnight scenarios (Suite B) with 100% success (30/30 PASS).

---

## [0.6.3G] - 2026-08-23

### Finalized & Verified
- **Architecture Finalization**: Verified end-to-end production pipeline: UI → Repository → Firestore. Checked that the active write path to Sheets for corrective reports is fully disabled (`0 runtime writes`).
- **Development Doctor Script**: Introduced a non-invasive environment doctor `/scripts/doctor.ts` (`npm run doctor`) verifying Node, `.env` selections, package structures, and Firebase CLI status.
- **Portability Audit**: Checked that fresh workstations can boot the system solely using `npm install`, copying `.env.example`, and logging in via `firebase login`.
- **Pre-Login Query Protections**: Re-verified zero pre-login queries on startup for both Preventive and Corrective backends.
- **Rules & Cutover Pass**: Verified rules test suite (41/41) and cutover test suite (5/5) are 100% stable.

---

## [0.6.3F] - 2026-08-23

### Stabilized & Cleaned
- **AI Attribution & Watermark Audit**: Performed complete repository search; removed unnecessary AI provenance strings from source files, preserving all required third-party legal license attributions.
- **Legacy Invariant Threshold**: Verified that `MAX_LEGACY_SEQUENTIAL_ID = 1000000000` is active and backed by strict boundary unit tests.
- **Logout Cleansing**: Enhanced `handleLogout` to purge in-memory corrective reports state alongside preventive entries, preventing leakage of protected session logs.
- **Local Cache Contract**: Re-verified `localStorage` contract as cache-only, prioritizing remote Firestore authoritative records on sync merge.

---

## [0.6.3E.1C] - 2026-08-21

### Verified & Audited
- **Security Gate & Live Rules Verification Analysis**:
  - Re-ran fresh 41-scenario automated security test suite (`npm run rules:test`) with 100% PASS (41/41).
  - Explicitly classified execution environment distinction: Cloud Run sandboxed container vs. Local User Machine. Confirmed deployment command must be issued from local user machine with interactive user credentials (`firebase deploy --only firestore:rules --project x-ray-reporting-app`).
  - Re-validated generic legacy identity strategy (`event_id = legacy_{legacyId}`, `document_id = {dataset_id}_cr_legacy_{legacyId}`) to eliminate duplicate risks in `v0.6.3E.2`.
  - Re-confirmed Fetch-First startup policy and auth-aware pre-login query protections.
  - Preserved active runtime source of truth on Google Sheets (`VITE_CORRECTIVE_BACKEND="sheets"`). Zero runtime dual-writes and zero unintended mutations on migrated Firestore document `corrective_records/default_cr_legacy_1`.

---

## [0.6.3E.1A] - 2026-08-21

### Completed
- **Live Firestore Rules & RBAC Audit**:
  - Re-verified entire 41-scenario automated security test suite (`npm run rules:test`) with 100% PASS (41/41).
  - Validated target Firebase Project: `x-ray-reporting-app`.
  - Confirmed RBAC function evaluation: Authorized active technician/supervisor read permissions are active, while unauthenticated and unauthorized profile access is strictly denied (`PERMISSION_DENIED`).
  - Confirmed user profile privilege escalation protection remains immutable (`allow write: if false;` on `/users/{uid}`).
  - Confirmed Preventive regression tests (38–41) remain 100% passing without regression.
- **Legacy Corrective Local Cache Cutover Preflight & Duplicate Risk Audit**:
  - Traced application startup and synchronization flow (`src/App.tsx`, `src/data/initialData.ts`, `src/services/firestoreCorrectiveRepository.ts`, `src/services/correctiveMapper.ts`).
  - **Identified Critical Risk**: Historical local records (e.g. `id: 1`, `corrective_code: 'CR-20260806-001'`) without `event_id` / `document_id` and `synced: undefined` would trigger auto-push in `syncFromCloud` upon switching `VITE_CORRECTIVE_BACKEND="firestore"`, generating a new UUID (`generateCorrectiveEventId()`) and creating duplicate Firestore documents alongside migrated `default_cr_legacy_1`.
  - **Defined Safe Cutover Policy for v0.6.3E.2**: Formulated deterministic legacy identity reconstruction, fetch-first sync order, and local cache sanitation before enabling Firestore runtime.
  - Preserved active runtime source of truth: `VITE_CORRECTIVE_BACKEND="sheets"`. Zero runtime dual-writes and zero unintended writes to migrated production record `corrective_records/default_cr_legacy_1`.

---

## [0.6.3E.1] - 2026-08-21

### Added
- **Corrective Firestore Security Rules & RBAC (`match /corrective_records/{recordId}`)**:
  - Implemented strict RBAC read/create/update rules leveraging shared `isAuthorizedStaff()`, `isActiveUser()`, and `hasRole()` functions.
  - **Create Security Constraints**: Enforced canonical identity (`document_id == recordId`, non-empty `event_id`, non-empty `dataset_id`, non-empty `corrective_code`), canonical shift (`shift in ['PS', 'M']`), audit ownership (`submitted_by_uid == request.auth.uid`, `updated_by_uid == request.auth.uid`), Timestamp enforcement for `created_at` and `updated_at`, and prevented client-side spoofing of migration metadata.
  - **Update Security Constraints & Immutability**: Protected immutable technical and audit fields (`document_id`, `event_id`, `dataset_id`, `corrective_code`, `record_id`, `created_at`, `submitted_by_uid`, `migrated_from`, `migrated_at`, `schema_version`).
  - **Migration Historical Record Compatibility**: Enabled legitimate updates by active technicians/supervisors to migrated documents with `submitted_by_uid == 'MIGRATION_SYSTEM'` while strictly preventing client overwrite of the original audit creator.
  - **Audit Immutability (Delete Denial)**: Strictly denied client-side document deletions (`allow delete: if false;`) across both technician and supervisor roles.
- **Automated Security Rules Test Suite (`scripts/testCorrectiveRules.ts`)**:
  - Added full 41-scenario automated security test suite covering unauthenticated, untrusted/inactive profile, authorized read/create, UID spoofing, migration spoofing, shift validation, timestamp validation, immutable field attacks, delete denial, privilege escalation, and preventive regression.
  - Added `npm run rules:test` script to `package.json`.

---

## [0.5.0] - 2026-08-10

### Added
- **Google Sheets & Google Drive Cloud Persistence Integration**:
  - Full cloud synchronization layer via Google Apps Script (GAS) Web App backend (`google-apps-script/Code.gs`).
  - Dedicated cloud service module (`src/services/cloudService.ts`) for health check, record fetching, record upserting, and Drive photo uploads.
  - Configurable endpoint environment variable `VITE_GAS_API_URL` without hardcoding server URLs.
- **Strict Tuple Upsert for Preventive Records**:
  - Preventive entries are uniquely upserted in Google Sheets based on: `(equipment_id, checklist_frequency_id, period_key, shift)`.
  - Editing an existing preventive report updates the cloud row in place without creating duplicate records.
- **Corrective Cloud Sync**:
  - Corrective maintenance logs are uniquely matched by `id` / `corrective_code` in Google Sheets (`Corrective_Records` tab).
- **Automated Google Drive Photo Organization**:
  - Field photos are automatically uploaded to Google Drive under folder hierarchy: `X-Ray Reporting App / YYYY / MM / YYYY-MM-DD / Preventive` (or `Corrective`).
  - Google Drive URLs and photo metadata are saved in Google Sheets instead of storing heavy base64 strings permanently.
  - Photos already hosted on Drive are preserved during edits to prevent duplicate file uploads.
- **Cross-Device Sync & Fallback Offline Storage**:
  - `localStorage` is preserved as a local cache and fallback mechanism, ensuring the app remains fully usable when offline or if Apps Script is temporarily unreachable.
  - Automatic background sync on startup and session shift/date changes merges records submitted from different devices (e.g., HP A and HP B) using `updated_at` conflict resolution.
- **Non-Blocking Cloud Sync Status Badge**:
  - Added visual sync indicator badge (`Tersimpan (Cloud)`, `Sinkronisasi...`, `Belum tersinkron (Lokal)`) in the Sidebar and session header with a 1-click manual sync trigger.

---

## [0.3.5] - 2026-08-10

### Added
- **Mobile Rear Camera Direct Capture (`capture="environment"`)**:
  - Directs mobile device browsers (Android & iOS) to trigger the rear/back camera by default when technicians tap documentation photo upload buttons in the field.
  - Added `capture="environment"` and standardized `accept="image/*"` across all operational documentation file inputs.

### Quickfix Details
- **Affected File Upload Inputs**:
  1. **Foto Report** (`PreventiveView.tsx`): Documentation photo for general preventive reports.
  2. **Foto Pembersihan / Bebersih** (`PreventiveView.tsx`): Equipment cleaning documentation photos.
  3. **Foto Pengukuran & Sinyal Generator** (`PreventiveView.tsx`): Voltage parameters & Generator A/B signal waveform photos.
  4. **Dokumen Sederhana / Simple Docs** (`PreventiveView.tsx`): Multi-photo uploads for simple maintenance documentation (max 7 photos).
  5. **Foto Corrective Maintenance** (`CorrectiveView.tsx`): Repair and troubleshooting documentation photos.
- **Preserved System Behaviors**:
  - Image compression & quality optimization remain intact.
  - Square photo collage generation (1200x1200px) with automatic date/time watermark.
  - Photo preview galleries and max image upload limits per field.
  - Existing PDF vector rendering pipeline and WhatsApp report formatters.

---

## [0.3.4] - 2026-08-09

### Added
- **Multi-Interval WhatsApp Report Split**:
  - Separated WhatsApp summary report generation by checklist frequency (Harian, Mingguan, Bulanan, Triwulan, Semesteran, Tahunan).
- **Dedicated Corrective WhatsApp Report**:
  - Implemented `generateCorrectiveWhatsAppReportText` in `reportService.ts` to generate standalone WhatsApp summaries for corrective maintenance logs.
- **Period Key Utilities (`src/utils/periodUtils.ts`)**:
  - Added `getPeriodKey` utility function to compute standardized period identifiers (`YYYY-MM-DD`, `YYYY-Wweek`, `YYYY-MM`, `YYYY-Qq`, `YYYY-Ss`, `YYYY`) for precise filtering across operational dates and frequencies.

### Changed
- Filtered preventive entry checks, dashboard statistics, and equipment status badges by shift, operational date, and period key.

---

## [0.3.3] - 2026-08-08

### Fixed
- **Multi-Page A4 PDF Header Consistency**:
  - Ensured repeating company header block, operational date, shift, dynamic 2-column technician grid, and table header row appear cleanly on every page of multi-page PDF reports.
- **Row-Based Border Model**:
  - Removed outer table wrapper border stretching across page breaks, eliminating fragmented border lines in Puppeteer PDF output.

---

## [0.3.2] - 2026-08-07

### Added
- **Pure Vector PDF Engine (`/api/generate-pdf`)**:
  - Replaced legacy canvas raster engine (`html2canvas`) with a high-resolution server-side Puppeteer Chromium PDF rendering backend.
  - Standardized A4 portrait page layout with 15mm margins, 0.5pt table borders, and Times New Roman typography.
- **Standardized Filename Format**:
  - Automatic report naming convention: `DD NamaBulan YYYY (KODE_SHIFT).pdf` (e.g., `06 Agustus 2026 (M).pdf` or `07 Agustus 2026 (PS).pdf`).
- **Web Share API Integration**:
  - Enabled direct mobile PDF sharing via native system dialogs (WhatsApp, Gmail, Drive, Telegram) with automatic fallback to browser download.

---

## [0.3.1] - 2026-08-05

### Added
- **Automated Square Photo Collage Generator (`collageService.ts`)**:
  - Merges up to 9+ field photos into a 1200x1200px square grid complete with timestamp & location watermarks.
- **XRAY Generator Parameter Measurements**:
  - High Voltage (kV), Heater Current (mA), and Anode Current (uA) measurement inputs for dual/single view XRAY inspection systems.

---

## [0.2.0] - 2026-08-03

### Added
- **Shift & Technician On Duty Modal (`ShiftModal.tsx`)**:
  - Interactive shift selection (PAGI / MALAM) and multi-technician duty assignment.
- **Role-Based Access Control**:
  - Technician Mode for quick field reporting.
  - Supervisor Mode with password authentication modal (`SupervisorLoginModal.tsx`).

---

## [0.1.0] - 2026-08-01

### Added
- Initial release of System Maintenance & Inspection Reporting for PT Nararya Teknologi Indonesia.
- Core modules:
  - Dashboard View (Equipment health & completion stats)
  - Preventive Maintenance Form (Checklist items & notes)
  - Corrective Maintenance Log (Issue tracking & action logs)
  - Report Generator (WhatsApp summary & PDF preview)
  - Master Data Management (Equipment, Locations, Checklist items)
