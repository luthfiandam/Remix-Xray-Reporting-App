import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { Equipment, MeasurementValue, PreventiveEntry, ShiftType, PreventiveEvidence } from '../types';
import { SupabasePreventiveRecordRow } from '../types/supabase';
import {
  processAndUploadPreventiveEvidences,
  sanitizePreventiveEvidencesForSupabase,
  assertNoBase64Evidences,
} from './evidenceService';
import { buildDriveFolderPath } from '../utils/watermark';
import { normalizeSubmittedDateTime } from '../utils/dateTimeUtils';
import { deleteStorageObjects } from './storageService';
import { getAuthHeaders } from './authService';

export interface EquipmentPrefillResult {
  viewType: 'single' | 'dual';
  genAMeasurement: MeasurementValue;
  genBMeasurement: MeasurementValue;
  source: 'previous_record' | 'equipment_default' | 'fallback_default';
}

/**
 * Default fallback measurements when neither previous records nor equipment defaults exist.
 * Note: Single view requires Generator B only.
 */
export const DEFAULT_XRAY_GEN_A: MeasurementValue = {
  generator: 'A',
  positive_high_voltage: 70.0,
  negative_high_voltage: -70.0,
  heater_current: 111.22,
  anode_current: 222.11,
};

export const DEFAULT_XRAY_GEN_B: MeasurementValue = {
  generator: 'B',
  positive_high_voltage: 70.0,
  negative_high_voltage: -70.11,
  heater_current: 111.22,
  anode_current: 222.11,
};

/**
 * Synchronously computes the prefill data for an equipment given an in-memory/cached list
 * of all preventive entries. Adheres strictly to per-equipment isolation.
 *
 * Prefill priority:
 * 1. Most recent saved Preventive record for THAT SAME equipment with non-empty measurements.
 * 2. Equipment's master `default_measurements` and `default_view_type` / `default_view`.
 * 3. Standard fallback defaults (Dual: Gen A + Gen B, Single: Gen B).
 */
export function getEquipmentPrefillData(
  equipment: Equipment,
  allEntries: PreventiveEntry[] = []
): EquipmentPrefillResult {
  const eqId = equipment.id;

  // 1. Search for the most recent entry STRICTLY FOR THIS SAME EQUIPMENT with valid measurements
  const matchingEntries = allEntries.filter(
    (e) =>
      ((e.equipment_id !== undefined && Number(e.equipment_id) === Number(eqId)) ||
       (e.equipment_code && equipment.equipment_code && e.equipment_code.trim() === equipment.equipment_code.trim())) &&
      Array.isArray(e.measurements) &&
      e.measurements.length > 0
  );

  // Sort descending by operational_date, submitted_at, created_at, or id
  matchingEntries.sort((a, b) => {
    const timeA = a.operational_date || a.created_at || a.submitted_at || '';
    const timeB = b.operational_date || b.created_at || b.submitted_at || '';
    if (timeB !== timeA) {
      return timeB.localeCompare(timeA);
    }
    return (b.id || 0) - (a.id || 0);
  });

  const latestEntry = matchingEntries[0];

  if (latestEntry && latestEntry.measurements && latestEntry.measurements.length > 0) {
    const prevGenA = latestEntry.measurements.find((m) => m.generator === 'A');
    const prevGenB = latestEntry.measurements.find((m) => m.generator === 'B');

    // Inherit actual operating view_type from latest preventive record
    const resolvedViewType: 'single' | 'dual' =
      latestEntry.view_type ||
      (prevGenA ? 'dual' : 'single') ||
      equipment.default_view_type ||
      equipment.default_view ||
      'single';

    return {
      viewType: resolvedViewType,
      genAMeasurement: prevGenA
        ? { ...prevGenA }
        : getFallbackGenA(equipment),
      genBMeasurement: prevGenB
        ? { ...prevGenB }
        : getFallbackGenB(equipment),
      source: 'previous_record',
    };
  }

  // 2. Fallback to Master Equipment default configuration
  const defaultView: 'single' | 'dual' =
    equipment.default_view_type || equipment.default_view || 'single';

  if (equipment.default_measurements && equipment.default_measurements.length > 0) {
    const defGenA = equipment.default_measurements.find((m) => m.generator === 'A');
    const defGenB = equipment.default_measurements.find((m) => m.generator === 'B');

    return {
      viewType: defaultView,
      genAMeasurement: defGenA ? { ...defGenA } : { ...DEFAULT_XRAY_GEN_A },
      genBMeasurement: defGenB ? { ...defGenB } : { ...DEFAULT_XRAY_GEN_B },
      source: 'equipment_default',
    };
  }

  // 3. Fallback standard defaults
  return {
    viewType: defaultView,
    genAMeasurement: { ...DEFAULT_XRAY_GEN_A },
    genBMeasurement: { ...DEFAULT_XRAY_GEN_B },
    source: 'fallback_default',
  };
}

function getFallbackGenA(equipment: Equipment): MeasurementValue {
  if (equipment.default_measurements) {
    const m = equipment.default_measurements.find((x) => x.generator === 'A');
    if (m) return { ...m };
  }
  return { ...DEFAULT_XRAY_GEN_A };
}

function getFallbackGenB(equipment: Equipment): MeasurementValue {
  if (equipment.default_measurements) {
    const m = equipment.default_measurements.find((x) => x.generator === 'B');
    if (m) return { ...m };
  }
  return { ...DEFAULT_XRAY_GEN_B };
}

/**
 * Fetches the latest saved measurement and actual view_type for a specific equipment from Supabase.
 * Implements:
 * SELECT view_type, measurements
 * FROM preventive_records
 * WHERE equipment_id = :equipment_id
 *   AND jsonb_array_length(measurements) > 0
 * ORDER BY submitted_at DESC
 * LIMIT 1;
 */
export async function fetchLatestEquipmentMeasurementFromSupabase(
  equipmentId: number,
  datasetId = 'default'
): Promise<{
  view_type: 'single' | 'dual' | null;
  measurements: MeasurementValue[] | null;
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('preventive_records')
      .select('view_type, measurements, submitted_at')
      .eq('equipment_id', equipmentId)
      .eq('dataset_id', datasetId)
      .not('measurements', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.message?.toLowerCase().includes('permission denied')) {
        console.info('[SupabasePreventive] Query measurement dilewati (izin Postgres):', error.message);
      } else {
        console.warn('[SupabasePreventive] Query latest measurement error:', error.message);
      }
      return null;
    }

    if (!data || !Array.isArray(data.measurements) || data.measurements.length === 0) {
      return null;
    }

    return {
      view_type: (data.view_type as 'single' | 'dual') || null,
      measurements: data.measurements as MeasurementValue[],
    };
  } catch (err) {
    console.warn('[SupabasePreventive] Error executing fetchLatestEquipmentMeasurement:', err);
    return null;
  }
}

/**
 * Upserts a Preventive Record to Supabase PostgreSQL table `preventive_records`.
 * Relies on deterministic UNIQUE constraint on (dataset_id, equipment_id, checklist_frequency_id, period_key, shift).
 */
export async function upsertPreventiveRecordToSupabase(
  entry: PreventiveEntry,
  equipment?: Equipment,
  equipmentTypeStr = 'EQUIPMENT'
): Promise<{ success: boolean; data?: SupabasePreventiveRecordRow; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const supabase = getSupabaseClient();
    const datasetId = entry.dataset_id || 'default';
    const recordId = String(entry.id || Date.now());

    // Canonical Single View = Gen B only, Dual View = Gen A + Gen B
    let sanitizedMeasurements: MeasurementValue[] = [];
    if (entry.measurements && entry.measurements.length > 0) {
      if (entry.view_type === 'single') {
        const genB = entry.measurements.find((m) => m.generator === 'B');
        if (genB) {
          sanitizedMeasurements = [
            {
              generator: 'B',
              positive_high_voltage: genB.positive_high_voltage != null ? Number(genB.positive_high_voltage) : undefined,
              negative_high_voltage: genB.negative_high_voltage != null ? Number(genB.negative_high_voltage) : undefined,
              heater_current: genB.heater_current != null ? Number(genB.heater_current) : undefined,
              anode_current: genB.anode_current != null ? Number(genB.anode_current) : undefined,
            },
          ];
        }
      } else {
        sanitizedMeasurements = entry.measurements.map((m) => ({
          generator: m.generator,
          positive_high_voltage: m.positive_high_voltage != null ? Number(m.positive_high_voltage) : undefined,
          negative_high_voltage: m.negative_high_voltage != null ? Number(m.negative_high_voltage) : undefined,
          heater_current: m.heater_current != null ? Number(m.heater_current) : undefined,
          anode_current: m.anode_current != null ? Number(m.anode_current) : undefined,
        }));
      }
    }

    // Normalize shift to canonical ('PS' | 'M')
    const rawShift = String(entry.shift || '').trim();
    const canonicalShift: 'PS' | 'M' = (rawShift === 'M' || rawShift === 'Malam') ? 'M' : 'PS';

    // Normalize technician IDs to integer array
    const techIds: number[] = Array.isArray(entry.submitted_by_technician_ids)
      ? entry.submitted_by_technician_ids.map((id) => Number(id)).filter((id) => !isNaN(id))
      : [];

    // Build Google Drive folder path and process evidences
    const equipmentLabel = equipment?.equipment_code || `EQ-${entry.equipment_id}`;
    const folderPath = (entry as any).folder_path || buildDriveFolderPath({
      reportType: 'PREVENTIVE',
      operationalDate: entry.operational_date || new Date().toISOString().split('T')[0],
      shift: canonicalShift === 'M' ? 'Malam' : 'Pagi',
      equipmentType: equipmentTypeStr,
      locationName: equipmentLabel,
      equipmentName: equipment?.name || equipment?.equipment_name || 'Equipment',
    });

    const rawEvidences = Array.isArray(entry.evidences) ? entry.evidences : [];
    let cleanEvidences: PreventiveEvidence[] = [];
    let expectedCount = rawEvidences.length;
    let uploadedCount = 0;
    let uploadStatus: string = entry.upload_status || (expectedCount === 0 ? 'completed' : 'pending');
    let lastUploadError: string | undefined = entry.last_upload_error;

    const hasBase64 = rawEvidences.some((ev) => {
      const candidate = ev.file_path || ev.dataUrl || ev.drive_url || ev.url || '';
      return typeof candidate === 'string' && candidate.startsWith('data:image/');
    });

    if (hasBase64) {
      try {
        const uploadRes = await processAndUploadPreventiveEvidences(rawEvidences, folderPath, {
          equipmentCode: equipmentLabel,
          locationName: equipment?.name,
          operationalDate: entry.operational_date,
          timeStr: entry.submitted_at,
          shift: canonicalShift,
          recordId,
        });

        expectedCount = uploadRes.expected_evidence_count;
        uploadedCount = uploadRes.uploaded_evidence_count;
        uploadStatus = uploadRes.upload_status;
        lastUploadError = uploadRes.last_upload_error;

        if (uploadRes.evidences && uploadRes.evidences.length > 0) {
          cleanEvidences = uploadRes.evidences;
        }
      } catch (uploadErr: any) {
        console.warn('[SupabasePreventive] Storage upload failed, skipping un-uploaded base64 evidences to protect Supabase storage:', uploadErr);
        uploadStatus = 'failed';
        lastUploadError = uploadErr?.message || 'Storage upload exception';
      }
    } else {
      cleanEvidences = rawEvidences;
      uploadedCount = cleanEvidences.filter((e) => Boolean(e.file_path || e.drive_url || e.url)).length;
      uploadStatus = 'completed';
    }

    // STRICT DEFENSE-IN-DEPTH: Filter out ANY base64 data URLs.
    // Supabase table stores ONLY S3 / HTTP(S) links to preserve free-tier storage!
    cleanEvidences = sanitizePreventiveEvidencesForSupabase(cleanEvidences);
    assertNoBase64Evidences(cleanEvidences);

    const payload: SupabasePreventiveRecordRow = {
      ...(typeof entry.id === 'number' && entry.id > 0 && entry.id < 2000000000 ? { id: entry.id } : {}),
      record_id: recordId,
      dataset_id: datasetId,
      equipment_id: entry.equipment_id,
      equipment_code: equipment?.equipment_code || '',
      equipment_name: equipment?.name || equipment?.equipment_name || '',
      equipment_type: equipmentTypeStr,
      view_type: entry.view_type || equipment?.default_view_type || equipment?.default_view || null,
      checklist_frequency_id: entry.checklist_frequency_id,
      period_key: entry.period_key || entry.operational_date || new Date().toISOString().split('T')[0],
      operational_date: entry.operational_date || new Date().toISOString().split('T')[0],
      shift: canonicalShift,
      preventive_session_id: entry.preventive_session_id || null,
      sequence: entry.sequence || 1,
      submitted_at: entry.submitted_at
        ? normalizeSubmittedDateTime(entry.submitted_at, entry.operational_date, canonicalShift)
        : new Date().toISOString(),
      submitted_by_technician_ids: techIds,
      status: (['OK', 'NG', 'NEEDS_REPAIR'].includes(entry.status) ? entry.status : 'OK') as 'OK' | 'NG' | 'NEEDS_REPAIR',
      notes: entry.notes || '',
      checklist_results: entry.checklist_results || [],
      measurements: sanitizedMeasurements,
      evidences: cleanEvidences,
      expected_evidence_count: expectedCount,
      uploaded_evidence_count: uploadedCount,
      upload_status: uploadStatus,
      last_upload_error: lastUploadError,
      schema_version: 1,
    };

    // 1. Authoritative Backend Save Route (Verifies server-side RBAC & schedule)
    try {
      const authHeaders = await getAuthHeaders();
      const apiResp = await fetch('/api/preventive/save', {
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
          return { success: true, data: json.data as SupabasePreventiveRecordRow };
        }
      }
    } catch (apiErr) {
      console.warn('[SupabasePreventive] Backend API /api/preventive/save unreachable, trying direct fallback:', apiErr);
    }

    // 2. Direct Supabase Client fallback
    const { data, error } = await supabase
      .from('preventive_records')
      .upsert(payload, {
        onConflict: 'dataset_id,equipment_id,checklist_frequency_id,period_key,shift',
      })
      .select()
      .maybeSingle();

    if (error) {
      console.warn('[SupabasePreventive] Upsert error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as SupabasePreventiveRecordRow };
  } catch (err: any) {
    console.error('[SupabasePreventive] Unexpected error saving record:', err);
    return { success: false, error: err?.message || 'Unknown error' };
  }
}

/**
 * Fetches all Preventive Records for a dataset from Supabase.
 */
export async function fetchPreventiveRecordsFromSupabase(
  datasetId = 'default'
): Promise<PreventiveEntry[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('preventive_records')
      .select('*')
      .eq('dataset_id', datasetId)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.message?.toLowerCase().includes('permission denied')) {
        console.info('[SupabasePreventive] Fetch dilewati (izin Postgres):', error.message);
      } else {
        console.warn('[SupabasePreventive] Fetch error:', error.message);
      }
      return null;
    }

    if (!data) return [];

    return data.map((row: any): PreventiveEntry => {
      const shiftDomain: ShiftType = row.shift === 'M' ? 'Malam' : 'Pagi';
      return {
        id: Number(row.id || row.record_id || Date.now()),
        dataset_id: row.dataset_id,
        preventive_session_id: row.preventive_session_id || 0,
        equipment_id: Number(row.equipment_id),
        checklist_frequency_id: Number(row.checklist_frequency_id),
        view_type: row.view_type || undefined,
        sequence: row.sequence || 1,
        submitted_at: row.submitted_at || '',
        submitted_by_technician_ids: Array.isArray(row.submitted_by_technician_ids)
          ? row.submitted_by_technician_ids.map(Number)
          : [],
        notes: row.notes || '',
        status: (['OK', 'NG', 'NEEDS_REPAIR'].includes(row.status) ? row.status : 'OK') as any,
        checklist_results: Array.isArray(row.checklist_results)
          ? row.checklist_results
          : typeof row.checklist_results === 'string'
          ? (() => { try { return JSON.parse(row.checklist_results); } catch { return []; } })()
          : [],
        measurements: Array.isArray(row.measurements)
          ? row.measurements
          : typeof row.measurements === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(row.measurements);
                return Array.isArray(parsed) ? parsed : [parsed];
              } catch {
                return [];
              }
            })()
          : (row.kv_value != null || row.ma_value != null)
          ? [{ generator: 'B', positive_high_voltage: Number(row.kv_value), heater_current: Number(row.ma_value) }]
          : [],
        evidences: Array.isArray(row.evidences)
          ? sanitizePreventiveEvidencesForSupabase(row.evidences)
          : typeof row.evidences === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(row.evidences);
                return sanitizePreventiveEvidencesForSupabase(Array.isArray(parsed) ? parsed : []);
              } catch {
                return [];
              }
            })()
          : [],
        operational_date: row.operational_date,
        shift: shiftDomain,
        period_key: row.period_key,
        created_at: row.created_at,
        updated_at: row.updated_at,
        synced: true,
      };
    });
  } catch (err) {
    console.warn('[SupabasePreventive] Fetch exception:', err);
    return null;
  }
}

/**
 * Deletes a Preventive Record from Supabase and cleans up photo evidence from S3 Storage.
 */
export async function deletePreventiveRecordFromSupabase(
  entry: PreventiveEntry
): Promise<{ success: boolean; error?: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const payload = {
      id: entry.id,
      equipment_id: entry.equipment_id,
      checklist_frequency_id: entry.checklist_frequency_id || 1,
      period_key: entry.period_key || entry.operational_date || '',
      dataset_id: entry.dataset_id || 'default',
    };

    const res = await fetch('/api/preventive/delete', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        return { success: true };
      }
    }
  } catch (apiErr) {
    console.warn('[SupabasePreventive] Backend API /api/preventive/delete warning:', apiErr);
  }

  // Fallback direct client query if offline or server API unavailable
  if (!isSupabaseConfigured()) return { success: true };
  try {
    const supabase = getSupabaseClient();
    const datasetId = entry.dataset_id || 'default';
    const periodKey = entry.period_key || entry.operational_date || '';

    let query = supabase.from('preventive_records').delete();
    if (entry.id) {
      query = query.eq('id', entry.id);
    } else {
      query = query
        .eq('dataset_id', datasetId)
        .eq('equipment_id', entry.equipment_id)
        .eq('checklist_frequency_id', entry.checklist_frequency_id || 1)
        .eq('period_key', periodKey);
    }

    const { error } = await query;
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('[SupabasePreventive] Unexpected error deleting record:', err);
    return { success: false, error: err?.message || 'Unknown error' };
  }
}
