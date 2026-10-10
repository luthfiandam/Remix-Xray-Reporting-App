/**
 * Central Session Cache Service for Operational Technician Shift Resolution.
 *
 * Requirements:
 * - Cache must be strictly validated against:
 *   1. dataset_id
 *   2. operational_date
 *   3. shift ('Pagi' | 'Malam' or 'PS' | 'M')
 *   4. schedule_document_id (${dataset_id}_${operational_date}_${shift_code})
 *   5. updated_at (Firestore timestamp / ISO string)
 * - If ANY of these parameters change, the old cached session is discarded and re-resolved.
 */

import { ShiftType } from '../types';
import { safeReadJson, safeWriteJson, safeRemove } from './localCache';
import { buildScheduleDocId } from './scheduleService';

export interface CachedShiftSession {
  dataset_id: string;
  operational_date: string; // YYYY-MM-DD
  shift: ShiftType; // 'Pagi' | 'Malam'
  shift_code: 'PS' | 'M';
  schedule_document_id: string;
  updated_at: string | null;
  technician_ids: number[];
  technician_names: string[];
  supervisor_on_duty: boolean;
  resolved_at: string;
  source: 'firestore_v2' | 'manual' | 'default_rotation';
}

const SESSION_CACHE_KEY = 'active_shift_session_v2';

/**
 * Validates a cached session against expected operational context.
 * Returns true only if dataset_id, operational_date, shift, and schedule_document_id all match exactly,
 * and updated_at matches when provided.
 */
export function validateSessionCache(
  cached: CachedShiftSession | null | undefined,
  expected: {
    dataset_id: string;
    operational_date: string;
    shift: ShiftType;
    schedule_document_id?: string;
    updated_at?: string | null;
  }
): boolean {
  if (!cached) return false;

  // 1. Dataset ID validation
  if (!cached.dataset_id || cached.dataset_id.trim() !== expected.dataset_id.trim()) {
    return false;
  }

  // 2. Operational Date validation
  if (!cached.operational_date || cached.operational_date !== expected.operational_date) {
    return false;
  }

  // 3. Shift validation
  if (!cached.shift || cached.shift !== expected.shift) {
    return false;
  }

  // 4. Schedule Document ID validation
  const expectedDocId =
    expected.schedule_document_id ||
    buildScheduleDocId(
      expected.dataset_id,
      expected.operational_date,
      expected.shift === 'Pagi' ? 'PS' : 'M'
    );

  if (!cached.schedule_document_id || cached.schedule_document_id !== expectedDocId) {
    return false;
  }

  // 5. Updated_at timestamp validation (if both sides provide it)
  if (
    expected.updated_at !== undefined &&
    expected.updated_at !== null &&
    cached.updated_at !== null &&
    cached.updated_at !== undefined
  ) {
    if (cached.updated_at !== expected.updated_at) {
      return false;
    }
  }

  // 6. Must contain at least one valid technician ID
  if (!Array.isArray(cached.technician_ids) || cached.technician_ids.length === 0) {
    return false;
  }

  return true;
}

/**
 * Reads cached session from storage and validates against current expected operational parameters.
 * If invalid or stale, discards the cached session and returns null.
 */
export function getValidCachedShiftSession(expected: {
  dataset_id: string;
  operational_date: string;
  shift: ShiftType;
  schedule_document_id?: string;
  updated_at?: string | null;
}): CachedShiftSession | null {
  const raw = safeReadJson<CachedShiftSession | null>(SESSION_CACHE_KEY, null);
  if (!raw) return null;

  const isValid = validateSessionCache(raw, expected);
  if (!isValid) {
    // Discard stale or mismatching session
    clearCachedShiftSession();
    return null;
  }

  return raw;
}

/**
 * Saves validated operational shift session to storage.
 */
export function saveCachedShiftSession(session: CachedShiftSession): boolean {
  return safeWriteJson(SESSION_CACHE_KEY, session);
}

/**
 * Clears the active shift session cache.
 */
export function clearCachedShiftSession(): void {
  safeRemove(SESSION_CACHE_KEY);
}
