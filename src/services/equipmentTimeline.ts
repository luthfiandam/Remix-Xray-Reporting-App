import { PreventiveEntry, CorrectiveReport, ShiftType } from '../types';
import { fetchPreventiveRecordsFromSupabase } from './supabasePreventiveService';
import { fetchCorrectiveFromSupabase } from './supabaseCorrectiveService';
import { fetchComponentReplacements, isDummyReplacement } from './componentReplacementService';
import { safeReadJson } from './localCache';
import { localDB } from './indexedDB';
import { ComponentReplacement } from '../types';

export interface EquipmentTimelineItem {
  id: string;
  source: 'preventive' | 'corrective' | 'component';
  event_date: string;       // YYYY-MM-DD
  operational_date: string; // YYYY-MM-DD
  shift: ShiftType;         // 'Pagi' | 'Malam'
  title: string;            // e.g., "Preventif Bulanan", "Corrective CR-...", "Penggantian Detector Board"
  summary?: string;         // Notes or problem description
  technicians: string[];    // Technician names
  status?: string;          // Completed, Resolved, etc.
  created_at?: string;      // For tie breaker
  source_document_id: string;
  rawPreventive?: PreventiveEntry;
  rawCorrective?: CorrectiveReport;
  rawComponent?: ComponentReplacement;
}

/**
 * Normalizes a preventive entry into a timeline item.
 */
export function mapPreventiveToTimelineItem(entry: PreventiveEntry, frequencyLabel: string): EquipmentTimelineItem {
  const techniciansMapped = entry.submitted_by_technician_ids?.map(String) || [];
  return {
    id: `prev_${entry.id}`,
    source: 'preventive',
    event_date: entry.operational_date || '',
    operational_date: entry.operational_date || '',
    shift: entry.shift || 'Pagi',
    title: `Preventif ${frequencyLabel}`,
    summary: entry.notes || '-',
    technicians: techniciansMapped,
    status: entry.status === 'OK' ? 'Completed' : entry.status || 'Completed',
    created_at: entry.created_at || entry.submitted_at || '',
    source_document_id: String(entry.id),
    rawPreventive: entry,
  };
}

/**
 * Normalizes a corrective report into a timeline item.
 */
export function mapCorrectiveToTimelineItem(report: CorrectiveReport): EquipmentTimelineItem {
  return {
    id: `corr_${report.id || report.event_id}`,
    source: 'corrective',
    event_date: report.corrective_date || '',
    operational_date: report.corrective_date || '',
    shift: report.shift || 'Pagi',
    title: `Corrective ${report.corrective_code || ''}`,
    summary: report.problem_description || '-',
    technicians: report.technicians || [],
    status: report.result || 'Resolved',
    created_at: report.created_at || '',
    source_document_id: String(report.id || report.event_id || ''),
    rawCorrective: report,
  };
}

/**
 * Normalizes a component replacement into a timeline item.
 */
export function mapComponentToTimelineItem(replacement: ComponentReplacement): EquipmentTimelineItem {
  return {
    id: `comp_${replacement.id}`,
    source: 'component',
    event_date: replacement.replaced_at || '',
    operational_date: replacement.replaced_at || '',
    shift: 'Pagi',
    title: `Penggantian Komponen: ${replacement.component_name}`,
    summary: `${replacement.reason || 'Penggantian spare part'} ${replacement.origin ? `(${replacement.origin})` : ''} ${replacement.serial_number ? `• S/N: ${replacement.serial_number}` : ''}`,
    technicians: replacement.technician_names || [],
    status: 'Installed',
    created_at: replacement.created_at || replacement.replaced_at || '',
    source_document_id: String(replacement.id),
    rawComponent: replacement,
  };
}

/**
 * Sorting function for timeline items: Newest first.
 * Priority: operational_date desc, event_date desc, created_at desc
 */
export function sortTimelineItems(items: EquipmentTimelineItem[]): EquipmentTimelineItem[] {
  return [...items].sort((a, b) => {
    // Compare operational_date desc
    if (a.operational_date !== b.operational_date) {
      return b.operational_date.localeCompare(a.operational_date);
    }
    // Compare event_date/corrective_date desc
    if (a.event_date !== b.event_date) {
      return b.event_date.localeCompare(a.event_date);
    }
    // Compare created_at desc (tie breaker)
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
}

/**
 * Fetches equipment timeline from Supabase and local cache, merging:
 * 1. Preventive records for target equipment
 * 2. Corrective reports for target equipment
 * 3. Component replacement records for target equipment
 */
export async function fetchEquipmentTimelineFromFirestore(
  equipmentId: number,
  datasetId: string,
  frequencyMap: Record<number, string> = {}
): Promise<{ success: boolean; data: EquipmentTimelineItem[]; message?: string }> {
  try {
    const cleanDataset = (datasetId || 'default').trim();
    const targetEqId = Number(equipmentId);

    // 1. Fetch Preventive from Supabase (fallback to local if null or empty)
    let preventiveList: PreventiveEntry[] = [];
    const remotePrev = await fetchPreventiveRecordsFromSupabase(cleanDataset);
    if (remotePrev && remotePrev.length > 0) {
      preventiveList = remotePrev;
    } else {
      // Fallback: namespaced localCache, IndexedDB, and raw localStorage
      const cached = safeReadJson<PreventiveEntry[]>('preventive_entries', [], null, cleanDataset);
      if (cached && cached.length > 0) {
        preventiveList = cached;
      } else {
        try {
          const idbPrev = await localDB.getAllPreventiveEntries(cleanDataset);
          if (idbPrev && idbPrev.length > 0) {
            preventiveList = idbPrev;
          }
        } catch (_) {}
      }

      if (preventiveList.length === 0) {
        const local = localStorage.getItem('preventive_entries');
        if (local) {
          try {
            preventiveList = JSON.parse(local);
          } catch (_) {}
        }
      }
    }

    const prevItems: EquipmentTimelineItem[] = (preventiveList || [])
      .filter((e) => e && Number(e.equipment_id) === targetEqId && !String(e.operational_date || '').includes('1899'))
      .map((entry) => {
        const freqLabel = frequencyMap[entry.checklist_frequency_id] || 'Harian';
        return mapPreventiveToTimelineItem(entry, freqLabel);
      });

    // 2. Fetch Corrective from Supabase (fallback to local if null or empty)
    let correctiveList: CorrectiveReport[] = [];
    const remoteCorr = await fetchCorrectiveFromSupabase(cleanDataset);
    if (remoteCorr && remoteCorr.length > 0) {
      correctiveList = remoteCorr;
    } else {
      const cachedCorr = safeReadJson<CorrectiveReport[]>('corrective_reports', [], null, cleanDataset);
      if (cachedCorr && cachedCorr.length > 0) {
        correctiveList = cachedCorr;
      } else {
        try {
          const idbCorr = await localDB.getAllCorrectiveReports(cleanDataset);
          if (idbCorr && idbCorr.length > 0) {
            correctiveList = idbCorr;
          }
        } catch (_) {}
      }

      if (correctiveList.length === 0) {
        const local = localStorage.getItem('corrective_reports');
        if (local) {
          try {
            correctiveList = JSON.parse(local);
          } catch (_) {}
        }
      }
    }

    const corrItems: EquipmentTimelineItem[] = (correctiveList || [])
      .filter((c) => c && Number(c.equipment_id) === targetEqId)
      .map((report) => mapCorrectiveToTimelineItem(report));

    // 3. Fetch Component Replacements
    const components = await fetchComponentReplacements(targetEqId);
    const compItems: EquipmentTimelineItem[] = (components || [])
      .filter((c) => !isDummyReplacement(c))
      .map((comp) => mapComponentToTimelineItem(comp));

    // Merge and sort newest first
    const combined = sortTimelineItems([...prevItems, ...corrItems, ...compItems]);

    return {
      success: true,
      data: combined,
    };
  } catch (err: any) {
    console.error('[fetchEquipmentTimeline] Error:', err);
    return {
      success: false,
      data: [],
      message: err.message || 'Gagal memuat riwayat timeline.',
    };
  }
}
