import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import {
  ScheduleFetchResult,
  ShiftScheduleV2,
  TechnicianSchedule,
  ShiftAssignmentV2,
  mapScheduleV2ToTechnicianSchedules,
  buildScheduleDocId,
} from './scheduleService';

/**
 * Adapter / Bridge for Shift Schedules with Supabase.
 * Connects the application shift schedule operations with Supabase `shift_schedules` table.
 */

export async function fetchSchedulesForShiftFromSupabase(
  dateStr: string,
  shift: 'PS' | 'M',
  datasetId = 'default'
): Promise<ScheduleFetchResult> {
  if (!isSupabaseConfigured()) {
    return { status: 'SUCCESS_EMPTY', data: [] };
  }

  const docId = buildScheduleDocId(datasetId, dateStr, shift);

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('shift_schedules')
      .select('*')
      .eq('id', docId)
      .maybeSingle();

    if (error) {
      if (error.message?.toLowerCase().includes('permission denied')) {
        console.info('[SupabaseSchedule] Query dilewati (izin Postgres):', error.message);
      } else {
        console.warn('[SupabaseSchedule] Query error:', error.message);
      }
      return {
        status: 'UNKNOWN_ERROR',
        data: [],
        error: error.message,
      };
    }

    if (!data) {
      return { status: 'SUCCESS_EMPTY', data: [] };
    }

    const v2Doc: ShiftScheduleV2 = {
      dataset_id: data.dataset_id || datasetId,
      schedule_date: data.schedule_date || dateStr,
      shift: data.shift || shift,
      assignments: data.assignments || {},
      updated_by: data.updated_by,
      updated_at: data.updated_at,
      schema_version: 2,
    };

    const schedules = mapScheduleV2ToTechnicianSchedules(v2Doc);
    return {
      status: schedules.length > 0 ? 'SUCCESS_WITH_DATA' : 'SUCCESS_EMPTY',
      data: schedules,
      rawV2Docs: [v2Doc],
    };
  } catch (err: any) {
    console.warn('[SupabaseSchedule] Exception reading shift schedule:', err);
    return {
      status: 'UNKNOWN_ERROR',
      data: [],
      error: err?.message || String(err),
    };
  }
}

export async function fetchSchedulesForMonthFromSupabase(
  year: number,
  month: number,
  datasetId = 'default'
): Promise<ScheduleFetchResult> {
  if (!isSupabaseConfigured()) {
    return { status: 'SUCCESS_EMPTY', data: [] };
  }

  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('shift_schedules')
      .select('*')
      .eq('dataset_id', datasetId)
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate);

    if (error) {
      console.warn('[SupabaseSchedule] Monthly fetch error:', error.message);
      return {
        status: 'UNKNOWN_ERROR',
        data: [],
        error: error.message,
      };
    }

    if (!data || data.length === 0) {
      return { status: 'SUCCESS_EMPTY', data: [] };
    }

    const rawV2Docs: ShiftScheduleV2[] = data.map((row: any) => ({
      dataset_id: row.dataset_id,
      schedule_date: row.schedule_date,
      shift: row.shift,
      assignments: row.assignments || {},
      updated_by: row.updated_by,
      updated_at: row.updated_at,
      schema_version: 2,
    }));

    const allSchedules: TechnicianSchedule[] = [];
    rawV2Docs.forEach((doc) => {
      allSchedules.push(...mapScheduleV2ToTechnicianSchedules(doc));
    });

    return {
      status: allSchedules.length > 0 ? 'SUCCESS_WITH_DATA' : 'SUCCESS_EMPTY',
      data: allSchedules,
      rawV2Docs,
    };
  } catch (err: any) {
    console.warn('[SupabaseSchedule] Monthly fetch exception:', err);
    return {
      status: 'UNKNOWN_ERROR',
      data: [],
      error: err?.message || String(err),
    };
  }
}

export async function saveShiftScheduleV2ToSupabase(
  datasetId: string,
  scheduleDate: string,
  shift: 'PS' | 'M',
  assignments: Record<string, ShiftAssignmentV2>
): Promise<ShiftScheduleV2> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase Client belum terkonfigurasi.');
  }

  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const docId = buildScheduleDocId(datasetId, scheduleDate, shift);

  const payload: ShiftScheduleV2 = {
    dataset_id: datasetId,
    schedule_date: scheduleDate,
    shift,
    assignments,
    updated_by: userData?.user?.id || 'anonymous',
    updated_at: new Date().toISOString(),
    schema_version: 2,
  };

  const { error } = await supabase.from('shift_schedules').upsert(
    {
      id: docId,
      dataset_id: datasetId,
      schedule_date: scheduleDate,
      shift,
      assignments,
      updated_by: payload.updated_by,
      updated_at: payload.updated_at,
      schema_version: 2,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.error('[SupabaseSchedule] Upsert error:', error.message);
    throw new Error(`Gagal menyimpan jadwal ke Supabase: ${error.message}`);
  }

  return payload;
}

export async function saveBatchShiftSchedulesV2ToSupabase(
  datasetId: string,
  shifts: Array<{
    schedule_date: string;
    shift: 'PS' | 'M';
    assignments: Record<string, ShiftAssignmentV2>;
  }>
): Promise<{ savedCount: number }> {
  if (shifts.length === 0) return { savedCount: 0 };
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase Client belum terkonfigurasi.');
  }

  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData?.user?.id || 'anonymous';
  const nowIso = new Date().toISOString();

  const rows = shifts.map((s) => ({
    id: buildScheduleDocId(datasetId, s.schedule_date, s.shift),
    dataset_id: datasetId,
    schedule_date: s.schedule_date,
    shift: s.shift,
    assignments: s.assignments,
    updated_by: updatedBy,
    updated_at: nowIso,
    schema_version: 2,
  }));

  const { error } = await supabase.from('shift_schedules').upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('[SupabaseSchedule] Batch upsert error:', error.message);
    throw new Error(`Gagal menyimpan batch jadwal ke Supabase: ${error.message}`);
  }

  return { savedCount: rows.length };
}

export async function deleteMonthlySchedulesV2ToSupabase(
  year: number,
  month: number,
  datasetId = 'default'
): Promise<{ deletedCount: number }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase Client belum terkonfigurasi.');
  }

  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('shift_schedules')
    .delete({ count: 'exact' })
    .eq('dataset_id', datasetId)
    .gte('schedule_date', startDate)
    .lte('schedule_date', endDate);

  if (error) {
    console.error('[SupabaseSchedule] Delete monthly error:', error.message);
    throw new Error(`Gagal menghapus jadwal bulanan di Supabase: ${error.message}`);
  }

  return { deletedCount: count || 0 };
}
