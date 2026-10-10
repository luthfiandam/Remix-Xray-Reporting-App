import { PreventiveEntry, Equipment, EquipmentType } from '../types';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  upsertPreventiveRecordToSupabase,
  fetchPreventiveRecordsFromSupabase,
  deletePreventiveRecordFromSupabase,
} from './supabasePreventiveService';

/**
 * Result Contract for Preventive Repository Operations
 */
export interface RepositoryResult<T> {
  success: boolean;
  data?: T;
  message?: string;
  conflict?: boolean;
}

/**
 * Reusable Preventive Repository Interface
 */
export interface PreventiveRepository {
  readonly backendName: 'supabase';
  fetchByContext(
    datasetId?: string,
    operationalDate?: string,
    shift?: string
  ): Promise<RepositoryResult<PreventiveEntry[]>>;
  fetchById(canonicalId: string): Promise<RepositoryResult<PreventiveEntry | null>>;
  save(
    entry: PreventiveEntry,
    equipments?: Equipment[],
    equipmentTypes?: EquipmentType[]
  ): Promise<RepositoryResult<PreventiveEntry>>;
  delete(
    entry: PreventiveEntry,
    equipments?: Equipment[],
    equipmentTypes?: EquipmentType[]
  ): Promise<RepositoryResult<boolean>>;
  exists(
    datasetId: string,
    equipmentId: number,
    frequencyId: number,
    periodKey: string,
    shift: string
  ): Promise<boolean>;
}

/**
 * 100% Supabase Preventive Repository Implementation
 */
export class SupabasePreventiveRepository implements PreventiveRepository {
  readonly backendName = 'supabase' as const;

  async fetchByContext(
    datasetId = 'default',
    operationalDate?: string,
    shift?: string
  ): Promise<RepositoryResult<PreventiveEntry[]>> {
    try {
      const records = await fetchPreventiveRecordsFromSupabase(datasetId);
      if (records !== null) {
        let filtered = records;
        if (operationalDate) {
          filtered = filtered.filter((r) => r.operational_date === operationalDate);
        }
        if (shift) {
          filtered = filtered.filter((r) => !r.shift || r.shift === shift);
        }
        return { success: true, data: filtered };
      }
      return { success: false, data: [], message: 'Supabase returned null' };
    } catch (err: any) {
      return { success: false, data: [], message: err?.message || 'Error fetching from Supabase' };
    }
  }

  async fetchById(canonicalId: string): Promise<RepositoryResult<PreventiveEntry | null>> {
    const res = await this.fetchByContext();
    if (!res.success || !res.data) {
      return { success: false, data: null };
    }
    const found = res.data.find((e) => (e as any).canonical_key === canonicalId);
    return { success: true, data: found || null };
  }

  async save(
    entry: PreventiveEntry,
    equipments?: Equipment[],
    equipmentTypes?: EquipmentType[]
  ): Promise<RepositoryResult<PreventiveEntry>> {
    try {
      const eq = equipments?.find((e) => Number(e.id) === Number(entry.equipment_id));
      const eqType = equipmentTypes?.find((t) => Number(t.id) === Number(eq?.equipment_type_id))?.name || 'EQUIPMENT';
      const res = await upsertPreventiveRecordToSupabase(entry, eq, eqType);
      if (res.success) {
        return { success: true, data: entry };
      }
      return { success: false, message: res.error || 'Gagal menyimpan ke Supabase' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error saving preventive record to Supabase' };
    }
  }

  async delete(
    entry: PreventiveEntry,
    _equipments?: Equipment[],
    _equipmentTypes?: EquipmentType[]
  ): Promise<RepositoryResult<boolean>> {
    try {
      const res = await deletePreventiveRecordFromSupabase(entry);
      if (res.success) {
        return { success: true, data: true };
      }
      return { success: false, message: res.error || 'Gagal menghapus data preventif di Supabase' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error deleting preventive record' };
    }
  }

  async exists(
    datasetId: string,
    equipmentId: number,
    frequencyId: number,
    periodKey: string,
    shift: string
  ): Promise<boolean> {
    const res = await this.fetchByContext(datasetId);
    if (!res.success || !res.data) return false;
    return res.data.some(
      (e) =>
        Number(e.equipment_id) === Number(equipmentId) &&
        Number(e.checklist_frequency_id) === Number(frequencyId) &&
        e.period_key === periodKey &&
        e.shift === shift
    );
  }
}

// Singleton instance
const supabaseRepoInstance = new SupabasePreventiveRepository();

/**
 * Returns the active Preventive Repository implementation (Supabase).
 */
export function getPreventiveRepository(): PreventiveRepository {
  return supabaseRepoInstance;
}
