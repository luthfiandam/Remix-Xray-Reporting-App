import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// Suppress noisy libsignal decryption warnings for unneeded incoming WhatsApp messages
const isBadMacOrDecryptionError = (str: string): boolean => {
  return (
    str.includes("Failed to decrypt message with any known session") ||
    str.includes("Session error") ||
    str.includes("Bad MAC") ||
    str.includes("SessionError") ||
    str.includes("No matching sessions found")
  );
};

const origConsoleError = console.error;
console.error = function (...args: any[]) {
  const str = args.map((a) => (typeof a === "string" ? a : (a?.message || a?.stack || ""))).join(" ");
  if (isBadMacOrDecryptionError(str)) {
    return;
  }
  origConsoleError.apply(console, args);
};

if (process.stderr && typeof process.stderr.write === "function") {
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function (chunk: any, ...rest: any[]): boolean {
    const str = typeof chunk === "string" ? chunk : chunk?.toString?.() || "";
    if (isBadMacOrDecryptionError(str)) {
      return true;
    }
    return (origStderrWrite as any)(chunk, ...rest);
  };
}
import bcrypt from "bcryptjs";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import net from "net";
import os from "os";
import { GoogleGenAI } from "@google/genai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListBucketsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { extractS3ObjectKey } from "./src/utils/s3ObjectKey";
import { isWahaEnabled, wahaSendText, wahaSendMedia, getWahaConnectionStatus, wahaGetGroups } from "./src/server/wahaGateway";
import { PDFDocument } from "pdf-lib";
import { generateReportPdfWithPuppeteer, buildReportHtml, resolveAllEvidencesServerSide, closePuppeteerBrowser } from "./src/server/puppeteerPdfGenerator";
import { getJakartaISOString } from "./src/utils/dateTimeUtils";
import { evaluateOperationalPermissions, getPreviousDateString } from "./src/services/rbacPermissionService";
import { DEFAULT_STAFF_WORK_PATTERNS, DEFAULT_WORK_SHIFT_RULES } from "./src/services/workShiftRulesService";
import {
  initializeWhatsApp,
  hasSavedWhatsAppCredentials,
  getWhatsAppStatus,
  requestWhatsAppPairingCode,
  logoutWhatsApp,
  loadWhatsAppConfig,
  saveWhatsAppConfig,
  sendWhatsAppTextMessage,
  sendWhatsAppImageMessage,
  sendWhatsAppDocumentMessage,
  getWhatsAppGroupList,
  writeServerErrorLog,
} from "./src/server/whatsappBaileys";

// ==============================================================================
// SECURITY CONSTANTS & PEPPER
// ==============================================================================
const TECHNICIAN_PASSWORD_PEPPER =
  process.env.TECHNICIAN_PASSWORD_PEPPER || "nti_technician_pepper_secret_faskampen_2026";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.SUPABASE_SECRET_KEY ||
  "nti_session_secret_jwt_2026_faskampen";

interface TechnicianTokenPayload {
  uid: string;
  technician_id: number;
  code: string;
  name: string;
  email: string;
  role: "system_admin" | "operations_admin" | "supervisor" | "technician";
  iat: number;
  exp: number;
}

export function generateTechnicianToken(tech: {
  id: number;
  code?: string;
  name: string;
  email?: string;
  role?: string;
}): string {
  const resolvedRole: "system_admin" | "operations_admin" | "supervisor" | "technician" =
    tech.role === "system_admin" || tech.role === "admin" ? "system_admin" :
    tech.role === "operations_admin" ? "operations_admin" :
    tech.role === "supervisor" ? "supervisor" : "technician";

  const payload: TechnicianTokenPayload = {
    uid: `tech_${tech.id}`,
    technician_id: Number(tech.id),
    code: tech.code || "",
    name: tech.name || "",
    email: tech.email || "",
    role: resolvedRole,
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 3600 * 1000, // 7 days expiration
  };
  const dataStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(dataStr).digest("base64url");
  return `${dataStr}.${sig}`;
}

export function verifyTechnicianToken(token: string): TechnicianTokenPayload | null {
  try {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [dataStr, sig] = parts;
    const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(dataStr).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }
    const payload: TechnicianTokenPayload = JSON.parse(Buffer.from(dataStr, "base64url").toString("utf-8"));
    if (payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function generateImageTicket(key: string, expiresInSec: number = 3600): string {
  const expiresAt = Date.now() + expiresInSec * 1000;
  const payload = `${key}:${expiresAt}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${expiresAt}.${sig}`;
}

export function verifyImageTicket(key: string, ticket: string): boolean {
  if (!key || !ticket || typeof ticket !== "string") return false;
  const parts = ticket.split(".");
  if (parts.length !== 2) return false;
  const [expiresAtStr, sig] = parts;
  const expiresAt = Number(expiresAtStr);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
  const payload = `${key}:${expiresAt}`;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

export function verifyAndUpgradePassword(
  plainInput: string,
  storedPassword?: string
): { match: boolean; needsUpgrade: boolean } {
  const input = (plainInput || "").trim();
  const stored = (storedPassword || "").trim();

  // If no password configured and user sent empty password
  if (!stored && !input) {
    return { match: true, needsUpgrade: false };
  }

  // If stored is bcrypt hash ($2a$, $2b$, $2y$)
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
    let isOk = false;
    try {
      isOk = bcrypt.compareSync(input + TECHNICIAN_PASSWORD_PEPPER, stored);
      if (!isOk) {
        // Fallback without pepper in case it was hashed without pepper
        isOk = bcrypt.compareSync(input, stored);
      }
    } catch (_) {}
    return { match: isOk, needsUpgrade: false };
  }

  // If stored is legacy plaintext
  if (stored === input) {
    return { match: true, needsUpgrade: true };
  }

  return { match: false, needsUpgrade: false };
}

export function hashTechnicianPassword(password: string): string {
  return bcrypt.hashSync(password + TECHNICIAN_PASSWORD_PEPPER, 10);
}

// Magic bytes validator for file uploads
export function validateFileBuffer(
  buffer: Buffer,
  claimedMime: string
): { valid: boolean; actualMime: string } {
  if (buffer.length < 4) return { valid: false, actualMime: "unknown" };

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return {
      valid: claimedMime === "image/jpeg" || claimedMime === "image/jpg",
      actualMime: "image/jpeg",
    };
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { valid: claimedMime === "image/png", actualMime: "image/png" };
  }

  // WebP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { valid: claimedMime === "image/webp", actualMime: "image/webp" };
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { valid: claimedMime === "application/pdf", actualMime: "application/pdf" };
  }

  return { valid: false, actualMime: "unknown" };
}

// Canonical S3 key validator and sanitizer
export function validateAndSanitizeS3Key(
  rawInput: string | null | undefined,
  allowedPrefixes: string[] = ["!Kantor/"]
): { valid: boolean; cleanKey: string | null; error?: string } {
  if (!rawInput || typeof rawInput !== "string") {
    return { valid: false, cleanKey: null, error: "Parameter 'key' wajib disertakan." };
  }

  // 1. Reject NUL or control characters
  if (/[\x00-\x1f\x7f]/.test(rawInput)) {
    return { valid: false, cleanKey: null, error: "Karakter kontrol/ilegal terdeteksi pada key." };
  }

  // 2. Safely decode URI and handle malformed encoding
  let decoded = rawInput.trim();
  try {
    while (decoded.includes("%")) {
      const prev = decoded;
      decoded = decodeURIComponent(decoded);
      if (decoded === prev) break;
    }
  } catch (_) {
    return { valid: false, cleanKey: null, error: "Format encoding key tidak valid." };
  }

  // 3. Strip query parameters and URL fragments
  decoded = decoded.split("?")[0].split("#")[0].trim();

  // 4. Reject backslashes
  if (decoded.includes("\\")) {
    return { valid: false, cleanKey: null, error: "Karakter backslash tidak diizinkan." };
  }

  // 5. Extract canonical path starting from !Kantor/ if passed inside URL/full path
  const kIdx = decoded.indexOf("!Kantor/");
  let relativeKey = kIdx !== -1 ? decoded.substring(kIdx) : decoded;

  // Strip leading slashes
  relativeKey = relativeKey.replace(/^\/+/, "").trim();

  // 6. Inspect individual path segments for '.' or '..'
  const segments = relativeKey.split("/");
  for (const seg of segments) {
    const s = seg.trim();
    if (s === "." || s === "..") {
      return { valid: false, cleanKey: null, error: "Path traversal terdeteksi pada key." };
    }
  }

  // 7. Validate allowed root prefix
  const matchesPrefix = allowedPrefixes.some((p) => relativeKey.startsWith(p));
  if (!matchesPrefix) {
    return { valid: false, cleanKey: null, error: "Key berada di luar struktur folder yang diizinkan." };
  }

  return { valid: true, cleanKey: relativeKey };
}

export function isValidBackupFilename(filename: string | null | undefined): boolean {
  if (!filename || typeof filename !== "string") return false;
  const clean = path.basename(filename.trim());
  return /^[a-zA-Z0-9_\-\.]+\.json$/.test(clean) && !clean.includes("..");
}

export interface StorageAuthResult {
  allowed: boolean;
  reason?: string;
}

// In-memory server-side user inactivity activity map for 6-hour idle logout enforcement
const userSessionActivityMap = new Map<string, number>();

async function validateOffDutyEvidenceContinuation(
  supabase: any,
  user: any,
  effectiveTechId: number | undefined,
  entityType: string,
  recordId: string | number | undefined,
  entityId: string | number | undefined
): Promise<{ allowed: boolean; error?: string }> {
  const targetRecordId = recordId || entityId;
  if (!targetRecordId) {
    return {
      allowed: false,
      error: "Akses ditolak: Teknisi sedang OFF DUTY/LIBUR (READ ONLY). Laporan belum tersimpan di server. Simpan sebagai draft lokal.",
    };
  }

  try {
    const techIdNum = effectiveTechId ? Number(effectiveTechId) : null;
    const now = Date.now();
    const MAX_CONTINUATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours max continuation window

    if (entityType === "corrective_evidence" || entityType === "corrective_collage") {
      const { data: corrRec } = await supabase
        .from("corrective_records")
        .select("id, technician_ids, submitted_by_uid, created_at, upload_status")
        .or(`id.eq.${Number(targetRecordId) || 0},event_id.eq.${String(targetRecordId)}`)
        .limit(1);

      if (!corrRec || corrRec.length === 0) {
        return {
          allowed: false,
          error: "Akses ditolak: Laporan corrective tidak ditemukan di server. Simpan sebagai draft lokal.",
        };
      }

      const row = corrRec[0];
      const techIdsArray: number[] = Array.isArray(row.technician_ids) ? row.technician_ids.map(Number) : [];
      const isOwner = (techIdNum && techIdsArray.includes(techIdNum)) || (row.submitted_by_uid && row.submitted_by_uid === user.uid);
      if (!isOwner) {
        return {
          allowed: false,
          error: "Akses ditolak: Laporan corrective ini bukan milik akun Anda.",
        };
      }

      const createdAtTime = row.created_at ? new Date(row.created_at).getTime() : 0;
      if (createdAtTime > 0 && now - createdAtTime > MAX_CONTINUATION_WINDOW_MS) {
        return {
          allowed: false,
          error: "Akses ditolak: Batas waktu 24 jam untuk melengkapi evidence lanjutan telah berakhir.",
        };
      }

      const statusStr = (row.upload_status || "").toLowerCase();
      if (statusStr === "completed") {
        return {
          allowed: false,
          error: "Akses ditolak: Laporan ini sudah berstatus lengkap (COMPLETED). Tidak dapat menambahkan evidence baru setelah off duty.",
        };
      }

      return { allowed: true };
    } else {
      // Preventive evidence or collage
      const { data: prevRec } = await supabase
        .from("preventive_records")
        .select("id, submitted_by_technician_ids, created_at, upload_status")
        .eq("id", Number(targetRecordId) || 0)
        .limit(1);

      if (!prevRec || prevRec.length === 0) {
        return {
          allowed: false,
          error: "Akses ditolak: Laporan preventive tidak ditemukan di server. Simpan sebagai draft lokal.",
        };
      }

      const row = prevRec[0];
      const techIdsArray: number[] = Array.isArray(row.submitted_by_technician_ids) ? row.submitted_by_technician_ids.map(Number) : [];
      const isOwner = techIdNum && techIdsArray.includes(techIdNum);
      if (!isOwner) {
        return {
          allowed: false,
          error: "Akses ditolak: Laporan preventive ini bukan milik akun Anda.",
        };
      }

      const createdAtTime = row.created_at ? new Date(row.created_at).getTime() : 0;
      if (createdAtTime > 0 && now - createdAtTime > MAX_CONTINUATION_WINDOW_MS) {
        return {
          allowed: false,
          error: "Akses ditolak: Batas waktu 24 jam untuk melengkapi evidence lanjutan telah berakhir.",
        };
      }

      const statusStr = (row.upload_status || "").toLowerCase();
      if (statusStr === "completed") {
        return {
          allowed: false,
          error: "Akses ditolak: Laporan ini sudah berstatus lengkap (COMPLETED). Tidak dapat menambahkan evidence baru setelah off duty.",
        };
      }

      return { allowed: true };
    }
  } catch (err: any) {
    return {
      allowed: false,
      error: `Gagal memverifikasi status laporan: ${err?.message || "Error"}`,
    };
  }
}

export function authorizeStorageAccess(
  user: any,
  cleanKey: string,
  action: "read" | "write" | "delete"
): StorageAuthResult {
  if (!user) {
    return { allowed: false, reason: "Autentikasi diperlukan." };
  }

  // 1. Supervisor role has full authoritative access across all !Kantor/ resources
  if (user.role === "supervisor" || user.role === "system_admin") {
    return { allowed: true };
  }

  // 2. Technician role: Scoped operational access only
  if (user.role === "technician" || user.role === "operations_admin") {
    // A. Technicians are never allowed to delete S3 objects directly
    if (action === "delete") {
      return { allowed: false, reason: "Akses ditolak: Penghapusan berkas S3 hanya diizinkan untuk Supervisor." };
    }

    // B. Personal Attendance Photos (!Kantor/3. Absen/)
    // Enforce strict positional parsing against canonical schema:
    // !Kantor/3. Absen/<TAHUN>/<BULAN>/<TANGGAL>/<SHIFT>/<OWNER>/<FILENAME>
    if (cleanKey.startsWith("!Kantor/3. Absen/")) {
      const pathSegments = cleanKey.split("/").filter(Boolean);
      // Remove root segments: '!Kantor' and '3. Absen'
      const relativeSegments = pathSegments.slice(2);

      // Strict positional requirement: exactly 6 segments (Year, Month, Date, Shift, Owner, Filename)
      if (relativeSegments.length !== 6) {
        return {
          allowed: false,
          reason: "Akses ditolak: Struktur path absensi tidak sesuai skema kanonikal (!Kantor/3. Absen/<Tahun>/<Bulan>/<Tanggal>/<Shift>/<Owner>/<Filename>).",
        };
      }

      const [yearSeg, monthSeg, dateSeg, shiftSeg, ownerSeg, fileNameSeg] = relativeSegments;

      // 1. Validate Position 0: Year (<TAHUN>)
      const isYearValid = /^\d{4}$/.test(yearSeg.trim());
      if (!isYearValid) {
        return { allowed: false, reason: "Akses ditolak: Format segmen tahun absensi tidak valid." };
      }

      // 2. Validate Position 1: Month (<BULAN>)
      const monthNamesLower = INDONESIAN_MONTH_NAMES.map((m) => m.toLowerCase());
      const monthLower = monthSeg.trim().toLowerCase();
      const isMonthValid =
        monthNamesLower.includes(monthLower) ||
        /^\d{2}\.\s*[a-z]+$/i.test(monthLower) ||
        (/^\d{1,2}$/.test(monthLower) && parseInt(monthLower, 10) >= 1 && parseInt(monthLower, 10) <= 12);
      if (!isMonthValid) {
        return { allowed: false, reason: "Akses ditolak: Format segmen bulan absensi tidak valid." };
      }

      // 3. Validate Position 2: Date (<TANGGAL>)
      const dateTrim = dateSeg.trim();
      const isDateValid = /^\d{1,2}$/.test(dateTrim) && parseInt(dateTrim, 10) >= 1 && parseInt(dateTrim, 10) <= 31;
      if (!isDateValid) {
        return { allowed: false, reason: "Akses ditolak: Format segmen tanggal absensi tidak valid." };
      }

      // 4. Validate Position 3: Shift (<SHIFT>)
      const allowedShifts = new Set([
        "pagi", "malam", "siang",
        "shift pagi", "shift malam", "shift siang",
        "p", "m", "ps", "s"
      ]);
      const shiftLower = shiftSeg.trim().toLowerCase();
      if (!allowedShifts.has(shiftLower)) {
        return { allowed: false, reason: "Akses ditolak: Format segmen shift absensi tidak valid." };
      }

      // 5. Validate Position 4: Owner (<OWNER>) against server-authenticated user identity
      const userIds = [
        user.id !== undefined && user.id !== null ? String(user.id).trim().toLowerCase() : "",
        user.uid !== undefined && user.uid !== null ? String(user.uid).trim().toLowerCase() : "",
      ].filter(Boolean);

      const userCodes = [
        user.code !== undefined && user.code !== null ? String(user.code).trim().toLowerCase() : "",
      ].filter(Boolean);

      const userNames = [
        user.name !== undefined && user.name !== null ? String(user.name).trim().toLowerCase() : "",
      ].filter(Boolean);

      const allUserIdentities = new Set([...userIds, ...userCodes, ...userNames]);
      const ownerLower = ownerSeg.trim().toLowerCase();

      // Ownership MUST strictly match the OWNER positional segment. Filename is ignored.
      if (!allUserIdentities.has(ownerLower)) {
        return {
          allowed: false,
          reason: "Akses ditolak: Folder absensi ini bukan milik akun Anda.",
        };
      }

      // 6. Validate Position 5: Filename (<FILENAME>) is present and valid
      if (!fileNameSeg || !fileNameSeg.trim()) {
        return { allowed: false, reason: "Akses ditolak: Nama berkas absensi tidak valid." };
      }

      return { allowed: true };
    }

    // C. Operational Evidence Photos (!Kantor/2. Foto Laporan/) & Reports (!Kantor/1. Laporan/)
    if (cleanKey.startsWith("!Kantor/2. Foto Laporan/") || cleanKey.startsWith("!Kantor/1. Laporan/")) {
      return { allowed: true };
    }

    // D. Root browsing / Storage Manager is restricted to Supervisor
    return {
      allowed: false,
      reason: "Akses ditolak: Resource ini memerlukan hak akses Supervisor.",
    };
  }

  return { allowed: false, reason: "Role pengguna tidak memiliki izin akses storage." };
}

let genAiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!genAiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key.trim()) {
      genAiClient = new GoogleGenAI({ apiKey: key.trim() });
    }
  }
  return genAiClient;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

let serverSupabase: SupabaseClient | null = null;
function getServerSupabase(): SupabaseClient | null {
  if (!serverSupabase && SUPABASE_URL && SUPABASE_KEY) {
    try {
      serverSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) {
      console.warn("[Server Supabase Init Exception]:", e);
    }
  }
  return serverSupabase;
}

/**
 * Shared authoritative time/roster context for report, presign and RBAC checks.
 * Never resolve operational permissions from today's global PS/M doc alone:
 * the prior night's M has valid checkout and ON_DUTY across midnight.
 */
async function loadServerShiftContext(db: SupabaseClient, serverNow: Date) {
  const calendarDate = serverNow.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const previousDate = getPreviousDateString(calendarDate);
  const { data: roster, error: rosterError } = await db
    .from('shift_schedules')
    .select('dataset_id,schedule_date,shift,assignments,status')
    .eq('dataset_id', 'default')
    .in('schedule_date', [previousDate, calendarDate]);
  if (rosterError) throw new Error(`Gagal membaca jadwal otoritatif: ${rosterError.message}`);
  const { data: patterns, error: patternError } = await db
    .from('staff_work_patterns').select('*').eq('is_active', true);
  if (patternError && !['42P01', 'PGRST205'].includes(patternError.code || '')) {
    throw new Error(`Gagal membaca pola kerja: ${patternError.message}`);
  }
  const { data: ruleRows, error: ruleError } = await db
    .from('work_shift_rules').select('*').eq('is_active', true);
  if (ruleError && !['42P01', 'PGRST205'].includes(ruleError.code || '')) {
    throw new Error(`Gagal membaca aturan jam kerja: ${ruleError.message}`);
  }
  const staffPatterns = Array.isArray(patterns) && patterns.length
    ? patterns.map((p: any) => p.work_pattern === 'OFFICE' &&
        ['desi', 'luthfi'].includes(String(p.staff_name).trim().toLowerCase())
        ? { ...p, active_days: [1, 2, 3, 4, 5] } : p)
    : DEFAULT_STAFF_WORK_PATTERNS;
  const rules = { ...DEFAULT_WORK_SHIFT_RULES };
  for (const r of (ruleRows || [])) {
    if (r.shift_code === 'OFFICE' || r.shift_code === 'PS' || r.shift_code === 'M') {
      rules[r.shift_code] = { ...rules[r.shift_code], ...r };
    }
  }
  return {
    scheduleDocs: (roster || []).map((row: any) => ({
      dataset_id: row.dataset_id, schedule_date: row.schedule_date,
      shift: row.shift, assignments: row.assignments || {},
      status: row.status || 'published',
    })),
    staffPatterns, rules,
  };
}

function escapeTgHtml(text: any): string {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isDummyOrRemovedName(name: string | null | undefined): boolean {
  if (!name || typeof name !== "string") return true;
  return /daffa\s*evan|supervisor\s*utama/i.test(name.trim());
}

interface TelegramSubscriber {
  chat_id: string;
  type: "private" | "group" | "supergroup" | "channel";
  name: string;
  username?: string;
  first_seen: string;
  last_active: string;
  last_message?: string;
  is_active: boolean;
  notes?: string;
}

interface TelegramServerConfig {
  bot_token?: string;
  chat_id?: string;
  broadcast_to_all_subscribers?: boolean;
  auto_notify_corrective?: boolean;
  auto_notify_recurring_fault?: boolean;
}

interface OperationalEquipment {
  id: number;
  equipment_type_id?: number;
  equipment_code?: string;
  name: string;
  location_name?: string;
  brand?: string;
  model?: string;
  status?: string;
  type?: string;
  public_id?: string;
}

interface OperationalCorrective {
  id: number | string;
  equipment_id: number;
  equipment_name?: string;
  location_name?: string;
  fault_description?: string;
  problem_description?: string;
  action_taken?: string;
  result: string;
  corrective_date: string;
  shift?: string;
  start_time?: string;
  end_time?: string;
  technicians?: string[];
  technician_name?: string;
  created_by?: string;
}

interface OperationalState {
  operationalDate: string;
  shift: string;
  technicianNames: string[];
  equipments: OperationalEquipment[];
  correctiveReports: OperationalCorrective[];
  updatedAt: string;
}

const DATA_DIR = path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function resolveDataFile(filename: string): string {
  const inData = path.join(DATA_DIR, filename);
  const inRoot = path.join(process.cwd(), filename);
  if (fs.existsSync(inData)) return inData;
  if (fs.existsSync(inRoot)) return inRoot;
  return inData;
}

const SUBSCRIBERS_FILE = resolveDataFile("telegram_subscribers.json");
const CONFIG_FILE = resolveDataFile("telegram_server_config.json");
const OPERATIONAL_STATE_FILE = resolveDataFile("operational_state.json");
const ATTENDANCE_FILE = resolveDataFile("attendance_records.json");
const STORAGE_CONFIG_FILE = resolveDataFile("storage_config.json");
const EXTERNAL_REPORTS_FILE = resolveDataFile("external_error_reports.json");

interface ServerExternalReport {
  id: string | number;
  report_number: string;
  equipment_id: number;
  public_equipment_id?: string;
  equipment_name?: string;
  location_name?: string;
  reporter_name: string;
  reporter_unit: string;
  issue_type: string;
  description: string;
  photo_object_key?: string;
  photo_url?: string;
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy?: number | null;
  session_id?: string;
  status: 'NEW' | 'ACKNOWLEDGED' | 'CONVERTED_TO_CORRECTIVE' | 'CLOSED';
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_notes?: string | null;
  corrective_record_id?: string | number | null;
}

function loadExternalErrorReports(): ServerExternalReport[] {
  try {
    if (fs.existsSync(EXTERNAL_REPORTS_FILE)) {
      const data = fs.readFileSync(EXTERNAL_REPORTS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading external error reports file:", e);
  }
  return [];
}

function saveExternalErrorReports(reports: ServerExternalReport[]) {
  safeWriteJsonFile(EXTERNAL_REPORTS_FILE, reports);
}

// In-Memory Report Sessions Map (10-minute short-lived tokens for AVSEC QR reporting)
interface ReportSessionRecord {
  session_id: string;
  public_id: string;
  equipment_id: number;
  expires_at: number;
  used: boolean;
  ip: string;
}
const reportSessions = new Map<string, ReportSessionRecord>();

interface ServerStorageConfig {
  provider: 'idcloudhost' | 'google_drive' | 'local';
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
  publicUrlBase?: string;
  enabled: boolean;
}

function loadStorageConfig(): ServerStorageConfig {
  const envEndpoint = process.env.IDCLOUDHOST_ENDPOINT || "https://is3.cloudhost.id";
  const envAccessKey = process.env.IDCLOUDHOST_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || "";
  const envSecretKey = process.env.IDCLOUDHOST_SECRET_KEY || "";
  const envBucket = process.env.IDCLOUDHOST_BUCKET || "";
  const envRegion = process.env.IDCLOUDHOST_REGION || "us-east-1";

  try {
    if (fs.existsSync(STORAGE_CONFIG_FILE)) {
      const data = fs.readFileSync(STORAGE_CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return {
        provider: parsed.provider || "idcloudhost",
        endpoint: parsed.endpoint || envEndpoint,
        accessKeyId: parsed.accessKeyId || envAccessKey,
        secretAccessKey: parsed.secretAccessKey || envSecretKey,
        bucketName: parsed.bucketName || envBucket,
        region: parsed.region || envRegion,
        publicUrlBase: parsed.publicUrlBase || "",
        enabled: parsed.enabled !== undefined ? parsed.enabled : true,
      };
    }
  } catch (e) {
    console.error("Error reading storage config file:", e);
  }

  return {
    provider: "idcloudhost",
    endpoint: envEndpoint,
    accessKeyId: envAccessKey,
    secretAccessKey: envSecretKey,
    bucketName: envBucket,
    region: envRegion,
    publicUrlBase: "",
    enabled: true,
  };
}

function saveStorageConfig(cfg: ServerStorageConfig) {
  safeWriteJsonFile(STORAGE_CONFIG_FILE, cfg);
}

function getS3Client(config: ServerStorageConfig): S3Client {
  const cleanEndpoint = config.endpoint.startsWith("http")
    ? config.endpoint
    : `https://${config.endpoint}`;

  return new S3Client({
    endpoint: cleanEndpoint,
    region: config.region || "us-east-1",
    credentials: {
      accessKeyId: (config.accessKeyId || "").trim(),
      secretAccessKey: (config.secretAccessKey || "").trim(),
    },
    forcePathStyle: true, // IDCloudHost / Ceph object storage requires path-style access
  });
}

// ==============================================================================
// GPS & OFFICE RADIUS CONFIGURATION (SERVER AUTHORITATIVE)
// ==============================================================================
const OFFICE_CONFIG = {
  latitude: Number(process.env.OFFICE_LATITUDE) || -6.2657,
  longitude: Number(process.env.OFFICE_LONGITUDE) || 106.8906,
  radiusMeters: Number(process.env.OFFICE_RADIUS_METERS) || 2500,
  name: process.env.OFFICE_NAME || "Bandara Halim Perdanakusuma",
};

export function calculateHaversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

const INDONESIAN_MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export function generateCanonicalStorageKey(params: {
  entityType?: string;
  dateStr?: string;
  shift?: string;
  entityId?: string | number;
  fileName?: string;
  ext?: string;
  technicianName?: string;
  attendanceType?: string;
  equipmentLabel?: string;
}): string {
  const now = new Date();
  const rawDate = params.dateStr || now.toISOString().split("T")[0];
  const dateParts = rawDate.split("-");
  const year = dateParts[0] || String(now.getFullYear());
  const monthNum = parseInt(dateParts[1] || String(now.getMonth() + 1), 10);
  const mIdx = Math.max(0, Math.min(11, monthNum - 1));
  const monthStr = String(mIdx + 1).padStart(2, "0");
  const monthName = INDONESIAN_MONTH_NAMES[mIdx];
  const day = (dateParts[2] || String(now.getDate())).padStart(2, "0");
  const monthFolder = `${monthStr}. ${monthName}`;

  const uuid = crypto.randomUUID();
  const safeExt = (params.ext || "jpg").replace(/^\./, "");
  const entityIdStr = params.entityId ? String(params.entityId).replace(/[^a-zA-Z0-9_-]/g, "_") : uuid;
  const type = (params.entityType || "general").toLowerCase();

  let shiftCode = "PS";
  let shiftLabel = "Shift Pagi";
  const sUpper = (params.shift || "").toUpperCase();
  if (sUpper.includes("MALAM") || sUpper === "M") {
    shiftCode = "M";
    shiftLabel = "Shift Malam";
  } else if (sUpper.includes("SIANG")) {
    shiftLabel = "Shift Siang";
  }

  // 1. Attendance: !Kantor/3. Absen/<TAHUN>/<BULAN>/<TANGGAL>/<SHIFT>/<OWNER>/<FILENAME>
  if (type.includes("attendance")) {
    const techId = params.entityId || "1";
    const rawName = params.technicianName || "Teknisi";
    const cleanName = rawName.replace(/[\\/:*?"<>|#%&{}]/g, "").replace(/\s+/g, " ").trim() || "Teknisi";
    const shiftFolder = shiftLabel.toUpperCase().includes("MALAM") ? "MALAM" : shiftLabel.toUpperCase().includes("SIANG") ? "SIANG" : "PAGI";
    const attType = (params.attendanceType || "masuk").toLowerCase();
    const jenisAbsen = attType === "pulang" ? "Absen Pulang" : "Absen Masuk";
    const timeSuffix = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .format(now)
      .replace(/[^0-9]/g, "");
    const fileName = params.fileName || `${shiftLabel}_${techId}_${cleanName}_${jenisAbsen}_${timeSuffix || uuid}.${safeExt}`;
    return `!Kantor/3. Absen/${year}/${monthName}/${day}/${shiftFolder}/${cleanName}/${fileName}`;
  }

  // 2. Reports: !Kantor/1. Laporan/...
  if (type.startsWith("report_") || ["daily", "weekly", "monthly", "quarterly", "semester", "yearly", "corrective"].includes(type)) {
    let subDir = "1. Laporan Harian";
    let useMonthFolder = true;
    let freqName = "Harian";

    if (type === "report_daily" || type === "daily") {
      subDir = "1. Laporan Harian";
      useMonthFolder = true;
      freqName = "Harian";
    } else if (type === "report_weekly" || type === "weekly") {
      subDir = "2. Laporan Mingguan";
      useMonthFolder = true;
      freqName = "Mingguan";
    } else if (type === "report_monthly" || type === "monthly") {
      subDir = "3. Laporan Bulanan";
      useMonthFolder = true;
      freqName = "Bulanan";
    } else if (type === "report_quarterly" || type === "quarterly") {
      subDir = "4. Laporan Triwulan";
      useMonthFolder = false;
      freqName = "Triwulan";
    } else if (type === "report_semester" || type === "semester") {
      subDir = "5. Laporan Semester";
      useMonthFolder = false;
      freqName = "Semester";
    } else if (type === "report_yearly" || type === "yearly") {
      subDir = "6. Laporan Tahunan";
      useMonthFolder = false;
      freqName = "Tahunan";
    } else if (type === "report_corrective" || type === "corrective") {
      subDir = "7. Laporan Corrective";
      useMonthFolder = true;
      freqName = "Corrective";
    }

    const folder = useMonthFolder
      ? `!Kantor/1. Laporan/${subDir}/${year}/${monthFolder}`
      : `!Kantor/1. Laporan/${subDir}/${year}`;
    const fileName = params.fileName || `${day} ${monthName} ${year} (${shiftCode}) - ${freqName}.pdf`;
    return `${folder}/${fileName}`;
  }

  // 3. Evidence (Preventive / Corrective / AVSEC): !Kantor/2. Foto Laporan/...
  if (type.includes("preventive")) {
    const fileName = params.fileName || `foto_${uuid}.${safeExt}`;
    const shiftDir = shiftCode === 'M' ? 'MALAM' : 'PAGI';
    let folderPath = `!Kantor/2. Foto Laporan/1. Foto Laporan Harian/${year}/${monthFolder}/${day} ${monthName}/${shiftDir}/${entityIdStr}`;

    if (type.includes("weekly") || type.includes("minggu")) {
      folderPath = `!Kantor/2. Foto Laporan/2. Foto Laporan Mingguan/${year}/${monthFolder}/${day} ${monthName}/${shiftDir}/${entityIdStr}`;
    } else if (type.includes("monthly") || type.includes("bulan")) {
      folderPath = `!Kantor/2. Foto Laporan/3. Foto Laporan Bulanan/${year}/${monthFolder}/${shiftDir}/${entityIdStr}`;
    } else if (type.includes("quarterly") || type.includes("triwulan")) {
      const qNum = Math.ceil(monthNum / 3);
      folderPath = `!Kantor/2. Foto Laporan/4. Foto Laporan Triwulan/${year}/Triwulan ${qNum}/${monthFolder}/${shiftDir}/${entityIdStr}`;
    } else if (type.includes("semester")) {
      const sNum = monthNum <= 6 ? 1 : 2;
      folderPath = `!Kantor/2. Foto Laporan/5. Foto Laporan Semesteran/${year}/Semester ${sNum}/${monthFolder}/${shiftDir}/${entityIdStr}`;
    } else if (type.includes("yearly") || type.includes("tahun")) {
      folderPath = `!Kantor/2. Foto Laporan/6. Foto Laporan Tahunan/${year}/${monthFolder}/${shiftDir}/${entityIdStr}`;
    }

    return `${folderPath}/${fileName}`;
  } else if (type.includes("corrective")) {
    const fileName = params.fileName || `foto_${uuid}.${safeExt}`;
    return `!Kantor/2. Foto Laporan/1.1 Foto Laporan Corrective/${year}/${monthFolder}/${day} ${monthName}/${shiftCode === 'M' ? 'MALAM' : 'PAGI'}/${entityIdStr}/${fileName}`;
  } else if (type.includes("avsec") || type.includes("external") || type.includes("qr_error")) {
    const fileName = params.fileName || `foto_${uuid}.${safeExt}`;

    // Server-side WIB time calculation (Asia/Jakarta)
    const nowWibStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
    const nowWib = new Date(nowWibStr);

    const yearWib = String(nowWib.getFullYear());
    const mIdxWib = nowWib.getMonth();
    const monthNumStr = String(mIdxWib + 1).padStart(2, "0");
    const monthNameWib = INDONESIAN_MONTH_NAMES[mIdxWib];
    const monthFolderWib = `${monthNumStr}. ${monthNameWib}`;

    const dayNumWib = nowWib.getDate();
    const dateMonthFolderWib = `${dayNumWib} ${monthNameWib}`;

    // Server-side shift determination: 07:00-18:59 = PAGI, 19:00-06:59 = MALAM
    const hourWib = nowWib.getHours();
    const shiftStrWib = (hourWib >= 7 && hourWib < 19) ? "PAGI" : "MALAM";

    const rawEqLabel = params.equipmentLabel || `XRAY ${entityIdStr}`;
    const cleanEqLabel = rawEqLabel.replace(/[\\/:*?"<>|#%&{}]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

    return `!Kantor/2. Foto Laporan/99. Foto Laporan Avsec/${yearWib}/${monthFolderWib}/${dateMonthFolderWib}/${shiftStrWib}/${cleanEqLabel}/${fileName}`;
  }

  const fileName = params.fileName || `foto_${uuid}.${safeExt}`;
  return `!Kantor/2. Foto Laporan/General/${year}/${monthFolder}/${day} ${monthName}/${fileName}`;
}

interface ServerAttendanceRecord {
  id: string;
  technician_id?: number;
  technician_name: string;
  attendance_type?: 'masuk' | 'pulang' | 'bypass' | 'grace_period' | 'off_duty';
  shift: 'Pagi' | 'Malam' | 'PS' | 'M' | 'Office' | 'OFFICE';
  attendance_date: string;
  attendance_time: string;
  status: 'Tepat Waktu' | 'Telat';
  verification_status?: 'verified' | 'unverified' | 'verification_failed' | 'supervisor_override';
  liveness_confidence?: number;
  notes?: string;
  is_bypassed?: boolean;
  is_off_duty?: boolean;
  photo_url?: string;
  photo_object_key?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    area_name?: string;
    distance_meters?: number;
    is_within_radius?: boolean;
  };
  expected_evidence_count?: number;
  uploaded_evidence_count?: number;
  upload_status?: 'pending' | 'uploading' | 'completed' | 'partial' | 'failed';
  last_upload_error?: string;
  created_at: string;
}

function safeWriteJsonFile(filePath: string, data: any) {
  try {
    const newContent = JSON.stringify(data, null, 2);
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, "utf-8");
      if (existing.trim() === newContent.trim()) {
        return; // Skip writing if identical to avoid triggering file watchers
      }
    }
    fs.writeFileSync(filePath, newContent, "utf-8");
  } catch (e) {
    console.error(`Error writing file ${filePath}:`, e);
  }
}

function loadAttendanceRecords(): ServerAttendanceRecord[] {
  try {
    if (fs.existsSync(ATTENDANCE_FILE)) {
      const data = fs.readFileSync(ATTENDANCE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading attendance file:", e);
  }
  return [];
}

function saveAttendanceRecords(records: ServerAttendanceRecord[]) {
  safeWriteJsonFile(ATTENDANCE_FILE, records);
}

async function autoMigrateLocalAttendanceToSupabase() {
  const supabase = getServerSupabase();
  if (!supabase) return;
  try {
    const localRecords = loadAttendanceRecords();
    if (!Array.isArray(localRecords) || localRecords.length === 0) return;

    let syncedCount = 0;
    for (const rec of localRecords) {
      if (!rec || !rec.technician_name) continue;
      const attDate = rec.attendance_date || new Date().toISOString().split("T")[0];
      const attType = rec.attendance_type || (rec.is_bypassed ? "bypass" : rec.is_off_duty ? "off_duty" : "masuk");
      const cleanShift = (rec.shift === "Malam" || rec.shift === "M") ? "M" : "PS";

      try {
        const { error } = await supabase
          .from("attendance")
          .upsert(
            {
              attendance_id: rec.id,
              technician_id: rec.technician_id || null,
              technician_name: rec.technician_name.trim(),
              operational_date: attDate,
              shift: cleanShift,
              attendance_type: attType,
              attendance_time: rec.attendance_time || "",
              timestamp: rec.created_at
                ? (rec.created_at.includes('+') ? rec.created_at : getJakartaISOString(new Date(rec.created_at)))
                : getJakartaISOString(),
              status: rec.status || "Tepat Waktu",
              is_bypassed: Boolean(rec.is_bypassed),
              is_off_duty: Boolean(rec.is_off_duty),
              photo_url: rec.photo_url || null,
              photo_object_key: rec.photo_object_key || null,
              latitude: rec.location?.latitude || null,
              longitude: rec.location?.longitude || null,
              distance_meters: rec.location?.distance_meters || null,
              is_within_radius: rec.location?.is_within_radius !== false,
              notes: rec.notes || "",
              verification_status: rec.verification_status || "verified",
              raw_data: rec,
            },
            {
              onConflict: "operational_date,technician_name,attendance_type",
              ignoreDuplicates: true,
            }
          );
        if (!error) syncedCount++;
      } catch (_) {}
    }
    if (syncedCount > 0) {
      console.log(`[Attendance Startup Sync] Successfully checked/synced ${syncedCount} records to Supabase.`);
    }
  } catch (err) {
    console.warn("[Attendance Startup Sync Warning]:", err);
  }
}

const DEFAULT_EQUIPMENT_TYPES = [
  { id: 1, name: 'X-Ray System', code: 'XRAY', priority: 1 },
  { id: 2, name: 'Walk Through Metal Detector', code: 'WTMD', priority: 2 },
  { id: 3, name: 'Hand Held Metal Detector', code: 'HHMD', priority: 3 },
  { id: 4, name: 'Explosive Trace Detector', code: 'ETD', priority: 4 },
];

const DEFAULT_EQUIPMENTS: OperationalEquipment[] = [
  // X-Ray (10 unit)
  { id: 1, equipment_type_id: 1, equipment_code: 'EQ-XRAY-01', name: 'BACK UP AREA', location_name: 'BACK UP AREA', brand: 'SMITHS DETECTION', model: '100100 T 2IS', type: 'XRAY', public_id: 'N7PK2A9XQ' },
  { id: 2, equipment_type_id: 1, equipment_code: 'EQ-XRAY-02', name: 'BHS Line Batik', location_name: 'BHS Line Batik', brand: 'SMITHS DETECTION', model: '100100 T 2IS', type: 'XRAY', public_id: 'B8K2L4MP9' },
  { id: 3, equipment_type_id: 1, equipment_code: 'EQ-XRAY-03', name: 'BHS Line Citilink', location_name: 'BHS Line Citilink', brand: 'SMITHS DETECTION', model: '100100 T 2IS', type: 'XRAY', public_id: 'X4R9T1ZQ2' },
  { id: 4, equipment_type_id: 1, equipment_code: 'EQ-XRAY-04', name: 'VVIP SMP SETNEG', location_name: 'VVIP SMP SETNEG', brand: 'SMITHS DETECTION', model: '100100 T 2IS', type: 'XRAY', public_id: 'W7M3P5LD8' },
  { id: 5, equipment_type_id: 1, equipment_code: 'EQ-XRAY-05', name: 'MSCP EMERGENCY BATIK', location_name: 'MSCP EMERGENCY BATIK', brand: 'NUCHTECH', model: 'CX 6040D', type: 'XRAY', public_id: 'H9B2C8LK4' },
  { id: 6, equipment_type_id: 1, equipment_code: 'EQ-XRAY-06', name: 'CIP KARYAWAN', location_name: 'CIP KARYAWAN', brand: 'SMITHS DETECTION', model: '6040 2IS HR', type: 'XRAY', public_id: 'E5T1Q7NR6' },
  { id: 7, equipment_type_id: 1, equipment_code: 'EQ-XRAY-07', name: 'HBSCP LINE C', location_name: 'HBSCP LINE C', brand: 'SMITHS DETECTION', model: '6040 2IS HR', type: 'XRAY', public_id: 'K3L8M2PX5' },
  { id: 8, equipment_type_id: 1, equipment_code: 'EQ-XRAY-08', name: 'HBSCP LINE D', location_name: 'HBSCP LINE D', brand: 'SMITHS DETECTION', model: '6040 2IS HR', type: 'XRAY', public_id: 'J6N9P4RT1' },
  { id: 9, equipment_type_id: 1, equipment_code: 'EQ-XRAY-09', name: 'HBSCP LINE E', location_name: 'HBSCP LINE E', brand: 'SMITHS DETECTION', model: '6040 2IS HR', type: 'XRAY', public_id: 'M2X8T5KQ7' },
  { id: 10, equipment_type_id: 1, equipment_code: 'EQ-XRAY-10', name: 'PINTU LAUD', location_name: 'PINTU LAUD', brand: 'SMITHS DETECTION', model: '6040 2IS HR', type: 'XRAY', public_id: 'P4Q7L9ZM3' },

  // ETD (1 unit)
  { id: 11, equipment_type_id: 4, equipment_code: 'EQ-ETD-01', name: 'REKONSILIASI ROOM', location_name: 'REKONSILIASI ROOM', brand: 'HIKVISION', model: 'ISD-SE311H', type: 'ETD', public_id: 'R9T2W4NL8' },

  // WTMD (7 unit)
  { id: 12, equipment_type_id: 2, equipment_code: 'EQ-WTMD-01', name: 'BACK UP AREA', location_name: 'BACK UP AREA', brand: 'CEIA', model: 'HIPE/PZ', type: 'WTMD', public_id: 'T5K8P2XM4' },
  { id: 13, equipment_type_id: 2, equipment_code: 'EQ-WTMD-02', name: 'CIP KARYAWAN', location_name: 'CIP KARYAWAN', brand: 'CEIA', model: 'HIPE/PZ', type: 'WTMD', public_id: 'C7M4L9RQ2' },
  { id: 14, equipment_type_id: 2, equipment_code: 'EQ-WTMD-03', name: 'HBSCP LINE C', location_name: 'HBSCP LINE C', brand: 'CEIA', model: 'HIPE/PZ', type: 'WTMD', public_id: 'L2N8T6KP5' },
  { id: 15, equipment_type_id: 2, equipment_code: 'EQ-WTMD-04', name: 'HBSCP LINE D', location_name: 'HBSCP LINE D', brand: 'CEIA', model: 'HIPE/PZ', type: 'WTMD', public_id: 'D9P3K7MR1' },
  { id: 16, equipment_type_id: 2, equipment_code: 'EQ-WTMD-05', name: 'HBSCP LINE E', location_name: 'HBSCP LINE E', brand: 'CEIA', model: 'HIPE/PZ', type: 'WTMD', public_id: 'V4T8M2LP6' },
  { id: 17, equipment_type_id: 2, equipment_code: 'EQ-WTMD-06', name: 'PINTU LAUD', location_name: 'PINTU LAUD', brand: 'CEIA', model: 'HIPE/PZ', type: 'WTMD', public_id: 'S6K2P9TR4' },
  { id: 18, equipment_type_id: 2, equipment_code: 'EQ-WTMD-07', name: 'VVIP SMP SETNEG', location_name: 'VVIP SMP SETNEG', brand: 'CEIA', model: 'HIPE/PZ', type: 'WTMD', public_id: 'A3M7L5NQ8' },

  // HHMD (9 unit)
  { id: 19, equipment_type_id: 3, equipment_code: 'EQ-HHMD-01', name: 'ARRIVAL', location_name: 'ARRIVAL', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'Z8K4P1TM5' },
  { id: 20, equipment_type_id: 3, equipment_code: 'EQ-HHMD-02', name: 'BACK UP AREA', location_name: 'BACK UP AREA', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'G2L9N4RQ7' },
  { id: 21, equipment_type_id: 3, equipment_code: 'EQ-HHMD-03', name: 'CIP KARYAWAN', location_name: 'CIP KARYAWAN', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'F7M3K8PT2' },
  { id: 22, equipment_type_id: 3, equipment_code: 'EQ-HHMD-04', name: 'HBSCP LINE C', location_name: 'HBSCP LINE C', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'Q4P8L2NM6' },
  { id: 23, equipment_type_id: 3, equipment_code: 'EQ-HHMD-05', name: 'HBSCP LINE D', location_name: 'HBSCP LINE D', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'Y9K5T3MR1' },
  { id: 24, equipment_type_id: 3, equipment_code: 'EQ-HHMD-06', name: 'HBSCP LINE E', location_name: 'HBSCP LINE E', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'U2M7P4LQ8' },
  { id: 25, equipment_type_id: 3, equipment_code: 'EQ-HHMD-07', name: 'PINTU LAUD', location_name: 'PINTU LAUD', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'W5L2K9RT4' },
  { id: 26, equipment_type_id: 3, equipment_code: 'EQ-HHMD-08', name: 'REKONSILIASI ROOM', location_name: 'REKONSILIASI ROOM', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'H8P4M1NQ6' },
  { id: 27, equipment_type_id: 3, equipment_code: 'EQ-HHMD-09', name: 'RUANG ISTIRAHAT SCP 2', location_name: 'RUANG ISTIRAHAT SCP 2', brand: 'CEIA', model: 'PD140E', type: 'HHMD', public_id: 'B3T7L9KM2' },
];

function loadSubscribers(): TelegramSubscriber[] {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const data = fs.readFileSync(SUBSCRIBERS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading subscribers file:", e);
  }
  return [];
}

function saveSubscribers(subs: TelegramSubscriber[]) {
  safeWriteJsonFile(SUBSCRIBERS_FILE, subs);
}

function loadTelegramServerConfig(): TelegramServerConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (!parsed.chat_id) {
        parsed.chat_id = process.env.TELEGRAM_CHAT_ID || "-5531204015";
      }
      return parsed;
    }
  } catch (e) {
    console.error("Error reading server config file:", e);
  }
  return {
    chat_id: process.env.TELEGRAM_CHAT_ID || "-5531204015",
    broadcast_to_all_subscribers: true,
    auto_notify_corrective: true,
    auto_notify_recurring_fault: true,
  };
}

function saveTelegramServerConfig(cfg: TelegramServerConfig) {
  safeWriteJsonFile(CONFIG_FILE, cfg);
}

function loadOperationalState(): OperationalState {
  try {
    if (fs.existsSync(OPERATIONAL_STATE_FILE)) {
      const data = fs.readFileSync(OPERATIONAL_STATE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading operational state file:", e);
  }
  return {
    operationalDate: new Date().toISOString().split("T")[0],
    shift: "pagi",
    technicianNames: [],
    equipments: DEFAULT_EQUIPMENTS,
    correctiveReports: [],
    updatedAt: new Date().toISOString(),
  };
}

function saveOperationalState(state: OperationalState) {
  safeWriteJsonFile(OPERATIONAL_STATE_FILE, state);
}

// Tracks recent message IDs sent or received per chat to support automatic clean up
const chatRecentMessages = new Map<string, number[]>();

function recordChatMessage(chatId: string, messageId: number) {
  if (!messageId || !chatId) return;
  const strId = String(chatId);
  const list = chatRecentMessages.get(strId) || [];
  if (!list.includes(messageId)) {
    list.push(messageId);
  }
  // Keep up to 30 recent message IDs per chat
  if (list.length > 30) {
    list.splice(0, list.length - 30);
  }
  chatRecentMessages.set(strId, list);
}

async function cleanChatMessages(chatId: string, token: string, excludeIds: number[] = []) {
  if (!chatId || !token) return;
  const strId = String(chatId);
  const list = chatRecentMessages.get(strId) || [];
  if (list.length === 0) return;
  const toDelete = list.filter((id) => !excludeIds.includes(id));
  chatRecentMessages.set(strId, list.filter((id) => excludeIds.includes(id)));

  for (const msgId of toDelete) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: strId, message_id: msgId }),
      });
    } catch (_) {
      // Ignore errors if already deleted or permissions missing
    }
  }
}

let lastProcessedUpdateId = 0;
let isPollingStarted = false;
let isPollingActive = false;
let telegramPollingAbortController: AbortController | null = null;
let operationalHealthCheckInterval: NodeJS.Timeout | null = null;

process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Unhandled Rejection] at:", promise, "reason:", reason);
});

const DANGEROUS_XSS_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const DANGEROUS_INLINE_EVENT_REGEX = /\b(on\w+|javascript:|vbscript:)\s*=/gi;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeBackendString(str: string): string {
  // Preserve base64 image data URIs
  if (str.startsWith("data:image/")) {
    return str;
  }
  let s = str.replace(/\0/g, ""); // strip null bytes
  s = s.replace(DANGEROUS_XSS_REGEX, "");
  s = s.replace(DANGEROUS_INLINE_EVENT_REGEX, "");
  return s;
}

export function sanitizeBackendInput(input: any, depth = 0): any {
  if (depth > 12) return input;
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    return sanitizeBackendString(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeBackendInput(item, depth + 1));
  }

  if (typeof input === "object") {
    const cleanObj: any = {};
    for (const [key, value] of Object.entries(input)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
      cleanObj[key] = sanitizeBackendInput(value, depth + 1);
    }
    return cleanObj;
  }

  return input;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Set trust proxy for Cloud Run and reverse proxies (enables accurate client IP detection)
  app.set("trust proxy", 1);

  // 1. Helmet Security Headers (iframe compatible for AI Studio & SPA)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    })
  );

  // 2. CORS Policy
  const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || "";
  const defaultAllowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://nararyaapps.net",
    "https://www.nararyaapps.net",
  ];
  const configuredOrigins = rawAllowedOrigins
    ? rawAllowedOrigins.split(",").map((o) => o.trim()).filter(Boolean)
    : defaultAllowedOrigins;

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          configuredOrigins.includes(origin) ||
          origin.includes("run.app") ||
          origin.includes("localhost") ||
          origin.includes("127.0.0.1")
        ) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    })
  );

  // 3. Rate Limiters (configured for Cloud Run / proxy environments)
  const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 400,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { success: false, error: "Terlalu banyak permintaan. Silakan coba lagi beberapa saat." },
  });

  const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30, // 30 attempts per 5 minutes
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { success: false, error: "Terlalu banyak percobaan login. Silakan coba lagi dalam 5 menit." },
  });

  const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 80,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { success: false, error: "Batas frekuensi upload tercapai. Mohon tunggu sejenak." },
  });

  const livenessLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { success: false, error: "Batas frekuensi verifikasi wajah tercapai." },
  });

  // JSON & URL-encoded parser with 30mb limit for large photos/documents
  app.use(express.json({ limit: "30mb" }));
  app.use(express.urlencoded({ extended: true, limit: "30mb" }));

  // Global Input Sanitization Middleware (XSS, Prototype Pollution, Null-Byte Injection)
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeBackendInput(req.body);
    }
    if (req.query && typeof req.query === "object") {
      req.query = sanitizeBackendInput(req.query);
    }
    if (req.params && typeof req.params === "object") {
      req.params = sanitizeBackendInput(req.params);
    }
    next();
  });

  app.use("/api/", apiLimiter);

  // Authoritative Server Time & Clock Sync (Anti-manipulation)
  app.get("/api/time", (_req, res) => {
    const now = new Date();
    res.json({
      success: true,
      timestamp: now.getTime(),
      iso: getJakartaISOString(now),
      timezone: "Asia/Jakarta",
    });
  });

  // 4. Global Auth Resolution Middleware (Supports Technician Token, Supabase Auth JWT, and Query Param Tokens)
  app.use(async (req, res, next) => {
    const authHeader =
      (req.headers.authorization as string) ||
      (req.headers["x-technician-token"] as string) ||
      (req.query.token as string) ||
      (req.query.t as string) ||
      "";
    let token = "";
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    } else if (authHeader) {
      token = authHeader.trim();
    }

    if (!token) {
      return next();
    }

    // A. Verify Supabase Auth JWT (Primary when token is a JWT format or standard Bearer token)
    const isJwt = token.startsWith("ey") || token.split(".").length === 3;
    const supabase = getServerSupabase();

    if (isJwt && supabase) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) {
          const u = data.user;
          const now = Date.now();
          const MAX_SESSION_MS = 16 * 60 * 60 * 1000; // 16 hours absolute limit
          const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours idle timeout

          // 1. Enforce 16-hour absolute session limit from initial credentials sign-in time (last_sign_in_at)
          if (u.last_sign_in_at) {
            const initialLoginTime = new Date(u.last_sign_in_at).getTime();
            if (!isNaN(initialLoginTime) && now - initialLoginTime > MAX_SESSION_MS) {
              return res.status(401).json({
                success: false,
                error: "Sesi login telah melewati batas maksimal 16 jam sejak login awal. Silakan login kembali demi keamanan.",
                code: "SESSION_EXPIRED_MAX_LIMIT",
              });
            }
          }

          // 2. Enforce 6-hour inactivity timeout tracked on server
          const lastActive = userSessionActivityMap.get(u.id);
          if (lastActive && now - lastActive > INACTIVITY_TIMEOUT_MS) {
            userSessionActivityMap.delete(u.id);
            return res.status(401).json({
              success: false,
              error: "Sesi login telah kedaluwarsa karena tidak ada aktivitas selama 6 jam. Silakan login kembali.",
              code: "SESSION_EXPIRED_INACTIVITY",
            });
          }

          // Record user activity timestamp on server
          userSessionActivityMap.set(u.id, now);

          let userRole: "supervisor" | "technician" | "admin" | "system_admin" | "operations_admin" = "technician";
          let userTechId: number | undefined = undefined;
          let displayName = u.user_metadata?.display_name || u.user_metadata?.full_name || u.email?.split("@")[0] || "User";

          const { data: prof } = await supabase
            .from("profiles")
            .select("id, role, technician_id, display_name, active")
            .eq("id", u.id)
            .maybeSingle();

          if (prof) {
            if (prof.active === false) {
              return res.status(403).json({
                success: false,
                error: "Akun Anda berstatus nonaktif. Silakan hubungi Administrator.",
                code: "ACCOUNT_INACTIVE",
              });
            }
            if (prof.role === "system_admin") {
              userRole = "system_admin";
            } else if (prof.role === "operations_admin") {
              userRole = "operations_admin";
            } else if (prof.role === "supervisor") {
              userRole = "supervisor";
            }
            if (prof.technician_id != null && !isNaN(Number(prof.technician_id))) {
              userTechId = Number(prof.technician_id);
            }
            if (prof.display_name && prof.display_name.trim()) {
              displayName = prof.display_name.trim();
            }
          } else {
            if (u.email?.toLowerCase() === "kamal@ntiapps.net") {
              return res.status(403).json({
                success: false,
                error: "Akun Anda berstatus nonaktif. Silakan hubungi Administrator.",
                code: "ACCOUNT_INACTIVE",
              });
            }
          }

          (req as any).user = {
            id: u.id, // Supabase Auth UUID string
            uid: u.id,
            technician_id: userTechId,
            name: displayName,
            email: u.email || "",
            role: userRole,
            type: "supabase",
          };
          return next();
        }
      } catch (_) {}
    }

    // B. Verify Legacy Technician HMAC token (Fallback)
    const techPayload = verifyTechnicianToken(token);
    if (techPayload) {
      if (techPayload.email?.toLowerCase() === "kamal@ntiapps.net" || techPayload.name?.toLowerCase() === "kamal") {
        return res.status(403).json({
          success: false,
          error: "Akun Anda berstatus nonaktif. Silakan hubungi Administrator.",
          code: "ACCOUNT_INACTIVE",
        });
      }
      if (supabase && techPayload.technician_id) {
        try {
          const { data: techRow } = await supabase
            .from("technicians")
            .select("active, role")
            .eq("id", techPayload.technician_id)
            .maybeSingle();
          if (techRow && techRow.active === false) {
            return res.status(403).json({
              success: false,
              error: "Akun Anda berstatus nonaktif. Silakan hubungi Administrator.",
              code: "ACCOUNT_INACTIVE",
            });
          }
          if (techRow && techRow.role) {
            techPayload.role = techRow.role;
          }
        } catch (_) {}
      }
      (req as any).user = {
        id: techPayload.technician_id,
        uid: techPayload.uid,
        name: techPayload.name,
        code: techPayload.code,
        email: techPayload.email,
        role: techPayload.role,
        type: "technician",
      };
      return next();
    }

    // C. Verify non-standard Supabase token if not caught above
    if (!isJwt && supabase) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) {
          const u = data.user;
          let userRole: "supervisor" | "technician" | "system_admin" | "operations_admin" = "technician";
          let userTechId: number | undefined = undefined;
          let displayName = u.user_metadata?.display_name || u.user_metadata?.full_name || u.email?.split("@")[0] || "User";

          const { data: prof } = await supabase
            .from("profiles")
            .select("id, role, technician_id, display_name, active")
            .eq("id", u.id)
            .maybeSingle();

          if (prof) {
            if (prof.active === false) {
              return res.status(403).json({
                success: false,
                error: "Akun Anda berstatus nonaktif. Silakan hubungi Administrator.",
                code: "ACCOUNT_INACTIVE",
              });
            }
            if (prof.role === "system_admin") {
              userRole = "system_admin";
            } else if (prof.role === "operations_admin") {
              userRole = "operations_admin";
            } else if (prof.role === "supervisor") {
              userRole = "supervisor";
            }
            if (prof.technician_id != null && !isNaN(Number(prof.technician_id))) {
              userTechId = Number(prof.technician_id);
            }
            if (prof.display_name && prof.display_name.trim()) {
              displayName = prof.display_name.trim();
            }
          } else {
            if (u.email?.toLowerCase() === "kamal@ntiapps.net") {
              return res.status(403).json({
                success: false,
                error: "Akun Anda berstatus nonaktif. Silakan hubungi Administrator.",
                code: "ACCOUNT_INACTIVE",
              });
            }
          }

          (req as any).user = {
            id: u.id,
            uid: u.id,
            technician_id: userTechId,
            name: displayName,
            email: u.email || "",
            role: userRole,
            type: "supabase",
          };
          return next();
        }
      } catch (_) {}
    }

    next();
  });

  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as any).user) {
      return res.status(401).json({
        success: false,
        error: "Autentikasi diperlukan. Silakan login terlebih dahulu.",
      });
    }
    next();
  };

  const requireSystemAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as any).user) {
      return res.status(401).json({
        success: false,
        error: "Autentikasi diperlukan. Silakan login terlebih dahulu.",
      });
    }
    const r = (req as any).user.role;
    if (r !== "system_admin") {
      return res.status(403).json({
        success: false,
        error: "Akses ditolak. Fitur ini hanya dapat diakses oleh Akun System Administrator.",
      });
    }
    next();
  };

  const requireOperationsOrAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as any).user) {
      return res.status(401).json({
        success: false,
        error: "Autentikasi diperlukan. Silakan login terlebih dahulu.",
      });
    }
    const r = (req as any).user.role;
    if (r !== "operations_admin" && r !== "system_admin" && r !== "supervisor") {
      return res.status(403).json({
        success: false,
        error: "Akses ditolak. Fitur ini hanya dapat diakses oleh Administrator Operasional atau Supervisor.",
      });
    }
    next();
  };

  const requireSupervisor = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as any).user) {
      return res.status(401).json({
        success: false,
        error: "Autentikasi diperlukan. Silakan login sebagai supervisor atau administrator.",
      });
    }
    const r = (req as any).user.role;
    if (r !== "supervisor" && r !== "system_admin") {
      return res.status(403).json({
        success: false,
        error: "Akses ditolak. Fitur ini hanya dapat diakses oleh akun Supervisor atau System Administrator.",
      });
    }
    next();
  };

  // Authoritative Server-Side RBAC & Operational Permission Check Route
  app.post("/api/rbac/check-permission", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const userRole: 'system_admin' | 'operations_admin' | 'supervisor' | 'technician' | 'admin' =
        user.role === 'system_admin' ? 'system_admin' :
        user.role === 'operations_admin' ? 'operations_admin' :
        user.role === 'admin' ? 'admin' :
        user.role === 'supervisor' ? 'supervisor' : 'technician';

      const supabase = getServerSupabase();
      let psDoc = null;
      let mDoc = null;
      let officeDoc = null;

      const serverNow = new Date();
      const datePart = serverNow.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

      if (supabase) {
        try {
          const { data: psData } = await supabase
            .from("shift_schedules")
            .select("*")
            .eq("schedule_date", datePart)
            .eq("shift", "PS")
            .limit(1);
          if (psData && psData.length > 0) psDoc = psData[0];

          const { data: mData } = await supabase
            .from("shift_schedules")
            .select("*")
            .eq("schedule_date", datePart)
            .eq("shift", "M")
            .limit(1);
          if (mData && mData.length > 0) mDoc = mData[0];

          const { data: officeData } = await supabase
            .from("shift_schedules")
            .select("*")
            .eq("schedule_date", datePart)
            .eq("shift", "OFFICE")
            .limit(1);
          if (officeData && officeData.length > 0) officeDoc = officeData[0];
        } catch (_) {}
      }

      // Safely resolve technician ID: use user.technician_id (numeric), do NOT Number(UUID)
      const effectiveTechId = user.technician_id !== undefined ? user.technician_id : (typeof user.id === 'number' ? user.id : undefined);

      const permissionResult = evaluateOperationalPermissions({
        userRole,
        technician: {
          id: effectiveTechId,
          name: user.name || user.code || "",
        },
        nowDate: serverNow,
        scheduleDocPS: psDoc,
        scheduleDocM: mDoc,
        scheduleDocOffice: officeDoc,
        ...(supabase ? await loadServerShiftContext(supabase, serverNow) : {}),
      });

      return res.json({
        success: true,
        permissionResult,
        serverTime: serverNow.toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Gagal memvalidasi hak akses server" });
    }
  });

  // ==============================================================================
  // CATEGORY 4: OPERATIONAL HEALTH & EQUIPMENT MONITORING
  // ==============================================================================

  interface ServiceFailureTracker {
    consecutiveFailures: number;
    alertSent: boolean;
    lastAlertAt: number;
  }

  const operationalAlertState: Record<string, ServiceFailureTracker> = {
    database: { consecutiveFailures: 0, alertSent: false, lastAlertAt: 0 },
    storage: { consecutiveFailures: 0, alertSent: false, lastAlertAt: 0 },
    disk: { consecutiveFailures: 0, alertSent: false, lastAlertAt: 0 },
  };

  const ALERT_FAILURE_THRESHOLD = 3;
  const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

  async function sendTelegramAlertMessage(text: string): Promise<boolean> {
    const tgCfg = loadTelegramServerConfig();
    const token = tgCfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = tgCfg.chat_id || process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return false;

    try {
      let resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      let data = (await resp.json()) as any;
      if (!data?.ok && data?.description?.includes("can't parse entities")) {
        resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.replace(/<[^>]*>?/gm, ""),
            disable_web_page_preview: true,
          }),
        });
        data = (await resp.json()) as any;
      }
      return Boolean(data?.ok);
    } catch (err) {
      console.warn("[sendTelegramAlertMessage Error]:", err);
      return false;
    }
  }

  async function triggerOperationalAlert(
    serviceName: string,
    failed: boolean,
    errorDetail: string = ""
  ) {
    const tracker = operationalAlertState[serviceName];
    if (!tracker) return;

    if (failed) {
      tracker.consecutiveFailures++;
      const now = Date.now();
      if (
        tracker.consecutiveFailures >= ALERT_FAILURE_THRESHOLD &&
        (!tracker.alertSent || now - tracker.lastAlertAt > ALERT_COOLDOWN_MS)
      ) {
        tracker.alertSent = true;
        tracker.lastAlertAt = now;
        const message = `🚨 <b>[SYSTEM ALERT] Operational Health Warning</b>\n\n` +
          `• <b>Layanan:</b> ${serviceName.toUpperCase()}\n` +
          `• <b>Status:</b> MENGALAMI KEGAGALAN (${tracker.consecutiveFailures}x berturut-turut)\n` +
          `• <b>Detail:</b> ${errorDetail || "Service unreachable or returned error"}\n` +
          `• <b>Waktu:</b> ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`;
        await sendTelegramAlertMessage(message);
      }
    } else {
      if (tracker.alertSent) {
        tracker.alertSent = false;
        tracker.consecutiveFailures = 0;
        const message = `✅ <b>[RECOVERY NOTICE] System Service Normal</b>\n\n` +
          `• <b>Layanan:</b> ${serviceName.toUpperCase()}\n` +
          `• <b>Status:</b> Kembali NORMAL / Operational\n` +
          `• <b>Waktu:</b> ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`;
        await sendTelegramAlertMessage(message);
      } else {
        tracker.consecutiveFailures = 0;
      }
    }
  }

  // 1. Basic Public Health Endpoint (Lightweight & Public-Safe)
  app.get("/api/health", (req, res) => {
    let status = "healthy";
    if (operationalAlertState.database.consecutiveFailures >= 1) {
      status = "unhealthy";
    } else if (
      operationalAlertState.storage.consecutiveFailures >= 1 ||
      operationalAlertState.disk.consecutiveFailures >= 1
    ) {
      status = "degraded";
    }
    res.json({
      status,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      app: "X-Ray Reporting App",
    });
  });

  // 1b. Public Machine History Endpoint (Public Read-Only, No Auth Required)
  // Strictly exposes sanitized, read-only equipment & maintenance history.
  // NEVER exposes attendance, GPS, user UID/tokens, Telegram configs, or internal secret keys.
  app.get("/api/public/equipment/:equipmentCode/history", async (req, res) => {
    try {
      const rawCode = (req.params.equipmentCode || "").trim();
      if (!rawCode) {
        return res.status(400).json({
          success: false,
          error: "Kode peralatan atau ID mesin wajib disertakan.",
        });
      }

      const supabase = getServerSupabase();
      let equipment: any = null;
      const cleanSearch = String(rawCode || "").trim().toUpperCase();
      const isNum = !isNaN(Number(cleanSearch));
      const numericId: number | null = isNum ? Number(cleanSearch) : null;

      let allTechs: any[] = [];
      if (supabase) {
        // Fetch technicians for name lookup (never select revoked password column)
        try {
          const { data: techRows } = await supabase.from("technicians").select("id, code, name, email");
          if (Array.isArray(techRows)) allTechs = techRows;
        } catch (_) {}

        // 1. Find equipment by equipment_code, id, public_id, or name
        try {
          const { data: allEq } = await supabase.from("equipment").select("*");
          if (Array.isArray(allEq) && allEq.length > 0) {
            equipment = allEq.find((e: any) => {
              const matchId = numericId !== null && Number(e.id) === numericId;
              const matchCode = (e.equipment_code || "").toUpperCase() === cleanSearch;
              const matchPublic = (e.public_id || "").toUpperCase() === cleanSearch;
              const matchName = (e.equipment_name || e.name || "").toUpperCase().includes(cleanSearch);
              return matchId || matchCode || matchPublic || matchName;
            });
          }
        } catch (e) {
          console.warn("[PublicHistory] Supabase equipment query warning:", e);
        }
      }

      // Fallback to DEFAULT_EQUIPMENTS
      if (!equipment) {
        equipment = DEFAULT_EQUIPMENTS.find((e: any) => {
          const matchId = numericId !== null && Number(e.id) === numericId;
          const matchCode = (e.equipment_code || "").toUpperCase() === cleanSearch;
          const matchPublic = (e.public_id || "").toUpperCase() === cleanSearch;
          const matchName = (e.name || "").toUpperCase().includes(cleanSearch);
          return matchId || matchCode || matchPublic || matchName;
        });
      }

      if (!equipment) {
        return res.status(404).json({
          success: false,
          error: "Peralatan tidak ditemukan atau kode mesin tidak valid.",
        });
      }

      const targetId = Number(equipment.id);
      const getTechNameById = (id: number | string) => {
        const found = allTechs.find((t) => Number(t.id) === Number(id));
        return found?.name || "Teknisi On-Duty";
      };

      // 2. Fetch preventive records for this equipment (Read-only, sanitized)
      let preventiveList: any[] = [];
      if (supabase) {
        try {
          const { data: prevData, error: prevErr } = await supabase
            .from("preventive_records")
            .select("*")
            .eq("equipment_id", targetId)
            .order("operational_date", { ascending: false })
            .limit(100);

          if (!prevErr && Array.isArray(prevData)) {
            preventiveList = prevData.map((r: any) => {
              const freqId = Number(r.checklist_frequency_id || 1);
              const freqLabel =
                freqId === 1 ? "Harian" :
                freqId === 2 ? "Mingguan" :
                freqId === 3 ? "Bulanan" :
                freqId === 4 ? "Triwulan" :
                freqId === 5 ? "Semester" :
                freqId === 6 ? "Tahunan" : "Berkala";

              let techName = "Teknisi On-Duty";
              if (Array.isArray(r.submitted_by_technician_ids) && r.submitted_by_technician_ids.length > 0) {
                const names = r.submitted_by_technician_ids.map((tid: any) => getTechNameById(tid));
                techName = names.join(", ");
              } else if (r.technician_name) {
                techName = r.technician_name;
              }

              return {
                date: r.operational_date || (r.submitted_at ? r.submitted_at.split("T")[0] : ""),
                frequency: freqLabel,
                status: r.status || "OK",
                summary: r.notes && r.notes.trim() ? r.notes : "Pemeriksaan selesai sesuai SOP",
                technician_name: techName,
                created_at: r.created_at || r.submitted_at || "",
              };
            });
          }
        } catch (prevErr) {
          console.warn("[PublicHistory] Preventive query warning:", prevErr);
        }
      }

      // 3. Fetch corrective records for this equipment (Read-only, sanitized)
      let correctiveList: any[] = [];
      if (supabase) {
        try {
          const { data: corrData, error: corrErr } = await supabase
            .from("corrective_records")
            .select("*")
            .eq("equipment_id", targetId)
            .order("operational_date", { ascending: false })
            .limit(100);

          if (!corrErr && Array.isArray(corrData)) {
            correctiveList = corrData.map((c: any) => ({
              date: c.operational_date || (c.created_at ? c.created_at.split("T")[0] : ""),
              code: c.corrective_code || "CR",
              problem: c.problem_description || "-",
              action: c.action_taken || "-",
              result: c.result || c.result_text || "Selesai",
              root_cause: c.root_cause || "-",
              technicians: Array.isArray(c.technicians) ? c.technicians : (c.technicians ? [String(c.technicians)] : []),
              completion_date: c.operational_date || "",
            }));
          }
        } catch (corrErr) {
          console.warn("[PublicHistory] Corrective query warning:", corrErr);
        }
      }

      // 4. Fetch component replacements for this equipment (Read-only, sanitized)
      let componentList: any[] = [];
      if (supabase) {
        try {
          const { data: compData } = await supabase
            .from("component_replacements")
            .select("*")
            .eq("equipment_id", targetId)
            .order("created_at", { ascending: false })
            .limit(100);

          if (Array.isArray(compData)) {
            componentList = compData.map((cmp: any) => ({
              date: cmp.replaced_at || (cmp.created_at ? cmp.created_at.split("T")[0] : ""),
              component_name: cmp.component_name || "-",
              part_number: cmp.part_number || "-",
              quantity: cmp.quantity || 1,
              reason: cmp.reason || "Penggantian komponen berkala",
              origin: cmp.origin || "-",
              technicians: Array.isArray(cmp.technician_names) ? cmp.technician_names : [],
              remarks: cmp.remarks || "-",
            }));
          }
        } catch (compErr) {
          console.warn("[PublicHistory] Component replacements query warning:", compErr);
        }
      }

      // Safe sanitized equipment identity (Strict zero leak of private fields)
      const sanitizedEquipment = {
        id: equipment.id,
        equipment_code: equipment.equipment_code || equipment.code || `EQ-${equipment.id}`,
        name: equipment.equipment_name || equipment.name || "X-Ray Security System",
        type: equipment.type || equipment.equipment_type || "X-Ray Scanner",
        brand: equipment.brand || "-",
        model: equipment.model || "-",
        serial_number: equipment.serial_number || "-",
        location: equipment.location_name || equipment.location || "Area Bandara",
        status: equipment.status || "OPERATIONAL",
        installation_year: equipment.installation_year || equipment.year || null,
        description: equipment.description || "",
      };

      const lastPreventive = preventiveList[0]?.date || null;
      const lastCorrective = correctiveList[0]?.date || null;

      return res.json({
        success: true,
        data: {
          equipment: sanitizedEquipment,
          stats: {
            total_preventive: preventiveList.length,
            total_corrective: correctiveList.length,
            total_replacements: componentList.length,
            last_preventive_date: lastPreventive,
            last_corrective_date: lastCorrective,
          },
          preventive_history: preventiveList,
          corrective_history: correctiveList,
          component_replacements: componentList,
        },
      });
    } catch (err: any) {
      console.error("[PublicHistory Error]:", err);
      return res.status(500).json({
        success: false,
        error: "Terjadi kesalahan internal saat memuat riwayat publik peralatan.",
      });
    }
  });

  // 2. Detailed Supervisor Health Endpoint (Supervisor Only)
  app.get("/api/health/details", requireSupervisor, async (req, res) => {
    const timeoutMs = 3000;

    // Supabase DB Check
    let dbStatus = "ok";
    let dbLatencyMs: number | null = null;
    let dbError = "";
    try {
      const dbStart = performance.now();
      const supabase = getServerSupabase();
      if (!supabase) throw new Error("Supabase client not connected");

      const dbPromise = supabase.from("equipment").select("id").limit(1);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database query timeout (3s)")), timeoutMs)
      );
      const { error: dbErr } = (await Promise.race([dbPromise, timeoutPromise])) as any;
      if (dbErr) throw new Error(dbErr.message);

      dbLatencyMs = Math.round(performance.now() - dbStart);
      await triggerOperationalAlert("database", false);
    } catch (err: any) {
      dbStatus = "error";
      dbError = err?.message || "Database check failed";
      await triggerOperationalAlert("database", true, dbError);
    }

    // IDCloudHost S3 Check
    let storageStatus = "ok";
    let storageLatencyMs: number | null = null;
    let storageError = "";
    try {
      const s3Start = performance.now();
      const cfg = loadStorageConfig();
      if (!cfg.enabled || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
        storageStatus = "warning";
        storageError = "IDCloudHost storage belum dikonfigurasi lengkap";
      } else {
        const s3 = getS3Client(cfg);
        const s3Promise = s3.send(new HeadBucketCommand({ Bucket: cfg.bucketName }));
        const s3TimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Storage HeadBucket timeout (3s)")), timeoutMs)
        );
        await Promise.race([s3Promise, s3TimeoutPromise]);
        storageLatencyMs = Math.round(performance.now() - s3Start);
        await triggerOperationalAlert("storage", false);
      }
    } catch (err: any) {
      storageStatus = "error";
      storageError = err?.message || "Storage S3 failed";
      await triggerOperationalAlert("storage", true, storageError);
    }

    // Telegram Check
    let telegramStatus = "ok";
    const tgCfg = loadTelegramServerConfig();
    if (!tgCfg.bot_token || !tgCfg.chat_id) {
      telegramStatus = "warning";
    }

    // Gemini API Check (No inference request made to conserve quota)
    let geminiStatus = "ok";
    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!geminiKey) {
      geminiStatus = "warning";
    }

    // Server Resources
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMemPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

    let diskFreeStr = "N/A";
    try {
      const cwdStats = fs.statSync(process.cwd());
      diskFreeStr = `${Math.round(cwdStats.size / (1024 * 1024))} MB`;
    } catch (_) {}

    let overallStatus = "healthy";
    if (dbStatus === "error") {
      overallStatus = "unhealthy";
    } else if (storageStatus === "error" || telegramStatus === "warning" || usedMemPercent > 90) {
      overallStatus = "degraded";
    }

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      services: {
        database: { status: dbStatus, latency_ms: dbLatencyMs, error: dbError || undefined },
        object_storage: { status: storageStatus, latency_ms: storageLatencyMs, error: storageError || undefined },
        telegram: { status: telegramStatus, configured: Boolean(tgCfg.bot_token && tgCfg.chat_id) },
        gemini: { status: geminiStatus, configured: Boolean(geminiKey) },
      },
      server: {
        memory_usage: `${Math.round(mem.heapUsed / (1024 * 1024))} MB / ${Math.round(totalMem / (1024 * 1024))} MB (${usedMemPercent}%)`,
        disk_free: diskFreeStr,
        node_version: process.version,
      },
    });
  });

  // Background Lightweight Health Check Worker (Runs every 5 minutes)
  // PM2 setup operates as a single application instance.
  async function runOperationalHealthCheckWorker() {
    const timeoutMs = 3000;

    // Check Database
    try {
      const supabase = getServerSupabase();
      if (supabase) {
        const dbPromise = supabase.from("equipment").select("id").limit(1);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database query timeout (3s)")), timeoutMs)
        );
        const { error: dbErr } = (await Promise.race([dbPromise, timeoutPromise])) as any;
        if (dbErr) throw new Error(dbErr.message);
        await triggerOperationalAlert("database", false);
      }
    } catch (err: any) {
      await triggerOperationalAlert("database", true, err?.message || "Database check failed");
    }

    // Check Storage (IDCloudHost S3)
    try {
      const cfg = loadStorageConfig();
      if (cfg.enabled && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName) {
        const s3 = getS3Client(cfg);
        const s3Promise = s3.send(new HeadBucketCommand({ Bucket: cfg.bucketName }));
        const s3TimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Storage HeadBucket timeout (3s)")), timeoutMs)
        );
        await Promise.race([s3Promise, s3TimeoutPromise]);
        await triggerOperationalAlert("storage", false);
      }
    } catch (err: any) {
      await triggerOperationalAlert("storage", true, err?.message || "Storage S3 check failed");
    }
  }

  // Register 5-minute background operational health checker
  operationalHealthCheckInterval = setInterval(runOperationalHealthCheckWorker, 5 * 60 * 1000);

  // ==============================================================================
  // AUTHENTICATION ROUTES (TECHNICIANS TABLE AUTH & LAZY HASH MIGRATION)
  // ==============================================================================

  app.post("/api/auth/technician-login", authLimiter, async (req, res) => {
    try {
      const { identifier, password = "" } = req.body || {};
      const cleanId = (identifier || "").trim().toLowerCase();

      if (!cleanId) {
        return res.status(400).json({
          success: false,
          error: "Nama, kode ID, atau email teknisi wajib diisi.",
        });
      }

      const supabase = getServerSupabase();
      let matchedTech: any = null;

      if (supabase) {
        try {
          const { data, error } = await supabase
            .from("technicians")
            .select("id, code, name, email, password, role, active");

          if (!error && Array.isArray(data)) {
            matchedTech = data.find((t: any) => {
              const nameMatch = (t.name || "").trim().toLowerCase() === cleanId;
              const codeMatch = (t.code || "").trim().toLowerCase() === cleanId;
              const emailMatch = (t.email || "").trim().toLowerCase() === cleanId;
              return nameMatch || codeMatch || emailMatch;
            });
          }
        } catch (dbErr) {
          console.warn("[Technician Login Supabase Query Exception]:", dbErr);
        }
      }

      if (!matchedTech) {
        return res.status(404).json({
          success: false,
          error: `Akun "${identifier}" tidak ditemukan pada daftar teknisi / supervisor.`,
        });
      }

      const techEmail = (matchedTech.email || "").trim().toLowerCase();

      // Enforce inactive accounts (Kamal & active=false)
      if (
        matchedTech.active === false ||
        techEmail === "kamal@ntiapps.net" ||
        (matchedTech.name || "").trim().toLowerCase() === "kamal"
      ) {
        return res.status(403).json({
          success: false,
          error: `Akun "${matchedTech.name}" saat ini berstatus non-aktif. Silakan hubungi Administrator.`,
          code: "ACCOUNT_INACTIVE",
        });
      }

      // Authoritative cross-check with public.profiles if available
      if (supabase && techEmail) {
        try {
          const { data: profRow } = await supabase
            .from("profiles")
            .select("active, role")
            .eq("email", techEmail)
            .maybeSingle();

          if (profRow) {
            if (profRow.active === false) {
              return res.status(403).json({
                success: false,
                error: `Akun "${matchedTech.name}" saat ini berstatus non-aktif. Silakan hubungi Administrator.`,
                code: "ACCOUNT_INACTIVE",
              });
            }
            if (profRow.role) {
              matchedTech.role = profRow.role;
            }
          }
        } catch (_) {}
      }

      // Canonical RBAC mapping enforcement
      if (techEmail === "admin@ntiapps.net") {
        matchedTech.role = "system_admin";
      } else if (techEmail === "desi@ntiapps.net") {
        matchedTech.role = "operations_admin";
      } else if (techEmail === "luthfi@ntiapps.net") {
        matchedTech.role = "technician";
      }

      // Verify password with Lazy Migration
      const verification = verifyAndUpgradePassword(password, matchedTech.password);

      if (!verification.match) {
        return res.status(401).json({
          success: false,
          error: `Kata sandi untuk "${matchedTech.name}" tidak sesuai.`,
        });
      }

      // Lazy migration: If matched password was plaintext, upgrade to bcrypt hash in database
      if (verification.needsUpgrade && password && supabase) {
        try {
          const hashed = hashTechnicianPassword(password);
          await supabase.from("technicians").update({ password: hashed }).eq("id", matchedTech.id);
          console.log(`[Security Hardening] Successfully migrated password for technician #${matchedTech.id} to bcrypt hash.`);
        } catch (upgradeErr) {
          console.warn("[Password Upgrade Exception]:", upgradeErr);
        }
      }

      // Generate verified session token
      const token = generateTechnicianToken({
        id: matchedTech.id,
        code: matchedTech.code,
        name: matchedTech.name,
        email: matchedTech.email,
        role: matchedTech.role,
      });

      return res.json({
        success: true,
        token,
        user: {
          id: matchedTech.id,
          uid: `tech_${matchedTech.id}`,
          code: matchedTech.code,
          name: matchedTech.name,
          email: matchedTech.email,
          role: matchedTech.role || "technician",
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Kesalahan server saat login" });
    }
  });

  app.get("/api/auth/verify-session", (req, res) => {
    if ((req as any).user) {
      return res.json({ success: true, user: (req as any).user });
    }
    return res.status(401).json({ success: false, error: "Sesi tidak valid atau telah kedaluwarsa." });
  });

  app.post("/api/auth/technician-register", requireSupervisor, async (req, res) => {
    try {
      const { name, code, email, password = "", role = "technician" } = req.body || {};
      const cleanName = (name || "").trim();
      if (!cleanName) {
        return res.status(400).json({ success: false, error: "Nama teknisi wajib diisi." });
      }

      const supabase = getServerSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database Supabase belum terhubung di server." });
      }

      const hashedPassword = password ? hashTechnicianPassword(password) : "";
      const { data, error } = await supabase
        .from("technicians")
        .insert({
          name: cleanName,
          code: code || `TECH-${Date.now().toString().slice(-4)}`,
          email: email || `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, "")}@bandara.id`,
          password: hashedPassword,
          role: role === "supervisor" ? "supervisor" : "technician",
          active: true,
        })
        .select("id, code, name, email, role, active")
        .single();

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json({ success: true, technician: data });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Gagal mendaftarkan teknisi baru" });
    }
  });

  // ==============================================================================
  // IDCLOUDHOST OBJECT STORAGE S3 ROUTES (PRIVATE & PRESIGNED URLS)
  // ==============================================================================

  // Public/Display Config (Masked credentials, no secret key exposed)
  app.get("/api/storage/config", (req, res) => {
    const cfg = loadStorageConfig();
    res.json({
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey ? "********" : "",
      bucketName: cfg.bucketName,
      region: cfg.region,
      publicUrlBase: cfg.publicUrlBase,
      enabled: cfg.enabled,
      isConfigured: Boolean(cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName),
    });
  });

  // Save Storage Config (Supervisor only)
  app.post("/api/storage/config", requireSupervisor, (req, res) => {
    const current = loadStorageConfig();
    const { provider, endpoint, accessKeyId, secretAccessKey, bucketName, region, publicUrlBase, enabled } = req.body;
    const updated: ServerStorageConfig = {
      provider: provider || current.provider,
      endpoint: endpoint || current.endpoint,
      accessKeyId: accessKeyId !== undefined ? accessKeyId : current.accessKeyId,
      secretAccessKey: (secretAccessKey && secretAccessKey !== "********") ? secretAccessKey : current.secretAccessKey,
      bucketName: bucketName !== undefined ? bucketName : current.bucketName,
      region: region || current.region,
      publicUrlBase: publicUrlBase !== undefined ? publicUrlBase : current.publicUrlBase,
      enabled: enabled !== undefined ? Boolean(enabled) : current.enabled,
    };
    saveStorageConfig(updated);
    res.json({ success: true, message: "Konfigurasi IDCloudHost Object Storage berhasil disimpan" });
  });

  // Test Storage Connection (Supervisor only)
  app.post("/api/storage/test", requireSupervisor, async (req, res) => {
    const savedCfg = loadStorageConfig();
    const reqBody = req.body || {};
    const cfg: ServerStorageConfig = {
      provider: reqBody.provider || savedCfg.provider,
      endpoint: reqBody.endpoint || savedCfg.endpoint,
      accessKeyId: (reqBody.accessKeyId || savedCfg.accessKeyId || "").trim(),
      secretAccessKey: (reqBody.secretAccessKey && reqBody.secretAccessKey !== "********")
        ? reqBody.secretAccessKey.trim()
        : savedCfg.secretAccessKey.trim(),
      bucketName: (reqBody.bucketName !== undefined ? reqBody.bucketName : savedCfg.bucketName).trim(),
      region: reqBody.region || savedCfg.region || "us-east-1",
      publicUrlBase: reqBody.publicUrlBase || savedCfg.publicUrlBase,
      enabled: reqBody.enabled !== undefined ? reqBody.enabled : savedCfg.enabled,
    };

    if (!cfg.accessKeyId || !cfg.secretAccessKey) {
      return res.status(400).json({
        success: false,
        message: "Access Key ID dan Secret Access Key wajib diisi untuk melakukan pengujian.",
      });
    }

    try {
      const s3 = getS3Client(cfg);
      const listRes = await s3.send(new ListBucketsCommand({}));
      const buckets = (listRes.Buckets || []).map((b) => b.Name || "").filter(Boolean);

      let bucketStatus = "Belum ada bucket yang dipilih";
      if (cfg.bucketName) {
        if (buckets.includes(cfg.bucketName)) {
          bucketStatus = `Bucket '${cfg.bucketName}' ditemukan dan siap digunakan.`;
        } else {
          bucketStatus = `Bucket '${cfg.bucketName}' belum terdaftar. Anda dapat membuatnya di panel IDCloudHost atau tombol Buat Bucket.`;
        }
      }

      res.json({
        success: true,
        message: `Koneksi IDCloudHost S3 berhasil! Ditemukan ${buckets.length} bucket. ${bucketStatus}`,
        buckets,
        owner: listRes.Owner?.DisplayName || "NTI Storage",
      });
    } catch (err: any) {
      console.error("[Storage Test Error]:", err);
      res.status(500).json({
        success: false,
        message: `Gagal terhubung ke IDCloudHost: ${err?.message || "Unknown error"}`,
        details: err?.Code || err?.name,
      });
    }
  });

  // List Buckets (Supervisor only)
  app.get("/api/storage/buckets", requireSupervisor, async (req, res) => {
    const cfg = loadStorageConfig();
    if (!cfg.accessKeyId || !cfg.secretAccessKey) {
      return res.json({ success: false, buckets: [], message: "Kredensial belum lengkap" });
    }
    try {
      const s3 = getS3Client(cfg);
      const listRes = await s3.send(new ListBucketsCommand({}));
      const buckets = (listRes.Buckets || []).map((b) => b.Name || "").filter(Boolean);
      res.json({ success: true, buckets });
    } catch (err: any) {
      res.status(500).json({ success: false, buckets: [], message: err.message });
    }
  });

  // Create Bucket (Supervisor only)
  app.post("/api/storage/create-bucket", requireSupervisor, async (req, res) => {
    const cfg = loadStorageConfig();
    const bucketName = (req.body.bucketName || "").trim().toLowerCase();
    if (!bucketName) {
      return res.status(400).json({ success: false, message: "Nama bucket wajib diisi" });
    }
    try {
      const s3 = getS3Client(cfg);
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
      if (!cfg.bucketName) {
        cfg.bucketName = bucketName;
        saveStorageConfig(cfg);
      }
      res.json({ success: true, message: `Bucket '${bucketName}' berhasil dibuat di IDCloudHost!` });
    } catch (err: any) {
      console.error("[Create Bucket Error]:", err);
      res.status(500).json({ success: false, message: err?.message || "Gagal membuat bucket" });
    }
  });

  // Upload Evidence / Document (Authenticated + Private Storage + Standard Key Generation + Validation)
  app.post("/api/storage/upload", requireAuth, uploadLimiter, async (req, res) => {
    const cfg = loadStorageConfig();
    if (!cfg.enabled || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
      return res.status(400).json({
        success: false,
        error: "IDCloudHost Object Storage belum dikonfigurasi lengkap di server.",
      });
    }

    const {
      base64,
      folderPath = "",
      fileName,
      contentType = "image/jpeg",
      entityType,
      dateStr,
      shift,
      entityId,
      recordId,
    } = req.body;

    if (!base64 || !fileName) {
      return res.status(400).json({ success: false, error: "Payload base64 dan fileName wajib disertakan." });
    }

    // 1. Content-Type Validation (Whitelist)
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const claimedMime = (contentType || "image/jpeg").toLowerCase().trim();
    if (!allowedMimeTypes.includes(claimedMime)) {
      return res.status(400).json({
        success: false,
        error: `Tipe file "${claimedMime}" tidak diizinkan. Hanya JPEG, PNG, WebP, dan PDF yang diterima.`,
      });
    }

    try {
      const rawBase64 = base64.replace(/^data:[^;]+;base64,/, "");
      const fileBuffer = Buffer.from(rawBase64, "base64");

      // 2. File Size Limits (10MB for images, 25MB for PDF)
      const maxSizeBytes = claimedMime === "application/pdf" ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
      if (fileBuffer.length > maxSizeBytes) {
        return res.status(400).json({
          success: false,
          error: `Ukuran file melebihi batas maksimal (${claimedMime === "application/pdf" ? "25MB" : "10MB"}).`,
        });
      }

      // 3. Magic Bytes / Header Signature Verification
      const fileCheck = validateFileBuffer(fileBuffer, claimedMime);
      if (!fileCheck.valid) {
        return res.status(400).json({
          success: false,
          error: "Format isi file tidak valid atau tidak sesuai dengan ekstensi gambar/dokumen.",
        });
      }

      // 4. Standardized Object Key Generation with Server Uniqueness & Strict Extension Validation
      const mimeExtMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "application/pdf": "pdf",
      };
      const validExt = mimeExtMap[claimedMime] || (fileCheck.actualMime === "image/png" ? "png" : fileCheck.actualMime === "image/webp" ? "webp" : fileCheck.actualMime === "application/pdf" ? "pdf" : "jpg");
      const rawBaseName = path.basename(fileName || "file", path.extname(fileName || ""));
      const sanitizedBase = rawBaseName.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_").slice(0, 50) || "file";
      const serverUniqueId = crypto.randomUUID();
      const uniqueFileName = `${sanitizedBase}_${serverUniqueId}.${validExt}`;

      let objectKey = "";
      const cleanFolder = (folderPath || "").trim();

      if (cleanFolder && cleanFolder.startsWith("!Kantor")) {
        objectKey = `${cleanFolder}/${uniqueFileName}`;
      } else if (entityType) {
        objectKey = generateCanonicalStorageKey({
          entityType,
          dateStr,
          shift,
          entityId: entityId || recordId,
          fileName: uniqueFileName,
          ext: validExt,
          technicianName: req.body?.technicianName,
          attendanceType: req.body?.attendanceType,
        });
      } else {
        objectKey = cleanFolder ? `${cleanFolder}/${uniqueFileName}` : `!Kantor/2. Foto Laporan/${uniqueFileName}`;
      }

      const keyValidation = validateAndSanitizeS3Key(objectKey);
      if (!keyValidation.valid || !keyValidation.cleanKey) {
        return res.status(400).json({ success: false, error: keyValidation.error || "Key penyimpanan tidak valid." });
      }
      objectKey = keyValidation.cleanKey;

      // 4b. Authorize destination storage access for user
      const authCheck = authorizeStorageAccess((req as any).user, objectKey, "write");
      if (!authCheck.allowed) {
        return res.status(403).json({ success: false, error: authCheck.reason || "Akses ditolak untuk lokasi upload ini." });
      }

      // 4c. Authorize operational duty & pending evidence completion for technician
      const user = (req as any).user;
      if (
        user?.role === "technician" &&
        (entityType === "preventive_evidence" || entityType === "preventive_collage" || entityType === "corrective_evidence" || entityType === "corrective_collage")
      ) {
        const supabase = getServerSupabase();
        if (supabase) {
          const serverNow = new Date();
          const datePart = serverNow.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
          let psDoc = null;
          let mDoc = null;
          let officeDoc = null;
          try {
            const { data: psData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "PS").limit(1);
            if (psData && psData.length > 0) psDoc = psData[0];
            const { data: mData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "M").limit(1);
            if (mData && mData.length > 0) mDoc = mData[0];
            const { data: offData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "OFFICE").limit(1);
            if (offData && offData.length > 0) officeDoc = offData[0];
          } catch (_) {}

          const effectiveTechId = user.technician_id !== undefined ? user.technician_id : (typeof user.id === "number" ? user.id : undefined);
          const permResult = evaluateOperationalPermissions({
            userRole: (user.role as any) || "technician",
            technician: {
              id: effectiveTechId,
              name: user.name || user.code || "",
            },
            nowDate: serverNow,
            scheduleDocPS: psDoc,
            scheduleDocM: mDoc,
            scheduleDocOffice: officeDoc,
            ...await loadServerShiftContext(supabase, serverNow),
          });

          const canSubmit = (entityType === "corrective_evidence" || entityType === "corrective_collage") ? permResult.permissions.canSubmitCorrective : permResult.permissions.canSubmitPreventive;

          if (!canSubmit) {
            // Check if report was ALREADY accepted by backend while on-duty
            let isExistingReportAccepted = false;
            const targetRecordId = recordId || entityId;
            if (targetRecordId) {
              try {
                if (entityType === "corrective_evidence" || entityType === "corrective_collage") {
                  const { data: corrRec } = await supabase
                    .from("corrective_records")
                    .select("id")
                    .or(`id.eq.${Number(targetRecordId) || 0},event_id.eq.${String(targetRecordId)}`)
                    .limit(1);
                  if (corrRec && corrRec.length > 0) isExistingReportAccepted = true;
                } else {
                  const { data: prevRec } = await supabase
                    .from("preventive_records")
                    .select("id")
                    .eq("id", Number(targetRecordId) || 0)
                    .limit(1);
                  if (prevRec && prevRec.length > 0) isExistingReportAccepted = true;
                }
              } catch (_) {}
            }

            if (!isExistingReportAccepted) {
              return res.status(403).json({
                success: false,
                error: "Akses ditolak: Teknisi sedang OFF DUTY/LIBUR (READ ONLY). Laporan belum tersimpan di server. Simpan sebagai draft lokal.",
              });
            }
          }
        }
      }

      // 5. Send to IDCloudHost S3 as PRIVATE OBJECT (No public-read ACL)
      const s3 = getS3Client(cfg);
      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucketName,
          Key: objectKey,
          Body: fileBuffer,
          ContentType: fileCheck.actualMime,
        })
      );

      // Permanent object key is the ONLY canonical database reference.
      // Private images must be fetched later with a fresh authenticated session.
      const cleanFileName = path.basename(objectKey);
      res.json({
        success: true,
        url: objectKey,
        key: objectKey,
        bucket: cfg.bucketName,
        file_name: cleanFileName,
        file_size: fileBuffer.length,
      });
    } catch (err: any) {
      console.error("[Storage Upload Error]:", err);
      res.status(500).json({
        success: false,
        error: "Gagal upload berkas ke Object Storage.",
      });
    }
  });

  // Request Presigned Direct Upload URL (Authenticated + Direct Binary Upload to IDCloudHost S3)
  app.post("/api/storage/presigned-upload-url", requireAuth, uploadLimiter, async (req, res) => {
    const cfg = loadStorageConfig();
    if (!cfg.enabled || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
      return res.status(400).json({
        success: false,
        error: "IDCloudHost Object Storage belum dikonfigurasi lengkap di server.",
      });
    }

    const {
      fileName,
      contentType = "image/jpeg",
      entityType,
      dateStr,
      shift,
      entityId,
      recordId,
      folderPath = "",
    } = req.body || {};

    if (!fileName) {
      return res.status(400).json({ success: false, error: "Parameter 'fileName' wajib disertakan." });
    }

    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const claimedMime = (contentType || "image/jpeg").toLowerCase().trim();
    if (!allowedMimeTypes.includes(claimedMime)) {
      return res.status(400).json({
        success: false,
        error: `Tipe file "${claimedMime}" tidak diizinkan. Hanya JPEG, PNG, WebP, dan PDF yang diterima.`,
      });
    }

    const mimeExtMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "application/pdf": "pdf",
    };
    const validExt = mimeExtMap[claimedMime] || "jpg";

    try {
      // Form unique, server-controlled filename to strictly prevent client from overwriting existing objects
      const rawBaseName = path.basename(fileName, path.extname(fileName));
      const sanitizedBase = rawBaseName.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_").slice(0, 50) || "file";
      const serverUniqueId = crypto.randomUUID();
      const uniqueFileName = `${sanitizedBase}_${serverUniqueId}.${validExt}`;

      let objectKey = "";
      const cleanFolder = (folderPath || "").trim();

      if (cleanFolder && cleanFolder.startsWith("!Kantor")) {
        objectKey = `${cleanFolder}/${uniqueFileName}`;
      } else if (entityType) {
        objectKey = generateCanonicalStorageKey({
          entityType,
          dateStr,
          shift,
          entityId: entityId || recordId,
          fileName: uniqueFileName,
          ext: validExt,
          technicianName: req.body?.technicianName,
          attendanceType: req.body?.attendanceType,
        });
      } else {
        objectKey = cleanFolder ? `${cleanFolder}/${uniqueFileName}` : `!Kantor/2. Foto Laporan/${uniqueFileName}`;
      }

      const keyValidation = validateAndSanitizeS3Key(objectKey);
      if (!keyValidation.valid || !keyValidation.cleanKey) {
        return res.status(400).json({ success: false, error: keyValidation.error || "Key penyimpanan tidak valid." });
      }
      objectKey = keyValidation.cleanKey;

      // Authorize destination storage access for user
      const authCheck = authorizeStorageAccess((req as any).user, objectKey, "write");
      if (!authCheck.allowed) {
        return res.status(403).json({ success: false, error: authCheck.reason || "Akses ditolak untuk lokasi upload ini." });
      }

      // Authorize operational duty & pending evidence completion for technician
      const presignUser = (req as any).user;
      if (
        presignUser?.role === "technician" &&
        (entityType === "preventive_evidence" || entityType === "preventive_collage" || entityType === "corrective_evidence" || entityType === "corrective_collage")
      ) {
        const supabase = getServerSupabase();
        if (supabase) {
          const serverNow = new Date();
          const datePart = serverNow.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
          let psDoc = null;
          let mDoc = null;
          let officeDoc = null;
          try {
            const { data: psData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "PS").limit(1);
            if (psData && psData.length > 0) psDoc = psData[0];
            const { data: mData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "M").limit(1);
            if (mData && mData.length > 0) mDoc = mData[0];
            const { data: offData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "OFFICE").limit(1);
            if (offData && offData.length > 0) officeDoc = offData[0];
          } catch (_) {}

          const effectiveTechId = presignUser.technician_id !== undefined ? presignUser.technician_id : (typeof presignUser.id === "number" ? presignUser.id : undefined);
          const permResult = evaluateOperationalPermissions({
            userRole: (presignUser.role as any) || "technician",
            technician: {
              id: effectiveTechId,
              name: presignUser.name || presignUser.code || "",
            },
            nowDate: serverNow,
            scheduleDocPS: psDoc,
            scheduleDocM: mDoc,
            scheduleDocOffice: officeDoc,
            ...await loadServerShiftContext(supabase, serverNow),
          });

          const canSubmit = (entityType === "corrective_evidence" || entityType === "corrective_collage") ? permResult.permissions.canSubmitCorrective : permResult.permissions.canSubmitPreventive;

          if (!canSubmit) {
            // Check if report was ALREADY accepted by backend while on-duty
            let isExistingReportAccepted = false;
            const targetRecordId = recordId || entityId;
            if (targetRecordId) {
              try {
                if (entityType === "corrective_evidence" || entityType === "corrective_collage") {
                  const { data: corrRec } = await supabase
                    .from("corrective_records")
                    .select("id")
                    .or(`id.eq.${Number(targetRecordId) || 0},event_id.eq.${String(targetRecordId)}`)
                    .limit(1);
                  if (corrRec && corrRec.length > 0) isExistingReportAccepted = true;
                } else {
                  const { data: prevRec } = await supabase
                    .from("preventive_records")
                    .select("id")
                    .eq("id", Number(targetRecordId) || 0)
                    .limit(1);
                  if (prevRec && prevRec.length > 0) isExistingReportAccepted = true;
                }
              } catch (_) {}
            }

            if (!isExistingReportAccepted) {
              return res.status(403).json({
                success: false,
                error: "Akses ditolak: Teknisi sedang OFF DUTY/LIBUR (READ ONLY). Laporan belum tersimpan di server. Simpan sebagai draft lokal.",
              });
            }
          }
        }
      }

      const s3 = getS3Client(cfg);
      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: cfg.bucketName,
          Key: objectKey,
        }),
        { expiresIn: 900 } // 15 minutes
      );

      res.json({
        success: true,
        uploadUrl,
        key: objectKey,
        bucket: cfg.bucketName,
        file_name: path.basename(objectKey),
        contentType: claimedMime,
        expiresIn: 900,
      });
    } catch (err: any) {
      console.error("[Presigned Upload URL Error]:", err);
      res.status(500).json({
        success: false,
        error: "Gagal membuat URL upload presigned.",
      });
    }
  });

  // Get Temporary Presigned URL for a Private Object Key (Authenticated + Authorized)
  app.get("/api/storage/presigned-url", requireAuth, async (req, res) => {
    const rawKey = (req.query.key as string) || "";
    const keyValidation = validateAndSanitizeS3Key(rawKey);
    if (!keyValidation.valid || !keyValidation.cleanKey) {
      return res.status(400).json({ success: false, error: keyValidation.error || "Parameter 'key' tidak valid." });
    }

    const cleanKey = keyValidation.cleanKey;

    // Resource-level authorization check
    const authCheck = authorizeStorageAccess((req as any).user, cleanKey, "read");
    if (!authCheck.allowed) {
      return res.status(403).json({ success: false, error: authCheck.reason || "Akses ditolak." });
    }

    const ticket = generateImageTicket(cleanKey, 3600);
    const proxyUrl = `/api/storage/proxy-image?key=${encodeURIComponent(cleanKey)}&ticket=${encodeURIComponent(ticket)}`;
    return res.json({ success: true, key: cleanKey, url: proxyUrl, expiresIn: 3600 });
  });

  // Internal helper to get Image Binary Buffer directly from S3 without HTTP round-trip
  async function getStorageImageBufferDirect(rawKey: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!rawKey) return null;
    const keyValidation = validateAndSanitizeS3Key(rawKey);
    if (!keyValidation.valid || !keyValidation.cleanKey) {
      return null;
    }

    const cleanKey = keyValidation.cleanKey;
    const cfg = loadStorageConfig();
    if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
      return null;
    }
    try {
      const s3 = getS3Client(cfg);
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: cfg.bucketName,
          Key: cleanKey,
        })
      );
      const bytes = await obj.Body?.transformToByteArray();
      if (!bytes) return null;
      return {
        buffer: Buffer.from(bytes),
        contentType: obj.ContentType || "image/jpeg",
      };
    } catch (err: any) {
      console.warn("[Internal Storage Buffer Error]:", err?.message);
      return null;
    }
  }

  // Get Image Binary Buffer for Excel Embedding & Previews (Authenticated + Authorized)
  app.get("/api/storage/image-buffer", requireAuth, async (req, res) => {
    const rawKey = (req.query.key as string) || "";
    const keyValidation = validateAndSanitizeS3Key(rawKey);
    if (!keyValidation.valid || !keyValidation.cleanKey) {
      return res.status(400).json({ success: false, error: keyValidation.error || "Parameter 'key' tidak valid." });
    }

    // Resource-level authorization check
    const authCheck = authorizeStorageAccess((req as any).user, keyValidation.cleanKey, "read");
    if (!authCheck.allowed) {
      return res.status(403).json({ success: false, error: authCheck.reason || "Akses ditolak." });
    }

    const cfg = loadStorageConfig();
    if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
      return res.status(400).json({ success: false, error: "Storage S3 belum terkonfigurasi." });
    }

    try {
      const direct = await getStorageImageBufferDirect(keyValidation.cleanKey);
      if (!direct) {
        return res.status(404).json({ success: false, error: "Gambar tidak ditemukan" });
      }

      res.setHeader("Content-Type", direct.contentType);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(direct.buffer);
    } catch (err: any) {
      console.warn("[Storage Image Buffer Error]:", err?.message);
      return res.status(500).json({ success: false, error: "Gagal mengambil buffer gambar" });
    }
  });

  // Authenticated & Validated Image Proxy (Supports Bearer auth and Cryptographic Single-Key Ticket)
  app.get("/api/storage/proxy-image", async (req, res, next) => {
    const rawUrlParam = (req.query.url as string) || "";
    const rawKeyParam = (req.query.key as string) || "";
    const rawTicket = (req.query.ticket as string) || "";
    const keyCandidate = rawKeyParam || rawUrlParam;

    if (keyCandidate && rawTicket) {
      const keyValidation = validateAndSanitizeS3Key(keyCandidate);
      if (keyValidation.valid && keyValidation.cleanKey) {
        if (verifyImageTicket(keyValidation.cleanKey, rawTicket)) {
          (req as any).user = { id: "ticket-user", role: "technician", type: "ticket" };
          return next();
        }
      }
    }
    return requireAuth(req, res, next);
  }, async (req, res) => {
    try {
      const rawUrlParam = (req.query.url as string) || "";
      const rawKeyParam = (req.query.key as string) || "";
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

      const keyCandidate = rawKeyParam || rawUrlParam;
      if (!keyCandidate) {
        return res.status(400).send("Parameter 'key' atau 'url' wajib disertakan.");
      }

      const keyValidation = validateAndSanitizeS3Key(keyCandidate);
      if (!keyValidation.valid || !keyValidation.cleanKey) {
        return res.status(403).send("Akses ditolak: " + (keyValidation.error || "Key tidak valid"));
      }

      // Resource-level authorization check
      const authCheck = authorizeStorageAccess((req as any).user, keyValidation.cleanKey, "read");
      if (!authCheck.allowed) {
        return res.status(403).send(authCheck.reason || "Akses ditolak.");
      }

      const direct = await getStorageImageBufferDirect(keyValidation.cleanKey);
      if (direct) {
        res.setHeader("Content-Type", direct.contentType);
        res.setHeader("Cache-Control", "private, no-store");
        return res.send(direct.buffer);
      }

      return res.status(404).send("Gambar tidak ditemukan.");
    } catch (err: any) {
      console.error("[Proxy Image Error]:", err);
      return res.status(500).send("Gagal memuat gambar.");
    }
  });

  // Batch Presigned URLs for Multiple Keys (Authenticated + Authorized)
  app.post("/api/storage/presigned-urls", requireAuth, async (req, res) => {
    const { keys } = req.body || {};
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ success: false, error: "Array 'keys' wajib disertakan." });
    }

    try {
      const results: Record<string, string> = {};

      for (const k of keys.slice(0, 100)) {
        if (typeof k === "string" && k.trim()) {
          const val = validateAndSanitizeS3Key(k);
          if (val.valid && val.cleanKey) {
            const authCheck = authorizeStorageAccess((req as any).user, val.cleanKey, "read");
            if (authCheck.allowed) {
              const ticket = generateImageTicket(val.cleanKey, 3600);
              const proxyUrl = `/api/storage/proxy-image?key=${encodeURIComponent(val.cleanKey)}&ticket=${encodeURIComponent(ticket)}`;
              results[val.cleanKey] = proxyUrl;
            }
          }
        }
      }

      return res.json({ success: true, urls: results, expiresIn: 3600 });
    } catch (err: any) {
      console.error("[Batch Presigned URLs Error]:", err);
      return res.status(500).json({ success: false, error: "Gagal membuat batch URL presigned" });
    }
  });

  // ==============================================================================
  // REPORT FILES ARCHIVE CATALOG ROUTES (SUPABASE + IDCLOUDHOST S3)
  // ==============================================================================

  // List Archived Reports from Supabase catalog
  app.get("/api/reports/archive", requireAuth, async (req, res) => {
    try {
      const { date, shift, type, frequency_id, presign } = req.query;
      const supabase = getServerSupabase();

      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database belum terhubung di server." });
      }

      let query = supabase
        .from("report_files")
        .select("*")
        .order("generated_at", { ascending: false });

      if (date) {
        query = query.eq("operational_date", String(date));
      }
      if (shift) {
        query = query.eq("shift", String(shift));
      }
      if (type) {
        query = query.eq("report_type", String(type));
      }
      if (frequency_id) {
        query = query.eq("frequency_id", Number(frequency_id));
      }

      const { data, error } = await query;

      if (error) {
        console.warn("[Report Archive Fetch Exception]:", error);
        return res.json({ success: true, reports: [] });
      }

      let reportList = data || [];

      // If presigned URLs are requested, generate temporary URLs
      if (presign === "true" || presign === "1") {
        const cfg = loadStorageConfig();
        if (cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName) {
          const s3 = getS3Client(cfg);
          reportList = await Promise.all(
            reportList.map(async (rep: any) => {
              try {
                if (rep.object_key) {
                  const signedUrl = await getSignedUrl(
                    s3,
                    new GetObjectCommand({
                      Bucket: rep.bucket || cfg.bucketName,
                      Key: rep.object_key,
                    }),
                    { expiresIn: 3600 }
                  );
                  return { ...rep, signed_url: signedUrl };
                }
              } catch (_) {}
              return rep;
            })
          );
        }
      }

      return res.json({ success: true, reports: reportList, total: reportList.length });
    } catch (err: any) {
      console.error("[Report Archive Error]:", err);
      return res.status(500).json({ success: false, error: err?.message || "Gagal memuat arsip laporan" });
    }
  });

  // Register an uploaded report in the catalog
  app.post("/api/reports/archive", requireAuth, async (req, res) => {
    try {
      const {
        report_type,
        operational_date,
        shift,
        frequency_id,
        object_key,
        file_name,
        file_size,
        content_type = "application/pdf",
        checksum,
        bucket,
        generated_by,
        metadata = {},
      } = req.body || {};

      if (!report_type || !operational_date || !object_key || !file_name) {
        return res.status(400).json({
          success: false,
          error: "Field report_type, operational_date, object_key, dan file_name wajib diisi.",
        });
      }

      const supabase = getServerSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database belum terhubung di server." });
      }

      const cfg = loadStorageConfig();
      const currentUser = (req as any).user;
      const author = generated_by || currentUser?.name || currentUser?.email || "System";

      // Enforce ISO YYYY-MM-DD format for database DATE column
      let cleanIsoDate = new Date().toISOString().slice(0, 10);
      if (operational_date) {
        const str = String(operational_date).trim();
        const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
          cleanIsoDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        } else {
          const parsed = new Date(str);
          if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
            const yyyy = parsed.getFullYear();
            const mm = String(parsed.getMonth() + 1).padStart(2, "0");
            const dd = String(parsed.getDate()).padStart(2, "0");
            cleanIsoDate = `${yyyy}-${mm}-${dd}`;
          }
        }
      }

      const numFreq = frequency_id ? Number(frequency_id) : null;
      const validFreqId = numFreq && numFreq >= 1 && numFreq <= 6 && String(report_type).toLowerCase() !== "corrective" ? numFreq : null;

      const payload = {
        report_type,
        operational_date: cleanIsoDate,
        shift: shift || null,
        frequency_id: validFreqId,
        object_key,
        file_name,
        file_size: file_size || 0,
        content_type,
        checksum: checksum || null,
        bucket: bucket || cfg.bucketName || "xray-storage",
        generated_by: author,
        generated_at: new Date().toISOString(),
        version: 1,
        metadata,
      };

      const { data, error } = await supabase
        .from("report_files")
        .upsert(payload, { onConflict: "object_key" })
        .select()
        .single();

      if (error) {
        console.warn("[Report Archive Register Exception]:", error);
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json({ success: true, report: data });
    } catch (err: any) {
      console.error("[Report Archive Save Error]:", err);
      return res.status(500).json({ success: false, error: err?.message || "Gagal menyimpan metadata laporan" });
    }
  });

  // Download / Get Signed URL for a specific report archive
  app.get("/api/reports/archive/download", requireAuth, async (req, res) => {
    try {
      const { key } = req.query;
      if (!key || typeof key !== "string") {
        return res.status(400).json({ success: false, error: "Parameter 'key' wajib disertakan." });
      }

      const cfg = loadStorageConfig();
      if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
        return res.status(400).json({ success: false, error: "Storage S3 belum terkonfigurasi." });
      }

      const cleanKey = key.replace(/\.\./g, "").replace(/^\/+/, "");
      const s3 = getS3Client(cfg);
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: cfg.bucketName,
          Key: cleanKey,
        }),
        { expiresIn: 3600 }
      );

      return res.json({ success: true, key: cleanKey, url, expiresIn: 3600 });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Gagal membuat URL download laporan" });
    }
  });

  // ==============================================================================
  // FEATURE 1: STORAGE MANAGER ROUTES (SUPERVISOR ONLY, ROOT LOCKED TO !Kantor/)
  // ==============================================================================

  // List S3 Objects & Virtual Subfolders under !Kantor/
  app.get("/api/storage-manager/list", requireAuth, async (req, res) => {
    try {
      const cfg = loadStorageConfig();
      if (!cfg.enabled || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
        return res.status(400).json({
          success: false,
          error: "IDCloudHost Object Storage belum dikonfigurasi di server.",
        });
      }

      let reqPrefix = typeof req.query.prefix === "string" ? req.query.prefix.trim() : "!Kantor/";
      const continuationToken = typeof req.query.continuationToken === "string" ? req.query.continuationToken.trim() : undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

      // Sanitize & enforce root locked to !Kantor/
      reqPrefix = reqPrefix.replace(/\.\./g, "").replace(/^\/+/, "");
      if (!reqPrefix.startsWith("!Kantor/") && reqPrefix !== "!Kantor") {
        reqPrefix = "!Kantor/";
      }
      if (!reqPrefix.endsWith("/") && reqPrefix !== "!Kantor") {
        reqPrefix = `${reqPrefix}/`;
      }

      const s3 = getS3Client(cfg);
      const command = new ListObjectsV2Command({
        Bucket: cfg.bucketName,
        Prefix: reqPrefix,
        Delimiter: "/",
        ContinuationToken: continuationToken || undefined,
        MaxKeys: limit,
      });

      const data = await s3.send(command);

      const commonPrefixes = (data.CommonPrefixes || []).map((cp) => cp.Prefix!).filter(Boolean);
      const files = (data.Contents || [])
        .filter((item) => item.Key && item.Key !== reqPrefix && !item.Key.endsWith("/"))
        .map((item) => {
          const fileName = path.basename(item.Key!);
          const ext = path.extname(fileName).replace(".", "").toLowerCase();
          return {
            key: item.Key!,
            name: fileName,
            size: item.Size || 0,
            lastModified: item.LastModified ? item.LastModified.toISOString() : new Date().toISOString(),
            type: ext,
          };
        });

      res.json({
        success: true,
        prefix: reqPrefix,
        folders: commonPrefixes,
        files,
        nextContinuationToken: data.NextContinuationToken || null,
        isTruncated: Boolean(data.IsTruncated),
      });
    } catch (err: any) {
      console.error("[Storage Manager List Error]:", err);
      res.status(500).json({
        success: false,
        error: `Gagal membaca IDCloudHost S3: ${err?.message || "Storage Error"}`,
      });
    }
  });

  // Get Temporary Presigned URL for Preview (Short Expiration)
  app.get("/api/storage-manager/preview", requireAuth, async (req, res) => {
    try {
      const rawKey = typeof req.query.key === "string" ? req.query.key.trim() : "";
      const keyValidation = validateAndSanitizeS3Key(rawKey);
      if (!keyValidation.valid || !keyValidation.cleanKey) {
        return res.status(400).json({ success: false, error: keyValidation.error || "Parameter 'key' tidak valid." });
      }

      const cleanKey = keyValidation.cleanKey;
      const cfg = loadStorageConfig();
      if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
        return res.status(400).json({ success: false, error: "Storage S3 belum terkonfigurasi." });
      }

      const s3 = getS3Client(cfg);
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: cfg.bucketName,
          Key: cleanKey,
        }),
        { expiresIn: 900 } // 15 minutes
      );

      res.json({ success: true, key: cleanKey, url, expiresIn: 900 });
    } catch (err: any) {
      console.error("[Storage Manager Preview Error]:", err);
      res.status(500).json({ success: false, error: "Gagal membuat URL preview" });
    }
  });

  // Direct Binary Stream Download (Preserves Original Filename)
  app.get("/api/storage-manager/download", requireAuth, async (req, res) => {
    try {
      const rawKey = typeof req.query.key === "string" ? req.query.key.trim() : "";
      const keyValidation = validateAndSanitizeS3Key(rawKey);
      if (!keyValidation.valid || !keyValidation.cleanKey) {
        return res.status(400).json({ success: false, error: keyValidation.error || "Parameter 'key' tidak valid." });
      }

      const cleanKey = keyValidation.cleanKey;
      const cfg = loadStorageConfig();
      if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
        return res.status(400).json({ success: false, error: "Storage S3 belum terkonfigurasi." });
      }

      const s3 = getS3Client(cfg);
      const s3Res = await s3.send(
        new GetObjectCommand({
          Bucket: cfg.bucketName,
          Key: cleanKey,
        })
      );

      const filename = path.basename(cleanKey);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      if (s3Res.ContentType) res.setHeader("Content-Type", s3Res.ContentType);
      if (s3Res.ContentLength) res.setHeader("Content-Length", s3Res.ContentLength);

      (s3Res.Body as any).pipe(res);
    } catch (err: any) {
      console.error("[Storage Manager Download Error]:", err);
      res.status(500).json({ success: false, error: "Gagal mengunduh berkas dari S3" });
    }
  });

  // Secure Delete Preventive Entry (Supervisor Only)
  app.post("/api/preventive/delete", requireSupervisor, async (req, res) => {
    try {
      const { id, equipment_id, checklist_frequency_id, period_key, dataset_id } = req.body || {};

      if (!equipment_id && !id) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'id' atau 'equipment_id' wajib disertakan.",
        });
      }

      const supabase = getServerSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database Supabase belum terkonfigurasi di server." });
      }

      const targetDatasetId = dataset_id || "default";
      const targetPeriodKey = period_key || "";
      const targetFreqId = checklist_frequency_id ? Number(checklist_frequency_id) : 1;

      // 1. Fetch preventive record from Supabase server-side first (Do not trust frontend object_keys)
      let query = supabase.from("preventive_records").select("*");
      if (id) {
        query = query.eq("id", id);
      } else {
        query = query
          .eq("dataset_id", targetDatasetId)
          .eq("equipment_id", equipment_id)
          .eq("checklist_frequency_id", targetFreqId)
          .eq("period_key", targetPeriodKey);
      }

      const { data: existingRecords, error: fetchErr } = await query;

      if (fetchErr) {
        return res.status(500).json({
          success: false,
          error: `Gagal membaca record preventif dari database: ${fetchErr.message}`,
        });
      }

      if (!existingRecords || existingRecords.length === 0) {
        // Record already gone from DB (idempotent response)
        return res.json({ success: true, deletedCount: 0, message: "Record preventif tidak ditemukan atau telah dihapus." });
      }

      // 2. Extract evidence object_keys stored in the database record(s)
      const CANONICAL_PREVENTIVE_PREFIX = "!Kantor/2. Foto Laporan/";
      const keysToDelete = new Set<string>();

      for (const rec of existingRecords) {
        let evidences = rec.evidences;
        if (typeof evidences === "string") {
          try {
            evidences = JSON.parse(evidences);
          } catch (_) {
            evidences = [];
          }
        }
        if (Array.isArray(evidences)) {
          for (const ev of evidences) {
            const rawCandidates = typeof ev === "string"
              ? [ev]
              : [ev?.object_key, ev?.photo_object_key, ev?.file_path, ev?.photo_url, ev?.url, ev?.drive_url];

            for (const rawKey of rawCandidates) {
              if (typeof rawKey === "string" && rawKey.trim()) {
                const keyValidation = validateAndSanitizeS3Key(rawKey, [CANONICAL_PREVENTIVE_PREFIX]);
                if (keyValidation.valid && keyValidation.cleanKey) {
                  if (
                    !keyValidation.cleanKey.startsWith("!Kantor/1. Laporan/") &&
                    !keyValidation.cleanKey.startsWith("!Kantor/3. Absen/")
                  ) {
                    keysToDelete.add(keyValidation.cleanKey);
                    break; // Found valid key for this evidence item
                  }
                } else if (rawKey.includes("!Kantor/") || rawKey.includes("%21Kantor/")) {
                  console.warn(`[Security Warning] Blocked attempt to delete non-preventive key: '${rawKey}'`);
                }
              }
            }
          }
        }
      }

      // 3. DELETE preventive record(s) from Supabase database FIRST
      let deleteQuery = supabase.from("preventive_records").delete();
      if (id) {
        deleteQuery = deleteQuery.eq("id", id);
      } else {
        deleteQuery = deleteQuery
          .eq("dataset_id", targetDatasetId)
          .eq("equipment_id", equipment_id)
          .eq("checklist_frequency_id", targetFreqId)
          .eq("period_key", targetPeriodKey);
      }

      const { error: deleteErr } = await deleteQuery;
      if (deleteErr) {
        console.error("[Preventive DB Delete Error]:", deleteErr);
        return res.status(500).json({
          success: false,
          error: "Gagal menghapus record preventif dari database.",
        });
      }

      // 4. AFTER DB delete succeeds, cleanup evidence photo objects from S3
      const deletedS3Keys: string[] = [];
      let s3Warning: string | null = null;
      const cfg = loadStorageConfig();

      if (cfg.enabled && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName && keysToDelete.size > 0) {
        try {
          const s3 = getS3Client(cfg);
          for (const key of keysToDelete) {
            try {
              await s3.send(
                new DeleteObjectCommand({
                  Bucket: cfg.bucketName,
                  Key: key,
                })
              );
              deletedS3Keys.push(key);
            } catch (s3Err: any) {
              console.warn(`[S3 Preventive Photo Cleanup Warning] Key '${key}':`, s3Err?.message || s3Err);
              s3Warning = `Beberapa foto S3 tidak dapat dibersihkan (${s3Err?.message || 'S3 Error'})`;
            }
          }
        } catch (s3ConfigErr: any) {
          console.warn("[S3 Client Error]:", s3ConfigErr?.message || s3ConfigErr);
          s3Warning = "Koneksi S3 Object Storage bermasalah saat pembersihan foto.";
        }
      }

      return res.json({
        success: true,
        deletedCount: existingRecords.length,
        deletedS3Keys,
        warning: s3Warning || undefined,
      });
    } catch (err: any) {
      console.error("[Preventive Delete Error]:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Gagal menghapus data preventif",
      });
    }
  });

  // Secure Delete Corrective Entry (Supervisor Only)
  app.post("/api/corrective/delete", requireSupervisor, async (req, res) => {
    try {
      const { id, corrective_code, event_id } = req.body || {};

      if (!id && !corrective_code && !event_id) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'id', 'corrective_code', atau 'event_id' wajib disertakan.",
        });
      }

      const supabase = getServerSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database Supabase belum terkonfigurasi di server." });
      }

      let fetchQuery = supabase.from("corrective_records").select("*");
      if (id) {
        fetchQuery = fetchQuery.eq("id", id);
      } else if (corrective_code) {
        fetchQuery = fetchQuery.eq("corrective_code", corrective_code);
      } else if (event_id) {
        fetchQuery = fetchQuery.eq("event_id", event_id);
      }

      const { data: existingRecords, error: fetchErr } = await fetchQuery;

      if (fetchErr) {
        return res.status(500).json({
          success: false,
          error: `Gagal membaca record corrective dari database: ${fetchErr.message}`,
        });
      }

      if (!existingRecords || existingRecords.length === 0) {
        return res.json({ success: true, deletedCount: 0, message: "Record corrective tidak ditemukan atau telah dihapus." });
      }

      // Delete from Supabase table
      let deleteQuery = supabase.from("corrective_records").delete();
      if (id) {
        deleteQuery = deleteQuery.eq("id", id);
      } else if (corrective_code) {
        deleteQuery = deleteQuery.eq("corrective_code", corrective_code);
      } else if (event_id) {
        deleteQuery = deleteQuery.eq("event_id", event_id);
      }

      const { error: deleteErr } = await deleteQuery;
      if (deleteErr) {
        console.error("[Corrective DB Delete Error]:", deleteErr);
        return res.status(500).json({
          success: false,
          error: "Gagal menghapus record corrective dari database.",
        });
      }

      return res.json({
        success: true,
        deletedCount: existingRecords.length,
        message: "Laporan corrective berhasil dihapus oleh Supervisor.",
      });
    } catch (err: any) {
      console.error("[Corrective Delete Error]:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Gagal menghapus data corrective",
      });
    }
  });

  // ==============================================================================
  // AUTHORITATIVE WRITE ENDPOINTS: PREVENTIVE & CORRECTIVE
  // Enforces server-authoritative time, schedule, and RBAC permission checks
  // ==============================================================================

  app.post("/api/preventive/save", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const userRole: 'system_admin' | 'operations_admin' | 'supervisor' | 'technician' =
        user.role === 'system_admin' || user.role === 'admin' ? 'system_admin' :
        user.role === 'operations_admin' ? 'operations_admin' :
        user.role === 'supervisor' ? 'supervisor' : 'technician';

      const supabase = getServerSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database Supabase belum terkonfigurasi di server." });
      }

      const serverNow = new Date();
      const datePart = serverNow.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

      // Fetch schedule for today
      let psDoc = null;
      let mDoc = null;
      let officeDoc = null;
      try {
        const { data: psData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "PS").limit(1);
        if (psData && psData.length > 0) psDoc = psData[0];
        const { data: mData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "M").limit(1);
        if (mData && mData.length > 0) mDoc = mData[0];
        const { data: offData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "OFFICE").limit(1);
        if (offData && offData.length > 0) officeDoc = offData[0];
      } catch (_) {}

      const effectiveTechId = user.technician_id !== undefined ? user.technician_id : (typeof user.id === 'number' ? user.id : undefined);

      // Authoritative RBAC check using server-verified identity & clock
      const permissionResult = evaluateOperationalPermissions({
        userRole,
        technician: {
          id: effectiveTechId,
          name: user.name || user.code || "",
        },
        nowDate: serverNow,
        scheduleDocPS: psDoc,
        scheduleDocM: mDoc,
        scheduleDocOffice: officeDoc,
        ...(supabase ? await loadServerShiftContext(supabase, serverNow) : {}),
      });

      if (!permissionResult.permissions.canSubmitPreventive) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak. ${permissionResult.reason} Anda berstatus READ ONLY dan tidak dapat menyimpan checklist preventive.`,
        });
      }

      const payload = req.body;
      if (!payload || (!payload.id && !payload.record_id) || !payload.equipment_id) {
        return res.status(400).json({ success: false, error: "Payload data preventive tidak lengkap." });
      }

      const { data, error } = await supabase
        .from("preventive_records")
        .upsert(payload, {
          onConflict: "dataset_id,equipment_id,checklist_frequency_id,period_key,shift",
        })
        .select()
        .maybeSingle();

      if (error) {
        console.error("[Preventive Server Save Error]:", error.message);
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.json({ success: true, data });
    } catch (err: any) {
      console.error("[Preventive Server Save Exception]:", err);
      return res.status(500).json({ success: false, error: err?.message || "Gagal menyimpan record preventive" });
    }
  });

  app.post("/api/corrective/save", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const userRole: 'system_admin' | 'operations_admin' | 'supervisor' | 'technician' =
        user.role === 'system_admin' || user.role === 'admin' ? 'system_admin' :
        user.role === 'operations_admin' ? 'operations_admin' :
        user.role === 'supervisor' ? 'supervisor' : 'technician';

      const supabase = getServerSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database Supabase belum terkonfigurasi di server." });
      }

      const serverNow = new Date();
      const datePart = serverNow.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

      let psDoc = null;
      let mDoc = null;
      let officeDoc = null;
      try {
        const { data: psData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "PS").limit(1);
        if (psData && psData.length > 0) psDoc = psData[0];
        const { data: mData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "M").limit(1);
        if (mData && mData.length > 0) mDoc = mData[0];
        const { data: offData } = await supabase.from("shift_schedules").select("*").eq("schedule_date", datePart).eq("shift", "OFFICE").limit(1);
        if (offData && offData.length > 0) officeDoc = offData[0];
      } catch (_) {}

      const effectiveTechId = user.technician_id !== undefined ? user.technician_id : (typeof user.id === 'number' ? user.id : undefined);

      const permissionResult = evaluateOperationalPermissions({
        userRole,
        technician: {
          id: effectiveTechId,
          name: user.name || user.code || "",
        },
        nowDate: serverNow,
        scheduleDocPS: psDoc,
        scheduleDocM: mDoc,
        scheduleDocOffice: officeDoc,
        ...(supabase ? await loadServerShiftContext(supabase, serverNow) : {}),
      });

      if (!permissionResult.permissions.canSubmitCorrective) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak. ${permissionResult.reason} Anda berstatus READ ONLY dan tidak dapat menyimpan laporan corrective.`,
        });
      }

      const payload = req.body;
      if (!payload || !payload.id || !payload.equipment_id) {
        return res.status(400).json({ success: false, error: "Payload data corrective tidak lengkap." });
      }

      const eventId = payload.event_id || payload.id;
      const correctiveCode = payload.corrective_code || payload.code;

      const { data: existing } = await supabase
        .from("corrective_records")
        .select("id, event_id, corrective_code")
        .or(`event_id.eq."${eventId}",corrective_code.eq."${correctiveCode}"`)
        .maybeSingle();

      let savedRow: any = null;
      if (existing && existing.id) {
        const { data: updateData, error: updateError } = await supabase
          .from("corrective_records")
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single();
        if (updateError) {
          return res.status(500).json({ success: false, error: updateError.message });
        }
        savedRow = updateData;
      } else {
        const { data: insertData, error: insertError } = await supabase
          .from("corrective_records")
          .insert(payload)
          .select()
          .single();
        if (insertError) {
          return res.status(500).json({ success: false, error: insertError.message });
        }
        savedRow = insertData;
      }

      return res.json({ success: true, data: savedRow });
    } catch (err: any) {
      console.error("[Corrective Server Save Exception]:", err);
      return res.status(500).json({ success: false, error: err?.message || "Gagal menyimpan record corrective" });
    }
  });

  // ==============================================================================
  // FEATURE 2: BATCH REPORT EXPORT / MERGE ARCHIVED REPORTS (PDF-LIB BINARY MERGE)
  // ==============================================================================

  app.post("/api/reports/merge", requireAuth, uploadLimiter, async (req, res) => {
    try {
      const { report_file_ids } = req.body || {};
      if (!Array.isArray(report_file_ids) || report_file_ids.length === 0) {
        return res.status(400).json({ success: false, error: "Pilih minimal 1 laporan untuk digabungkan." });
      }

      if (report_file_ids.length > 100) {
        return res.status(400).json({ success: false, error: "Maksimal 100 laporan dapat digabungkan sekaligus." });
      }

      const supabase = getServerSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Database belum terhubung di server." });
      }

      // Query report_files catalog
      const { data: records, error } = await supabase
        .from("report_files")
        .select("*")
        .in("id", report_file_ids);

      // 1. Verify that all requested IDs actually exist in DB
      if (error || !records || records.length === 0 || records.length !== report_file_ids.length) {
        return res.status(404).json({ success: false, error: "Beberapa atau seluruh laporan yang dipilih tidak ditemukan di database." });
      }

      // 2. Authorize every single report record before merging
      for (const rec of records) {
        const keyValidation = validateAndSanitizeS3Key(rec.object_key, ["!Kantor/1. Laporan/"]);
        if (!keyValidation.valid || !keyValidation.cleanKey) {
          return res.status(403).json({
            success: false,
            error: `Akses ditolak. File '${rec.file_name || rec.id}' tidak valid atau di luar direktori laporan resmi.`,
          });
        }

        const authCheck = authorizeStorageAccess((req as any).user, keyValidation.cleanKey, "read");
        if (!authCheck.allowed) {
          return res.status(403).json({
            success: false,
            error: `Akses ditolak untuk laporan '${rec.file_name || rec.id}': ${authCheck.reason || "Izin tidak mencukupi."}`,
          });
        }
      }

      // Sort: 1. operational_date ASC, 2. shift (Pagi -> Siang -> Malam), 3. generated_at ASC
      const shiftOrder: Record<string, number> = { Pagi: 1, Siang: 2, Malam: 3 };
      records.sort((a, b) => {
        if (a.operational_date !== b.operational_date) {
          return a.operational_date.localeCompare(b.operational_date);
        }
        const orderA = shiftOrder[a.shift || "Pagi"] || 9;
        const orderB = shiftOrder[b.shift || "Pagi"] || 9;
        if (orderA !== orderB) return orderA - orderB;
        return (a.generated_at || "").localeCompare(b.generated_at || "");
      });

      const cfg = loadStorageConfig();
      if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
        return res.status(400).json({ success: false, error: "Storage S3 belum terkonfigurasi." });
      }

      const s3 = getS3Client(cfg);
      const mergedPdf = await PDFDocument.create();

      for (const rec of records) {
        let s3Res;
        try {
          s3Res = await s3.send(
            new GetObjectCommand({
              Bucket: rec.bucket || cfg.bucketName,
              Key: rec.object_key,
            })
          );
        } catch (s3Err: any) {
          return res.status(400).json({
            success: false,
            error: `Gagal mengambil PDF ID #${rec.id} (${rec.file_name}): ${s3Err.message}`,
          });
        }

        const pdfByteArray = await (s3Res.Body as any).transformToByteArray();
        const pdfBuffer = Buffer.from(pdfByteArray);

        let srcDoc;
        try {
          srcDoc = await PDFDocument.load(pdfBuffer);
        } catch (parseErr: any) {
          return res.status(400).json({
            success: false,
            error: `File PDF laporan ID #${rec.id} (${rec.file_name}) rusak atau tidak dapat dibaca: ${parseErr.message}`,
          });
        }

        const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedBytes = await mergedPdf.save();
      const firstDate = records[0].operational_date;
      const lastDate = records[records.length - 1].operational_date;
      const reportTypeClean = (records[0].report_type || "laporan").replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `Merged_${reportTypeClean}_${firstDate}_sampai_${lastDate}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", mergedBytes.length);
      res.send(Buffer.from(mergedBytes));
    } catch (err: any) {
      console.error("[Report Merge Exception]:", err);
      res.status(500).json({ success: false, error: err?.message || "Gagal menggabungkan berkas PDF" });
    }
  });

  // ==============================================================================
  // PUPPETEER HIGH-FIDELITY PDF GENERATION ENDPOINTS
  // ==============================================================================

  // POST /api/reports/generate-pdf-puppeteer
  app.post("/api/reports/generate-pdf-puppeteer", async (req, res) => {
    try {
      const { structuredData, targetFrequencyId, signatories } = req.body || {};
      if (!structuredData || !structuredData.operational_date) {
        return res.status(400).json({
          success: false,
          error: "Data laporan (structuredData) wajib disertakan.",
        });
      }

      const pdfBuffer = await generateReportPdfWithPuppeteer(
        structuredData,
        targetFrequencyId || 1,
        { signatories }
      );

      const shiftCode = (structuredData.shift || "Pagi").toUpperCase().startsWith("M") ? "M" : "PS";
      const filename = `${structuredData.operational_date} (${shiftCode}).pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      return res.send(pdfBuffer);
    } catch (err: any) {
      console.error("[Puppeteer PDF Generation Error]:", err);
      return res.status(500).json({
        success: false,
        error: `Gagal menghasilkan PDF via Puppeteer: ${err?.message || "Internal Server Error"}`,
      });
    }
  });

  // POST /api/reports/preview-pdf-html
  app.post("/api/reports/preview-pdf-html", async (req, res) => {
    try {
      const { structuredData, targetFrequencyId, signatories } = req.body || {};
      if (!structuredData || !structuredData.operational_date) {
        return res.status(400).send("Data laporan wajib disertakan.");
      }

      await resolveAllEvidencesServerSide(structuredData);

      const html = buildReportHtml(structuredData, {
        targetFrequencyId: targetFrequencyId || 1,
        signatories,
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    } catch (err: any) {
      return res.status(500).send(`Error generating HTML preview: ${err.message}`);
    }
  });

  // ==============================================================================
  // AVSEC QR ERROR REPORTING PUBLIC & INTERNAL ENDPOINTS
  // ==============================================================================

  // Helper for PUBLIC QR route resolution - strictly matches public_id ONLY
  async function findPublicEquipmentByPublicId(publicIdInput: string) {
    const clean = (publicIdInput || "").trim();
    if (!clean) return null;

    // Check Supabase first matching public_id ONLY
    const supabase = getServerSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("equipment")
          .select(`
            id,
            equipment_code,
            equipment_name,
            name,
            brand,
            model,
            type,
            public_id,
            location_id,
            equipment_type_id,
            lokasi:lokasi(nama_lokasi),
            jenis_mesin:jenis_mesin(nama_jenis, kode_jenis)
          `)
          .eq("public_id", clean);

        if (!error && Array.isArray(data) && data.length > 0) {
          const matched = data[0];
          const locName = (matched.lokasi as any)?.nama_lokasi || (Array.isArray(matched.lokasi) ? (matched.lokasi as any)[0]?.nama_lokasi : "") || "Bandara";
          const typeCode = (matched.jenis_mesin as any)?.kode_jenis || (Array.isArray(matched.jenis_mesin) ? (matched.jenis_mesin as any)[0]?.kode_jenis : "") || matched.type || "XRAY";

          return {
            id: matched.id,
            public_id: matched.public_id,
            equipment_code: matched.equipment_code,
            name: matched.name || matched.equipment_name || "Equipment",
            location_name: locName,
            brand: matched.brand || "Security Equipment",
            model: matched.model || "",
            type: typeCode,
          };
        }
      } catch (_) {}
    }

    // Fallback to local DEFAULT_EQUIPMENTS matching public_id ONLY
    const localMatch = DEFAULT_EQUIPMENTS.find(
      (eq) => eq.public_id && eq.public_id.trim() === clean
    );

    if (localMatch) {
      return {
        id: localMatch.id,
        public_id: localMatch.public_id,
        equipment_code: localMatch.equipment_code,
        name: localMatch.name,
        location_name: localMatch.location_name || "Bandara",
        brand: localMatch.brand || "Security Equipment",
        model: localMatch.model || "",
        type: localMatch.type || "XRAY",
      };
    }

    return null;
  }

  // Helper to find equipment by public_id or equipment_code or id (Internal helper)
  async function findOperationalEquipment(publicIdOrCode: string) {
    const clean = (publicIdOrCode || "").trim().toUpperCase();
    if (!clean) return null;

    // Check Supabase first if available
    const supabase = getServerSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("equipment")
          .select(`
            id,
            equipment_code,
            equipment_name,
            name,
            brand,
            model,
            type,
            public_id,
            location_id,
            equipment_type_id,
            lokasi:lokasi(nama_lokasi),
            jenis_mesin:jenis_mesin(nama_jenis, kode_jenis)
          `);

        if (!error && Array.isArray(data)) {
          const matched = data.find((eq: any) => {
            const matchPublicId = (eq.public_id || "").toUpperCase() === clean;
            const matchCode = (eq.equipment_code || "").toUpperCase() === clean;
            const matchId = String(eq.id) === clean;
            return matchPublicId || matchCode || matchId;
          });
          if (matched) {
            const locName = (matched.lokasi as any)?.nama_lokasi || (Array.isArray(matched.lokasi) ? (matched.lokasi as any)[0]?.nama_lokasi : "") || "Bandara";
            const typeCode = (matched.jenis_mesin as any)?.kode_jenis || (Array.isArray(matched.jenis_mesin) ? (matched.jenis_mesin as any)[0]?.kode_jenis : "") || matched.type || "XRAY";

            return {
              id: matched.id,
              public_id: matched.public_id || matched.equipment_code || `EQ-${matched.id}`,
              equipment_code: matched.equipment_code,
              name: matched.name || matched.equipment_name || "Equipment",
              location_name: locName,
              brand: matched.brand || "Security Equipment",
              model: matched.model || "",
              type: typeCode,
            };
          }
        }
      } catch (_) {}
    }

    // Fallback to local DEFAULT_EQUIPMENTS
    const localMatch = DEFAULT_EQUIPMENTS.find((eq) => {
      const matchPublicId = (eq.public_id || "").toUpperCase() === clean;
      const matchCode = (eq.equipment_code || "").toUpperCase() === clean;
      const matchId = String(eq.id) === clean;
      return matchPublicId || matchCode || matchId;
    });

    if (localMatch) {
      return {
        id: localMatch.id,
        public_id: localMatch.public_id || localMatch.equipment_code || `EQ-${localMatch.id}`,
        equipment_code: localMatch.equipment_code,
        name: localMatch.name,
        location_name: localMatch.location_name || "Bandara",
        brand: localMatch.brand || "Security Equipment",
        model: localMatch.model || "",
        type: localMatch.type || "XRAY",
      };
    }

    return null;
  }

  // 1. GET /api/public/equipment/:publicId (Public Equipment Lookup - PUBLIC_ID ONLY)
  app.get("/api/public/equipment/:publicId", async (req, res) => {
    try {
      const publicId = req.params.publicId;
      const equipment = await findPublicEquipmentByPublicId(publicId);

      if (!equipment) {
        return res.status(404).json({
          success: false,
          error: "Peralatan tidak ditemukan atau kode QR tidak valid.",
        });
      }

      return res.json({
        success: true,
        equipment: {
          id: equipment.id,
          public_id: equipment.public_id,
          name: equipment.name,
          equipment_code: equipment.equipment_code,
          location_name: equipment.location_name,
          brand: equipment.brand,
          model: equipment.model,
          type: equipment.type,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. POST /api/public/report-session (Create 10-minute temporary report session - PUBLIC_ID ONLY)
  app.post("/api/public/report-session", async (req, res) => {
    try {
      const { public_id } = req.body || {};
      const equipment = await findPublicEquipmentByPublicId(public_id);

      if (!equipment) {
        return res.status(404).json({
          success: false,
          error: "Peralatan tidak ditemukan.",
        });
      }

      // Generate random session token
      const session_id = `SES-${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
      const expires_at = Date.now() + 10 * 60 * 1000; // 10 minutes
      const clientIp = (req.ip || req.headers["x-forwarded-for"] || "127.0.0.1").toString();

      reportSessions.set(session_id, {
        session_id,
        public_id: equipment.public_id,
        equipment_id: equipment.id,
        expires_at,
        used: false,
        ip: clientIp,
      });

      // Cleanup old expired sessions
      const now = Date.now();
      for (const [sId, sRec] of reportSessions.entries()) {
        if (sRec.expires_at < now - 60000) {
          reportSessions.delete(sId);
        }
      }

      return res.json({
        success: true,
        session_id,
        expires_at,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. POST /api/public/upload-photo (Upload incident photo to S3 under !Kantor/2. Foto Laporan/...)
  app.post("/api/public/upload-photo", uploadLimiter, async (req, res) => {
    try {
      const { session_id, image_base64, file_name } = req.body || {};
      if (!session_id || !image_base64) {
        return res.status(400).json({
          success: false,
          error: "Sesi laporan dan data gambar wajib disertakan.",
        });
      }

      const session = reportSessions.get(session_id);
      if (!session || session.expires_at < Date.now() || session.used) {
        return res.status(401).json({
          success: false,
          error: "Sesi laporan tidak valid atau telah kedaluwarsa.",
        });
      }

      // Extract Base64 Data
      let mime = "image/jpeg";
      let base64Clean = image_base64;
      const match = image_base64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mime = match[1];
        base64Clean = match[2];
      }

      const buffer = Buffer.from(base64Clean, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: "Ukuran gambar melebihi batas 10 MB.",
        });
      }

      // Validate magic bytes
      const validation = validateFileBuffer(buffer, mime);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: "Format file tidak didukung atau rusak (Hanya JPEG, PNG, WebP).",
        });
      }

      const equipment = await findOperationalEquipment(session.public_id);
      const eqType = equipment?.type || "XRAY";
      const eqName = equipment?.name || "SECURITY";
      const equipmentLabel = `${eqType} ${eqName}`;

      const ext = validation.actualMime === "image/png" ? "png" : validation.actualMime === "image/webp" ? "webp" : "jpg";
      const object_key = generateCanonicalStorageKey({
        entityType: "avsec_error",
        entityId: session.equipment_id,
        equipmentLabel,
        ext,
      });

      const cfg = loadStorageConfig();
      let photo_url = "";

      if (cfg.enabled && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName) {
        const s3 = getS3Client(cfg);
        await s3.send(
          new PutObjectCommand({
            Bucket: cfg.bucketName,
            Key: object_key,
            Body: buffer,
            ContentType: validation.actualMime,
          })
        );
        photo_url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: cfg.bucketName, Key: object_key }),
          { expiresIn: 7 * 24 * 3600 }
        );
      } else {
        // Fallback data URI
        photo_url = `data:${validation.actualMime};base64,${base64Clean}`;
      }

      return res.json({
        success: true,
        object_key,
        photo_url,
      });
    } catch (err: any) {
      console.error("[AVSEC Photo Upload Error]:", err);
      return res.status(500).json({ success: false, error: err.message || "Gagal mengunggah foto laporan." });
    }
  });

/**
 * Helper to get ISO timestamp string in Asia/Jakarta (WIB, UTC+07:00)
 */
function getJakartaISOString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}.${ms}+07:00`;
}

  // 4. POST /api/public/submit-error-report (Submit AVSEC Error Report & Notify via Telegram)
  app.post("/api/public/submit-error-report", async (req, res) => {
    try {
      const {
        session_id,
        public_id,
        reporter_name,
        reporter_unit = "AVSEC",
        issue_type,
        description,
        photo_object_key,
        photo_url,
        latitude,
        longitude,
        location_accuracy,
      } = req.body || {};

      if (!session_id || !reporter_name || !issue_type || !description) {
        return res.status(400).json({
          success: false,
          error: "Sesi, nama pelapor, jenis gangguan, dan keterangan wajib diisi.",
        });
      }

      const session = reportSessions.get(session_id);
      if (!session || session.expires_at < Date.now() || session.used) {
        return res.status(401).json({
          success: false,
          error: "Sesi laporan tidak valid atau telah kedaluwarsa.",
        });
      }

      // Mark session as used (one-time submit protection)
      session.used = true;

      const equipment = await findOperationalEquipment(public_id || session.public_id);
      const eqName = equipment?.name || "Mesin X-Ray / Security Equipment";
      const locName = equipment?.location_name || "Bandara Halim Perdanakusuma";

      // Generate sequential/unique report number in Jakarta date (Asia/Jakarta)
      const now = new Date();
      const datePart = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).replace(/-/g, "");
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      const report_number = `REP-AVSEC-${datePart}-${randSuffix}`;

      const reportRecord: ServerExternalReport = {
        id: crypto.randomUUID(),
        report_number,
        equipment_id: equipment?.id || session.equipment_id,
        public_equipment_id: equipment?.public_id || session.public_id,
        equipment_name: eqName,
        location_name: locName,
        reporter_name: (reporter_name || "").trim(),
        reporter_unit: (reporter_unit || "AVSEC").trim(),
        issue_type: (issue_type || "").trim(),
        description: (description || "").trim(),
        photo_object_key: photo_object_key || undefined,
        photo_url: photo_url || undefined,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        location_accuracy: location_accuracy ? Number(location_accuracy) : null,
        session_id,
        status: "NEW",
        created_at: now.toISOString(),
      };

      // 1. Save to Supabase external_error_reports if table exists
      const supabase = getServerSupabase();
      if (supabase) {
        try {
          await supabase.from("external_error_reports").insert({
            id: reportRecord.id,
            report_number: reportRecord.report_number,
            equipment_id: reportRecord.equipment_id,
            public_equipment_id: reportRecord.public_equipment_id,
            reporter_name: reportRecord.reporter_name,
            reporter_unit: reportRecord.reporter_unit,
            issue_type: reportRecord.issue_type,
            description: reportRecord.description,
            photo_object_key: reportRecord.photo_object_key || null,
            latitude: reportRecord.latitude,
            longitude: reportRecord.longitude,
            location_accuracy: reportRecord.location_accuracy,
            session_id: reportRecord.session_id,
            status: "NEW",
            created_at: reportRecord.created_at,
          });
        } catch (dbErr) {
          console.warn("[ExternalErrorReport Supabase Insert Warning]:", dbErr);
        }
      }

      // 2. Save to local fallback JSON storage
      const existingReports = loadExternalErrorReports();
      existingReports.unshift(reportRecord);
      saveExternalErrorReports(existingReports);

      // 3. Send Telegram Notification to Technical Team
      const formattedTime = now.toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
      });
      const formattedDate = now.toLocaleDateString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

      const getEquipmentTypeName = (typeCodeOrName?: string): string => {
        const code = (typeCodeOrName || "").toUpperCase().trim();
        if (code === "XRAY" || code.includes("X-RAY") || code.includes("XRAY")) return "X-Ray System";
        if (code === "WTMD" || code.includes("WALK THROUGH") || code.includes("METAL DETECTOR")) return "Walk Through Metal Detector (WTMD)";
        if (code === "HHMD" || code.includes("HAND HELD")) return "Hand Held Metal Detector (HHMD)";
        if (code === "ETD" || code.includes("EXPLOSIVE") || code.includes("TRACE")) return "Explosive Trace Detector (ETD)";
        return typeCodeOrName || "Security Equipment";
      };

      const eqTypeLabel = getEquipmentTypeName(equipment?.type);
      const locDisplay = equipment?.location_name || equipment?.name || "Bandara Halim Perdanakusuma";

      const tgMessage =
        `🚨 <b>LAPORAN GANGGUAN BARU (AVSEC)</b>\n\n` +
        `<b>No. Laporan:</b> <code>${escapeTgHtml(report_number)}</code>\n` +
        `<b>Equipment:</b> <b>${escapeTgHtml(eqTypeLabel)}</b>\n` +
        `<b>Lokasi:</b> ${escapeTgHtml(locDisplay)}\n` +
        `<b>Pelapor:</b> ${escapeTgHtml(reportRecord.reporter_name)} (${escapeTgHtml(reportRecord.reporter_unit)})\n` +
        `<b>Jenis Gangguan:</b> ${escapeTgHtml(reportRecord.issue_type)}\n` +
        `<b>Keterangan:</b> ${escapeTgHtml(reportRecord.description)}\n` +
        `<b>Waktu:</b> ${formattedDate}, ${formattedTime} WIB\n\n` +
        `🔗 <a href="https://nararyaapps.net/#/avsec-reports">Buka Sistem Monitoring Laporan</a>\n\n` +
        `<i>sent from nararyaapps.net</i>`;

      await sendTelegramAlertMessage(tgMessage);

      // 4. Send WhatsApp Notification to Technical Team (Baileys)
      try {
        const waMessage =
          `🚨 *LAPORAN GANGGUAN BARU (AVSEC)*\n\n` +
          `*No. Laporan:* \`${report_number}\`\n` +
          `*Equipment:* *${eqTypeLabel}*\n` +
          `*Lokasi:* ${locDisplay}\n` +
          `*Pelapor:* ${reportRecord.reporter_name} (${reportRecord.reporter_unit})\n` +
          `*Jenis Gangguan:* ${reportRecord.issue_type}\n` +
          `*Keterangan:* ${reportRecord.description}\n` +
          `*Waktu:* ${formattedDate}, ${formattedTime} WIB\n\n` +
          `*_sent from nararyaapps.net_*`;
        const targetJid = loadWhatsAppConfig().target_jid;
        if (targetJid) await whatsappText(targetJid, waMessage);
      } catch (waErr) {
        console.warn("[AVSEC WhatsApp Notify Error]:", waErr);
      }

      return res.json({
        success: true,
        report_number,
        created_at: now.toISOString(),
        status: "NEW",
      });
    } catch (err: any) {
      console.error("[Submit AVSEC Report Error]:", err);
      return res.status(500).json({ success: false, error: err.message || "Gagal mengirim laporan gangguan." });
    }
  });

  // 5. GET /api/avsec-reports (Internal Technician/Supervisor list)
  app.get("/api/avsec-reports", requireAuth, async (req, res) => {
    try {
      const status = req.query.status as string;
      let reports = loadExternalErrorReports();

      // Check Supabase if available
      const supabase = getServerSupabase();
      if (supabase) {
        try {
          const query = supabase
            .from("external_error_reports")
            .select("*")
            .order("created_at", { ascending: false });

          if (status && status !== "ALL") {
            query.eq("status", status);
          }

          const { data, error } = await query;
          if (!error && Array.isArray(data)) {
            // Prefer existing database equipment master where available
            let dbEquipments: any[] = [];
            try {
              const { data: eqMaster } = await supabase
                .from("equipment")
                .select("id, equipment_code, equipment_name, name, public_id, location_id, lokasi:lokasi(nama_lokasi)");
              if (Array.isArray(eqMaster)) {
                dbEquipments = eqMaster;
              }
            } catch (masterErr) {
              console.warn("[GET /api/avsec-reports] DB equipment master query warning:", masterErr);
            }

            const fallbackEquipments = DEFAULT_EQUIPMENTS;

            reports = data.map((d: any) => {
              // 1. Search in DB master equipment
              const matchedDb = dbEquipments.find(
                (eq: any) =>
                  eq.id === Number(d.equipment_id) ||
                  (eq.public_id && eq.public_id === d.public_equipment_id) ||
                  (eq.equipment_code && eq.equipment_code === d.public_equipment_id)
              );

              // 2. Fallback to DEFAULT_EQUIPMENTS
              const matchedFallback = !matchedDb
                ? fallbackEquipments.find(
                    (eq: any) =>
                      eq.id === Number(d.equipment_id) ||
                      (eq.public_id && eq.public_id === d.public_equipment_id) ||
                      (eq.equipment_code && eq.equipment_code === d.public_equipment_id)
                  )
                : null;

              const resolvedName =
                matchedDb?.name ||
                matchedDb?.equipment_name ||
                matchedFallback?.name ||
                d.equipment_name ||
                "Equipment";

              const resolvedLoc =
                (matchedDb?.lokasi as any)?.nama_lokasi ||
                (Array.isArray(matchedDb?.lokasi) ? (matchedDb?.lokasi as any)[0]?.nama_lokasi : "") ||
                matchedFallback?.location_name ||
                d.location_name ||
                "-";

              return {
                ...d,
                equipment_name: resolvedName,
                location_name: resolvedLoc,
              };
            });
          } else if (error) {
            console.warn("[GET /api/avsec-reports Supabase Error]:", error?.message || error);
          }
        } catch (dbErr) {
          console.warn("[GET /api/avsec-reports DB Exception]:", dbErr);
        }
      }

      // If signed URL needed for photos
      const cfg = loadStorageConfig();
      if (cfg.enabled && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName) {
        const s3 = getS3Client(cfg);
        for (const r of reports) {
          if (r.photo_object_key && !r.photo_url) {
            try {
              r.photo_url = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: cfg.bucketName, Key: r.photo_object_key }),
                { expiresIn: 3600 }
              );
            } catch (_) {}
          }
        }
      }

      if (status && status !== "ALL") {
        reports = reports.filter((r) => r.status === status);
      }

      return res.json({ success: true, reports });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. POST /api/avsec-reports/:id/acknowledge
  app.post("/api/avsec-reports/:id/acknowledge", requireAuth, async (req, res) => {
    try {
      const id = req.params.id;
      const userName = (req as any).user?.name || "Teknisi";
      const now = new Date().toISOString();

      // Update Supabase
      const supabase = getServerSupabase();
      if (supabase) {
        try {
          await supabase
            .from("external_error_reports")
            .update({ status: "ACKNOWLEDGED", reviewed_by: userName, reviewed_at: now })
            .eq("id", id);
        } catch (_) {}
      }

      // Update Local
      const reports = loadExternalErrorReports();
      const rec = reports.find((r) => String(r.id) === String(id));
      if (rec) {
        rec.status = "ACKNOWLEDGED";
        rec.reviewed_by = userName;
        rec.reviewed_at = now;
        saveExternalErrorReports(reports);
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. POST /api/avsec-reports/:id/convert-to-corrective
  app.post("/api/avsec-reports/:id/convert-to-corrective", requireAuth, async (req, res) => {
    try {
      const id = req.params.id;
      const userName = (req as any).user?.name || "Teknisi";
      const { action_taken, result = "Resolved", result_text = "", notes = "" } = req.body || {};
      const now = new Date().toISOString();
      const todayStr = now.slice(0, 10);
      const codeDate = todayStr.replace(/-/g, "");
      const randSuffix = Math.floor(100 + Math.random() * 900);
      const corrective_code = `CR-${codeDate}-${randSuffix}`;

      // Update Local
      const reports = loadExternalErrorReports();
      const rec = reports.find((r) => String(r.id) === String(id));
      if (!rec) {
        return res.status(404).json({ success: false, error: "Laporan tidak ditemukan" });
      }

      rec.status = "CONVERTED_TO_CORRECTIVE";
      rec.reviewed_by = userName;
      rec.reviewed_at = now;
      rec.corrective_record_id = corrective_code;
      saveExternalErrorReports(reports);

      // Create corrective entry in operational state
      const opState = loadOperationalState();
      const newCorrective: OperationalCorrective = {
        id: crypto.randomUUID(),
        equipment_id: rec.equipment_id,
        equipment_name: rec.equipment_name,
        location_name: rec.location_name,
        fault_description: `[Laporan AVSEC #${rec.report_number}] ${rec.issue_type}: ${rec.description}`,
        problem_description: `${rec.issue_type}: ${rec.description}`,
        action_taken: action_taken || "Pemeriksaan dan perbaikan langsung oleh teknisi on-duty.",
        result,
        corrective_date: todayStr,
        technicians: [userName],
        created_by: userName,
      };
      opState.correctiveReports.unshift(newCorrective);
      saveOperationalState(opState);

      // Update Supabase if available
      const supabase = getServerSupabase();
      if (supabase) {
        try {
          await supabase
            .from("external_error_reports")
            .update({
              status: "CONVERTED_TO_CORRECTIVE",
              reviewed_by: userName,
              reviewed_at: now,
              corrective_record_id: corrective_code,
            })
            .eq("id", id);

          await supabase.from("corrective_records").insert({
            corrective_code,
            equipment_id: rec.equipment_id,
            corrective_date: todayStr,
            problem_description: newCorrective.problem_description,
            action_taken: newCorrective.action_taken,
            result: newCorrective.result,
            result_text: result_text || newCorrective.result,
            technicians: [userName],
            created_by: userName,
          });
        } catch (_) {}
      }

      return res.json({ success: true, corrective_code });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8. POST /api/avsec-reports/:id/close
  app.post("/api/avsec-reports/:id/close", requireAuth, async (req, res) => {
    try {
      const id = req.params.id;
      const userName = (req as any).user?.name || "Teknisi";
      const { notes = "Pengecekan di lapangan: unit normal (false alarm)." } = req.body || {};
      const now = new Date().toISOString();

      const reports = loadExternalErrorReports();
      const rec = reports.find((r) => String(r.id) === String(id));
      if (!rec) {
        return res.status(404).json({ success: false, error: "Laporan tidak ditemukan" });
      }

      rec.status = "CLOSED";
      rec.reviewed_by = userName;
      rec.reviewed_at = now;
      rec.review_notes = notes;
      saveExternalErrorReports(reports);

      const supabase = getServerSupabase();
      if (supabase) {
        try {
          await supabase
            .from("external_error_reports")
            .update({
              status: "CLOSED",
              reviewed_by: userName,
              reviewed_at: now,
              review_notes: notes,
            })
            .eq("id", id);
        } catch (_) {}
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9. DELETE /api/avsec-reports/:id (Supervisor only - removes database record + S3 photo)
  app.delete("/api/avsec-reports/:id", requireSupervisor, async (req, res) => {
    try {
      const id = req.params.id;
      const reports = loadExternalErrorReports();
      const rec = reports.find((r) => String(r.id) === String(id) || String(r.report_number) === String(id));

      if (rec) {
        // Delete photo in S3 storage if photo_object_key is present
        if (rec.photo_object_key) {
          const cfg = loadStorageConfig();
          if (cfg.enabled && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName) {
            try {
              const s3 = getS3Client(cfg);
              await s3.send(new DeleteObjectCommand({
                Bucket: cfg.bucketName,
                Key: rec.photo_object_key,
              }));
              console.log(`[AVSEC Delete] Deleted incident photo from S3: ${rec.photo_object_key}`);
            } catch (s3Err) {
              console.warn(`[AVSEC Delete Warning] Failed to delete S3 photo ${rec.photo_object_key}:`, s3Err);
            }
          }
        }

        // Delete from local cache
        const updatedReports = reports.filter((r) => String(r.id) !== String(id) && String(r.report_number) !== String(id));
        saveExternalErrorReports(updatedReports);
      }

      // Delete from Supabase table
      const supabase = getServerSupabase();
      if (supabase) {
        try {
          await supabase.from("external_error_reports").delete().eq("id", id);
        } catch (dbErr) {
          console.warn("[AVSEC Delete Supabase Warning]:", dbErr);
        }
      }

      return res.json({ success: true, message: "Laporan AVSEC dan foto terkait berhasil dihapus." });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Telegram Bot: Check status & get bot profile
  app.get("/api/telegram/status", async (req, res) => {
    const serverCfg = loadTelegramServerConfig();
    const token = (req.query.token as string) || serverCfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;
    const defaultChatId = serverCfg.chat_id || process.env.TELEGRAM_CHAT_ID || "-5531204015";

    if (!token) {
      return res.json({
        configured: false,
        message: "TELEGRAM_BOT_TOKEN belum diset di server maupun konfigurasi.",
        defaultChatId,
      });
    }

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await tgRes.json() as any;

      if (!data.ok) {
        return res.json({
          configured: false,
          error: data.description || "Token Telegram tidak valid",
          defaultChatId,
        });
      }

      return res.json({
        configured: true,
        bot_id: data.result.id,
        bot_name: data.result.first_name,
        bot_username: data.result.username,
        defaultChatId,
        serverConfig: {
          chat_id: serverCfg.chat_id,
          broadcast_to_all_subscribers: serverCfg.broadcast_to_all_subscribers,
          auto_notify_corrective: serverCfg.auto_notify_corrective,
          auto_notify_recurring_fault: serverCfg.auto_notify_recurring_fault,
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        configured: false,
        error: err.message || "Gagal menghubungi Telegram Bot API",
      });
    }
  });

  // Telegram Bot: Save token and full settings to server file (.data/telegram_server_config.json) (Supervisor only)
  app.post("/api/telegram/save-token", requireSupervisor, async (req, res) => {
    try {
      const {
        token,
        chat_id,
        broadcast_to_all_subscribers,
        auto_notify_corrective,
        auto_notify_recurring_fault,
      } = req.body;
      const current = loadTelegramServerConfig();
      const updated: TelegramServerConfig = {
        bot_token: token !== undefined ? token.trim() : current.bot_token,
        chat_id: chat_id !== undefined ? chat_id.trim() : current.chat_id,
        broadcast_to_all_subscribers:
          broadcast_to_all_subscribers !== undefined
            ? Boolean(broadcast_to_all_subscribers)
            : current.broadcast_to_all_subscribers,
        auto_notify_corrective:
          auto_notify_corrective !== undefined
            ? Boolean(auto_notify_corrective)
            : current.auto_notify_corrective,
        auto_notify_recurring_fault:
          auto_notify_recurring_fault !== undefined
            ? Boolean(auto_notify_recurring_fault)
            : current.auto_notify_recurring_fault,
      };
      saveTelegramServerConfig(updated);

      if (updated.bot_token) {
        triggerTelegramPolling(updated.bot_token);
      }

      return res.json({ success: true, config: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==============================================================================
  // GPS & ATTENDANCE ROUTES (SERVER-AUTHORITATIVE & SUPABASE PERSISTENCE)
  // ==============================================================================

  // Location Config (Authoritative Airport Coordinates & Max Radius)
  app.get("/api/attendance/location-config", (req, res) => {
    res.json({
      success: true,
      latitude: OFFICE_CONFIG.latitude,
      longitude: OFFICE_CONFIG.longitude,
      radiusMeters: OFFICE_CONFIG.radiusMeters,
      name: OFFICE_CONFIG.name,
    });
  });

  // Attendance API: Verify Live Person (Anti-Spoofing & Liveness Detection — Non Fail-Open)
  app.post("/api/attendance/verify-liveness", requireAuth, livenessLimiter, async (req, res) => {
    try {
      const { image, technician_name } = req.body;
      if (!image || typeof image !== "string") {
        return res.status(400).json({
          success: false,
          isLive: false,
          verification_status: "verification_failed",
          confidence: 0,
          rejectionReason: "Foto selfie wajib dilampirkan untuk verifikasi keaslian.",
        });
      }

      // Extract base64 and mime type
      let mimeType = "image/jpeg";
      let base64Data = image;

      const dataUriMatch = image.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        mimeType = dataUriMatch[1];
        base64Data = dataUriMatch[2];
      }

      const client = getGeminiClient();
      if (!client) {
        // NON FAIL-OPEN: If GEMINI_API_KEY is not set, return unverified
        console.warn("[Liveness Detection] GEMINI_API_KEY belum diset. Status diset ke unverified.");
        return res.json({
          success: true,
          isLive: false,
          verification_status: "unverified",
          confidence: 0.5,
          rejectionReason: "",
          details: "Verifikasi biometrik belum dikonfigurasi di server. Presensi dicatat dengan status 'unverified'.",
          detectionType: "unverified",
        });
      }

      const systemPrompt = `You are a strict biometric security and face liveness verification specialist for airport security personnel attendance.
Your task is to analyze the captured selfie photo and verify whether it is a REAL LIVE HUMAN physically present in front of the camera, or an anti-spoofing fraud attempt.

CRITICAL REJECTION CRITERIA (SPOOFING / FAKE):
1. REJECT if the image is a photo of another computer/laptop screen, tablet, or phone screen (look for pixel moiré patterns, screen bezels, reflections on glass, display glare, RGB scanlines).
2. REJECT if the image is a photo of an ID card / KTP / SIM / passport / printed badge (look for card borders, laminate gloss, small passport-style crop, ID card watermarks).
3. REJECT if the image is a photo of a physical printed photo paper (look for paper corners, creases, paper borders, glossy photographic paper glare, photo frame).
4. REJECT if no human face is detected or if the face is obscured, masked, or a non-human object/cartoon.
5. REJECT if it is clearly a 2D cutout, mask, mannequin, or AI deepfake rendering.

ACCEPT CRITERIA (REAL HUMAN):
- An actual live technician physically taking a selfie directly into the camera lens with natural 3D facial lighting, organic skin texture, natural background depth of field, and proper selfie perspective.

Return ONLY a JSON response matching the following schema:
{
  "isLive": boolean,
  "confidence": number between 0.0 and 1.0,
  "rejectionReason": string (in Indonesian language, clear and polite explaining why it was rejected, or empty if accepted),
  "detectedFace": boolean,
  "details": string (short assessment in Indonesian)
}`;

      const aiResponse = await client.models.generateContent({
        model: "gemini-3.8-flash",
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: `Analisis foto presensi teknisi (${technician_name || "Teknisi"}). Tentukan apakah ini orang asli langsung di depan kamera atau foto dari layar PC/KTP/foto fisik. Berikan response JSON.`,
            },
          ],
        },
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const responseText = aiResponse.text || "{}";
      let parsed: any;
      try {
        parsed = JSON.parse(responseText);
      } catch (e) {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Gagal mengurai respons verifikasi wajah dari AI model.");
        }
      }

      const isLive = Boolean(parsed.isLive);
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : (isLive ? 0.95 : 0.2);
      const rejectionReason = parsed.rejectionReason || (isLive ? "" : "Terdeteksi bukan orang asli langsung (diduga foto dari layar/KTP/cetakan).");
      const details = parsed.details || (isLive ? "Wajah manusia asli terverifikasi langsung di kamera." : rejectionReason);
      const verificationStatus = isLive ? "verified" : "verification_failed";

      return res.json({
        success: true,
        isLive,
        verification_status: verificationStatus,
        confidence,
        rejectionReason,
        details,
        detectedFace: parsed.detectedFace !== undefined ? Boolean(parsed.detectedFace) : true,
      });
    } catch (err: any) {
      console.error("[Liveness Detection Error]:", err);
      // NON FAIL-OPEN: Network/API error returns unverified
      return res.status(200).json({
        success: true,
        isLive: false,
        verification_status: "unverified",
        confidence: 0.5,
        rejectionReason: "",
        details: `Terjadi kendala jaringan saat AI liveness check (${err?.message || "error"}). Presensi dicatat dengan status 'unverified'.`,
      });
    }
  });

  // Attendance API: Record attendance (Authenticated + Authoritative GPS & Supabase Persistence)
  app.post("/api/attendance", requireAuth, async (req, res) => {
    try {
      const rawRecord: ServerAttendanceRecord = req.body;
      const authUser = (req as any).user;

      if (!rawRecord || !rawRecord.technician_name) {
        return res.status(400).json({ success: false, error: "Nama teknisi wajib diisi." });
      }

      // 1. Authoritative Identity from Token
      // Never trust technician identity provided by browser for attendance.
      const verifiedTechId = authUser.technician_id != null ? authUser.technician_id
        : authUser.type === 'technician' ? authUser.id : null;
      const verifiedTechName = (authUser.name || '').trim();
      if (!verifiedTechName) {
        return res.status(403).json({ success: false, error: 'Identitas presensi belum terverifikasi.' });
      }

      // 2. Authoritative Time & Date in Asia/Jakarta (WIB)
      const serverNow = new Date();
      const jktFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = jktFormatter.formatToParts(serverNow);
      const partMap: Record<string, string> = {};
      parts.forEach((p) => { if (p.type !== 'literal') partMap[p.type] = p.value; });
      const currentCalDate = `${partMap.year}-${partMap.month}-${partMap.day}`;
      const hour = parseInt(partMap.hour, 10);
      const minute = parseInt(partMap.minute, 10);

      // Operational date calculation: Shift M from 00:00 - 06:59 WIB uses yesterday's date
      let authoritativeOpDate = currentCalDate;
      let rawShiftUpper = (rawRecord.shift || "").toUpperCase().trim();
      let cleanShift: ServerAttendanceRecord['shift'] = "PS";

      if (rawShiftUpper === "OFFICE") {
        cleanShift = "OFFICE";
      } else if (rawShiftUpper === "M" || rawShiftUpper === "MALAM") {
        cleanShift = "M";
        if (hour < 9) {
          // Shift M checkout remains bound to yesterday through 08:00 WIB.
          // Validation below rejects out-of-window submissions after 08:00.
          const prevDate = new Date(Date.UTC(parseInt(partMap.year, 10), parseInt(partMap.month, 10) - 1, parseInt(partMap.day, 10) - 1));
          const py = prevDate.getUTCFullYear();
          const pm = String(prevDate.getUTCMonth() + 1).padStart(2, "0");
          const pd = String(prevDate.getUTCDate()).padStart(2, "0");
          authoritativeOpDate = `${py}-${pm}-${pd}`;
        }
      } else {
        cleanShift = "PS";
      }

      const cleanDate = authoritativeOpDate;
      let verifiedAttendanceStatus: ServerAttendanceRecord['status'] = 'Tepat Waktu';
      const attType = rawRecord.attendance_type || (rawRecord.is_bypassed ? "bypass" : rawRecord.is_off_duty ? "off_duty" : "masuk");
      if (rawRecord.attendance_date && rawRecord.attendance_date !== cleanDate) {
        return res.status(403).json({ success: false, error: 'Tanggal operasional presensi tidak sesuai waktu server.' });
      }
      if (attType === 'masuk' || attType === 'pulang') {
        // Validate on server using the same person/date/shift resolver as UI.
        // Direct POST must never bypass attendance windows, even if the user
        // manually changes the disabled button in browser devtools.
        const db = getServerSupabase();
        if (!db) return res.status(503).json({ success: false, error: 'Database presensi belum tersedia.' });
        const yesterday = getPreviousDateString(currentCalDate);
        const { data: rosterRows, error: rosterError } = await db
          .from('shift_schedules')
          .select('schedule_date,shift,assignments')
          .in('schedule_date', [yesterday, currentCalDate])
          .eq('dataset_id', 'default');
        if (rosterError) return res.status(503).json({ success: false, error: 'Validasi jadwal belum tersedia.' });

        const { data: patternRows, error: patternError } = await db
          .from('staff_work_patterns').select('*').eq('is_active', true);
        // Older installations may not have the work pattern table yet.
        // A genuine table or permission error outside a missing migration is
        // not grounds to grant a role privileged attendance.
        if (patternError && patternError.code !== '42P01' && patternError.code !== 'PGRST205') {
          return res.status(503).json({ success: false, error: 'Konfigurasi pola kerja belum tersedia.' });
        }
        const staffPatterns = Array.isArray(patternRows) && patternRows.length > 0
          ? patternRows.map((pattern: any) => pattern.work_pattern === 'OFFICE' &&
              ['desi', 'luthfi'].includes(String(pattern.staff_name).trim().toLowerCase())
              ? { ...pattern, active_days: [1, 2, 3, 4, 5] } : pattern)
          : DEFAULT_STAFF_WORK_PATTERNS;
        const { data: configuredRules, error: rulesError } = await db
          .from('work_shift_rules').select('*').eq('is_active', true);
        if (rulesError && rulesError.code !== '42P01' && rulesError.code !== 'PGRST205') {
          return res.status(503).json({ success: false, error: 'Aturan jam kerja belum tersedia.' });
        }
        const rules = { ...DEFAULT_WORK_SHIFT_RULES };
        for (const rule of (configuredRules || [])) {
          if (rule.shift_code === 'OFFICE' || rule.shift_code === 'PS' || rule.shift_code === 'M') {
            rules[rule.shift_code] = { ...rules[rule.shift_code], ...rule };
          }
        }
        const { data: previousAttendance, error: previousError } = await db
          .from('attendance')
          .select('technician_id,technician_name,operational_date,attendance_type,shift')
          .in('operational_date', [yesterday, currentCalDate]);
        if (previousError) return res.status(503).json({ success: false, error: 'Validasi presensi sebelumnya gagal.' });
        const attendanceHistory = (previousAttendance || []).map((row: any) => ({
          technician_id: row.technician_id,
          technician_name: row.technician_name,
          attendance_date: row.operational_date,
          attendance_type: row.attendance_type,
          shift: row.shift === 'M' ? 'Malam' : row.shift === 'OFFICE' ? 'Office' : 'Pagi',
        }));
        const check = evaluateOperationalPermissions({
          userRole: authUser.role,
          technician: { id: verifiedTechId != null ? Number(verifiedTechId) : undefined, name: verifiedTechName },
          nowDate: serverNow,
          scheduleDocs: (rosterRows || []).map((row: any) => ({
            dataset_id: 'default',
            schedule_date: row.schedule_date,
            shift: row.shift,
            assignments: row.assignments || {},
          })),
          staffPatterns,
          rules,
          attendanceHistory: attendanceHistory as any,
        });
        verifiedAttendanceStatus = attType === 'masuk' && check.attendanceState === 'CAN_CHECK_IN_LATE'
          ? 'Telat' : 'Tepat Waktu';
        const allowed = attType === 'masuk'
          ? (check.permissions.canCheckIn || check.permissions.canCheckInLate)
          : check.permissions.canCheckOut;
        if (!allowed || check.operationalDate !== cleanDate || check.shiftCode !== cleanShift) {
          return res.status(403).json({ success: false, code: 'ATTENDANCE_WINDOW_CLOSED',
            error: 'Presensi ditolak: personel, shift, tanggal, atau waktu tidak sesuai jadwal aktif.' });
        }
      }

      // 3. Server-authoritative GPS Haversine calculation
      let distanceMeters: number | null = null;
      let isWithinRadius = true;
      if (rawRecord.location && typeof rawRecord.location.latitude === "number" && typeof rawRecord.location.longitude === "number") {
        distanceMeters = calculateHaversineDistanceMeters(
          rawRecord.location.latitude,
          rawRecord.location.longitude,
          OFFICE_CONFIG.latitude,
          OFFICE_CONFIG.longitude
        );
        isWithinRadius = distanceMeters <= OFFICE_CONFIG.radiusMeters;
      }

      const recordCreatedAt = getJakartaISOString(serverNow);

      const record: ServerAttendanceRecord = {
        ...rawRecord,
        technician_id: verifiedTechId,
        technician_name: verifiedTechName,
        attendance_date: cleanDate,
        shift: cleanShift,
        attendance_type: attType,
        attendance_time: rawRecord.attendance_time || new Intl.DateTimeFormat("id-ID", {
          timeZone: "Asia/Jakarta",
          hour: "2-digit",
          minute: "2-digit",
        }).format(serverNow) + " WIB",
        status: verifiedAttendanceStatus,
        verification_status: rawRecord.verification_status || "verified",
        is_bypassed: Boolean(rawRecord.is_bypassed),
        is_off_duty: Boolean(rawRecord.is_off_duty),
        location: rawRecord.location
          ? {
              ...rawRecord.location,
              distance_meters: distanceMeters !== null ? distanceMeters : rawRecord.location.distance_meters,
              is_within_radius: isWithinRadius,
              area_name: isWithinRadius ? OFFICE_CONFIG.name : `Di Luar Radius (${((distanceMeters || 0) / 1000).toFixed(1)} km)`,
            }
          : undefined,
        created_at: recordCreatedAt,
      };

      // 2. Primary Persistence: Supabase PostgreSQL `attendance` table
      const supabase = getServerSupabase();
      if (supabase) {
        try {
          const supabasePayload = {
            attendance_id: record.id,
            technician_id: record.technician_id || null,
            technician_name: record.technician_name.trim(),
            operational_date: cleanDate,
            shift: cleanShift,
            attendance_type: attType,
            timestamp: recordCreatedAt,
            attendance_time: record.attendance_time,
            latitude: record.location?.latitude || null,
            longitude: record.location?.longitude || null,
            distance_meters: distanceMeters,
            is_within_radius: isWithinRadius,
            photo_object_key: record.photo_object_key || null,
            photo_url: record.photo_url || null,
            status: record.status,
            verification_status: record.verification_status,
            liveness_confidence: record.liveness_confidence || null,
            is_bypassed: record.is_bypassed,
            is_off_duty: record.is_off_duty,
            notes: record.notes || "",
            raw_data: record,
          };

          // Check if record already exists in database (match personnel, operational date, shift, and attendance type)
          let query = supabase
            .from("attendance")
            .select("id")
            .eq("operational_date", cleanDate)
            .eq("shift", cleanShift)
            .eq("attendance_type", attType);

          if (record.technician_id) {
            query = query.or(`technician_id.eq.${record.technician_id},technician_name.ilike.${record.technician_name.trim()}`);
          } else {
            query = query.ilike("technician_name", record.technician_name.trim());
          }

          const { data: existingRows } = await query.limit(1);

          if (existingRows && existingRows.length > 0) {
            const existingId = existingRows[0].id;
            const { error: updErr } = await supabase
              .from("attendance")
              .update(supabasePayload)
              .eq("id", existingId);

            if (updErr) throw new Error(`Gagal menyimpan presensi: ${updErr.message}`);
          } else {
            const { error: insErr } = await supabase
              .from("attendance")
              .insert(supabasePayload);

            if (insErr) throw new Error(`Gagal menyimpan presensi: ${insErr.message}`);
          }
        } catch (dbEx) {
          console.error("[Supabase Attendance Save Failed]:", dbEx);
          throw dbEx;
        }
      } else {
        return res.status(503).json({ success: false, error: 'Database presensi tidak tersedia.' });
      }

      // 3. Update fast local cache / fallback file (.data/attendance_records.json)
      const records = loadAttendanceRecords();
      const existingIdx = records.findIndex(
        (r) =>
          r.attendance_date === cleanDate &&
          (r.shift || "").toUpperCase() === cleanShift.toUpperCase() &&
          ((record.technician_id && r.technician_id === record.technician_id) ||
            r.technician_name.toLowerCase() === record.technician_name.toLowerCase()) &&
          (r.attendance_type || "masuk") === attType
      );

      if (existingIdx >= 0) {
        records[existingIdx] = { ...records[existingIdx], ...record };
      } else {
        records.unshift(record);
      }
      saveAttendanceRecords(records.slice(0, 500));

      return res.json({ success: true, message: "Presensi berhasil disimpan", record });
    } catch (err: any) {
      console.error("[Attendance Save Error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Attendance API: List attendance history (Authenticated + Supabase prioritized)
  app.get("/api/attendance", requireAuth, async (req, res) => {
    try {
      const date = req.query.date as string | undefined;
      const supabase = getServerSupabase();

      if (supabase) {
        try {
          let query = supabase
            .from("attendance")
            .select("*")
            .order("timestamp", { ascending: false });

          if (date) {
            query = query.eq("operational_date", date);
          }

          const { data, error } = await query;
          if (!error && Array.isArray(data)) {
            const mappedRecords: ServerAttendanceRecord[] = data.map((row: any) => ({
              id: row.attendance_id || `att_${row.id}`,
              technician_id: row.technician_id,
              technician_name: row.technician_name,
              attendance_type: row.attendance_type,
              shift: row.shift === "M" || row.shift === "Malam" ? "Malam"
                : row.shift === "OFFICE" || row.shift === "Office" ? "Office" : "Pagi",
              attendance_date: row.operational_date,
              attendance_time: row.attendance_time || "",
              status: row.status || "Tepat Waktu",
              verification_status: row.verification_status || "verified",
              liveness_confidence: row.liveness_confidence,
              is_bypassed: Boolean(row.is_bypassed),
              is_off_duty: Boolean(row.is_off_duty),
              photo_url: row.photo_url,
              photo_object_key: row.photo_object_key,
              notes: row.notes || "",
              location: row.latitude && row.longitude
                ? {
                    latitude: Number(row.latitude),
                    longitude: Number(row.longitude),
                    distance_meters: row.distance_meters,
                    is_within_radius: row.is_within_radius !== false,
                    area_name: row.is_within_radius !== false ? OFFICE_CONFIG.name : `Di Luar Radius (${((row.distance_meters || 0) / 1000).toFixed(1)} km)`,
                  }
                : undefined,
              created_at: row.timestamp || row.created_at,
            }));

            return res.json({ success: true, records: mappedRecords, total: mappedRecords.length, source: "supabase" });
          }
        } catch (dbErr) {
          console.warn("[Supabase Attendance Query Exception]:", dbErr);
        }
      }

      // Fallback to local JSON file
      let records = loadAttendanceRecords();
      if (date) {
        records = records.filter((r) => r.attendance_date === date);
      }
      return res.json({ success: true, records, total: records.length, source: "local_cache" });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==============================================================================
  // BACKUP STRATEGY ENDPOINT (SUPERVISOR ONLY)
  // ==============================================================================
  app.get("/api/backup/export", requireSupervisor, async (req, res) => {
    try {
      const supabase = getServerSupabase();
      const backupData: Record<string, any> = {
        timestamp: new Date().toISOString(),
        exported_by: (req as any).user?.name || "Supervisor",
        database_tables: {},
        storage_manifest: [],
      };

      // 1. Export all Supabase tables
      if (supabase) {
        const tables = [
          "profiles",
          "technicians",
          "equipment",
          "lokasi",
          "jenis_mesin",
          "checklist_frequencies",
          "checklist_items",
          "preventive_records",
          "corrective_records",
          "shift_schedules",
          "component_replacements",
          "attendance",
          "report_files",
        ];

        for (const tbl of tables) {
          try {
            const { data, error } = await supabase.from(tbl).select("*");
            if (!error && Array.isArray(data)) {
              backupData.database_tables[tbl] = data;
            } else {
              backupData.database_tables[tbl] = { error: error?.message || "Failed to export" };
            }
          } catch (tErr: any) {
            backupData.database_tables[tbl] = { error: tErr?.message };
          }
        }
      }

      // 2. Export IDCloudHost Storage Objects Manifest
      const cfg = loadStorageConfig();
      if (cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName) {
        try {
          const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
          const s3 = getS3Client(cfg);
          const listRes = await s3.send(
            new ListObjectsV2Command({
              Bucket: cfg.bucketName,
              MaxKeys: 1000,
            })
          );
          backupData.storage_manifest = (listRes.Contents || []).map((o) => ({
            key: o.Key,
            size: o.Size,
            last_modified: o.LastModified,
            etag: o.ETag,
          }));
          backupData.storage_bucket = cfg.bucketName;
        } catch (s3Err: any) {
          backupData.storage_manifest_error = s3Err?.message;
        }
      }

      const filename = `xray_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.json(backupData);
    } catch (err: any) {
      console.error("[Backup Export Error]:", err);
      res.status(500).json({ success: false, error: err?.message || "Gagal melakukan export backup" });
    }
  });

  // Telegram Bot: Sync Operational State from frontend for /alat & /brief commands (Authenticated)
  app.post("/api/telegram/operational-state", requireAuth, (req, res) => {
    try {
      const { operationalDate, shift, technicianNames, equipments, correctiveReports } = req.body;
      const currentState = loadOperationalState();
      const rawTechs = Array.isArray(technicianNames) ? technicianNames : currentState.technicianNames;
      const safeTechs = (rawTechs || []).filter((n: string) => !isDummyOrRemovedName(n));

      const newState: OperationalState = {
        operationalDate: operationalDate || currentState.operationalDate,
        shift: shift || currentState.shift,
        technicianNames: safeTechs,
        equipments: Array.isArray(equipments) && equipments.length > 0 ? equipments : currentState.equipments,
        correctiveReports: Array.isArray(correctiveReports) ? correctiveReports : currentState.correctiveReports,
        updatedAt: new Date().toISOString(),
      };
      saveOperationalState(newState);
      return res.json({ success: true, message: "Operational state synced successfully" });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Telegram Bot: Get subscribers (Supervisor only)
  app.get("/api/telegram/subscribers", requireSupervisor, (req, res) => {
    try {
      const subscribers = loadSubscribers();
      return res.json({
        success: true,
        subscribers,
        total: subscribers.length,
        activeCount: subscribers.filter((s) => s.is_active).length,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err.message || "Gagal memuat daftar subscriber",
      });
    }
  });

  // Telegram Bot: Update or add subscriber manually (Supervisor only)
  app.post("/api/telegram/subscribers", requireSupervisor, (req, res) => {
    try {
      const { chat_id, name, type, username, is_active, notes } = req.body;
      if (!chat_id) {
        return res.status(400).json({ success: false, error: "chat_id wajib diisi" });
      }

      const subscribers = loadSubscribers();
      const existingIdx = subscribers.findIndex((s) => s.chat_id === String(chat_id));
      const nowStr = new Date().toISOString();

      if (existingIdx >= 0) {
        if (typeof is_active === "boolean") subscribers[existingIdx].is_active = is_active;
        if (name) subscribers[existingIdx].name = name;
        if (username !== undefined) subscribers[existingIdx].username = username;
        if (notes !== undefined) subscribers[existingIdx].notes = notes;
        subscribers[existingIdx].last_active = nowStr;
      } else {
        subscribers.push({
          chat_id: String(chat_id),
          type: type || "private",
          name: name || `Chat ${chat_id}`,
          username: username || "",
          first_seen: nowStr,
          last_active: nowStr,
          is_active: is_active !== false,
          notes: notes || "",
        });
      }

      saveSubscribers(subscribers);
      return res.json({ success: true, subscribers });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Telegram Bot: Delete subscriber (Supervisor only)
  app.delete("/api/telegram/subscribers/:chatId", requireSupervisor, (req, res) => {
    try {
      const { chatId } = req.params;
      let subscribers = loadSubscribers();
      const initialCount = subscribers.length;
      subscribers = subscribers.filter((s) => s.chat_id !== String(chatId));
      saveSubscribers(subscribers);
      return res.json({
        success: true,
        removed: initialCount !== subscribers.length,
        subscribers,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper to get formatted Jakarta time (WIB, UTC+7)
  function getJakartaTimeString(): string {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  // Helper to categorize equipments
  function getEquipmentCategory(eq: any): 'XRAY' | 'WTMD' | 'HHMD' | 'ETD' {
    if (eq.equipment_type_id === 1) return 'XRAY';
    if (eq.equipment_type_id === 2) return 'WTMD';
    if (eq.equipment_type_id === 3) return 'HHMD';
    if (eq.equipment_type_id === 4) return 'ETD';
    if (eq.type) {
      const t = String(eq.type).toUpperCase();
      if (t.includes('XRAY') || t.includes('X-RAY') || t === 'BAGASI' || t === 'KABIN') return 'XRAY';
      if (t.includes('WTMD')) return 'WTMD';
      if (t.includes('HHMD')) return 'HHMD';
      if (t.includes('ETD')) return 'ETD';
    }
    const nameAndModel = `${eq.name || ''} ${eq.model || ''} ${eq.equipment_code || ''}`.toUpperCase();
    if (nameAndModel.includes('WTMD') || nameAndModel.includes('HIPE')) return 'WTMD';
    if (nameAndModel.includes('HHMD') || nameAndModel.includes('PD140')) return 'HHMD';
    if (nameAndModel.includes('ETD') || nameAndModel.includes('SE311')) return 'ETD';
    return 'XRAY';
  }

  // Live operational data loader prioritizing Supabase as source of truth
  async function getLiveOperationalData(): Promise<{
    operationalDate: string;
    shift: string;
    technicians: string[];
    equipments: OperationalEquipment[];
    correctiveReports: OperationalCorrective[];
  }> {
    const opState = loadOperationalState();
    let equipments: OperationalEquipment[] =
      opState.equipments && opState.equipments.length > 0 ? opState.equipments : DEFAULT_EQUIPMENTS;
    let correctiveReports: OperationalCorrective[] = opState.correctiveReports || [];
    let technicianNames: string[] = (opState.technicianNames || []).filter(
      (n: string) => !isDummyOrRemovedName(n)
    );
    const operationalDate = opState.operationalDate || new Date().toISOString().split("T")[0];
    const shift = opState.shift || "Pagi";

    const supabase = getServerSupabase();
    if (supabase) {
      try {
        // 1. Fetch real technicians from Supabase
        const { data: techRows, error: techErr } = await supabase
          .from("technicians")
          .select("id, name, active");
        if (!techErr && Array.isArray(techRows) && techRows.length > 0) {
          const validSupabaseTechs = techRows
            .filter((t: any) => t.active !== false && !isDummyOrRemovedName(t.name))
            .map((t: any) => t.name.trim());

          if (validSupabaseTechs.length > 0) {
            // Check shift_schedules if available for today & shift
            const { data: schedRows } = await supabase
              .from("shift_schedules")
              .select("technician_id, shift, date")
              .eq("date", operationalDate)
              .eq("shift", shift);

            if (Array.isArray(schedRows) && schedRows.length > 0) {
              const onDutyIds = new Set(schedRows.map((s: any) => Number(s.technician_id)));
              const onDutyTechs = techRows
                .filter((t: any) => onDutyIds.has(Number(t.id)) && !isDummyOrRemovedName(t.name))
                .map((t: any) => t.name.trim());
              if (onDutyTechs.length > 0) {
                technicianNames = onDutyTechs;
              } else {
                technicianNames = validSupabaseTechs;
              }
            } else if (technicianNames.length === 0) {
              technicianNames = validSupabaseTechs;
            } else {
              const filtered = technicianNames.filter((tn) =>
                validSupabaseTechs.some((vst) => vst.toLowerCase() === tn.toLowerCase())
              );
              technicianNames = filtered.length > 0 ? filtered : validSupabaseTechs;
            }
          }
        }

        // 2. Fetch real equipment from Supabase
        const { data: eqRows, error: eqErr } = await supabase
          .from("equipment")
          .select("id, name, model, brand, location_id, equipment_type_id, equipment_code, status, is_active");
        if (!eqErr && Array.isArray(eqRows) && eqRows.length > 0) {
          equipments = eqRows.filter((e: any) => e.is_active !== false);
        }

        // 3. Fetch active/recent corrective records from Supabase
        const { data: crRows, error: crErr } = await supabase
          .from("corrective_records")
          .select("id, equipment_id, problem_description, action_taken, status, result, corrective_date, start_time, end_time, corrective_code, notes")
          .order("id", { ascending: false })
          .limit(20);
        if (!crErr && Array.isArray(crRows) && crRows.length > 0) {
          correctiveReports = crRows.map((r: any) => ({
            id: r.id,
            equipment_id: r.equipment_id,
            problem_description: r.problem_description,
            action_taken: r.action_taken,
            result: r.result || r.status || "Pending",
            corrective_code: r.corrective_code,
            corrective_date: r.corrective_date || operationalDate,
            date: r.corrective_date,
            start_time: r.start_time,
            notes: r.notes,
          }));
        }
      } catch (dbErr) {
        console.warn("[getLiveOperationalData Supabase query exception]:", dbErr);
      }
    }

    return {
      operationalDate,
      shift,
      technicians: technicianNames.filter((n) => !isDummyOrRemovedName(n)),
      equipments,
      correctiveReports,
    };
  }

  // Helper builders for rich messages with interactive inline keyboards
  async function buildAlatPayload() {
    const live = await getLiveOperationalData();
    const equipments = live.equipments && live.equipments.length > 0 ? live.equipments : DEFAULT_EQUIPMENTS;
    const activeCorrectives = (live.correctiveReports || []).filter((c) => c.result !== "Resolved");
    const issueEqIds = new Set(activeCorrectives.map((c) => Number(c.equipment_id)));

    const catMap: Record<'XRAY' | 'WTMD' | 'HHMD' | 'ETD', { normal: number; rusak: number; total: number }> = {
      XRAY: { normal: 0, rusak: 0, total: 0 },
      WTMD: { normal: 0, rusak: 0, total: 0 },
      HHMD: { normal: 0, rusak: 0, total: 0 },
      ETD: { normal: 0, rusak: 0, total: 0 },
    };

    equipments.forEach((eq) => {
      const cat = getEquipmentCategory(eq);
      const isRusak = issueEqIds.has(Number(eq.id));
      catMap[cat].total++;
      if (isRusak) {
        catMap[cat].rusak++;
      } else {
        catMap[cat].normal++;
      }
    });

    const totalCount = equipments.length;
    const totalRusak = catMap.XRAY.rusak + catMap.WTMD.rusak + catMap.HHMD.rusak + catMap.ETD.rusak;
    const totalNormal = totalCount - totalRusak;
    const readinessPercent = totalCount > 0 ? ((totalNormal / totalCount) * 100).toFixed(1) : "100";
    const timeStr = getJakartaTimeString();

    let reply = `🛫 <b>STATUS KESIAPAN ALAT — SEC-OPS</b>\n`;
    reply += `━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `📊 <b>Tingkat Kesiapan:</b> <b>${readinessPercent}%</b> (${totalNormal}/${totalCount} Unit Siap)\n\n`;

    reply += `📋 <b>Rincian Status Per Kategori:</b>\n`;
    reply += `• 🩻 <b>X-Ray:</b> ${catMap.XRAY.rusak} rusak / ${catMap.XRAY.normal} normal\n`;
    reply += `• 🚶‍♂️ <b>WTMD:</b> ${catMap.WTMD.rusak} rusak / ${catMap.WTMD.normal} normal\n`;
    reply += `• 🔍 <b>HHMD:</b> ${catMap.HHMD.rusak} rusak / ${catMap.HHMD.normal} normal\n`;
    reply += `• 🧪 <b>ETD:</b> ${catMap.ETD.rusak} rusak / ${catMap.ETD.normal} normal\n\n`;

    if (totalRusak > 0) {
      reply += `🚨 <b>Unit Terkendala (${totalRusak} Unit):</b>\n`;
      activeCorrectives.forEach((c) => {
        let eqName = c.equipment_name;
        if (!eqName && c.equipment_id) {
          const found = equipments.find((e) => Number(e.id) === Number(c.equipment_id));
          if (found) eqName = `${found.name} (${found.model || ''})`;
        }
        const safeName = escapeTgHtml(eqName || "Unit");
        const safeDesc = escapeTgHtml(c.problem_description || c.fault_description || "Kendala operasional");
        reply += `• 🔴 <b>${safeName}:</b> ${safeDesc}\n`;
      });
    } else {
      reply += `✨ <i>Semua unit X-Ray, WTMD, HHMD & ETD beroperasi normal.</i>\n`;
    }

    reply += `━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `⏱️ <i>Pembaruan: ${escapeTgHtml(timeStr)} WIB</i>`;

    const reply_markup = {
      inline_keyboard: [
        [
          { text: "🔄 Perbarui Status", callback_data: "refresh_alat" },
          { text: "📋 Ringkasan Shift", callback_data: "show_brief" },
        ],
        [
          { text: "📅 Cek Jadwal", callback_data: "show_jadwal" },
          { text: "📜 Riwayat Kerusakan", callback_data: "show_history" },
        ],
        [
          { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
        ],
      ],
    };

    return { text: reply, reply_markup };
  }

  function buildJadwalPayload(interval: string = "all") {
    let reply = `📅 <b>JADWAL PEMELIHARAAN PREVENTIF FASILITAS</b>\n`;
    reply += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (interval === "harian") {
      reply += `⏱️ <b>INTERVAL: HARIAN (DAILY / SETIAP SHIFT)</b>\n\n`;
      reply += `📌 <b>Waktu Pelaksanaan:</b>\n`;
      reply += `• Shift Pagi: Pukul 07:00 - 08:00 WIB\n`;
      reply += `• Shift Siang: Pukul 14:00 - 15:00 WIB\n`;
      reply += `• Shift Malam: Pukul 21:00 - 22:00 WIB\n\n`;
      reply += `🛠️ <b>Cakupan Pemeliharaan:</b>\n`;
      reply += `• 🩻 <b>X-Ray:</b> Uji CTP test piece (penetrasi kawat 30 AWG & resolusi spasial), uji emergency stop, tirai timbal (lead curtain), kebersihan conveyor & roller, lampu indikator radiasi.\n`;
      reply += `• 🚶‍♂️ <b>WTMD:</b> Test piece OTP/STP (deteksi senjata tajam/senpi di zona atas-bawah), fungsi alarm audio-visual, kebersihan body.\n`;
      reply += `• 🔍 <b>HHMD:</b> Uji fungsi deteksi logam uji acuan, kondisi baterai/charger, tombol sensitivitas.\n`;
      reply += `• 🧪 <b>ETD:</b> Daily Trap Verification, kebersihan nozzle sampling, verifikasi gas & consumables.\n`;
    } else if (interval === "mingguan") {
      reply += `🗓️ <b>INTERVAL: MINGGUAN (WEEKLY)</b>\n\n`;
      reply += `📌 <b>Waktu Pelaksanaan:</b> Setiap Hari Senin (Awal Pekan)\n\n`;
      reply += `🛠️ <b>Cakupan Pemeliharaan:</b>\n`;
      reply += `• 🩻 <b>X-Ray:</b> Pembersihan fotosel / light barriers, periksa kabel grounding (PE wiring), uji interlock cover switch, pembersihan filter udara & kipas pendingin power supply.\n`;
      reply += `• 🚶‍♂️ <b>WTMD:</b> Uji interferensi elektromagnetik lingkungan, periksa grounding kabel & kekokohan baut pondasi.\n`;
      reply += `• 🔍 <b>HHMD:</b> Pemeriksaan konektor charging rak, uji kapasitas baterai kontinu.\n`;
      reply += `• 🧪 <b>ETD:</b> Pembersihan desorber unit, pengecekan trap sampling consumables.\n`;
    } else if (interval === "bulanan") {
      reply += `📆 <b>INTERVAL: BULANAN (MONTHLY)</b>\n\n`;
      reply += `📌 <b>Waktu Pelaksanaan:</b> Tanggal 1 - 5 Awal Bulan\n\n`;
      reply += `🛠️ <b>Cakupan Pemeliharaan:</b>\n`;
      reply += `• 🩻 <b>X-Ray:</b> Pengujian Organic & Inorganic stripping, kalibrasi generator X-Ray (tegangan kV & arus tabung mA), uji auto change-over UPS saat pemadaman, backup log harddisk & image archives.\n`;
      reply += `• 🚶‍♂️ <b>WTMD:</b> Uji keseragaman deteksi (uniformity test multi-zone), kalibrasi tingkat sensitivitas regulasi ICAO/Dirjen Hubud.\n`;
      reply += `• 🔍 <b>HHMD:</b> Kalibrasi sensitivitas medan induksi elektromagnetik.\n`;
      reply += `• 🧪 <b>ETD:</b> Penggantian membran filter udara, kalibrasi drift tube ion mobility spectrometry.\n`;
    } else if (interval === "berkala") {
      reply += `📊 <b>INTERVAL: BERKALA (3 BULAN, 6 BULAN & TAHUNAN)</b>\n\n`;
      reply += `📌 <b>1. Triwulan (3 Bulanan):</b>\n`;
      reply += `• Waktu: Maret, Juni, September, Desember\n`;
      reply += `• Uji radiasi bocor (radiation leakage survey meter &lt; 0.1 mR/hr), pembersihan menyeluruh internal mesin, inspeksi visual safety interlock.\n\n`;
      reply += `📌 <b>2. Semesteran (6 Bulanan):</b>\n`;
      reply += `• Waktu: Juni & Desember\n`;
      reply += `• Beam alignment X-ray collimator, kalibrasi sistem deteksi ancaman otomatis (ATD/TIP), pemeliharaan drum motor conveyor.\n\n`;
      reply += `📌 <b>3. Tahunan (Annual):</b>\n`;
      reply += `• Uji Kelaikan Operasi Fasilitas Keamanan Penerbangan (Sertifikasi Dirjen Hubud) & overhaul total generator X-Ray.\n`;
    } else {
      reply += `📋 <b>Ringkasan Siklus Pemeliharaan Fasilitas:</b>\n\n`;
      reply += `⏱️ <b>1. Harian (Setiap Shift):</b>\n`;
      reply += `   • Pagi (07:00), Siang (14:00), Malam (21:00)\n`;
      reply += `   • Uji CTP test, tirai timbal, sensor optik, emergency stop, verifikasi baterai & trap.\n\n`;
      reply += `🗓️ <b>2. Mingguan (Weekly):</b>\n`;
      reply += `   • Setiap Hari Senin\n`;
      reply += `   • Pembersihan fotosel, filter kipas, uji grounding & interlock cover.\n\n`;
      reply += `📆 <b>3. Bulanan (Monthly):</b>\n`;
      reply += `   • Tanggal 1 - 5 Tiap Bulan\n`;
      reply += `   • Kalibrasi material discrimination, arus/tegangan generator kV, uji UPS cut-off.\n\n`;
      reply += `📊 <b>4. Triwulan (3 Bulan):</b> Maret, Juni, Sep, Des (Uji radiasi bocor).\n`;
      reply += `🔍 <b>5. Semesteran (6 Bulan):</b> Juni & Des (Beam alignment & kalibrasi sensor).\n`;
      reply += `🏆 <b>6. Tahunan (1 Tahun):</b> Sertifikasi Dirjen Hubud & Overhaul unit.\n\n`;
      reply += `💡 <i>Pilih tombol di bawah untuk melihat rincian tiap interval:</i>`;
    }

    const reply_markup = {
      inline_keyboard: [
        [
          { text: "⏱️ Harian", callback_data: "jadwal_harian" },
          { text: "🗓️ Mingguan", callback_data: "jadwal_mingguan" },
        ],
        [
          { text: "📆 Bulanan", callback_data: "jadwal_bulanan" },
          { text: "📊 3 Bln / 6 Bln / 1 Thn", callback_data: "jadwal_berkala" },
        ],
        [
          { text: "🔄 Semua Interval", callback_data: "jadwal_all" },
          { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
        ],
      ],
    };

    return { text: reply, reply_markup };
  }

  async function buildHistoryPayload() {
    const live = await getLiveOperationalData();
    const reports = live.correctiveReports || [];
    const equipments = live.equipments && live.equipments.length > 0 ? live.equipments : DEFAULT_EQUIPMENTS;

    let reply = `📜 <b>RIWAYAT KERUSAKAN & PERBAIKAN ALAT</b>\n`;
    reply += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (reports.length === 0) {
      reply += `✨ <i>Belum ada riwayat kerusakan yang tercatat pada sesi ini.</i>\n\n`;
      reply += `Semua peralatan tercatat beroperasi normal dan belum ada tiket kendala yang dilaporkan.\n`;
    } else {
      reply += `Tercatat total <b>${reports.length} laporan riwayat kerusakan</b>:\n\n`;
      const sorted = [...reports].reverse().slice(0, 5);
      sorted.forEach((r: any, idx: number) => {
        let eqName = r.equipment_name;
        if (!eqName && r.equipment_id) {
          const found = equipments.find((e) => Number(e.id) === Number(r.equipment_id));
          if (found) eqName = `${found.name} (${found.model || ''})`;
        }
        const isResolved = r.result === "Resolved";
        const statusIcon = isResolved ? "🟢" : r.result === "In Progress" ? "🟡" : "🔴";
        const statusText = isResolved ? "Selesai (Resolved)" : r.result === "In Progress" ? "Sedang Dikerjakan" : "Menunggu Penanganan";

        let tech = "-";
        if (Array.isArray(r.technicians) && r.technicians.length > 0) {
          const validTechs = r.technicians.filter((t: string) => !isDummyOrRemovedName(t));
          tech = validTechs.length > 0 ? validTechs.join(", ") : "-";
        } else if (r.technician_name && !isDummyOrRemovedName(r.technician_name)) {
          tech = r.technician_name;
        } else if (r.created_by && !isDummyOrRemovedName(r.created_by)) {
          tech = r.created_by;
        }

        const safeEqName = escapeTgHtml(eqName || "Unit Peralatan");
        const safeDesc = escapeTgHtml(r.problem_description || r.fault_description || "Kendala operasional");
        const safeDate = escapeTgHtml(r.corrective_date || r.date || live.operationalDate);
        const safeTime = r.start_time ? ` pk ${escapeTgHtml(r.start_time)}` : "";
        const safeTech = escapeTgHtml(tech);

        reply += `${idx + 1}. ${statusIcon} <b>${safeEqName}</b>\n`;
        reply += `   📅 <b>Waktu:</b> ${safeDate}${safeTime}\n`;
        reply += `   ⚠️ <b>Kendala:</b> ${safeDesc}\n`;
        if (r.action_taken) {
          reply += `   🔧 <b>Tindakan:</b> ${escapeTgHtml(r.action_taken)}\n`;
        }
        reply += `   👷 <b>Teknisi:</b> ${safeTech}\n`;
        reply += `   📊 <b>Status:</b> ${statusText}\n\n`;
      });
    }

    reply += `━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `💡 <i>Ketik /alat untuk cek kesiapan saat ini atau /jadwal untuk agenda pemeliharaan.</i>`;

    const reply_markup = {
      inline_keyboard: [
        [
          { text: "🔄 Perbarui Riwayat", callback_data: "show_history" },
          { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
        ],
        [
          { text: "📅 Cek Jadwal", callback_data: "show_jadwal" },
          { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
        ],
      ],
    };

    return { text: reply, reply_markup };
  }

  async function buildBriefPayload() {
    const live = await getLiveOperationalData();
    const equipments = live.equipments && live.equipments.length > 0 ? live.equipments : DEFAULT_EQUIPMENTS;
    const activeCorrectives = (live.correctiveReports || []).filter((c) => c.result !== "Resolved");
    const issueEqIds = new Set(activeCorrectives.map((c) => Number(c.equipment_id)));

    const totalCount = equipments.length;
    const normalCount = equipments.filter((e) => !issueEqIds.has(Number(e.id))).length;
    const readinessPercent = totalCount > 0 ? ((normalCount / totalCount) * 100).toFixed(1) : "100";

    const safeTechNames = (live.technicians || []).filter((n) => !isDummyOrRemovedName(n));
    const techStr = safeTechNames.length > 0 ? safeTechNames.map(escapeTgHtml).join(", ") : "Tim Teknisi Jaga";
    const timeStr = getJakartaTimeString();

    let reply = `📋 <b>RINGKASAN OPERASIONAL SHIFT — FASKAMPEN</b>\n`;
    reply += `━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `📅 <b>Tanggal:</b> ${escapeTgHtml(live.operationalDate)}\n`;
    reply += `⏰ <b>Shift Kerja:</b> ${escapeTgHtml((live.shift || "Pagi").toUpperCase())}\n`;
    reply += `👷 <b>Personel Jaga:</b> ${techStr}\n`;
    reply += `📊 <b>Kesiapan Fasilitas:</b> <b>${readinessPercent}%</b> (${normalCount}/${totalCount} Unit Siap)\n\n`;

    if (activeCorrectives.length > 0) {
      reply += `🚨 <b>Kendala Aktif (${activeCorrectives.length} Unit):</b>\n`;
      activeCorrectives.forEach((c) => {
        let eqName = c.equipment_name;
        if (!eqName && c.equipment_id) {
          const found = equipments.find((e) => Number(e.id) === Number(c.equipment_id));
          if (found) eqName = `${found.name} (${found.model || ''})`;
        }
        const safeName = escapeTgHtml(eqName || "Unit");
        const safeProb = escapeTgHtml(c.problem_description || c.fault_description || "Kendala");
        reply += `• <b>${safeName}:</b> ${safeProb}\n`;
      });
    } else {
      reply += `✨ <i>Tidak ada kendala aktif saat ini. Fasilitas prima.</i>\n`;
    }
    reply += `\n⏱️ <i>Terakhir diperbarui: ${escapeTgHtml(timeStr)} WIB</i>`;

    const reply_markup = {
      inline_keyboard: [
        [
          { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
          { text: "🔄 Perbarui Ringkasan", callback_data: "refresh_brief" },
        ],
        [
          { text: "📅 Cek Jadwal", callback_data: "show_jadwal" },
          { text: "📜 Riwayat Kerusakan", callback_data: "show_history" },
        ],
        [
          { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
        ],
      ],
    };

    return { text: reply, reply_markup };
  }

  function buildStartPayload(chatTitle: string, chatId: string, isAlreadyActive: boolean) {
    const safeTitle = escapeTgHtml(chatTitle);
    let reply = `🛫 <b>Sistem Pemeliharaan X-Ray & Fasilitas SEC-OPS</b>\n`;
    reply += `━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `Halo <b>${safeTitle}</b>! 👋\n\n`;
    reply += `Selamat datang di bot monitoring fasilitas keamanan penerbangan (FASKAMPEN).\n\n`;

    if (isAlreadyActive) {
      reply += `✅ <b>Status:</b> <i>Terdaftar & Aktif</i>\n\n`;
    } else {
      reply += `📌 <i>Klik tombol <b>📝 Daftarkan ID Saya</b> di bawah agar otomatis menerima siaran briefing & alert kerusakan.</i>\n\n`;
    }

    reply += `🛠️ <b>Menu & Perintah Bot:</b>\n`;
    reply += `• <b>/alat</b> — Cek status kesiapan alat (X-Ray, WTMD, HHMD, ETD)\n`;
    reply += `• <b>/jadwal</b> — Cek jadwal pemeliharaan (Harian, Mingguan, Bulanan, dll)\n`;
    reply += `• <b>/history</b> — Riwayat kerusakan & perbaikan alat\n`;
    reply += `• <b>/brief</b> — Ringkasan shift & personel jaga\n`;
    reply += `• <b>/daftar</b> — Pendaftaran ID otomatis\n`;
    reply += `• <b>/bantuan</b> — Panduan lengkap fitur bot\n\n`;
    reply += `<i>Pusat Pemeliharaan Fasilitas Keamanan Penerbangan</i>`;

    const buttons: any[] = [];
    if (!isAlreadyActive) {
      buttons.push([{ text: "📝 Daftarkan ID Saya", callback_data: "do_daftar" }]);
    }
    buttons.push([
      { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
      { text: "📋 Ringkasan Shift", callback_data: "show_brief" },
    ]);
    buttons.push([
      { text: "📅 Cek Jadwal", callback_data: "show_jadwal" },
      { text: "📜 Riwayat Kerusakan", callback_data: "show_history" },
    ]);

    return { text: reply, reply_markup: { inline_keyboard: buttons } };
  }

  function buildDaftarPayload(chatTitle: string, chatId: string, isAlreadyRegistered: boolean, chatType: string) {
    const safeTitle = escapeTgHtml(chatTitle);
    if (isAlreadyRegistered) {
      const reply =
        `⚠️ <b>Kamu sudah terdaftar!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `• <b>Nama:</b> <b>${safeTitle}</b>\n` +
        `• <b>Tipe:</b> ${chatType === "private" ? "Akun Pribadi" : "Grup Operasional"}\n` +
        `• <b>Status:</b> <i>Aktif Menerima Siaran Laporan</i>\n\n` +
        `ID Anda sudah aktif terdaftar di sistem pemeliharaan FASKAMPEN. Setiap ada Daily Briefing, tiket kerusakan alat (Corrective), dan peringatan teknis akan otomatis dikirimkan ke sini.\n\n` +
        `💡 Klik tombol di bawah atau ketik <b>/alat</b> untuk memeriksa status alat saat ini.`;

      const reply_markup = {
        inline_keyboard: [
          [
            { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
            { text: "📋 Ringkasan Shift", callback_data: "show_brief" },
          ],
          [
            { text: "📅 Cek Jadwal", callback_data: "show_jadwal" },
            { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
          ],
        ],
      };
      return { text: reply, reply_markup };
    }

    const reply =
      `✅ <b>Pendaftaran Berhasil!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• <b>Nama:</b> <b>${safeTitle}</b>\n` +
      `• <b>Tipe:</b> ${chatType === "private" ? "Akun Pribadi" : "Grup Operasional"}\n\n` +
      `Selamat! ID Anda telah berhasil didaftarkan ke sistem pemeliharaan FASKAMPEN SEC-OPS.\n` +
      `Mulai sekarang Anda akan otomatis menerima notifikasi:\n` +
      `• 📋 <b>Supervisor Daily Briefing</b> pergantian shift\n` +
      `• 🚨 <b>Tiket Kerusakan (Corrective)</b> saat dilaporkan\n` +
      `• ⚠️ <b>Peringatan Kerusakan Berulang (Recurring Faults)</b>\n\n` +
      `💡 Klik tombol di bawah untuk langsung memeriksa kondisi alat.`;

    const reply_markup = {
      inline_keyboard: [
        [
          { text: "🛠️ Cek Status Alat Sekarang", callback_data: "refresh_alat" },
          { text: "📅 Cek Jadwal", callback_data: "show_jadwal" },
        ],
        [
          { text: "📜 Riwayat Kerusakan", callback_data: "show_history" },
          { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
        ],
      ],
    };
    return { text: reply, reply_markup };
  }

  // Tracks processed incoming Telegram message IDs and callback queries to prevent duplicate replies
  const processedIncomingMessageKeys = new Set<string>();
  const processedCallbackQueryIds = new Set<string>();

  function isDuplicateIncomingMessage(chatId: string, messageId: number | undefined): boolean {
    if (!messageId) return false;
    const key = `${chatId}:${messageId}`;
    if (processedIncomingMessageKeys.has(key)) {
      return true;
    }
    processedIncomingMessageKeys.add(key);
    if (processedIncomingMessageKeys.size > 500) {
      const oldest = processedIncomingMessageKeys.values().next().value;
      if (oldest) processedIncomingMessageKeys.delete(oldest);
    }
    return false;
  }

  function isDuplicateCallbackQuery(cbId: string | undefined): boolean {
    if (!cbId) return false;
    if (processedCallbackQueryIds.has(cbId)) {
      return true;
    }
    processedCallbackQueryIds.add(cbId);
    if (processedCallbackQueryIds.size > 500) {
      const oldest = processedCallbackQueryIds.values().next().value;
      if (oldest) processedCallbackQueryIds.delete(oldest);
    }
    return false;
  }

  // Helper function to register or update a subscriber and process commands
  async function processIncomingTelegramMessage(msg: any, token: string) {
    if (!msg || !msg.chat) return false;
    const chatId = String(msg.chat.id);
    const userMsgId = msg.message_id;

    // Deduplication check: ignore if the exact message ID was already processed
    if (userMsgId && isDuplicateIncomingMessage(chatId, userMsgId)) {
      return false;
    }

    const chatType = msg.chat.type || "private";
    const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
    const chatTitle = msg.chat.title || senderName || "Pengguna Telegram";
    const username = msg.from?.username || msg.chat.username || "";
    const rawText = (msg.text || "").trim();
    const firstWord = rawText.split(/\s+/)[0] || "";
    const cmd = firstWord.toLowerCase().split("@")[0];
    const nowStr = new Date().toISOString();

    // Record incoming user message ID
    if (userMsgId) {
      recordChatMessage(chatId, userMsgId);
    }

    const subscribers = loadSubscribers();
    const existingIdx = subscribers.findIndex((s) => s.chat_id === chatId);
    const existingSub = existingIdx >= 0 ? subscribers[existingIdx] : null;

    // Helper to send reply without deleting previous chat history (cleanHistory defaults to false)
    const sendReply = async (replyText: string, replyMarkup?: any, cleanHistory: boolean = false) => {
      if (cleanHistory) {
        await cleanChatMessages(chatId, token);
      }

      try {
        let resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: replyText,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
        });
        let resData = (await resp.json()) as any;
        if (!resData?.ok && resData?.description?.includes("can't parse entities")) {
          resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: replyText.replace(/<[^>]*>?/gm, ""),
              disable_web_page_preview: true,
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
          });
          resData = (await resp.json()) as any;
        }

        if (resData?.ok && resData.result?.message_id) {
          recordChatMessage(chatId, resData.result.message_id);
        }
      } catch (err) {
        console.warn("[Telegram Auto-Reply Error]:", err);
      }
    };

    // Command: /bersih, /clear, /hapus (manual cleaning if explicitly triggered)
    if (cmd === "/bersih" || cmd === "/clear" || cmd === "/hapus") {
      await cleanChatMessages(chatId, token);
      const confirmMsg =
        `🧹 <b>Riwayat percakapan telah dibersihkan!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Ketik <b>/alat</b> untuk cek status alat atau <b>/start</b> untuk menu utama.`;

      const markup = {
        inline_keyboard: [
          [
            { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
            { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
          ],
        ],
      };

      await sendReply(confirmMsg, markup, false);
      return false;
    }

    // 1. Command: /start
    if (cmd === "/start") {
      const isAlreadyActive = !!(existingSub && existingSub.is_active);
      const payload = buildStartPayload(chatTitle, chatId, isAlreadyActive);
      await sendReply(payload.text, payload.reply_markup, false);
      return false;
    }

    // 2. Command: /daftar
    if (cmd === "/daftar") {
      if (existingSub && existingSub.is_active) {
        const payload = buildDaftarPayload(chatTitle, chatId, true, chatType);
        await sendReply(payload.text, payload.reply_markup, false);
        return false;
      }

      // Register or reactivate
      if (existingSub) {
        existingSub.is_active = true;
        existingSub.name = chatTitle;
        if (username) existingSub.username = username;
        existingSub.last_active = nowStr;
        existingSub.last_message = rawText;
      } else {
        subscribers.push({
          chat_id: chatId,
          type: chatType,
          name: chatTitle,
          username,
          first_seen: nowStr,
          last_active: nowStr,
          last_message: rawText,
          is_active: true,
        });
      }
      saveSubscribers(subscribers);

      const payload = buildDaftarPayload(chatTitle, chatId, false, chatType);
      await sendReply(payload.text, payload.reply_markup, false);
      return true;
    }

    // 3. Command: /alat, /cek, /status
    if (cmd === "/alat" || cmd === "/cek" || cmd === "/status") {
      const payload = await buildAlatPayload();
      await sendReply(payload.text, payload.reply_markup, false);
      return false;
    }

    // 4. Command: /jadwal, /schedule
    if (cmd === "/jadwal" || cmd === "/schedule") {
      const payload = buildJadwalPayload("all");
      await sendReply(payload.text, payload.reply_markup, false);
      return false;
    }

    // 5. Command: /history, /riwayat, /kerusakan
    if (cmd === "/history" || cmd === "/riwayat" || cmd === "/kerusakan") {
      const payload = await buildHistoryPayload();
      await sendReply(payload.text, payload.reply_markup, false);
      return false;
    }

    // 6. Command: /brief, /shift
    if (cmd === "/brief" || cmd === "/shift") {
      const payload = await buildBriefPayload();
      await sendReply(payload.text, payload.reply_markup, false);
      return false;
    }

    // 7. Command: /id
    if (cmd === "/id") {
      const isRegistered = existingSub && existingSub.is_active;
      const reply =
        `🆔 <b>Informasi Chat Telegram</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `• <b>Chat ID:</b> <code>${chatId}</code>\n` +
        `• <b>Nama:</b> <b>${chatTitle}</b>\n` +
        `• <b>Tipe:</b> ${chatType}\n` +
        `• <b>Status Terdaftar:</b> ${isRegistered ? "✅ Sudah Terdaftar" : "❌ Belum Terdaftar (Ketik /daftar)"}\n\n` +
        `<i>💡 Chat ID aman untuk diketahui dan hanya berfungsi sebagai alamat penerima pesan siaran bot.</i>`;

      const markup = {
        inline_keyboard: [
          [
            { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
            { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
          ],
        ],
      };

      await sendReply(reply, markup, false);
      return false;
    }

    // 8. Command: /bantuan, /help
    if (cmd === "/bantuan" || cmd === "/help") {
      const reply =
        `📖 <b>PANDUAN PERINTAH BOT FASKAMPEN</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Berikut perintah yang dapat Anda gunakan:\n\n` +
        `• <b>/start</b> — Tampilkan sambutan dan menu navigasi bot\n` +
        `• <b>/daftar</b> — Daftarkan ID Anda agar otomatis menerima siaran laporan\n` +
        `• <b>/alat</b> — Cek status kesiapan alat (X-Ray, WTMD, HHMD, ETD)\n` +
        `• <b>/jadwal</b> — Cek jadwal pemeliharaan (Harian, Mingguan, Bulanan, dll)\n` +
        `• <b>/history</b> — Riwayat kerusakan & tiket perbaikan alat\n` +
        `• <b>/brief</b> — Ringkasan shift & kesiapan fasilitas hari ini\n` +
        `• <b>/id</b> — Cek Chat ID Telegram Anda\n` +
        `• <b>/bantuan</b> — Tampilkan panduan ini\n\n` +
        `<i>Gunakan tombol interaktif di bawah pesan untuk beralih menu dengan cepat.</i>`;

      const markup = {
        inline_keyboard: [
          [
            { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
            { text: "📅 Cek Jadwal", callback_data: "show_jadwal" },
          ],
          [
            { text: "📜 Riwayat Kerusakan", callback_data: "show_history" },
            { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
          ],
        ],
      };

      await sendReply(reply, markup, false);
      return false;
    }

    // Fallback for private message if command is not recognized
    if (chatType === "private" && rawText.startsWith("/")) {
      const reply =
        `Perintah tidak dikenali. Ketik <b>/bantuan</b> untuk melihat daftar perintah, atau klik tombol di bawah untuk memeriksa alat.`;
      const markup = {
        inline_keyboard: [
          [
            { text: "🛠️ Cek Status Alat", callback_data: "refresh_alat" },
            { text: "◀️ Kembali ke Menu Utama", callback_data: "show_start" },
          ],
        ],
      };
      await sendReply(reply, markup, false);
    }

    return false;
  }

  // Handle Telegram Inline Button Callbacks (Updates messages in-place with back buttons)
  async function processIncomingTelegramCallback(callbackQuery: any, token: string) {
    if (!callbackQuery) return;
    const cbId = callbackQuery.id;

    if (cbId && isDuplicateCallbackQuery(cbId)) {
      return;
    }

    const data = callbackQuery.data;
    const message = callbackQuery.message;
    if (!message || !message.chat) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: cbId }),
        });
      } catch (_) {}
      return;
    }

    const chatId = String(message.chat.id);
    const msgId = message.message_id;
    const chatType = message.chat.type || "private";
    const senderName = [callbackQuery.from?.first_name, callbackQuery.from?.last_name].filter(Boolean).join(" ");
    const chatTitle = message.chat.title || senderName || "Pengguna Telegram";

    // Helper to notify Telegram client
    const answerCb = async (popupText?: string) => {
      try {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: cbId,
            ...(popupText ? { text: popupText } : {}),
          }),
        });
      } catch (_) {}
    };

    // Helper to edit current message in place
    const editCurrentMessage = async (newText: string, newMarkup?: any) => {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: msgId,
            text: newText,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...(newMarkup ? { reply_markup: newMarkup } : {}),
          }),
        });
        const resData = (await resp.json()) as any;
        if (!resData?.ok && resData?.description?.includes("can't parse entities")) {
          await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: msgId,
              text: newText.replace(/<[^>]*>?/gm, ""),
              disable_web_page_preview: true,
              ...(newMarkup ? { reply_markup: newMarkup } : {}),
            }),
          });
        }
      } catch (e) {
        console.warn("[EditMessage Error]:", e);
      }
    };

    if (data === "clear_chat") {
      await cleanChatMessages(chatId, token);
      try {
        await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: msgId }),
        });
      } catch (_) {}
      await answerCb("🧹 Percakapan telah dibersihkan!");
      return;
    }

    if (data === "refresh_alat") {
      const payload = await buildAlatPayload();
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("🔄 Status alat berhasil diperbarui!");
      return;
    }

    if (data === "show_brief" || data === "refresh_brief") {
      const payload = await buildBriefPayload();
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("📋 Ringkasan shift ditampilkan");
      return;
    }

    if (data === "show_jadwal" || data === "jadwal_all") {
      const payload = buildJadwalPayload("all");
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("📅 Jadwal Pemeliharaan");
      return;
    }

    if (data === "jadwal_harian") {
      const payload = buildJadwalPayload("harian");
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("⏱️ Jadwal Harian");
      return;
    }

    if (data === "jadwal_mingguan") {
      const payload = buildJadwalPayload("mingguan");
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("🗓️ Jadwal Mingguan");
      return;
    }

    if (data === "jadwal_bulanan") {
      const payload = buildJadwalPayload("bulanan");
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("📆 Jadwal Bulanan");
      return;
    }

    if (data === "jadwal_berkala") {
      const payload = buildJadwalPayload("berkala");
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("📊 Jadwal Berkala (3B / 6B / 1T)");
      return;
    }

    if (data === "show_history") {
      const payload = await buildHistoryPayload();
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("📜 Riwayat Kerusakan");
      return;
    }

    if (data === "show_start") {
      const subscribers = loadSubscribers();
      const sub = subscribers.find((s) => s.chat_id === chatId);
      const payload = buildStartPayload(chatTitle, chatId, !!(sub && sub.is_active));
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb("🏠 Menu utama");
      return;
    }

    if (data === "do_daftar") {
      const subscribers = loadSubscribers();
      const existing = subscribers.find((s) => s.chat_id === chatId);
      const nowStr = new Date().toISOString();
      let already = false;

      if (existing && existing.is_active) {
        already = true;
      } else if (existing) {
        existing.is_active = true;
        existing.last_active = nowStr;
        saveSubscribers(subscribers);
      } else {
        subscribers.push({
          chat_id: chatId,
          type: chatType,
          name: chatTitle,
          username: callbackQuery.from?.username || "",
          first_seen: nowStr,
          last_active: nowStr,
          is_active: true,
        });
        saveSubscribers(subscribers);
      }

      const payload = buildDaftarPayload(chatTitle, chatId, already, chatType);
      await editCurrentMessage(payload.text, payload.reply_markup);
      await answerCb(already ? "⚠️ Anda sudah terdaftar sebelumnya" : "✅ Pendaftaran berhasil!");
      return;
    }

    await answerCb();
  }

  function stopTelegramPolling() {
    if (!isPollingActive && !isPollingStarted) return;
    console.log("[Telegram Polling] Menghentikan layanan auto-polling Telegram...");
    isPollingActive = false;
    isPollingStarted = false;
    if (telegramPollingAbortController) {
      try {
        telegramPollingAbortController.abort();
      } catch (_) {}
      telegramPollingAbortController = null;
    }
  }

  // Background Auto-Polling Service
  function triggerTelegramPolling(token: string) {
    if (isPollingStarted) return;
    isPollingStarted = true;
    isPollingActive = true;

    console.log("[Telegram Polling] Memulai layanan auto-polling Telegram...");

    (async () => {
      while (isPollingActive) {
        try {
          const cfg = loadTelegramServerConfig();
          const activeToken = token || cfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;

          if (!activeToken) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          if (!isPollingActive) break;

          telegramPollingAbortController = new AbortController();
          const timeoutSignal = AbortSignal.timeout(30000);
          const pollSignal = (AbortSignal as any).any
            ? (AbortSignal as any).any([telegramPollingAbortController.signal, timeoutSignal])
            : telegramPollingAbortController.signal;

          const offsetParam = lastProcessedUpdateId > 0 ? `&offset=${lastProcessedUpdateId + 1}` : "";
          const tgRes = await fetch(
            `https://api.telegram.org/bot${activeToken}/getUpdates?limit=50&timeout=25${offsetParam}`,
            { signal: pollSignal }
          );

          if (!isPollingActive) break;

          const data = (await tgRes.json()) as any;

          if (!isPollingActive) break;

          if (!data.ok) {
            if (data.error_code === 409) {
              // Clear webhook then resume
              await fetch(`https://api.telegram.org/bot${activeToken}/deleteWebhook`, {
                signal: AbortSignal.timeout(5000),
              }).catch(() => {});
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            await new Promise((r) => setTimeout(r, 6000));
            continue;
          }

          const updates: any[] = data.result || [];
          for (const upd of updates) {
            if (!isPollingActive) break;
            if (upd.update_id > lastProcessedUpdateId) {
              lastProcessedUpdateId = upd.update_id;
            }
            const msg = upd.message || upd.channel_post;
            if (msg) {
              await processIncomingTelegramMessage(msg, activeToken);
            }
            const cb = upd.callback_query;
            if (cb) {
              await processIncomingTelegramCallback(cb, activeToken);
            }
          }

          if (isPollingActive) {
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch (pollErr: any) {
          if (!isPollingActive) {
            // Stopped gracefully during shutdown
            break;
          }

          // Gracefully suppress common transient network hiccups, timeouts, and socket drops
          const errMsg = String(pollErr?.message || pollErr);
          const errCause = String(pollErr?.cause || "");
          const isTransient =
            pollErr?.name === "TimeoutError" ||
            pollErr?.name === "AbortError" ||
            errMsg.includes("timeout") ||
            errMsg.includes("abort") ||
            errMsg.includes("fetch failed") ||
            errCause.includes("HeadersTimeoutError") ||
            errCause.includes("UND_ERR_HEADERS_TIMEOUT");

          if (!isTransient) {
            console.warn("[Telegram Polling]:", errMsg);
          }
          if (isPollingActive) {
            await new Promise((r) => setTimeout(r, 4000));
          }
        } finally {
          telegramPollingAbortController = null;
        }
      }
      console.log("[Telegram Polling] Layanan auto-polling Telegram selesai dihentikan.");
    })();
  }

  // Telegram Bot: Pull updates via getUpdates (Auto-Detect new users / chats)
  app.post("/api/telegram/sync-updates", async (req, res) => {
    try {
      const { token: customToken } = req.body;
      const serverCfg = loadTelegramServerConfig();
      const token = customToken || serverCfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;

      if (!token) {
        return res.status(200).json({
          success: false,
          newDetectedCount: 0,
          totalSubscribers: 0,
          subscribers: [],
          error: "Token Bot Telegram belum diset. Masukkan bot token Anda terlebih dahulu.",
          message: "Token Bot Telegram belum diset.",
        });
      }

      // Query getUpdates
      const offsetParam = lastProcessedUpdateId > 0 ? `&offset=${lastProcessedUpdateId + 1}` : "";
      let tgRes = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0${offsetParam}`,
        { signal: AbortSignal.timeout(8000) }
      );
      let data = (await tgRes.json()) as any;

      // Handle conflict if webhook was active
      if (!data.ok && data.error_code === 409) {
        // Clear webhook first then retry
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
        tgRes = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0${offsetParam}`,
          { signal: AbortSignal.timeout(8000) }
        );
        data = (await tgRes.json()) as any;
      }

      if (!data.ok) {
        return res.status(400).json({
          success: false,
          error: data.description || "Gagal mengambil pembaruan dari Telegram",
        });
      }

      const updates: any[] = data.result || [];
      let newCount = 0;

      for (const upd of updates) {
        if (upd.update_id > lastProcessedUpdateId) {
          lastProcessedUpdateId = upd.update_id;
        }

        const msg = upd.message || upd.channel_post || upd.my_chat_member;
        if (msg && msg.chat && msg.chat.id) {
          const chatId = String(msg.chat.id);
          const chatType = msg.chat.type || "private";
          const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
          const chatTitle = msg.chat.title || senderName || "Pengguna Telegram";
          const username = msg.from?.username || msg.chat.username || "";
          const nowStr = new Date().toISOString();

          const subscribers = loadSubscribers();
          const existingIdx = subscribers.findIndex((s) => s.chat_id === chatId);
          if (existingIdx < 0) {
            subscribers.push({
              chat_id: chatId,
              type: chatType,
              name: chatTitle,
              username,
              first_seen: nowStr,
              last_active: nowStr,
              is_active: true,
            });
            saveSubscribers(subscribers);
            newCount++;
          } else if (!subscribers[existingIdx].is_active) {
            subscribers[existingIdx].is_active = true;
            subscribers[existingIdx].last_active = nowStr;
            saveSubscribers(subscribers);
          }
        }
      }

      const currentSubscribers = loadSubscribers();
      return res.json({
        success: true,
        newDetectedCount: newCount,
        totalSubscribers: currentSubscribers.length,
        subscribers: currentSubscribers,
        message:
          newCount > 0
            ? `Berhasil mendeteksi ${newCount} kontak/grup baru dari Telegram!`
            : `Pemeriksaan selesai. Semua ${currentSubscribers.length} kontak sudah tersinkronisasi.`,
      });
    } catch (err: any) {
      console.error("[Telegram Sync Error]:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Gagal sinkronisasi pembaruan Telegram",
      });
    }
  });

  // Telegram Bot: Webhook Receiver (Real-time update)
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      const token = (req.query.token as string) || process.env.TELEGRAM_BOT_TOKEN;
      const update = req.body;

      if (token && update) {
        const msg = update.message || update.channel_post;
        if (msg) {
          await processIncomingTelegramMessage(msg, token);
        }
        const cb = update.callback_query;
        if (cb) {
          await processIncomingTelegramCallback(cb, token);
        }
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[Telegram Webhook Error]:", err);
      return res.status(200).json({ ok: true });
    }
  });

  // Telegram Bot: Set or Delete Webhook
  app.post("/api/telegram/set-webhook", async (req, res) => {
    try {
      const { webhook_url, token: customToken } = req.body;
      const token = customToken || process.env.TELEGRAM_BOT_TOKEN;

      if (!token) {
        return res.status(400).json({ success: false, error: "Token belum diisi." });
      }

      if (!webhook_url) {
        // Delete webhook
        const tgRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
        const data = (await tgRes.json()) as any;
        return res.json({
          success: data.ok,
          message: data.description || "Webhook berhasil dihapus (beralih ke Polling).",
        });
      }

      const tgRes = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhook_url)}`
      );
      const data = (await tgRes.json()) as any;
      return res.json({
        success: data.ok,
        message: data.description || "Webhook Telegram berhasil dikonfigurasikan.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper to send either a photo with caption or a text message to a specific Telegram chat
  async function sendTelegramItem(params: {
    token: string;
    targetId: string;
    message?: string;
    photo?: string;
    caption?: string;
    parse_mode?: string;
    disable_web_page_preview?: boolean;
  }): Promise<{ ok: boolean; message_id?: number; description?: string }> {
    const { token, targetId, message, photo, caption, parse_mode = "HTML", disable_web_page_preview = true } = params;

    if (photo && typeof photo === "string" && photo.trim()) {
      try {
        const effectiveCaption = (caption || message || "").trim();

        if (photo.startsWith("data:image/")) {
          const mimeMatch = photo.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
          const base64Data = photo.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          const extension = mimeType.includes("png") ? "png" : "jpg";

          const formData = new FormData();
          formData.append("chat_id", targetId);
          if (effectiveCaption) {
            formData.append("caption", effectiveCaption);
            formData.append("parse_mode", parse_mode);
          }
          const blob = new Blob([buffer], { type: mimeType });
          formData.append("photo", blob, `attendance_${Date.now()}.${extension}`);

          let resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: "POST",
            body: formData,
          });
          let d = (await resp.json()) as any;

          if (!d.ok && parse_mode === "HTML" && d.description?.includes("can't parse entities")) {
            // Retry stripping HTML tags from caption
            const retryFormData = new FormData();
            retryFormData.append("chat_id", targetId);
            if (effectiveCaption) {
              retryFormData.append("caption", effectiveCaption.replace(/<[^>]*>?/gm, ""));
            }
            const retryBlob = new Blob([buffer], { type: mimeType });
            retryFormData.append("photo", retryBlob, `attendance_${Date.now()}.${extension}`);
            resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
              method: "POST",
              body: retryFormData,
            });
            d = (await resp.json()) as any;
          }

          if (d.ok) {
            return { ok: true, message_id: d.result?.message_id };
          }

          console.warn(`[Telegram sendPhoto fallback for ${targetId}]:`, d.description);
          // Fallback if photo sending was rejected by Telegram: send text message with caption
          if (effectiveCaption) {
            const textResp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: targetId,
                text: effectiveCaption,
                parse_mode,
              }),
            });
            const textData = (await textResp.json()) as any;
            return {
              ok: textData.ok,
              message_id: textData.result?.message_id,
              description: textData.description || d.description,
            };
          }
          return { ok: false, description: d.description };
        } else {
          // Public image URL
          const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: targetId,
              photo: photo,
              caption: effectiveCaption,
              parse_mode,
            }),
          });
          const d = (await resp.json()) as any;
          return { ok: d.ok, message_id: d.result?.message_id, description: d.description };
        }
      } catch (photoErr: any) {
        console.warn(`[Telegram sendPhoto exception for ${targetId}]:`, photoErr);
        if (caption || message) {
          try {
            const textResp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: targetId,
                text: (caption || message || "").trim(),
                parse_mode,
              }),
            });
            const textData = (await textResp.json()) as any;
            return { ok: textData.ok, message_id: textData.result?.message_id, description: textData.description };
          } catch (e: any) {
            return { ok: false, description: e.message };
          }
        }
        return { ok: false, description: photoErr.message };
      }
    }

    // Standard text message
    let textContent = (message || caption || "").trim();
    if (!textContent) {
      return { ok: false, description: "Pesan teks tidak boleh kosong." };
    }
    if (parse_mode === "HTML" && textContent.includes("**")) {
      textContent = textContent.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
    }

    let resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: targetId,
        text: textContent,
        parse_mode,
        disable_web_page_preview,
      }),
    });
    let d = (await resp.json()) as any;

    if (!d.ok && parse_mode === "HTML" && d.description?.includes("can't parse entities")) {
      resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetId,
          text: textContent.replace(/<[^>]*>?/gm, ""),
          disable_web_page_preview,
        }),
      });
      d = (await resp.json()) as any;
    }

    return { ok: d.ok, message_id: d.result?.message_id, description: d.description };
  }

  // Telegram Bot: Send message or photo (Supports single recipient OR Broadcast to all subscribers)
  app.post("/api/telegram/send", async (req, res) => {
    try {
      const {
        message,
        caption,
        photo,
        chat_id,
        broadcast_all = false,
        token: customToken,
        parse_mode = "HTML",
        disable_web_page_preview = true,
      } = req.body;

      const serverCfg = loadTelegramServerConfig();
      const token = (customToken && customToken.trim()) || serverCfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;
      let defaultChatId = (chat_id && String(chat_id).trim()) || serverCfg.chat_id || process.env.TELEGRAM_CHAT_ID || "-5531204015";

      if (!token) {
        return res.status(400).json({
          success: false,
          error: "TELEGRAM_BOT_TOKEN belum ditentukan. Konfigurasikan token bot terlebih dahulu.",
        });
      }

      if (!photo && (!message || typeof message !== "string" || !message.trim())) {
        return res.status(400).json({
          success: false,
          error: "Pesan teks atau foto tidak boleh kosong.",
        });
      }

      // If Broadcast to all registered active subscribers
      if (broadcast_all) {
        const subscribers = loadSubscribers().filter((s) => s.is_active);
        const targetIds = new Set<string>();

        if (defaultChatId) {
          targetIds.add(String(defaultChatId));
        }
        subscribers.forEach((s) => targetIds.add(String(s.chat_id)));

        if (targetIds.size === 0) {
          return res.status(400).json({
            success: false,
            error:
              "Belum ada Chat ID tujuan maupun subscriber terdaftar. Tambahkan Chat ID atau minta pengguna chat /start ke bot.",
          });
        }

        const sendPromises = Array.from(targetIds).map(async (targetId) => {
          const itemRes = await sendTelegramItem({
            token,
            targetId,
            message,
            photo,
            caption,
            parse_mode,
            disable_web_page_preview,
          });
          if (itemRes.ok && itemRes.message_id) {
            recordChatMessage(targetId, itemRes.message_id);
          }
          return { chat_id: targetId, ok: itemRes.ok, description: itemRes.description };
        });

        const results = await Promise.all(sendPromises);
        const successCount = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok);

        return res.json({
          success: successCount > 0,
          broadcast: true,
          totalTargets: targetIds.size,
          sentCount: successCount,
          failedCount: failed.length,
          failedDetails: failed,
          message: `Berhasil disiarkan ke ${successCount} dari ${targetIds.size} penerima Telegram.`,
        });
      }

      // Single target delivery
      if (!defaultChatId) {
        return res.status(400).json({
          success: false,
          error: "Chat ID tujuan belum ditentukan. Masukkan Chat ID atau aktifkan mode broadcast.",
        });
      }

      const singleRes = await sendTelegramItem({
        token,
        targetId: defaultChatId,
        message,
        photo,
        caption,
        parse_mode,
        disable_web_page_preview,
      });

      if (!singleRes.ok) {
        return res.status(400).json({
          success: false,
          error: singleRes.description || "Gagal mengirim pesan / foto ke Telegram",
        });
      }

      if (singleRes.message_id) {
        recordChatMessage(defaultChatId, singleRes.message_id);
      }

      return res.json({
        success: true,
        messageId: singleRes.message_id,
      });
    } catch (err: any) {
      console.error("[Telegram Send Error]:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Kesalahan internal saat mengirim pesan Telegram",
      });
    }
  });

  // Telegram Bot: Test connection and send ping message
  app.post("/api/telegram/test", async (req, res) => {
    try {
      const { token: customToken, chat_id: customChatId } = req.body;
      const serverCfg = loadTelegramServerConfig();
      const token = (customToken && customToken.trim()) || serverCfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;
      let targetChatId = (customChatId && String(customChatId).trim()) || serverCfg.chat_id || process.env.TELEGRAM_CHAT_ID || "-5531204015";

      if (!token) {
        return res.status(400).json({
          success: false,
          error: "Token Bot Telegram belum diisi. Buat bot via @BotFather di Telegram lalu masukkan HTTP API Token di form ini.",
        });
      }

      // Step 1: Validate getMe
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const meData = (await meRes.json()) as any;
      if (!meData.ok) {
        const desc = meData.description || "";
        let friendlyError = `Token tidak valid: ${desc}`;
        if (desc.includes("Unauthorized")) {
          friendlyError = "Token Bot tidak valid (Unauthorized). Pastikan Anda menyalin HTTP API Token lengkap dari @BotFather.";
        }
        return res.status(400).json({
          success: false,
          error: friendlyError,
        });
      }

      // If no chatId is provided, try picking from active subscribers
      if (!targetChatId) {
        const activeSubscribers = loadSubscribers().filter((s) => s.is_active);
        if (activeSubscribers.length > 0) {
          targetChatId = activeSubscribers[activeSubscribers.length - 1].chat_id;
        }
      }

      // If chatId is provided (or resolved from subscribers), attempt sending test message
      if (targetChatId) {
        const testText = `🤖 <b>FASKAMPEN X-Ray Maintenance Bot</b>\n\n` +
          `✅ <b>Koneksi Berhasil Terhubung!</b>\n` +
          `• <b>Bot:</b> @${meData.result.username} (${meData.result.first_name})\n` +
          `• <b>Target Chat ID:</b> <code>${targetChatId}</code>\n` +
          `• <b>Waktu Tes:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
          `<i>Sistem siap menyiarkan Daily Briefing Supervisor, Notifikasi Tiket Kerusakan (Corrective), dan Peringatan Recurring Faults secara real-time.</i>`;

        const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: testText,
            parse_mode: "HTML",
          }),
        });

        const sendData = (await sendRes.json()) as any;
        if (!sendData.ok) {
          const desc = sendData.description || "";
          let errorDetail = `Bot valid (@${meData.result.username}), namun gagal mengirim pesan ke Chat ID ${targetChatId}: ${desc}.`;
          if (desc.includes("bot can't initiate conversation") || desc.includes("Forbidden")) {
            errorDetail = `Telegram memblokir pesan karena pengguna belum pernah memulai chat dengan bot. Buka Telegram, cari @${meData.result.username}, lalu tekan 'START' atau kirim /start terlebih dahulu!`;
          } else if (desc.includes("chat not found")) {
            errorDetail = `Chat ID ${targetChatId} tidak ditemukan. Pastikan sudah menekan /start pada bot @${meData.result.username} (untuk chat pribadi) atau bot sudah di-invite ke grup Anda.`;
          }
          return res.status(400).json({
            success: false,
            bot: meData.result,
            error: errorDetail,
          });
        }

        return res.json({
          success: true,
          bot: meData.result,
          sent: true,
          message: `Berhasil terhubung ke @${meData.result.username} dan pesan tes berhasil dikirim ke chat ${targetChatId}!`,
        });
      }

      return res.status(400).json({
        success: false,
        bot: meData.result,
        sent: false,
        error: `Bot terhubung (@${meData.result.username}), namun Chat ID tujuan masih kosong. Silakan isi Chat ID tujuan Anda (cek via @userinfobot) atau buka bot @${meData.result.username} di Telegram lalu ketik /start agar terdeteksi otomatis.`,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err.message || "Gagal melakukan tes bot Telegram",
      });
    }
  });

  // ==============================================================================
  // AUTOMATED MIDNIGHT BACKUP SYSTEM & GOOGLE DRIVE BACKUP SNAPSHOTS
  // ==============================================================================
  const BACKUP_DIR = path.join(process.cwd(), "backups");
  const GDRIVE_CONFIG_FILE = path.join(process.cwd(), "data", "gdrive_config.json");

  // Helper to load and save Google Drive configuration persistently
  function loadGDriveConfig(): { token?: string; email?: string; gas_url?: string } {
    try {
      if (fs.existsSync(GDRIVE_CONFIG_FILE)) {
        const raw = fs.readFileSync(GDRIVE_CONFIG_FILE, "utf-8");
        return JSON.parse(raw);
      }
    } catch (_) {}
    return {};
  }

  function saveGDriveConfig(cfg: { token?: string; email?: string; gas_url?: string }) {
    try {
      const dataDir = path.dirname(GDRIVE_CONFIG_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const existing = loadGDriveConfig();
      const updated = { ...existing, ...cfg };
      fs.writeFileSync(GDRIVE_CONFIG_FILE, JSON.stringify(updated, null, 2), "utf-8");
    } catch (err) {
      console.warn("[Backup System] Failed to save GDrive config:", err);
    }
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    } catch (e) {
      console.warn("[Backup Init Warning]: Could not create backups directory", e);
    }
  }

  // Active Google Drive OAuth token or Google Apps Script Web App URL for server-side backup uploads
  const savedGDriveCfg = loadGDriveConfig();
  let activeGDriveToken = savedGDriveCfg.token || "";
  let activeGDriveEmail = savedGDriveCfg.email || "";
  let activeGasUrl = savedGDriveCfg.gas_url || process.env.GDRIVE_GAS_URL || "";

  async function getS3ObjectBuffer(s3: S3Client, bucket: string, key: string): Promise<Buffer | null> {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) return null;
      if (typeof (res.Body as any).transformToByteArray === "function") {
        const arr = await (res.Body as any).transformToByteArray();
        return Buffer.from(arr);
      }
      const chunks: any[] = [];
      for await (const chunk of res.Body as any) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      console.warn(`[Backup System] S3 download skipped for key ${key}:`, err);
      return null;
    }
  }

  async function performFullSystemBackup(
    type: 'auto_midnight' | 'manual' = 'manual',
    triggeredBy?: string
  ) {
    const jktIso = getJakartaISOString();
    const dateStr = jktIso.split("T")[0]; // YYYY-MM-DD
    const timeFormatted = jktIso.split("T")[1].slice(0, 8).replace(/:/g, ""); // HHMMSS
    const filename = `backup_${type}_${dateStr}_${timeFormatted}.json`;
    const filePath = path.join(BACKUP_DIR, filename);

    console.log(`[Backup System] Starting ${type} full system backup (${filename})...`);

    const sb = getServerSupabase();
    let techniciansData: any[] = [];
    let equipmentData: any[] = [];
    let attendanceData: any[] = [];
    let preventiveData: any[] = [];
    let correctiveData: any[] = [];
    let scheduleData: any[] = [];
    let avsecData: any[] = [];
    let auditData: any[] = [];

    if (sb) {
      try {
        const [techs, eq, att, prev, corr, sched, avsec, audit] = await Promise.all([
          Promise.resolve(sb.from("technicians").select("id, code, name, email, role, active, created_at, updated_at")).catch(() => ({ data: [] })),
          Promise.resolve(sb.from("equipment").select("*")).catch(() => ({ data: [] })),
          Promise.resolve(sb.from("attendance_records").select("*")).catch(() => ({ data: [] })),
          Promise.resolve(sb.from("preventive_records").select("*")).catch(() => ({ data: [] })),
          Promise.resolve(sb.from("corrective_records").select("*")).catch(() => ({ data: [] })),
          Promise.resolve(sb.from("shift_schedules").select("*")).catch(() => ({ data: [] })),
          Promise.resolve(sb.from("avsec_qr_error_reports").select("*")).catch(() => ({ data: [] })),
          Promise.resolve(sb.from("audit_logs").select("*")).catch(() => ({ data: [] })),
        ]);
        techniciansData = (techs as any).data || [];
        equipmentData = (eq as any).data || [];
        attendanceData = (att as any).data || [];
        preventiveData = (prev as any).data || [];
        correctiveData = (corr as any).data || [];
        scheduleData = (sched as any).data || [];
        avsecData = (avsec as any).data || [];
        auditData = (audit as any).data || [];
      } catch (e) {
        console.warn("[Backup System] Exception fetching Supabase tables:", e);
      }
    }

    // Retrieve storage manifest metadata from IDCloudHost S3 Storage (keys & sizes only, zero binary bloat)
    let storageManifest: any[] = [];
    try {
      const cfg = loadStorageConfig();
      if (cfg && cfg.secretAccessKey && cfg.bucketName) {
        const s3 = getS3Client(cfg);
        const listCmd = new ListObjectsV2Command({
          Bucket: cfg.bucketName,
          MaxKeys: 1000,
        });
        const s3Res = await s3.send(listCmd);
        if (s3Res.Contents) {
          storageManifest = s3Res.Contents.map((obj) => ({
            key: obj.Key,
            size: obj.Size,
            last_modified: obj.LastModified,
          }));
        }
      }
    } catch (s3Err) {
      console.warn("[Backup System] S3 manifest fetching warning:", s3Err);
    }

    const payload = {
      version: "2.0.0",
      app_id: "nti_faskampen_xray",
      backup_type: type,
      triggered_by: triggeredBy || (type === 'auto_midnight' ? 'Schedule Otomatis Midnight (00:00 WIB)' : 'Manual User'),
      created_at: jktIso,
      date: dateStr,
      time: timeFormatted,
      summary: {
        technicians_count: techniciansData.length,
        equipment_count: equipmentData.length,
        attendance_count: attendanceData.length,
        preventive_count: preventiveData.length,
        corrective_count: correctiveData.length,
        schedules_count: scheduleData.length,
        avsec_reports_count: avsecData.length,
        audit_logs_count: auditData.length,
        storage_objects_count: storageManifest.length,
      },
      data: {
        technicians: techniciansData,
        equipment: equipmentData,
        attendance: attendanceData,
        preventive: preventiveData,
        corrective: correctiveData,
        schedules: scheduleData,
        avsec_reports: avsecData,
        audit_logs: auditData,
      },
      storage_manifest: storageManifest,
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    fs.writeFileSync(filePath, jsonStr, "utf-8");

    // Upload backup to Google Drive if GAS Web App or active OAuth token is registered
    let gdriveUploaded = false;
    let gdriveFileId = "";
    const gdriveTargetEmail = activeGDriveEmail || "luthfiandammm@gmail.com";

    // 1. Try Google Apps Script (GAS) Web App upload first if configured
    if (activeGasUrl && activeGasUrl.startsWith("https://script.google.com/")) {
      try {
        const gasRes = await fetch(activeGasUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            filename,
            content: jsonStr,
            folderName: "FASKAMPEN_XRAY_BACKUP",
          }),
        });
        const gasData = (await gasRes.json().catch(() => ({}))) as any;
        if (gasData.status === "success" || gasData.fileId || gasRes.ok) {
          gdriveUploaded = true;
          gdriveFileId = gasData.fileId || "GAS_OK";
          console.log(`[Backup System] Uploaded backup copy to Google Drive via GAS (${gdriveTargetEmail}): ${gdriveFileId}`);
        }
      } catch (gasErr) {
        console.warn("[Backup System] GAS Google Drive upload error:", gasErr);
      }
    } else if (activeGDriveToken) {
      // 2. Try Google OAuth REST API upload
      try {
        let folderId = "";
        const searchRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            "name = 'FASKAMPEN_XRAY_BACKUP' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
          )}`,
          { headers: { Authorization: `Bearer ${activeGDriveToken}` } }
        );
        if (searchRes.ok) {
          const sData = await searchRes.json();
          if (sData.files && sData.files.length > 0) folderId = sData.files[0].id;
        }
        if (!folderId) {
          const createFolderRes = await fetch("https://www.googleapis.com/drive/v3/files", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${activeGDriveToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: "FASKAMPEN_XRAY_BACKUP",
              mimeType: "application/vnd.google-apps.folder",
            }),
          });
          if (createFolderRes.ok) {
            const fData = await createFolderRes.json();
            folderId = fData.id;
          }
        }

        const metadata = {
          name: filename,
          mimeType: "application/json",
          parents: folderId ? [folderId] : [],
        };
        const boundary = "-------faskampen_gdrive_boundary";
        const multipartBody =
          `\r\n--${boundary}\r\n` +
          "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
          JSON.stringify(metadata) +
          `\r\n--${boundary}\r\n` +
          "Content-Type: application/json\r\n\r\n" +
          jsonStr +
          `\r\n--${boundary}--`;

        const uploadRes = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${activeGDriveToken}`,
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
          }
        );

        if (uploadRes.ok) {
          const uData = await uploadRes.json();
          gdriveUploaded = true;
          gdriveFileId = uData.id;
          console.log(`[Backup System] Uploaded backup copy to Google Drive (${activeGDriveEmail}): ${gdriveFileId}`);
        }
      } catch (gErr) {
        console.warn("[Backup System] Google Drive upload error:", gErr);
      }
    }

    // Broadcast full backup results report to Telegram
    try {
      const tgCfg = loadTelegramServerConfig();
      const activeToken = tgCfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;
      let targetChatId = tgCfg.chat_id || process.env.TELEGRAM_CHAT_ID || "-5531204015";

      if (activeToken && targetChatId) {
        const readableTime = `${timeFormatted.slice(0, 2)}:${timeFormatted.slice(2, 4)}:${timeFormatted.slice(4, 6)}`;
        const hasGdrive = activeGasUrl || activeGDriveToken;
        const tgText =
          `💾 <b>LAPORAN BACKUP SISTEM FASKAMPEN X-RAY</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 <b>Waktu:</b> ${dateStr} ${readableTime} WIB\n` +
          `⚙️ <b>Tipe:</b> ${type === 'auto_midnight' ? 'Backup Otomatis Midnight (00:00 WIB)' : 'Backup Manual'}\n` +
          `👤 <b>Pemicu:</b> ${escapeTgHtml(payload.triggered_by)}\n` +
          `📦 <b>File Backup:</b> <code>${filename}</code>\n` +
          `📊 <b>Ukuran:</b> ${(jsonStr.length / 1024).toFixed(1)} KB\n\n` +
          `📈 <b>RINGKASAN DATA DATABASE:</b>\n` +
          `• Data Teknisi: <b>${payload.summary.technicians_count}</b>\n` +
          `• Peralatan X-Ray: <b>${payload.summary.equipment_count}</b>\n` +
          `• Record Presensi: <b>${payload.summary.attendance_count}</b>\n` +
          `• Laporan Preventif: <b>${payload.summary.preventive_count}</b>\n` +
          `• Tiket Corrective: <b>${payload.summary.corrective_count}</b>\n` +
          `• Jadwal Shift: <b>${payload.summary.schedules_count}</b>\n` +
          `• Laporan AVSEC QR: <b>${payload.summary.avsec_reports_count}</b>\n` +
          `• Log Keamanan: <b>${payload.summary.audit_logs_count}</b>\n` +
          `• Manifest Storage: <b>${payload.summary.storage_objects_count} objects</b>\n\n` +
          `☁️ <b>STATUS PENYIMPANAN BACKUP:</b>\n` +
          `✅ Server Local Disk: <code>/backups/${filename}</code>\n` +
          `${hasGdrive ? (gdriveUploaded ? '✅' : '⚠️') + ` Google Drive (${gdriveTargetEmail}): <code>FASKAMPEN_XRAY_BACKUP/${filename}</code>\n` : '⚠️ Google Drive: Belum terhubung (Gunakan menu Backup untuk hubungkan GAS/OAuth)\n'}` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>Sistem Monitoring & Pemeliharaan Peralatan Bandara Halim</i>`;

        fetch(`https://api.telegram.org/bot${activeToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: tgText,
            parse_mode: "HTML",
          }),
        }).catch((err) => console.warn("[Backup Telegram Broadcast Error]:", err));
      }
    } catch (tgErr) {
      console.warn("[Backup Telegram Exception]:", tgErr);
    }

    console.log(`[Backup System] Full system backup completed: ${filename} (${(jsonStr.length / 1024).toFixed(1)} KB)`);

    return {
      filename,
      filePath,
      sizeBytes: jsonStr.length,
      createdAt: jktIso,
      summary: payload.summary,
    };
  }

  // Midnight Auto Backup Scheduler (Runs exclusively at 00:05 WIB)
  let lastBackupDateCheck = "";
  function checkAndRunMidnightBackup() {
    try {
      const jktIso = getJakartaISOString();
      const dateStr = jktIso.split("T")[0]; // YYYY-MM-DD
      const timePart = jktIso.split("T")[1]; // HH:MM:SS
      const hour = parseInt(timePart.slice(0, 2), 10);
      const minute = parseInt(timePart.slice(3, 5), 10);

      // Trigger at 00:05 WIB window (00:05 - 00:10 WIB) once per date
      if (hour === 0 && minute >= 5 && minute <= 10) {
        if (lastBackupDateCheck !== dateStr) {
          lastBackupDateCheck = dateStr;
          performFullSystemBackup('auto_midnight', 'Sistem Scheduler Otomatis 00:05 WIB (Google Drive & S3)').catch(e => {
            console.error('[Backup Scheduler Error]:', e);
          });
        }
      }
    } catch (e) {
      console.warn('[Backup Scheduler Check Exception]:', e);
    }
  }

  // Check midnight backup status every 60 seconds
  setInterval(checkAndRunMidnightBackup, 60000);

  async function normalizeExistingCorrectiveRecordsInDatabase() {
    try {
      const supabase = getServerSupabase();
      if (!supabase) return;

      const { data: rows, error } = await supabase
        .from("corrective_records")
        .select("*");

      if (error || !Array.isArray(rows) || rows.length === 0) return;

      let updatedCount = 0;
      for (const row of rows) {
        const rawDate = row.operational_date || row.corrective_date;
        const startTime = row.start_time || row.time_start || "00:00";
        if (!rawDate) continue;

        const hh = parseInt((startTime.replace('.', ':').split(':')[0] || '0'), 10);
        const shiftCode = String(row.shift || '').toUpperCase();
        const isNightShift = shiftCode === 'M' || shiftCode === 'MALAM' || hh < 7;

        if (isNightShift && hh < 7) {
          const curDateObj = new Date(`${rawDate}T12:00:00+07:00`);
          if (!isNaN(curDateObj.getTime())) {
            let createdDatePart = rawDate;
            if (row.created_at && row.created_at.includes('T')) {
              createdDatePart = row.created_at.split('T')[0];
            } else if (row.created_at && row.created_at.includes(' ')) {
              createdDatePart = row.created_at.split(' ')[0];
            }

            if (rawDate === createdDatePart) {
              const prevDateObj = new Date(curDateObj.getTime() - 86400000);
              const targetOpDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(prevDateObj);

              if (targetOpDate !== rawDate) {
                let updatedFolderPath = row.folder_path;
                if (updatedFolderPath && typeof updatedFolderPath === 'string') {
                  const [cYear, cMonth, cDay] = rawDate.split('-');
                  const [pYear, pMonth, pDay] = targetOpDate.split('-');
                  updatedFolderPath = updatedFolderPath.replace(`/${cDay} `, `/${pDay} `);
                }

                await supabase
                  .from("corrective_records")
                  .update({
                    operational_date: targetOpDate,
                    corrective_date: targetOpDate,
                    shift: 'M',
                    ...(updatedFolderPath ? { folder_path: updatedFolderPath } : {}),
                  })
                  .eq("id", row.id);

                updatedCount++;
                console.log(`[Shift Auto-Normalize] Corrective #${row.corrective_code || row.id} (${startTime}) normalized: ${rawDate} -> ${targetOpDate}`);
              }
            }
          }
        }
      }

      if (updatedCount > 0) {
        console.log(`[Shift Auto-Normalize] Successfully auto-corrected ${updatedCount} existing corrective records in database.`);
      }
    } catch (e) {
      console.warn("[Shift Auto-Normalize Exception]:", e);
    }
  }

  // Run normalization on startup
  setTimeout(() => {
    normalizeExistingCorrectiveRecordsInDatabase().catch(console.warn);
  }, 3000);

  let isShiftAutoExportRunning = false;

  async function performShiftPdfAutoExport(targetOpDate: string, targetShift: "Pagi" | "Malam") {
    if (isShiftAutoExportRunning) {
      console.log(`[Auto-Export PDF] Export sedang berjalan, menolak eksekusi ganda untuk ${targetOpDate} Shift ${targetShift}.`);
      return { success: false, message: "Proses Auto-Export sedang berjalan di server. Mohon tunggu sejenak." };
    }

    isShiftAutoExportRunning = true;
    try {
      const supabase = getServerSupabase();
      if (!supabase) {
        console.warn("[Auto-Export PDF] Supabase database tidak tersedia.");
        return { success: false, error: "Database tidak tersedia" };
      }

      // Auto-normalize any existing night shift records in database first
      await normalizeExistingCorrectiveRecordsInDatabase();

      const cfg = loadStorageConfig();
      const s3Configured = cfg && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName;

      // Helper for shift matching
      const isShiftMatch = (s: any, target: "Pagi" | "Malam") => {
        if (!s) return false;
        const norm = String(s).trim().toUpperCase();
        if (target === "Malam") {
          return norm === "M" || norm.includes("MALAM") || norm === "NIGHT" || norm === "SHIFT 2";
        } else {
          return norm === "PS" || norm === "P" || norm.includes("PAGI") || norm === "MORNING" || norm === "SHIFT 1" || norm === "SIANG";
        }
      };

      // 1. Fetch preventive entries for targetOpDate & targetShift
      let prevList: any[] = [];
      try {
        const { data: allPrev, error: prevErr } = await supabase
          .from("preventive_records")
          .select("*");

        if (prevErr) {
          console.warn("[Auto-Export PDF] Query preventive_records error:", prevErr.message);
        } else if (Array.isArray(allPrev)) {
          prevList = allPrev.filter((r: any) => {
            const opDate =
              r.operational_date ||
              (r.submitted_at ? r.submitted_at.split("T")[0] : "") ||
              (r.period_key && r.period_key.length === 10 ? r.period_key : "");
            return opDate === targetOpDate && isShiftMatch(r.shift, targetShift);
          });
        }
      } catch (pErr) {
        console.warn("[Auto-Export PDF] Preventive fetch exception:", pErr);
      }

      // 2. Fetch corrective records
      let corrList: any[] = [];
      try {
        const { data: allCorr, error: corrErr } = await supabase
          .from("corrective_records")
          .select("*");

        if (corrErr) {
          console.warn("[Auto-Export PDF] Query corrective_records error:", corrErr.message);
        } else if (Array.isArray(allCorr)) {
          corrList = allCorr.filter((r: any) => {
            const opDate =
              r.operational_date ||
              r.corrective_date ||
              (r.created_at ? r.created_at.split("T")[0] : "");
            return opDate === targetOpDate && isShiftMatch(r.shift, targetShift);
          });
        }
      } catch (cErr) {
        console.warn("[Auto-Export PDF] Corrective fetch exception:", cErr);
      }

      console.log(`[Auto-Export PDF] Data ditemukan untuk ${targetOpDate} Shift ${targetShift}: ${prevList.length} checklist preventif, ${corrList.length} tiket corrective.`);

      if (prevList.length === 0 && corrList.length === 0) {
        console.log(`[Auto-Export PDF] Nihil data inspeksi untuk ${targetOpDate} Shift ${targetShift}. Melewati auto-export.`);
        return { success: false, message: "Nihil data inspeksi pada shift tersebut" };
      }

      // 3. Fetch equipment, types & technicians (exclude revoked password column)
      const { data: eqRows } = await supabase.from("equipment").select("*");
      const { data: eqTypeRows } = await supabase.from("equipment_types").select("*");
      const { data: techRows } = await supabase.from("technicians").select("id, code, name, email, role, active");

      const equipments = Array.isArray(eqRows) ? eqRows : DEFAULT_EQUIPMENTS;
      const eqTypes = Array.isArray(eqTypeRows) ? eqTypeRows : [];
      const allTechs = Array.isArray(techRows) ? techRows : [];

      // Resolve technician names for this shift
      const techNamesSet = new Set<string>();
      prevList.forEach((p: any) => {
        if (Array.isArray(p.submitted_by_technician_ids)) {
          p.submitted_by_technician_ids.forEach((tid: number) => {
            const found = allTechs.find((t: any) => Number(t.id) === Number(tid));
            if (found && found.name) techNamesSet.add(found.name);
          });
        }
        if (p.technician_name) techNamesSet.add(p.technician_name);
      });
      corrList.forEach((c: any) => {
        if (c.technician_name) techNamesSet.add(c.technician_name);
      });

      // Also check shift_schedules
      const { data: schedRows } = await supabase
        .from("shift_schedules")
        .select("technician_id, shift, date")
        .eq("date", targetOpDate)
        .eq("shift", targetShift);
      if (Array.isArray(schedRows)) {
        schedRows.forEach((s: any) => {
          const found = allTechs.find((t: any) => Number(t.id) === Number(s.technician_id));
          if (found && found.name) techNamesSet.add(found.name);
        });
      }

      const safeTechNames = Array.from(techNamesSet).filter((n) => !isDummyOrRemovedName(n));
      const finalTechNames = safeTechNames.length > 0 ? safeTechNames : ["Tim Teknisi Jaga"];

      // 4. Construct StructuredReportData
      const shiftCode = targetShift === "Malam" ? "M" : "PS";

      const enrichedCorrList = corrList.map((c: any) => {
        const eqId = Number(c.equipment_id);
        const eq =
          equipments.find((e: any) => Number(e.id) === eqId) ||
          DEFAULT_EQUIPMENTS.find((e) => Number(e.id) === eqId);

        let typeId = eq ? Number(eq.equipment_type_id) : 1;
        const typeObj =
          eqTypes.find((t: any) => Number(t.id) === typeId) ||
          DEFAULT_EQUIPMENT_TYPES.find((t) => t.id === typeId) ||
          DEFAULT_EQUIPMENT_TYPES[0];

        const rawEqName =
          c.equipment_name ||
          eq?.name ||
          eq?.equipment_name ||
          eq?.location_name ||
          `Unit #${c.equipment_id || ''}`;

        return {
          ...c,
          equipment_name: rawEqName,
          type_code: c.type_code || typeObj?.code || "EQUIPMENT",
          type_name: c.type_name || typeObj?.name || "Equipment",
          location_name: c.location_name || (eq?.location_id ? `Lokasi ${eq.location_id}` : ""),
        };
      });

      const structuredData: any = {
        operational_date: targetOpDate,
        display_date: targetOpDate,
        shift: targetShift,
        start_time: targetShift === "Malam" ? "19:00" : "07:00",
        end_time: targetShift === "Malam" ? "07:00" : "19:00",
        technicians: finalTechNames,
        lines_by_type: [],
        entries_by_type: [],
        corrective_entries: enrichedCorrList,
      };

      const typeGroupsMap = new Map<number, any>();
      prevList.forEach((entry: any) => {
        const eqId = Number(entry.equipment_id);
        const eq =
          equipments.find((e: any) => Number(e.id) === eqId) ||
          DEFAULT_EQUIPMENTS.find((e) => Number(e.id) === eqId);

        let typeId = eq ? Number(eq.equipment_type_id) : 1;
        if (!typeId || isNaN(typeId)) {
          if (entry.equipment_type && typeof entry.equipment_type === "string") {
            const etUpper = entry.equipment_type.toUpperCase();
            if (etUpper.includes("WTMD")) typeId = 2;
            else if (etUpper.includes("HHMD")) typeId = 3;
            else if (etUpper.includes("ETD")) typeId = 4;
            else typeId = 1;
          } else {
            typeId = 1;
          }
        }

        const typeObj =
          eqTypes.find((t: any) => Number(t.id) === typeId) ||
          DEFAULT_EQUIPMENT_TYPES.find((t) => t.id === typeId) ||
          DEFAULT_EQUIPMENT_TYPES[0];

        if (!typeGroupsMap.has(typeId)) {
          typeGroupsMap.set(typeId, {
            type_id: typeId,
            type_name: typeObj.name,
            type_code: typeObj.code,
            priority: (typeObj as any).priority || typeId,
            entries: [],
          });
        }

        const rawEqName =
          eq?.name ||
          eq?.equipment_name ||
          eq?.location_name ||
          entry.equipment_name ||
          entry.equipment_code ||
          `Unit #${entry.equipment_id}`;

        typeGroupsMap.get(typeId).entries.push({
          ...entry,
          equipment_name: rawEqName,
          equipment_brand: eq?.brand || "",
          equipment_model: eq?.model || "",
          location_name: eq?.location_name || (eq?.location_id ? `Lokasi ${eq.location_id}` : ""),
        });
      });

      // Sort groups by priority (XRAY -> WTMD -> HHMD -> ETD)
      const sortedTypeGroups = Array.from(typeGroupsMap.values()).sort(
        (a, b) => (a.priority || a.type_id) - (b.priority || b.type_id)
      );
      structuredData.entries_by_type = sortedTypeGroups;

      const FREQ_MAP: Record<number, { typeKey: string; name: string }> = {
        1: { typeKey: "report_daily", name: "Harian" },
        2: { typeKey: "report_weekly", name: "Mingguan" },
        3: { typeKey: "report_monthly", name: "Bulanan" },
        4: { typeKey: "report_quarterly", name: "Triwulan" },
        5: { typeKey: "report_semester", name: "Semester" },
        6: { typeKey: "report_yearly", name: "Tahunan" },
      };

      // Detect all distinct frequencies present in the shift
      const distinctFreqIds = new Set<number>();
      prevList.forEach((p: any) => {
        const fId = Number(p.checklist_frequency_id || 1);
        if (FREQ_MAP[fId]) distinctFreqIds.add(fId);
      });

      // Default to frequency 1 (Harian) if only correctives exist
      if (distinctFreqIds.size === 0) {
        distinctFreqIds.add(1);
      }

      const generatedFiles: Array<{ freqId: number; intervalName: string; fileName: string; objectKey: string; size: number }> = [];
      let lastPdfBuffer: Buffer | null = null;
      let lastFileName = "";
      let lastObjectKey = "";
      let totalWaSentCount = 0;

      const waCfg = loadWhatsAppConfig();
      let isWaConnected = false;
      if (isWahaEnabled()) {
        isWaConnected = await getWahaConnectionStatus();
      } else {
        const waStatus = getWhatsAppStatus();
        isWaConnected = waStatus.status === "connected";
      }
      const targetJid = waCfg.target_jid;

      const dateObj = new Date(targetOpDate + "T12:00:00Z");
      const dateFormatted = new Intl.DateTimeFormat("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Jakarta",
      }).format(dateObj);

      const tgCfg = loadTelegramServerConfig();
      const tgToken = tgCfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;
      const targetChatId = tgCfg.chat_id || process.env.TELEGRAM_CHAT_ID || "-5531204015";

      for (const freqId of Array.from(distinctFreqIds).sort((a, b) => a - b)) {
        const freqInfo = FREQ_MAP[freqId] || { typeKey: "report_daily", name: "Harian" };
        const objectKey = generateCanonicalStorageKey({
          entityType: freqInfo.typeKey,
          dateStr: targetOpDate,
          shift: shiftCode,
        });
        const fileName = path.basename(objectKey);

        // Generate PDF Buffer for this specific interval
        const pdfBuffer = await generateReportPdfWithPuppeteer(structuredData, freqId);
        lastPdfBuffer = pdfBuffer;
        lastFileName = fileName;
        lastObjectKey = objectKey;

        generatedFiles.push({
          freqId,
          intervalName: freqInfo.name,
          fileName,
          objectKey,
          size: pdfBuffer.length,
        });

        // Upload to IDCloudHost S3 with standardized canonical path
        if (s3Configured) {
          const s3 = getS3Client(cfg);
          await s3.send(
            new PutObjectCommand({
              Bucket: cfg.bucketName,
              Key: objectKey,
              Body: pdfBuffer,
              ContentType: "application/pdf",
            })
          );

          // Upsert to report_files in Supabase
          await supabase.from("report_files").upsert(
            {
              report_type: freqInfo.typeKey.replace("report_", ""),
              operational_date: targetOpDate,
              shift: targetShift,
              frequency_id: freqId,
              object_key: objectKey,
              file_name: fileName,
              file_size: pdfBuffer.length,
              content_type: "application/pdf",
              bucket: cfg.bucketName,
              generated_by: "Auto-Scheduler Shift",
              generated_at: new Date().toISOString(),
              version: 1,
            },
            { onConflict: "object_key" }
          );
        }

        // Send PDF Document to WhatsApp if connected
        if (waCfg.enabled && isWaConnected && targetJid) {
          try {
            const waCaption = `Assalamualaikum, izin mengirimkan Laporan Preventif ${freqInfo.name} ${dateFormatted} Shift ${targetShift}\n\n*_sent from nararyaapps.net_*`;
            await whatsappMedia(
              'file',
              targetJid,
              { buffer: pdfBuffer, mime: 'application/pdf', filename: fileName },
              waCaption,
              fileName
            );
            totalWaSentCount++;
            console.log(`[Auto-Export PDF] Berhasil dikirim ke WhatsApp Group: ${targetJid} (${fileName})`);
            // Small pause between multiple interval sends
            if (distinctFreqIds.size > 1) {
              await new Promise((r) => setTimeout(r, 1200));
            }
          } catch (waErr) {
            writeServerErrorLog("performShiftPdfAutoExport_WA", `Gagal kirim PDF WA (${fileName})`, waErr);
          }
        }
      }

      // Send Summary Notification to Telegram
      if (tgToken && targetChatId) {
        const fileListText = generatedFiles
          .map((f) => `• <b>${f.intervalName}:</b> <code>${f.fileName}</code> (${(f.size / 1024).toFixed(1)} KB)`)
          .join("\n");

        const tgMsg =
          `📄 <b>AUTO-EXPORT LAPORAN SHIFT</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 <b>Tanggal Operasional:</b> <b>${targetOpDate}</b>\n` +
          `⏰ <b>Shift Kerja:</b> <b>${targetShift}</b>\n` +
          `👷 <b>Teknisi Jaga:</b> ${finalTechNames.join(", ")}\n` +
          `📊 <b>Data:</b> ${prevList.length} checklist preventif, ${corrList.length} tiket corrective\n` +
          `📁 <b>Berkas PDF (${generatedFiles.length} interval):</b>\n${fileListText}\n\n` +
          `✅ <i>Semua laporan PDF resmi telah digenerate otomatis dan diarsipkan ke S3 Cloud Storage.</i>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📡 <i>Sistem Otomatisasi FASKAMPEN HLP</i>`;

        fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: tgMsg,
            parse_mode: "HTML",
          }),
        }).catch((e) => console.warn("[Auto-Export Telegram Warning]:", e));
      }

      console.log(`[Auto-Export PDF] Berhasil mengekspor ${generatedFiles.length} file PDF untuk ${targetOpDate} Shift ${targetShift}.`);
      return {
        success: true,
        fileName: lastFileName,
        objectKey: lastObjectKey,
        size: lastPdfBuffer ? lastPdfBuffer.length : 0,
        files: generatedFiles,
        waSent: totalWaSentCount > 0,
      };
    } catch (exportErr: any) {
      writeServerErrorLog("performShiftPdfAutoExport", "Auto-Export PDF Exception", exportErr);
      return { success: false, error: exportErr.message };
    } finally {
      isShiftAutoExportRunning = false;
    }
  }

  // Private S3 evidence is pulled server-side. Never fetch arbitrary external URLs
  // and never send a temporary AWS signature/ticket to WhatsApp.
  async function resolveWhatsAppMedia(input: unknown, user: any, kind: 'image' | 'file'):
    Promise<{ buffer: Buffer; mime: string; filename: string }> {
    if (typeof input !== 'string' || !input.trim()) throw new Error('Media kosong atau tidak valid.');
    const raw = input.trim();
    const key = extractS3ObjectKey(raw);
    let buffer: Buffer;
    let mime = kind === 'file' ? 'application/pdf' : 'image/jpeg';
    let filename = kind === 'file' ? 'Laporan.pdf' : 'Foto.jpg';

    if (key) {
      const validated = validateAndSanitizeS3Key(key);
      if (!validated.valid || !validated.cleanKey) throw new Error('S3 object key tidak valid.');
      const permission = authorizeStorageAccess(user, validated.cleanKey, 'read');
      if (!permission.allowed) throw new Error(permission.reason || 'Tidak berwenang mengirim media S3.');
      const object = await getStorageImageBufferDirect(validated.cleanKey);
      if (!object) throw new Error('Objek S3 tidak ditemukan; periksa key dan bucket.');
      buffer = object.buffer;
      mime = object.contentType;
      filename = path.basename(validated.cleanKey);
    } else if (raw.startsWith('data:')) {
      const found = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/s.exec(raw);
      if (!found) throw new Error('Data URL media bukan JPEG/PNG/WebP/PDF yang valid.');
      mime = found[1];
      buffer = Buffer.from(found[2], 'base64');
      filename = mime === 'application/pdf' ? 'Laporan.pdf' : 'Foto.jpg';
    } else if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length > 128) {
      // Compatibility with existing PDF and image generators which send raw Base64.
      buffer = Buffer.from(raw, 'base64');
    } else {
      throw new Error('URL media eksternal tidak diterima. Kirim S3 key atau Base64.');
    }
    if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error('Media kosong atau melebihi batas 25 MB.');
    if (kind === 'file') {
      if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') throw new Error('Dokumen harus berupa PDF valid.');
      mime = 'application/pdf';
    } else {
      const signature = ['image/jpeg', 'image/png', 'image/webp']
        .map(candidate => validateFileBuffer(buffer, candidate))
        .find(result => result.valid && result.actualMime.startsWith('image/'));
      if (!signature) throw new Error('Foto harus JPEG, PNG, atau WebP.');
      mime = signature.actualMime;
    }
    return { buffer, mime, filename };
  }

  const whatsappText = (chat: string, message: string) =>
    isWahaEnabled() ? wahaSendText(chat, message) : sendWhatsAppTextMessage(chat, message);
  const whatsappMedia = (kind: 'image' | 'file', chat: string, media: {buffer: Buffer; mime: string; filename: string}, caption?: string, filename?: string) =>
    isWahaEnabled() ? wahaSendMedia(kind, chat, media.buffer, media.mime, filename || media.filename, caption) :
      kind === 'image' ? sendWhatsAppImageMessage(chat, media.buffer, caption) :
      sendWhatsAppDocumentMessage(chat, media.buffer, filename || media.filename, caption);

  // ==============================================================================
  // BAILEYS WHATSAPP BOT API ENDPOINTS
  // ==============================================================================

  app.get("/api/whatsapp/status", requireAuth, async (req, res) => {
    try {
      const status = getWhatsAppStatus();
      if (isWahaEnabled()) {
        const connected = await getWahaConnectionStatus();
        return res.json({ ...status, status: connected ? 'connected' : 'disconnected', qrDataUrl: null,
          pairingCode: null, phoneNumber: null, pushName: 'WAHA (VPS)', provider: 'waha' });
      }
      return res.json(status);
    } catch (err: any) {
      writeServerErrorLog("GET /api/whatsapp/status", "Gagal mengambil status WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/connect", requireSupervisor, async (req, res) => {
    try {
      if (isWahaEnabled()) return res.status(409).json({ error: 'WAHA digunakan; kelola koneksi dari dashboard WAHA VPS.' });
      await initializeWhatsApp(true);
      const status = getWhatsAppStatus();
      return res.json(status);
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/connect", "Gagal inisialisasi koneksi WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/pairing-code", requireSupervisor, async (req, res) => {
    try {
      const { phone_number } = req.body || {};
      if (!phone_number) {
        return res.status(400).json({ error: "Nomor telepon wajib diisi." });
      }
      if (isWahaEnabled()) return res.status(409).json({ error: 'Pairing dilakukan di dashboard WAHA VPS.' });
      const code = await requestWhatsAppPairingCode(phone_number);
      return res.json({ success: true, code });
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/pairing-code", "Gagal generate pairing code", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/disconnect", requireSupervisor, async (req, res) => {
    try {
      if (isWahaEnabled()) return res.status(409).json({ error: 'Logout WAHA melalui dashboard WAHA VPS.' });
      await logoutWhatsApp();
      return res.json({ success: true, message: "WhatsApp berhasil diputus." });
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/disconnect", "Gagal logout WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/config", requireSupervisor, (req, res) => {
    try {
      const updated = saveWhatsAppConfig(req.body || {});
      return res.json(updated);
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/config", "Gagal menyimpan konfigurasi WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/whatsapp/groups", requireAuth, async (req, res) => {
    try {
      const groups = isWahaEnabled() ? await wahaGetGroups() : await getWhatsAppGroupList();
      return res.json({ success: true, groups });
    } catch (err: any) {
      writeServerErrorLog("GET /api/whatsapp/groups", "Gagal mengambil daftar grup WhatsApp", err);
      return res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });

  app.post("/api/whatsapp/send-test", requireSupervisor, async (req, res) => {
    try {
      const { target_jid, message } = req.body || {};
      const cfg = loadWhatsAppConfig();
      const target = target_jid || cfg.target_jid;

      if (!target) {
        return res.status(400).json({
          error: "Nomor WhatsApp atau Group JID tujuan belum ditentukan.",
        });
      }

      await whatsappText(
        target,
        message || "🟢 *Tes Koneksi Bot WhatsApp Faskampen Halim Berhasil!*\n\nSistem notifikasi siap beroperasi."
      );
      return res.json({ success: true, message: `Pesan tes berhasil dikirim ke ${target}` });
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/send-test", "Gagal kirim pesan tes WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/send-photo", requireAuth, async (req, res) => {
    try {
      const { target_jid, photo, caption, type } = req.body || {};
      const cfg = loadWhatsAppConfig();
      const target = target_jid || cfg.target_jid;

      if (!target || !photo) {
        return res.status(400).json({ error: "Target JID dan Foto wajib disertakan." });
      }

      // Enforce attendance notification toggle
      const isAttendance = type === "attendance" || (caption && (caption.includes("PRESENSI") || caption.includes("ABSEN")));
      if (isAttendance && cfg.auto_notify_attendance === false) {
        console.log("[Server WhatsApp] Pengiriman foto presensi dilewati karena auto_notify_attendance = false");
        return res.json({ success: true, skipped: true, message: "Notifikasi presensi WhatsApp dinonaktifkan di pengaturan." });
      }

      // Enforce interval report notification toggle
      const isReport = type === "report" || type === "preventive" || (caption && caption.includes("LAPORAN PREVENTIF"));
      if (isReport && cfg.auto_notify_preventive === false) {
        console.log("[Server WhatsApp] Pengiriman foto laporan dilewati karena auto_notify_preventive = false");
        return res.status(403).json({ error: "Pengiriman laporan WhatsApp dinonaktifkan di pengaturan bot WhatsApp." });
      }

      const media = await resolveWhatsAppMedia(photo, (req as any).user, 'image');
      await whatsappMedia('image', target, media, caption);
      return res.json({ success: true });
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/send-photo", "Gagal kirim foto WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/send-text", requireAuth, async (req, res) => {
    try {
      const { target_jid, message, type } = req.body || {};
      const cfg = loadWhatsAppConfig();
      const target = target_jid || cfg.target_jid;

      if (!target || !message) {
        return res.status(400).json({ error: "Target JID dan Pesan teks wajib disertakan." });
      }

      // Enforce interval report notification toggle
      const isReport = type === "report" || type === "preventive" || (message && (message.includes("LAPORAN PREVENTIF") || message.includes("LAPORAN CORRECTIVE")));
      if (isReport && cfg.auto_notify_preventive === false) {
        console.log("[Server WhatsApp] Pengiriman teks laporan dilewati karena auto_notify_preventive = false");
        return res.status(403).json({ error: "Pengiriman laporan WhatsApp dinonaktifkan di pengaturan bot WhatsApp." });
      }

      await whatsappText(target, message);
      return res.json({ success: true });
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/send-text", "Gagal kirim teks WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/send-document", requireAuth, async (req, res) => {
    try {
      const { target_jid, document, file_name, caption } = req.body || {};
      const cfg = loadWhatsAppConfig();
      const target = target_jid || cfg.target_jid;

      if (!target || !document) {
        return res.status(400).json({ error: "Target JID dan Dokumen (PDF/Base64/URL) wajib disertakan." });
      }

      const fileName = file_name || "Laporan_Resmi.pdf";
      const media = await resolveWhatsAppMedia(document, (req as any).user, 'file');
      await whatsappMedia('file', target, media, caption, fileName);
      return res.json({ success: true, fileName });
    } catch (err: any) {
      writeServerErrorLog("POST /api/whatsapp/send-document", "Gagal kirim dokumen WhatsApp", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ==============================================================================
  // WAHA (WhatsApp HTTP API) ALIAS ENDPOINTS
  // ==============================================================================
  app.post("/api/sendImage", requireAuth, async (req, res) => {
    try {
      const { chatId, file, caption, target_jid, photo } = req.body || {};
      const cfg = loadWhatsAppConfig();
      const target = chatId || target_jid || cfg.target_jid;
      const media = file?.url || file?.data || photo;
      if (!target || !media) {
        return res.status(400).json({ error: "chatId dan file gambar wajib disertakan." });
      }
      const image = await resolveWhatsAppMedia(media, (req as any).user, 'image');
      await whatsappMedia('image', target, image, caption);
      return res.json({ success: true, status: "sent" });
    } catch (err: any) {
      writeServerErrorLog("POST /api/sendImage", "Gagal kirim gambar WAHA", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sendText", requireAuth, async (req, res) => {
    try {
      const { chatId, text, target_jid, message } = req.body || {};
      const cfg = loadWhatsAppConfig();
      const target = chatId || target_jid || cfg.target_jid;
      const msg = text || message;
      if (!target || !msg) {
        return res.status(400).json({ error: "chatId dan text pesan wajib disertakan." });
      }
      await whatsappText(target, msg);
      return res.json({ success: true, status: "sent" });
    } catch (err: any) {
      writeServerErrorLog("POST /api/sendText", "Gagal kirim pesan teks WAHA", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sendFile", requireAuth, async (req, res) => {
    try {
      const { chatId, file, filename, caption, target_jid, document } = req.body || {};
      const cfg = loadWhatsAppConfig();
      const target = chatId || target_jid || cfg.target_jid;
      const doc = (typeof file === "string" ? file : file?.url || file?.data) || document;
      if (!target || !doc) {
        return res.status(400).json({ error: "chatId dan file dokumen wajib disertakan." });
      }
      const documentMedia = await resolveWhatsAppMedia(doc, (req as any).user, 'file');
      await whatsappMedia('file', target, documentMedia, caption, filename || 'Dokumen.pdf');
      return res.json({ success: true, status: "sent" });
    } catch (err: any) {
      writeServerErrorLog("POST /api/sendFile", "Gagal kirim file WAHA", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ==============================================================================
  // CENTRALIZED ERROR LOGGING ENDPOINTS (JAKARTA TIME)
  // ==============================================================================

  app.post("/api/audit-logs", (req, res) => {
    try {
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/logs/error", (req, res) => {
    try {
      const { context, message, details, stack } = req.body || {};
      writeServerErrorLog(context || "ClientApp", message || "Unknown client error", { details, stack });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/logs/error/tail", (req, res) => {
    try {
      const errorLogPath = path.join(process.cwd(), "logs", "error.log");
      if (!fs.existsSync(errorLogPath)) {
        return res.json({ success: true, lines: [] });
      }
      const raw = fs.readFileSync(errorLogPath, "utf8");
      const lines = raw.trim().split("\n").slice(-100);
      return res.json({ success: true, lines });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  let lastAutoExportKey = "";

  async function checkAndRunShiftAutoExport() {
    try {
      const jktIso = getJakartaISOString();
      const datePart = jktIso.split("T")[0]; // YYYY-MM-DD
      const timePart = jktIso.split("T")[1]; // HH:MM:SS
      const hour = parseInt(timePart.slice(0, 2), 10);
      const minute = parseInt(timePart.slice(3, 5), 10);

      let targetShift: "Pagi" | "Malam" | null = null;
      let targetOpDate = datePart;

      // 18:00 - 18:05 WIB -> 1 jam sebelum shift pagi selesai (19:00 WIB)
      if (hour === 18 && minute <= 5) {
        targetShift = "Pagi";
        targetOpDate = datePart;
      }
      // 06:00 - 06:05 WIB -> 1 jam sebelum shift malam selesai (07:00 WIB)
      else if (hour === 6 && minute <= 5) {
        targetShift = "Malam";
        // Shift malam yang sedang berakhir adalah operasional tanggal kemarin
        const curDate = new Date(`${datePart}T12:00:00+07:00`);
        const yDate = new Date(curDate.getTime() - 24 * 3600 * 1000);
        const yParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(yDate);
        targetOpDate = yParts;
      }

      if (!targetShift) return;

      const exportKey = `${targetOpDate}_${targetShift}`;
      if (lastAutoExportKey === exportKey) return;
      lastAutoExportKey = exportKey;

      console.log(`[Auto-Export PDF] Memulai auto-export shift untuk ${targetOpDate} Shift ${targetShift}...`);
      await performShiftPdfAutoExport(targetOpDate, targetShift);
    } catch (e) {
      console.warn("[Auto Export Scheduler Exception]:", e);
    }
  }

  // Check auto-export shift PDF status every 60 seconds
  setInterval(checkAndRunShiftAutoExport, 60000);

  // Manual Trigger Endpoint for Auto Export
  app.post("/api/reports/auto-export-trigger", async (req, res) => {
    try {
      const { operational_date, shift } = req.body || {};
      const targetDate = operational_date || getJakartaISOString().split("T")[0];
      const targetShift = (shift || "Pagi").toLowerCase().startsWith("m") ? "Malam" : "Pagi";

      const result = await performShiftPdfAutoExport(targetDate, targetShift);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Backup API Endpoints (Supervisor Only)
  app.get("/api/backup/list", requireSupervisor, (req, res) => {
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        return res.json({ success: true, backups: [] });
      }
      const files = fs.readdirSync(BACKUP_DIR).filter(f => isValidBackupFilename(f));
      const backups = files.map(filename => {
        const fullPath = path.join(BACKUP_DIR, filename);
        const stat = fs.statSync(fullPath);
        const isAuto = filename.includes("auto_midnight");
        return {
          filename,
          size_bytes: stat.size,
          size_kb: (stat.size / 1024).toFixed(1),
          created_at: stat.birthtime.toISOString(),
          type: isAuto ? 'Otomatis (Jam 12 Malam)' : 'Manual',
        };
      }).sort((a, b) => b.created_at.localeCompare(a.created_at));

      return res.json({ success: true, backups });
    } catch (err: any) {
      console.error("[Backup List Error]:", err);
      return res.status(500).json({ success: false, error: "Gagal memuat daftar backup" });
    }
  });

  app.post("/api/backup/gdrive-token", requireSupervisor, (req, res) => {
    const { token, email } = req.body || {};
    if (token && typeof token === "string") {
      activeGDriveToken = token.trim();
      activeGDriveEmail = email || "luthfiandammm@gmail.com";
      saveGDriveConfig({ token: activeGDriveToken, email: activeGDriveEmail });
      console.log(`[Backup GDrive] Active token saved for ${activeGDriveEmail}`);
      return res.json({ success: true, message: `Token Google Drive terhubung (${activeGDriveEmail})` });
    }
    return res.status(400).json({ success: false, error: "Token tidak valid" });
  });

  app.delete("/api/backup/gdrive-token", requireSupervisor, (req, res) => {
    activeGDriveToken = "";
    activeGDriveEmail = "";
    saveGDriveConfig({ token: "", email: "" });
    return res.json({ success: true, message: "Token Google Drive terputus" });
  });

  app.post("/api/backup/gdrive-gas-url", requireSupervisor, (req, res) => {
    const { gas_url, email } = req.body || {};
    if (gas_url && String(gas_url).startsWith("https://script.google.com/")) {
      activeGasUrl = String(gas_url).trim();
      activeGDriveEmail = email || "luthfiandammm@gmail.com (GAS)";
      saveGDriveConfig({ gas_url: activeGasUrl, email: activeGDriveEmail });
      console.log(`[Backup GDrive GAS] Active GAS URL saved for ${activeGDriveEmail}`);
      return res.json({ success: true, message: `Google Apps Script Web App terhubung (${activeGDriveEmail})` });
    }
    return res.status(400).json({ success: false, error: "URL Google Apps Script tidak valid" });
  });

  app.delete("/api/backup/gdrive-gas-url", requireSupervisor, (req, res) => {
    activeGasUrl = "";
    saveGDriveConfig({ gas_url: "" });
    return res.json({ success: true, message: "URL Google Apps Script terputus" });
  });

  app.post("/api/backup/run", requireSupervisor, async (req, res) => {
    try {
      const user = (req as any).user?.name || req.body?.user || 'Supervisor Operasional';
      const result = await performFullSystemBackup('manual', `Dipicu Manual oleh ${user}`);
      return res.json({
        success: true,
        message: `Backup database dan cloud storage berhasil dibuat (${result.filename})`,
        backup: result,
      });
    } catch (err: any) {
      console.error("[Backup Run Error]:", err);
      return res.status(500).json({ success: false, error: "Gagal membuat backup sistem" });
    }
  });

  app.get("/api/backup/download/:filename", requireSupervisor, (req, res) => {
    try {
      const rawParam = req.params.filename;
      if (!isValidBackupFilename(rawParam)) {
        return res.status(400).json({ error: "Nama file backup tidak valid" });
      }

      const filename = path.basename(rawParam);
      const filePath = path.join(BACKUP_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File backup tidak ditemukan" });
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.sendFile(filePath);
    } catch (err: any) {
      console.error("[Backup Download Error]:", err);
      return res.status(500).json({ error: "Gagal mengunduh file backup" });
    }
  });

  app.post("/api/backup/restore", requireSupervisor, async (req, res) => {
    try {
      const backupData = req.body;
      if (!backupData || !backupData.data) {
        return res.status(400).json({ success: false, error: "Payload backup tidak valid" });
      }

      const sb = getServerSupabase();
      if (!sb) {
        return res.status(400).json({ success: false, error: "Supabase database client tidak terkonfigurasi" });
      }

      const d = backupData.data;
      let restoredCount = 0;

      if (Array.isArray(d.technicians) && d.technicians.length > 0) {
        await Promise.resolve(sb.from("technicians").upsert(d.technicians)).catch(e => console.warn("Restore technicians warn:", e));
        restoredCount += d.technicians.length;
      }
      if (Array.isArray(d.equipment) && d.equipment.length > 0) {
        await Promise.resolve(sb.from("equipment").upsert(d.equipment)).catch(e => console.warn("Restore equipment warn:", e));
        restoredCount += d.equipment.length;
      }
      if (Array.isArray(d.attendance) && d.attendance.length > 0) {
        await Promise.resolve(sb.from("attendance_records").upsert(d.attendance)).catch(e => console.warn("Restore attendance warn:", e));
        restoredCount += d.attendance.length;
      }
      if (Array.isArray(d.preventive) && d.preventive.length > 0) {
        await Promise.resolve(sb.from("preventive_records").upsert(d.preventive)).catch(e => console.warn("Restore preventive warn:", e));
        restoredCount += d.preventive.length;
      }
      if (Array.isArray(d.corrective) && d.corrective.length > 0) {
        await Promise.resolve(sb.from("corrective_records").upsert(d.corrective)).catch(e => console.warn("Restore corrective warn:", e));
        restoredCount += d.corrective.length;
      }
      if (Array.isArray(d.schedules) && d.schedules.length > 0) {
        await Promise.resolve(sb.from("shift_schedules").upsert(d.schedules)).catch(e => console.warn("Restore schedules warn:", e));
        restoredCount += d.schedules.length;
      }
      if (Array.isArray(d.avsec_reports) && d.avsec_reports.length > 0) {
        await Promise.resolve(sb.from("avsec_qr_error_reports").upsert(d.avsec_reports)).catch(e => console.warn("Restore avsec warn:", e));
        restoredCount += d.avsec_reports.length;
      }
      if (Array.isArray(d.audit_logs) && d.audit_logs.length > 0) {
        await Promise.resolve(sb.from("audit_logs").upsert(d.audit_logs)).catch(e => console.warn("Restore audit warn:", e));
        restoredCount += d.audit_logs.length;
      }

      // Restore IDCloudHost S3 storage files
      let restoredStorageCount = 0;
      if (Array.isArray(backupData.storage_files) && backupData.storage_files.length > 0) {
        try {
          const cfg = loadStorageConfig();
          if (cfg && cfg.secretAccessKey && cfg.bucketName) {
            const s3 = getS3Client(cfg);
            for (const file of backupData.storage_files) {
              if (file.key && file.base64) {
                const validKey = validateAndSanitizeS3Key(file.key);
                if (validKey.valid && validKey.cleanKey) {
                  try {
                    const buf = Buffer.from(file.base64, "base64");
                    await s3.send(
                      new PutObjectCommand({
                        Bucket: cfg.bucketName,
                        Key: validKey.cleanKey,
                        Body: buf,
                        ContentType: file.content_type || "application/octet-stream",
                      })
                    );
                    restoredStorageCount++;
                  } catch (e) {
                    console.warn(`[Restore S3] Warning restoring file ${validKey.cleanKey}:`, e);
                  }
                }
              }
            }
            console.log(`[Restore System] Restored ${restoredStorageCount} files back into IDCloudHost S3`);
          }
        } catch (s3RestoreErr) {
          console.warn("[Restore System] S3 file restore exception:", s3RestoreErr);
        }
      }

      return res.json({
        success: true,
        message: `Restore data berhasil diproses (${restoredCount} entitas database + ${restoredStorageCount} berkas IDCloudHost S3 dipulihkan)`,
      });
    } catch (err: any) {
      console.error("[Backup Restore Error]:", err);
      return res.status(500).json({ success: false, error: "Gagal memproses restore backup" });
    }
  });

  app.delete("/api/backup/:filename", requireSupervisor, (req, res) => {
    try {
      const rawParam = req.params.filename;
      if (!isValidBackupFilename(rawParam)) {
        return res.status(400).json({ error: "Nama file backup tidak valid" });
      }

      const filename = path.basename(rawParam);
      const filePath = path.join(BACKUP_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.json({ success: true, message: `File backup ${filename} berhasil dihapus` });
    } catch (err: any) {
      console.error("[Backup Delete Error]:", err);
      return res.status(500).json({ success: false, error: "Gagal menghapus file backup" });
    }
  });

  // API Endpoint for Vector PDF Generation
  app.post("/api/generate-pdf", async (req, res) => {
    let browser: any;
    try {
      const { html, filename } = req.body;
      if (!html) {
        return res.status(400).json({ error: "HTML content is required" });
      }

      const pdfFilename = filename || "Laporan_Preventive_Maintenance.pdf";
      let puppeteer: any;
      try {
        const puppeteerModule = "puppeteer";
        puppeteer = (await import(/* @vite-ignore */ puppeteerModule)).default;
      } catch (e) {
        return res.status(501).json({
          error: "Puppeteer PDF generation service is not available. Please use client-side PDF export."
        });
      }

      // Launch headless Chromium with --no-sandbox flags for Cloud Run container environment
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
        ],
      });

      const page = await browser.newPage();

      const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm;
    }
    *, *:before, *:after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: 'Times New Roman', Times, serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    table {
      border-collapse: collapse !important;
      border-spacing: 0 !important;
      width: 100% !important;
      table-layout: fixed !important;
    }
    th, td {
      border: 0.5pt solid #000000 !important;
      box-sizing: border-box !important;
    }
    .pdf-page {
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      box-sizing: border-box;
      width: 100%;
      padding: 0;
      margin: 0 auto;
      background: #ffffff;
    }
    .pdf-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;

      await page.setContent(fullHtml, { waitUntil: "networkidle0" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
      res.send(Buffer.from(pdfBuffer));
    } catch (err: any) {
      console.error("Puppeteer PDF generation error:", err);
      res.status(500).json({ error: err.message || "Failed to generate PDF" });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  });

  // Vite middleware for development vs static asset serving for production
  const isDevMode = process.env.NODE_ENV !== "production";
  const distPath = path.join(process.cwd(), "dist");

  if (isDevMode) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [
            '**/*.json',
            '**/.data/**',
            '**/data/**',
            '**/dist/**',
            '**/.git/**',
          ],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(200).send(`<!DOCTYPE html><html><head><title>Loading App...</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2>Aplikasi sedang memuat aset...</h2><p>Silakan build aplikasi terlebih dahulu dengan 'npm run build' atau jalankan mode development dengan 'npm run dev'.</p></body></html>`);
      }
    });
  }

  let isShuttingDown = false;

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);

    // Auto-migrate local attendance to Supabase on startup
    autoMigrateLocalAttendanceToSupabase().catch((attErr) => {
      console.warn("[Attendance Migration Init Warning]:", attErr);
    });

    // Auto-start Telegram polling if bot token is configured
    try {
      const initialConfig = loadTelegramServerConfig();
      const activeToken = initialConfig.bot_token || process.env.TELEGRAM_BOT_TOKEN;
      if (activeToken) {
        triggerTelegramPolling(activeToken);
      }
    } catch (tgInitErr) {
      console.warn("[Telegram Init Warning]:", tgInitErr);
    }

    // Auto-initialize Baileys WhatsApp only if configured and authenticated session exists
    try {
      const waConfig = loadWhatsAppConfig();
      if (!isWahaEnabled() && waConfig.enabled && hasSavedWhatsAppCredentials()) {
        initializeWhatsApp(false).catch((waInitErr) => {
          writeServerErrorLog("WhatsAppInit", "Gagal inisialisasi awal WhatsApp", waInitErr);
        });
      } else {
        console.log("[Baileys WhatsApp] Sesi belum terhubung. Menunggu aksi user di dashboard untuk scan QR.");
      }
    } catch (waErr) {
      writeServerErrorLog("WhatsAppStartup", "Exception saat startup WhatsApp", waErr);
    }
  });

  if (PORT !== 3000) {
    try {
      const secondaryServer = app.listen(3000, "0.0.0.0", () => {
        console.log("Secondary listener active on http://0.0.0.0:3000");
      });
      secondaryServer.on("error", (e: any) => {
        console.log("[Notice] Secondary port 3000 listener:", e.message);
      });
    } catch (_) {}
  }

  server.on("error", (err: any) => {
    console.error("[Express Server Error]:", err);
  });

  async function handleGracefulShutdown(signal: string) {
    if (isShuttingDown) {
      console.log(`[Shutdown] Shutdown already in progress, ignoring duplicate ${signal}`);
      return;
    }
    isShuttingDown = true;
    console.log(`\n[Shutdown] Received ${signal}. Initiating graceful shutdown...`);

    // Safety fallback: force exit after 10s if any cleanup hangs
    const forceExitTimer = setTimeout(() => {
      console.error("[Shutdown] Cleanup timed out after 10s. Forcing exit (1).");
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      // Stage 1: Clear operational health-check interval
      console.log("[Shutdown Stage 1/4] Clearing operational health-check timer...");
      if (operationalHealthCheckInterval) {
        clearInterval(operationalHealthCheckInterval);
        operationalHealthCheckInterval = null;
      }

      // Stage 2: Stop Telegram auto-polling & abort active long-poll request
      console.log("[Shutdown Stage 2/4] Stopping Telegram polling service...");
      stopTelegramPolling();

      // Stage 3: Close persistent Puppeteer Chrome instance safely
      console.log("[Shutdown Stage 3/4] Closing persistent Puppeteer browser...");
      await closePuppeteerBrowser();

      // Stage 4: Close Express HTTP server gracefully
      console.log("[Shutdown Stage 4/4] Closing Express HTTP server...");
      await new Promise<void>((resolve) => {
        if (server && server.listening) {
          server.close((err) => {
            if (err) {
              console.warn("[Shutdown] Notice while closing HTTP server:", err);
            } else {
              console.log("[Shutdown] Express HTTP server closed successfully.");
            }
            resolve();
          });
        } else {
          resolve();
        }
      });

      console.log("[Shutdown] Graceful shutdown completed cleanly. Exiting with code 0.");
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (shutdownErr) {
      console.error("[Shutdown Error] Unhandled error during graceful shutdown:", shutdownErr);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("[startServer Critical Error]:", err);
});
