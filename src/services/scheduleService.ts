import { isSupabaseConfigured } from '../lib/supabase';
import {
  fetchSchedulesForShiftFromSupabase,
  fetchSchedulesForMonthFromSupabase,
  saveShiftScheduleV2ToSupabase,
  saveBatchShiftSchedulesV2ToSupabase,
  deleteMonthlySchedulesV2ToSupabase,
} from './supabaseScheduleService';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
  BATCH_WRITE = 'batch_write',
}

export type ScheduleFetchStatus =
  | 'SUCCESS_WITH_DATA'
  | 'SUCCESS_EMPTY'
  | 'PERMISSION_DENIED'
  | 'INDEX_REQUIRED'
  | 'UNAUTHENTICATED'
  | 'NETWORK_ERROR'
  | 'INVALID_QUERY'
  | 'UNKNOWN_ERROR';

export type ScheduleStatus =
  | 'scheduled'
  | 'backup'
  | 'overtime'
  | 'day_off'
  | 'off'
  | 'leave'
  | 'sick'
  | 'permission';

export const ON_DUTY_STATUSES: ScheduleStatus[] = ['scheduled', 'backup', 'overtime'];

export interface ShiftAssignmentV2 {
  technician_name?: string;
  technician_id?: number | string;
  status: ScheduleStatus;
}

export interface ShiftScheduleV2 {
  dataset_id: string;
  schedule_date: string;
  shift: 'PS' | 'M';
  assignments: Record<string, ShiftAssignmentV2>;
  updated_by?: string;
  updated_at?: string;
  schema_version?: number;
  status?: string;
}

export interface TechnicianSchedule {
  id?: string;
  dataset_id: string;
  schedule_date: string;
  shift: 'PS' | 'M';
  technician_id: string;
  status: ScheduleStatus;
  updated_by?: string;
  updated_at?: string;
}

export interface ScheduleFetchResult {
  status: ScheduleFetchStatus;
  data: TechnicianSchedule[];
  error?: string;
  rawV2Docs?: ShiftScheduleV2[];
}

/**
 * Builds the canonical document ID for a shift schedule (Schema v2).
 * If technicianId is supplied, returns the legacy v1 format for backward-compatibility.
 */
export function buildScheduleDocId(
  datasetId: string,
  dateStr: string,
  shift: 'PS' | 'M',
  technicianId?: string | number
): string {
  if (technicianId !== undefined && technicianId !== null) {
    return `${datasetId.trim()}_${dateStr.trim()}_${shift.trim()}_${String(technicianId).trim()}`;
  }
  return `${datasetId.trim()}_${dateStr.trim()}_${shift.trim()}`;
}

export function buildLegacyScheduleDocId(
  datasetId: string,
  dateStr: string,
  shift: 'PS' | 'M',
  technicianId: string | number
): string {
  return `${datasetId.trim()}_${dateStr.trim()}_${shift.trim()}_${String(technicianId).trim()}`;
}

/**
 * Classifies error into standard ScheduleFetchStatus
 */
export function classifyFirestoreError(err: any): ScheduleFetchStatus {
  const errMsg = (err?.message || String(err)).toLowerCase();
  const errCode = (err?.code || '').toLowerCase();

  if (
    errCode === 'permission-denied' ||
    errMsg.includes('permission-denied') ||
    errMsg.includes('insufficient permissions') ||
    errMsg.includes('missing or insufficient permissions')
  ) {
    return 'PERMISSION_DENIED';
  }

  if (
    errCode === 'failed-precondition' ||
    errMsg.includes('failed-precondition') ||
    errMsg.includes('requires an index') ||
    errMsg.includes('the query requires an index') ||
    errMsg.includes('index')
  ) {
    return 'INDEX_REQUIRED';
  }

  if (
    errCode === 'unauthenticated' ||
    errMsg.includes('unauthenticated') ||
    errMsg.includes('auth/user-not-found')
  ) {
    return 'UNAUTHENTICATED';
  }

  if (
    errCode === 'unavailable' ||
    errCode === 'deadline-exceeded' ||
    errMsg.includes('unavailable') ||
    errMsg.includes('deadline-exceeded') ||
    errMsg.includes('offline') ||
    errMsg.includes('network') ||
    errMsg.includes('transport')
  ) {
    return 'NETWORK_ERROR';
  }

  if (
    errCode === 'invalid-argument' ||
    errMsg.includes('invalid-argument') ||
    errMsg.includes('invalid query')
  ) {
    return 'INVALID_QUERY';
  }

  return 'UNKNOWN_ERROR';
}

/**
 * Converts a ShiftScheduleV2 document into individual flat TechnicianSchedule objects.
 */
export function mapScheduleV2ToTechnicianSchedules(v2Doc: ShiftScheduleV2): TechnicianSchedule[] {
  if (!v2Doc || !v2Doc.assignments) {
    return [];
  }

  const results: TechnicianSchedule[] = [];
  const entries = Object.entries(v2Doc.assignments);

  for (const [techId, assignment] of entries) {
    results.push({
      id: buildScheduleDocId(v2Doc.dataset_id, v2Doc.schedule_date, v2Doc.shift, techId),
      dataset_id: v2Doc.dataset_id,
      schedule_date: v2Doc.schedule_date,
      shift: v2Doc.shift,
      technician_id: techId,
      status: assignment.status,
      updated_by: v2Doc.updated_by,
      updated_at: v2Doc.updated_at,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Telemetry & Cache
// ---------------------------------------------------------------------------
let activeShiftQueryCallCount = 0;
let monthlyScheduleQueryCallCount = 0;
let monthlyDocumentsReturnedCount = 0;

export function getActiveShiftQueryCount(): number {
  return activeShiftQueryCallCount;
}

export function resetActiveShiftQueryCount(): void {
  activeShiftQueryCallCount = 0;
}

export function getMonthlyScheduleQueryCount(): number {
  return monthlyScheduleQueryCallCount;
}

export function resetMonthlyScheduleQueryCount(): void {
  monthlyScheduleQueryCallCount = 0;
}

export function getMonthlyDocumentsReturnedCount(): number {
  return monthlyDocumentsReturnedCount;
}

export function resetMonthlyDocumentsReturnedCount(): void {
  monthlyDocumentsReturnedCount = 0;
}

export function getScheduleQueryCount(): number {
  return activeShiftQueryCallCount + monthlyScheduleQueryCallCount;
}

export function resetScheduleQueryCount(): void {
  activeShiftQueryCallCount = 0;
  monthlyScheduleQueryCallCount = 0;
  monthlyDocumentsReturnedCount = 0;
}

export interface MonthlyScheduleCacheEntry {
  result: ScheduleFetchResult;
  loadedTimestamp: number;
  documentsReturned: number;
  status: 'pending' | 'resolved' | 'rejected';
}

const MONTHLY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const monthlyScheduleCache = new Map<string, MonthlyScheduleCacheEntry>();
const inFlightMonthlyPromises = new Map<string, Promise<ScheduleFetchResult>>();

function pruneMonthlyCacheIfNeeded(currentDatasetId: string): void {
  if (monthlyScheduleCache.size <= 6) return;
  const now = Date.now();
  for (const [key, entry] of monthlyScheduleCache.entries()) {
    if (now - entry.loadedTimestamp > MONTHLY_CACHE_TTL_MS || !key.startsWith(`${currentDatasetId}_`)) {
      monthlyScheduleCache.delete(key);
    }
  }
}

export function clearMonthlyScheduleCache(): void {
  monthlyScheduleCache.clear();
  inFlightMonthlyPromises.clear();
}

export function invalidateMonthlyScheduleCache(
  datasetId: string,
  year?: number,
  month?: number
): void {
  if (year !== undefined && month !== undefined) {
    const monthStr = String(month).padStart(2, '0');
    monthlyScheduleCache.delete(`${datasetId}_${year}-${monthStr}`);
  } else {
    for (const key of monthlyScheduleCache.keys()) {
      if (key.startsWith(`${datasetId}_`)) {
        monthlyScheduleCache.delete(key);
      }
    }
  }
}

export function updateMonthlyScheduleCache(
  datasetId: string,
  year: number,
  month: number,
  v2Docs: ShiftScheduleV2 | ShiftScheduleV2[]
): void {
  const monthStr = String(month).padStart(2, '0');
  const cacheKey = `${datasetId}_${year}-${monthStr}`;
  const entry = monthlyScheduleCache.get(cacheKey);

  if (!entry || !entry.result.data) {
    return;
  }

  const docsArray = Array.isArray(v2Docs) ? v2Docs : [v2Docs];
  let currentData = entry.result.data;
  let rawDocs = entry.result.rawV2Docs ? [...entry.result.rawV2Docs] : [];

  for (const doc of docsArray) {
    const updatedSchedules = mapScheduleV2ToTechnicianSchedules(doc);
    currentData = currentData.filter(
      (s) => !(s.schedule_date === doc.schedule_date && s.shift === doc.shift)
    );
    currentData = [...currentData, ...updatedSchedules];

    const rawIdx = rawDocs.findIndex(
      (d) => d.schedule_date === doc.schedule_date && d.shift === doc.shift
    );
    if (rawIdx >= 0) {
      rawDocs[rawIdx] = doc;
    } else {
      rawDocs.push(doc);
    }
  }

  entry.result = {
    ...entry.result,
    status: currentData.length > 0 ? 'SUCCESS_WITH_DATA' : 'SUCCESS_EMPTY',
    data: currentData,
    rawV2Docs: rawDocs,
  };
}

export function invalidateActiveShiftCache(): void {
  // No-op for backward compatibility
}

// ---------------------------------------------------------------------------
// Schedule Operations
// ---------------------------------------------------------------------------

/**
 * Fetches all technician schedules for a specific date and shift.
 */
export async function fetchSchedulesForShiftDetailed(
  dateStr: string,
  shift: 'PS' | 'M',
  datasetId = 'default'
): Promise<ScheduleFetchResult> {
  activeShiftQueryCallCount++;

  if (isSupabaseConfigured()) {
    return fetchSchedulesForShiftFromSupabase(dateStr, shift, datasetId);
  }

  return { status: 'SUCCESS_EMPTY', data: [] };
}

export async function fetchSchedulesForShift(
  dateStr: string,
  shift: 'PS' | 'M',
  datasetId = 'default'
): Promise<TechnicianSchedule[]> {
  const result = await fetchSchedulesForShiftDetailed(dateStr, shift, datasetId);
  return result.data;
}

/**
 * Saves a complete shift's schedule as a single Schema v2 document.
 */
export async function saveShiftScheduleV2(
  datasetId: string,
  schedule_date: string,
  shift: 'PS' | 'M',
  assignments: Record<string, ShiftAssignmentV2>
): Promise<ShiftScheduleV2> {
  if (isSupabaseConfigured()) {
    return saveShiftScheduleV2ToSupabase(datasetId, schedule_date, shift, assignments);
  }

  throw new Error('Database Supabase belum terkonfigurasi.');
}

/**
 * Batched write for multiple shift schedules (Schema v2).
 */
export async function saveBatchShiftSchedulesV2(
  datasetId: string,
  shifts: Array<{
    schedule_date: string;
    shift: 'PS' | 'M';
    assignments: Record<string, ShiftAssignmentV2>;
  }>
): Promise<{ savedCount: number }> {
  if (shifts.length === 0) {
    return { savedCount: 0 };
  }

  if (isSupabaseConfigured()) {
    return saveBatchShiftSchedulesV2ToSupabase(datasetId, shifts);
  }

  throw new Error('Database Supabase belum terkonfigurasi.');
}

/**
 * Deletes all shift schedule documents for an entire month.
 */
export async function deleteMonthlySchedulesV2Batch(
  year: number,
  month: number,
  datasetId = 'default'
): Promise<{ deletedCount: number }> {
  if (isSupabaseConfigured()) {
    const res = await deleteMonthlySchedulesV2ToSupabase(year, month, datasetId);
    invalidateMonthlyScheduleCache(datasetId, year, month);
    return res;
  }

  throw new Error('Database Supabase belum terkonfigurasi.');
}

/**
 * Legacy single-technician schedule save.
 */
export async function saveSchedule(schedule: TechnicianSchedule): Promise<void> {
  if (isSupabaseConfigured()) {
    await saveShiftScheduleV2ToSupabase(
      schedule.dataset_id,
      schedule.schedule_date,
      schedule.shift,
      {
        [schedule.technician_id]: {
          technician_name: `Tech ${schedule.technician_id}`,
          status: schedule.status,
        },
      }
    );
    return;
  }

  throw new Error('Database Supabase belum terkonfigurasi.');
}

/**
 * Fetches all technician schedules for an entire month with detailed status and in-memory cache.
 */
export async function fetchMonthlySchedulesDetailed(
  year: number,
  month: number,
  datasetId = 'default',
  bypassCache = false
): Promise<ScheduleFetchResult> {
  const monthStr = String(month).padStart(2, '0');
  const cacheKey = `${datasetId}_${year}-${monthStr}`;

  if (!bypassCache) {
    const cached = monthlyScheduleCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedTimestamp < MONTHLY_CACHE_TTL_MS) {
      return cached.result;
    }
  }

  if (inFlightMonthlyPromises.has(cacheKey)) {
    return inFlightMonthlyPromises.get(cacheKey)!;
  }

  if (isSupabaseConfigured()) {
    const promise = (async (): Promise<ScheduleFetchResult> => {
      monthlyScheduleQueryCallCount++;
      const res = await fetchSchedulesForMonthFromSupabase(year, month, datasetId);
      monthlyDocumentsReturnedCount += res.data.length;

      monthlyScheduleCache.set(cacheKey, {
        result: res,
        loadedTimestamp: Date.now(),
        documentsReturned: res.data.length,
        status: 'resolved',
      });
      pruneMonthlyCacheIfNeeded(datasetId);
      return res;
    })();

    inFlightMonthlyPromises.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlightMonthlyPromises.delete(cacheKey);
    }
  }

  return { status: 'SUCCESS_EMPTY', data: [] };
}

/**
 * Fetches all technician schedules for a specific month (YYYY-MM).
 */
export async function fetchMonthlySchedules(
  year: number,
  month: number,
  datasetId = 'default'
): Promise<TechnicianSchedule[]> {
  const result = await fetchMonthlySchedulesDetailed(year, month, datasetId);
  return result.data;
}

/**
 * Fetches monthly schedules directly as Schema v2 shift documents.
 */
export async function fetchMonthlyShiftDocsV2(
  year: number,
  month: number,
  datasetId = 'default'
): Promise<{ status: ScheduleFetchStatus; docs: ShiftScheduleV2[]; error?: string }> {
  const res = await fetchMonthlySchedulesDetailed(year, month, datasetId);
  if (res.status !== 'SUCCESS_WITH_DATA') {
    return { status: res.status, docs: [], error: res.error };
  }

  if (res.rawV2Docs && res.rawV2Docs.length > 0) {
    return { status: 'SUCCESS_WITH_DATA', docs: res.rawV2Docs };
  }

  const grouped = new Map<string, ShiftScheduleV2>();
  res.data.forEach((s) => {
    const key = `${s.schedule_date}_${s.shift}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        dataset_id: s.dataset_id,
        schedule_date: s.schedule_date,
        shift: s.shift,
        assignments: {},
        updated_by: s.updated_by,
        updated_at: s.updated_at,
        schema_version: 2,
      });
    }
    const doc = grouped.get(key)!;
    doc.assignments[s.technician_id] = {
      technician_name: `Tech ${s.technician_id}`,
      status: s.status,
    };
  });

  return { status: 'SUCCESS_WITH_DATA', docs: Array.from(grouped.values()) };
}
