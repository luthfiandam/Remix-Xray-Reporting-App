import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { CorrectiveReport, Equipment, Location, ShiftType } from '../types';
import {
  processAndUploadCorrectiveEvidences,
  sanitizeCorrectiveEvidencesForSupabase,
  assertNoBase64Evidences,
} from './evidenceService';
import { buildDriveFolderPath } from '../utils/watermark';
import { getOperationalShiftForCorrective } from '../utils/technicianSchedule';
import { getJakartaDateString } from '../utils/dateTimeUtils';
import { getAuthHeaders } from './authService';

export interface SupabaseCorrectiveRow {
  id?: number;
  event_id: string;
  corrective_code: string;
  dataset_id: string;
  equipment_id: number;
  equipment_code?: string;
  equipment_name: string;
  equipment_type: string;
  location_id?: number | null;
  location_name?: string;
  operational_date: string;
  shift: 'PS' | 'M';
  problem_description: string;
  action_taken: string;
  result: 'Resolved' | 'Pending Sparepart' | 'Temporary Fix';
  result_text?: string;
  start_time?: string;
  end_time?: string;
  technician_ids?: number[];
  technicians?: string[];
  created_by?: string;
  notes?: string;
  evidences?: any[];
  created_at?: string;
  updated_at?: string;
}

/**
 * Normalizes any shift representation ('PAGI', 'MALAM', 'PS', 'M') to canonical PostgreSQL enum 'PS' | 'M'
 */
function toCanonicalShift(rawShift?: string): 'PS' | 'M' {
  if (!rawShift) return 'PS';
  const s = rawShift.toUpperCase().trim();
  if (s === 'M' || s === 'MALAM') return 'M';
  return 'PS';
}

/**
 * Normalizes result status to allowed check constraint in database
 */
function toCanonicalResult(rawResult?: string): 'Resolved' | 'Pending Sparepart' | 'Temporary Fix' {
  if (rawResult === 'Pending Sparepart' || rawResult === 'Temporary Fix' || rawResult === 'Resolved') {
    return rawResult;
  }
  return 'Resolved';
}

export async function fetchCorrectiveFromSupabase(
  datasetId: string = 'default'
): Promise<CorrectiveReport[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('corrective_records')
      .select('*')
      .or(`dataset_id.eq.${datasetId},dataset_id.is.null`)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.message?.toLowerCase().includes('permission denied')) {
        console.info('[SupabaseCorrective] Query dilewati (izin Postgres):', error.message);
      } else {
        console.warn('[SupabaseCorrective] Query error:', error.message);
      }
      return null;
    }

    if (!data) return [];

    return data.map((row: any): CorrectiveReport => {
      const rawOpDate = row.operational_date || row.corrective_date || getJakartaDateString();
      const shiftDomain: ShiftType = (row.shift === 'M' || row.shift === 'Malam') ? 'Malam' : 'Pagi';

      return {
        id: Number(row.id),
        event_id: row.event_id,
        document_id: row.event_id,
        dataset_id: row.dataset_id,
        corrective_code: row.corrective_code || `CR-${row.id}`,
        corrective_date: rawOpDate,
        shift: shiftDomain,
        equipment_id: Number(row.equipment_id),
        location_id: row.location_id ? Number(row.location_id) : 1,
        problem_description: row.problem_description || '',
        action_taken: row.action_taken || '',
        result: toCanonicalResult(row.result),
        result_text: row.result_text || '',
        start_time: row.start_time || '',
        end_time: row.end_time || '',
        technicians: Array.isArray(row.technicians) ? row.technicians : [],
        created_by: row.created_by || 'Teknisi',
        notes: row.notes || '',
        evidences: Array.isArray(row.evidences)
          ? sanitizeCorrectiveEvidencesForSupabase(row.evidences)
          : [],
        collage_object_key: row.collage_object_key || undefined,
        collage_url: row.collage_url || undefined,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString(),
        synced: true,
      };
    });
  } catch (err) {
    console.warn('[SupabaseCorrective] fetch error:', err);
    return null;
  }
}

export async function upsertCorrectiveRecordToSupabase(
  report: CorrectiveReport,
  equipments: Equipment[] = [],
  locations: Location[] = []
): Promise<{ success: boolean; data?: CorrectiveReport; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const supabase = getSupabaseClient();
    const datasetId = report.dataset_id || 'default';
    const eqId = Number(report.equipment_id);
    const eq = equipments.find((e) => e.id === eqId);

    // Resolve location ID and name
    const locId = report.location_id ? Number(report.location_id) : (eq?.location_id || 1);
    const loc = locations.find((l) => l.id === locId);

    const operationalDate = report.corrective_date || new Date().toISOString().split('T')[0];
    const canonicalShift = toCanonicalShift(report.shift);
    const eventId = report.event_id || `evt_corr_${report.id || Date.now()}`;
    const correctiveCode = report.corrective_code || `CR-${operationalDate.replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;

    // Build Google Drive folder path and process evidences
    const locationLabel = loc?.name || eq?.name || 'LOCATION';
    let folderPath = (report as any).folder_path || buildDriveFolderPath({
      reportType: 'CORRECTIVE',
      operationalDate: operationalDate,
      shift: canonicalShift === 'M' ? 'Malam' : 'Pagi',
      equipmentType: eq?.type || 'EQUIPMENT',
      locationName: locationLabel,
      equipmentName: eq?.name || 'Equipment',
    });

    if (folderPath && folderPath.includes('1. Foto Laporan Harian')) {
      folderPath = folderPath.replace('1. Foto Laporan Harian', '1.1 Foto Laporan Corrective');
    }

    const rawEvidences = Array.isArray(report.evidences) ? report.evidences : [];
    let cleanEvidences: string[] = [];
    let expectedCount = rawEvidences.length;
    let uploadedCount = 0;
    let uploadStatus: string = report.upload_status || (expectedCount === 0 ? 'completed' : 'pending');
    let lastUploadError: string | undefined = report.last_upload_error;

    const hasBase64 = rawEvidences.some((ev) => typeof ev === 'string' && ev.startsWith('data:image/'));
    if (hasBase64) {
      try {
        const uploadRes = await processAndUploadCorrectiveEvidences(rawEvidences, folderPath, {
          locationOrEquipment: locationLabel,
          startTime: report.start_time,
          correctiveDate: operationalDate,
          shift: canonicalShift,
          recordId: eventId,
        });

        expectedCount = uploadRes.expected_evidence_count;
        uploadedCount = uploadRes.uploaded_evidence_count;
        uploadStatus = uploadRes.upload_status;
        lastUploadError = uploadRes.last_upload_error;

        if (uploadRes.evidences && uploadRes.evidences.length > 0) {
          cleanEvidences = uploadRes.evidences;
        }
      } catch (uploadErr: any) {
        console.warn('[SupabaseCorrective] Storage upload failed, skipping un-uploaded base64 evidences to protect Supabase storage:', uploadErr);
        uploadStatus = 'failed';
        lastUploadError = uploadErr?.message || 'Storage upload exception';
      }
    } else {
      cleanEvidences = rawEvidences
        .map((ev) => (typeof ev === 'string' ? ev.trim() : (ev as any)?.drive_url || ''))
        .filter(Boolean);
      uploadedCount = cleanEvidences.length;
      uploadStatus = 'completed';
    }

    // STRICT DEFENSE-IN-DEPTH: Filter out ANY base64 data URLs.
    // Supabase table stores ONLY S3 / HTTP(S) links to preserve free-tier storage!
    cleanEvidences = sanitizeCorrectiveEvidencesForSupabase(cleanEvidences);
    assertNoBase64Evidences(cleanEvidences);

    const payload: Record<string, any> = {
      event_id: eventId,
      corrective_code: correctiveCode,
      dataset_id: datasetId,
      equipment_id: eqId,
      equipment_code: eq?.equipment_code || `EQ-${eqId}`,
      equipment_name: eq?.name || eq?.equipment_name || `Equipment #${eqId}`,
      equipment_type: eq?.type || 'X-RAY',
      location_id: locId,
      location_name: loc?.name || '-',
      operational_date: operationalDate,
      shift: canonicalShift,
      problem_description: report.problem_description || '-',
      action_taken: report.action_taken || '-',
      result: toCanonicalResult(report.result),
      result_text: report.result_text || '',
      start_time: report.start_time || '',
      end_time: report.end_time || '',
      technicians: Array.isArray(report.technicians) ? report.technicians : [],
      created_by: report.created_by || 'Teknisi',
      notes: report.notes || '',
      evidences: cleanEvidences,
      collage_object_key: report.collage_object_key || null,
      collage_url: report.collage_url || null,
      expected_evidence_count: expectedCount,
      uploaded_evidence_count: uploadedCount,
      upload_status: uploadStatus,
      last_upload_error: lastUploadError,
      updated_at: new Date().toISOString(),
      schema_version: 1,
    };

    // Check if record already exists by event_id or corrective_code
    const { data: existing, error: findError } = await supabase
      .from('corrective_records')
      .select('id, event_id, corrective_code')
      .or(`event_id.eq."${eventId}",corrective_code.eq."${correctiveCode}"`)
      .maybeSingle();

    if (findError) {
      console.warn('[SupabaseCorrective] Check existing warning:', findError.message);
    }

    // 1. Authoritative Backend Save Route (Verifies server-side RBAC & schedule)
    let savedRow: any = null;
    try {
      const authHeaders = await getAuthHeaders();
      const apiResp = await fetch('/api/corrective/save', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (apiResp.status === 403) {
        const errJson = await apiResp.json().catch(() => ({}));
        return {
          success: false,
          error: errJson.error || 'Akses ditolak: Teknisi sedang OFF DUTY / di luar jadwal piket.',
        };
      }

      if (apiResp.ok) {
        const json = await apiResp.json();
        if (json.success && json.data) {
          savedRow = json.data;
        }
      }
    } catch (apiErr) {
      console.warn('[SupabaseCorrective] Backend API /api/corrective/save unreachable, trying direct fallback:', apiErr);
    }

    if (!savedRow) {
      // 2. Direct Supabase Client fallback
      if (existing && existing.id) {
        const { data: updateData, error: updateError } = await supabase
          .from('corrective_records')
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single();

        if (updateError) {
          console.error('[SupabaseCorrective] Update error:', updateError.message);
          return { success: false, error: updateError.message };
        }
        savedRow = updateData;
      } else {
        const { data: insertData, error: insertError } = await supabase
          .from('corrective_records')
          .insert(payload)
          .select()
          .single();

        if (insertError) {
          console.error('[SupabaseCorrective] Insert error:', insertError.message);
          return { success: false, error: insertError.message };
        }
        savedRow = insertData;
      }
    }

    const transformed: CorrectiveReport = {
      ...report,
      id: savedRow.id ? Number(savedRow.id) : report.id,
      event_id: savedRow.event_id || eventId,
      corrective_code: savedRow.corrective_code || correctiveCode,
      evidences: cleanEvidences,
      synced: true,
      updated_at: savedRow.updated_at,
    };

    console.log('[SupabaseCorrective] Successfully saved corrective record:', savedRow.id, savedRow.corrective_code);
    return { success: true, data: transformed };
  } catch (err: any) {
    console.error('[SupabaseCorrective] Exception saving corrective record:', err);
    return { success: false, error: err?.message || 'Unknown error' };
  }
}

export async function deleteCorrectiveRecordFromSupabase(
  report: CorrectiveReport
): Promise<{ success: boolean; message?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: true, message: 'Supabase tidak dikonfigurasi, hapus lokal saja.' };
  }

  try {
    const { getAuthHeaders } = await import('./authService');
    const headers = await getAuthHeaders();

    const response = await fetch('/api/corrective/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: report.id,
        corrective_code: report.corrective_code,
        event_id: report.event_id,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return { success: true, message: data.message };
      }
      return { success: false, message: data.error || 'Gagal menghapus laporan dari server.' };
    }

    const errData = await response.json().catch(() => ({}));
    if (response.status === 403) {
      return { success: false, message: errData.error || 'Penghapusan laporan corrective hanya diizinkan untuk Supervisor.' };
    }

    // Fallback to direct Supabase client query
    const supabase = getSupabaseClient();
    let query = supabase.from('corrective_records').delete();

    if (report.id && typeof report.id === 'number') {
      query = query.or(`id.eq.${report.id},corrective_code.eq."${report.corrective_code}"`);
    } else if (report.corrective_code) {
      query = query.eq('corrective_code', report.corrective_code);
    } else if (report.event_id) {
      query = query.eq('event_id', report.event_id);
    }

    const { error } = await query;
    if (error) {
      console.error('[SupabaseCorrective] Delete error:', error.message);
      return { success: false, message: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[SupabaseCorrective] Delete exception:', err);
    return { success: false, message: err?.message || 'Unknown error' };
  }
}
