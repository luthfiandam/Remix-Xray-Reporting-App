import { ComponentReplacement } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { safeReadJson, safeWriteJson } from './localCache';

const STORAGE_KEY = 'faskampen_component_replacements';

/**
 * Filter out legacy dummy/ghost data that might be stuck in local storage or database
 */
export function isDummyReplacement(item: any): boolean {
  if (!item) return true;
  const id = String(item.id || '');
  const sn = String(item.serial_number || '').trim();
  const code = String(item.corrective_code || '').trim();
  const reason = String(item.reason || '');
  const compName = String(item.component_name || '');
  const date = String(item.replaced_at || '');

  if (id.startsWith('cr-part-')) return true;
  if (['SOL-SHT-551', 'DB-XRAY-9942A', 'GEN-XR-140-B'].includes(sn)) return true;
  if (['CR-20260814-001', 'CR-20260828-002', 'CR-20260902-001'].includes(code)) return true;
  if (reason.includes('Pixel drop / no signal pada channel 3') || 
      reason.includes('Shutter mekanik tersangkut / error 0032') || 
      reason.includes('High Voltage drop > 10%')) {
    return true;
  }
  if (compName === 'Detector Board L-Shape' && date === '2026-08-14') return true;
  if (compName === 'Solenoid Shutter' && date === '2026-08-28') return true;
  if (compName === 'X-Ray Generator B' && date === '2026-09-02') return true;

  return false;
}

export function purifyComponentReplacements(items: ComponentReplacement[]): ComponentReplacement[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => !isDummyReplacement(item));
}

/**
 * Calculates human-friendly component operational age.
 */
export function calculateComponentAge(
  replacedAt: string,
  retiredAt?: string
): { days: number; label: string; isOngoing: boolean } {
  if (!replacedAt) {
    return { days: 0, label: 'Tanggal belum ditentukan', isOngoing: !retiredAt };
  }

  const start = new Date(replacedAt).getTime();
  const end = retiredAt ? new Date(retiredAt).getTime() : Date.now();

  if (isNaN(start)) {
    return { days: 0, label: 'Tanggal tidak valid', isOngoing: !retiredAt };
  }

  const diffMs = Math.max(0, end - start);
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let label = '';
  if (days === 0) {
    label = 'Hari ini';
  } else if (days < 30) {
    label = `${days} hari`;
  } else {
    const months = Math.floor(days / 30);
    const remDays = days % 30;
    label = remDays > 0 ? `${months} bulan ${remDays} hari` : `${months} bulan`;
  }

  return {
    days,
    label: retiredAt ? `Masa pakai: ${label}` : `Umur berjalan: ${label}`,
    isOngoing: !retiredAt,
  };
}

/**
 * Returns safe string label for component age (prevents object rendering errors in React).
 */
export function getComponentAgeLabel(replacedAt?: string, retiredAt?: string): string {
  if (!replacedAt) return 'Masa pakai: -';
  try {
    const age = calculateComponentAge(replacedAt, retiredAt);
    if (age && typeof age === 'object' && typeof age.label === 'string') {
      return age.label;
    }
    return 'Masa pakai: -';
  } catch (_) {
    return 'Masa pakai: -';
  }
}

/**
 * Fetches all component replacement records, optionally filtered by equipment_id.
 */
export async function fetchComponentReplacements(equipmentId?: number): Promise<ComponentReplacement[]> {
  let localData = purifyComponentReplacements(safeReadJson<ComponentReplacement[]>(STORAGE_KEY, []));
  // Clean up any ghost records from localStorage
  safeWriteJson(STORAGE_KEY, localData);

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from('component_replacements').select('*').order('replaced_at', { ascending: false });
      if (equipmentId) {
        query = query.eq('equipment_id', equipmentId);
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        const supaRecords: ComponentReplacement[] = data
          .map((row: any) => ({
            id: String(row.id),
            equipment_id: Number(row.equipment_id),
            equipment_name: row.equipment_name,
            component_name: row.component_name,
            replaced_at: row.replaced_at,
            technician_names: Array.isArray(row.technician_names) ? row.technician_names : [],
            reason: row.reason || '',
            corrective_code: row.corrective_code,
            serial_number: row.serial_number,
            origin: row.origin || 'Baru',
            notes: row.notes,
            evidence_url: row.evidence_url,
            created_at: row.created_at,
          }))
          .filter((item) => !isDummyReplacement(item));

        // Background cleanup: if any dummy records exist in database, delete them
        try {
          supabase
            .from('component_replacements')
            .delete()
            .or('serial_number.in.(SOL-SHT-551,DB-XRAY-9942A,GEN-XR-140-B),corrective_code.in.(CR-20260814-001,CR-20260828-002,CR-20260902-001)')
            .then(() => {});
        } catch (_) {}

        // Merge Supabase data with any local unsynced records (strictly non-ghost)
        const mergedMap = new Map<string, ComponentReplacement>();
        localData.forEach((item) => {
          if (!supaRecords.some((sr) => sr.id === item.id)) {
            mergedMap.set(item.id, item);
          }
        });
        supaRecords.forEach((item) => mergedMap.set(item.id, item));

        const combined = Array.from(mergedMap.values()).sort(
          (a, b) => (b.replaced_at || '').localeCompare(a.replaced_at || '')
        );
        safeWriteJson(STORAGE_KEY, combined);
        return equipmentId ? combined.filter((c) => c.equipment_id === equipmentId) : combined;
      }
    } catch (supaErr) {
      console.warn('[ComponentReplacement] Supabase sync fallback to local cache:', supaErr);
    }
  }

  return equipmentId ? localData.filter((c) => c.equipment_id === equipmentId) : localData;
}

/**
 * Deletes a component replacement record from Supabase and local cache.
 */
export async function deleteComponentReplacement(id: string): Promise<boolean> {
  const localData = purifyComponentReplacements(safeReadJson<ComponentReplacement[]>(STORAGE_KEY, []));
  const filtered = localData.filter((item) => item.id !== id);
  safeWriteJson(STORAGE_KEY, filtered);

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      await supabase.from('component_replacements').delete().eq('id', id);
    } catch (err) {
      console.warn('[ComponentReplacement] Failed to delete from Supabase:', err);
    }
  }
  return true;
}

/**
 * Saves a new component replacement record to Supabase and local cache.
 */
export async function saveComponentReplacement(
  replacement: Omit<ComponentReplacement, 'id' | 'created_at'>
): Promise<ComponentReplacement> {
  const newRecord: ComponentReplacement = {
    ...replacement,
    id: `comp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    created_at: new Date().toISOString(),
  };

  // 1. Save to local cache immediately
  const localData = purifyComponentReplacements(safeReadJson<ComponentReplacement[]>(STORAGE_KEY, []));
  const updated = [newRecord, ...localData];
  safeWriteJson(STORAGE_KEY, updated);

  // 2. Persist to Supabase if configured
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const payload = {
        equipment_id: newRecord.equipment_id,
        equipment_name: newRecord.equipment_name,
        component_name: newRecord.component_name,
        replaced_at: newRecord.replaced_at,
        technician_names: newRecord.technician_names,
        reason: newRecord.reason,
        corrective_code: newRecord.corrective_code,
        serial_number: newRecord.serial_number,
        origin: newRecord.origin,
        notes: newRecord.notes,
        evidence_url: newRecord.evidence_url,
        created_at: newRecord.created_at,
      };

      const { data, error } = await supabase.from('component_replacements').insert(payload).select().maybeSingle();
      if (!error && data) {
        newRecord.id = String(data.id || newRecord.id);
      }
    } catch (err) {
      console.warn('[ComponentReplacement] Supabase insert warning (saved locally):', err);
    }
  }

  return newRecord;
}
