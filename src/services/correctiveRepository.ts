import { CorrectiveReport, Equipment, Location } from '../types';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  fetchCorrectiveFromSupabase,
  upsertCorrectiveRecordToSupabase,
} from './supabaseCorrectiveService';

/**
 * Result Contract for Corrective Repository Operations
 */
export interface RepositoryResult<T> {
  success: boolean;
  data?: T;
  message?: string;
  conflict?: boolean;
}

/**
 * Reusable Corrective Repository Interface
 */
export interface CorrectiveRepository {
  readonly backendName: 'supabase';
  fetchByDataset(datasetId?: string): Promise<RepositoryResult<CorrectiveReport[]>>;
  fetchByContext(
    datasetId?: string,
    operationalDate?: string,
    shift?: string
  ): Promise<RepositoryResult<CorrectiveReport[]>>;
  fetchById(idOrEventId: string | number): Promise<RepositoryResult<CorrectiveReport | null>>;
  save(
    record: CorrectiveReport,
    equipments?: Equipment[],
    locations?: Location[]
  ): Promise<RepositoryResult<CorrectiveReport>>;
  delete(
    record: CorrectiveReport,
    equipments?: Equipment[],
    locations?: Location[]
  ): Promise<RepositoryResult<boolean>>;
}

/**
 * 100% Supabase Corrective Repository Implementation
 */
export class SupabaseCorrectiveRepository implements CorrectiveRepository {
  readonly backendName = 'supabase' as const;

  async fetchByDataset(datasetId = 'default'): Promise<RepositoryResult<CorrectiveReport[]>> {
    try {
      const records = await fetchCorrectiveFromSupabase(datasetId);
      if (records !== null) {
        return { success: true, data: records };
      }
      return { success: false, data: [], message: 'Supabase corrective fetch returned null' };
    } catch (err: any) {
      return { success: false, data: [], message: err?.message || 'Error fetching corrective from Supabase' };
    }
  }

  async fetchByContext(
    datasetId = 'default',
    operationalDate?: string,
    shift?: string
  ): Promise<RepositoryResult<CorrectiveReport[]>> {
    const res = await this.fetchByDataset(datasetId);
    if (!res.success || !res.data) return res;

    let filtered = res.data;
    if (operationalDate) {
      filtered = filtered.filter((r) => r.corrective_date === operationalDate);
    }
    if (shift) {
      filtered = filtered.filter((r) => !r.shift || r.shift === shift);
    }
    return { success: true, data: filtered };
  }

  async fetchById(idOrEventId: string | number): Promise<RepositoryResult<CorrectiveReport | null>> {
    const res = await this.fetchByDataset();
    if (!res.success || !res.data) return { success: false, data: null };
    const found = res.data.find(
      (r) => r.id === idOrEventId || r.event_id === idOrEventId || r.corrective_code === idOrEventId
    );
    return { success: true, data: found || null };
  }

  async save(
    record: CorrectiveReport,
    equipments: Equipment[] = [],
    locations: Location[] = []
  ): Promise<RepositoryResult<CorrectiveReport>> {
    try {
      const res = await upsertCorrectiveRecordToSupabase(record, equipments, locations);
      if (res.success && res.data) {
        return { success: true, data: res.data };
      }
      return { success: false, message: res.error || 'Failed to save corrective record to Supabase' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error saving corrective record' };
    }
  }

  async delete(
    record: CorrectiveReport
  ): Promise<RepositoryResult<boolean>> {
    try {
      const { deleteCorrectiveRecordFromSupabase } = await import('./supabaseCorrectiveService');
      const res = await deleteCorrectiveRecordFromSupabase(record);
      if (res.success) {
        return { success: true, data: true };
      }
      return { success: false, message: res.message || 'Failed to delete corrective record from Supabase' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error deleting corrective record' };
    }
  }
}

// Singleton instance
const supabaseRepoInstance = new SupabaseCorrectiveRepository();

/**
 * Returns the active Corrective Repository (Supabase).
 */
export function getCorrectiveRepository(): CorrectiveRepository {
  return supabaseRepoInstance;
}
