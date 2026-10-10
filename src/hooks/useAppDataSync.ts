import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PreventiveSession,
  PreventiveEntry,
  CorrectiveReport,
  Equipment,
  EquipmentType,
  Location,
} from '../types';
import {
  INITIAL_PREVENTIVE_ENTRIES,
  INITIAL_CORRECTIVE_REPORTS,
} from '../data/initialData';
import {
  getActivePreventiveRecords,
  dedupePreventiveRecords,
  normalizeShift,
} from '../utils/contextFilter';
import { getPreventiveRepository } from '../services/preventiveRepository';
import { getCorrectiveRepository } from '../services/correctiveRepository';
import { isSupabaseConfigured, getSupabaseClient } from '../lib/supabase';
import { fetchAttendanceHistoryFromServer } from '../services/attendanceService';
import { normalizeCorrectiveIdentity } from '../services/correctiveMapper';
import { safeReadJson, safeWriteJson } from '../services/localCache';
import { localDB } from '../services/indexedDB';
import { offlineSyncService } from '../services/offlineSyncService';
import { toast } from '../components/Toast';
import {
  formatPreventiveTelegramHtml,
  sendTelegramMessage,
  getStoredTelegramConfig,
} from '../services/telegramService';
import { formatPreventiveWhatsAppText } from '../services/whatsappService';

interface UseAppDataSyncProps {
  isLoggedIn: boolean;
  currentUserUid: string | null;
  currentSession: PreventiveSession;
  equipments: Equipment[];
  equipmentTypes: EquipmentType[];
  locations: Location[];
  authStateRef: React.MutableRefObject<{ isAuthenticated: boolean; isAuthorized: boolean }>;
}

export function useAppDataSync({
  isLoggedIn,
  currentUserUid,
  currentSession,
  equipments,
  equipmentTypes,
  locations,
  authStateRef,
}: UseAppDataSyncProps) {
  // Cloud Sync State
  const [activeDatasetId, setActiveDatasetId] = useState<string>(() => {
    return safeReadJson<string>('active_dataset', 'default');
  });

  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'error'>(() => {
    return isSupabaseConfigured() ? 'synced' : 'offline';
  });
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  const [preventiveEntries, setPreventiveEntries] = useState<PreventiveEntry[]>([]);
  const [correctiveReports, setCorrectiveReports] = useState<CorrectiveReport[]>([]);

  // Concurrency & state refs to eliminate re-entrancy loops
  const isSyncingRef = useRef(false);
  const preventiveEntriesRef = useRef(preventiveEntries);
  const correctiveReportsRef = useRef(correctiveReports);

  useEffect(() => {
    preventiveEntriesRef.current = preventiveEntries;
  }, [preventiveEntries]);

  useEffect(() => {
    correctiveReportsRef.current = correctiveReports;
  }, [correctiveReports]);

  // Load cached data when user/dataset/login status changes (Dual layer: localStorage + IndexedDB)
  useEffect(() => {
    if (isLoggedIn) {
      // 1. Read from shared shift cache first, then fallback to user-specific cache
      const sharedCachedPrev = safeReadJson<PreventiveEntry[]>(
        'preventive_entries',
        [],
        'shared',
        activeDatasetId
      );
      const userCachedPrev = currentUserUid
        ? safeReadJson<PreventiveEntry[]>(
            'preventive_entries',
            [],
            currentUserUid,
            activeDatasetId
          )
        : [];
      const combinedRawPrev = sharedCachedPrev.length > 0 ? sharedCachedPrev : userCachedPrev;

      // Filter out any ghost/dummy preventive records
      const cachedPrev = (combinedRawPrev || []).filter(
        (p) => p && !String(p.operational_date || '').includes('1899') && !String(p.submitted_at || '').includes('1899')
      );
      setPreventiveEntries((prev) => (prev.length === cachedPrev.length && JSON.stringify(prev) === JSON.stringify(cachedPrev) ? prev : cachedPrev));

      const sharedCachedCorr = safeReadJson<CorrectiveReport[]>(
        'corrective_reports',
        [],
        'shared',
        activeDatasetId
      );
      const userCachedCorr = currentUserUid
        ? safeReadJson<CorrectiveReport[]>(
            'corrective_reports',
            [],
            currentUserUid,
            activeDatasetId
          )
        : [];
      const combinedRawCorr = sharedCachedCorr.length > 0 ? sharedCachedCorr : userCachedCorr;

      // Filter out invalid/epoch date artifacts
      const cachedCorr = (combinedRawCorr || []).filter(
        (c) => c && !String(c.corrective_date || '').includes('1899')
      );
      setCorrectiveReports((prev) => (prev.length === cachedCorr.length && JSON.stringify(prev) === JSON.stringify(cachedCorr) ? prev : cachedCorr));

      // Asynchronously check IndexedDB for any offline entries that might not fit in localStorage
      localDB.getAllPreventiveEntries(activeDatasetId).then((idbEntries) => {
        if (idbEntries && idbEntries.length > 0) {
          setPreventiveEntries((current) => {
            const merged = [...current];
            for (const item of idbEntries) {
              const existingIdx = merged.findIndex(
                (e) =>
                  Number(e.equipment_id) === Number(item.equipment_id) &&
                  Number(e.checklist_frequency_id) === Number(item.checklist_frequency_id) &&
                  (e.period_key || '').trim() === (item.period_key || '').trim() &&
                  normalizeShift(e.shift) === normalizeShift(item.shift)
              );
              if (existingIdx >= 0) {
                merged[existingIdx] = { ...merged[existingIdx], ...item };
              } else {
                merged.push(item);
              }
            }
            return merged;
          });
        }
      }).catch((err) => console.warn('[IndexedDB] Preventive hydration error:', err));

      localDB.getAllCorrectiveReports(activeDatasetId).then((idbReports) => {
        if (idbReports && idbReports.length > 0) {
          setCorrectiveReports((current) => {
            const merged = [...current];
            for (const item of idbReports) {
              const existingIdx = merged.findIndex(
                (r) => r.event_id === item.event_id || r.id === item.id
              );
              if (existingIdx >= 0) {
                merged[existingIdx] = { ...merged[existingIdx], ...item };
              } else {
                merged.push(item);
              }
            }
            return merged;
          });
        }
      }).catch((err) => console.warn('[IndexedDB] Corrective hydration error:', err));
    } else {
      setPreventiveEntries((prev) => (prev.length === 0 ? prev : []));
      setCorrectiveReports((prev) => (prev.length === 0 ? prev : []));
    }
  }, [isLoggedIn, currentUserUid, activeDatasetId]);

  // Sync active dataset choice to localStorage
  useEffect(() => {
    safeWriteJson('active_dataset', activeDatasetId);
  }, [activeDatasetId]);

  // Sync preventive entries to localStorage (both shared shift cache and user namespace)
  useEffect(() => {
    if (isLoggedIn) {
      safeWriteJson('preventive_entries', preventiveEntries, 'shared', activeDatasetId);
      if (currentUserUid) {
        safeWriteJson('preventive_entries', preventiveEntries, currentUserUid, activeDatasetId);
      }
    }
  }, [preventiveEntries, isLoggedIn, currentUserUid, activeDatasetId]);

  // Sync corrective reports to localStorage (both shared shift cache and user namespace)
  useEffect(() => {
    if (isLoggedIn) {
      safeWriteJson('corrective_reports', correctiveReports, 'shared', activeDatasetId);
      if (currentUserUid) {
        safeWriteJson('corrective_reports', correctiveReports, currentUserUid, activeDatasetId);
      }
    }
  }, [correctiveReports, isLoggedIn, currentUserUid, activeDatasetId]);

  // Cloud Synchronize Handler (Strictly Manual or Triggered on initial load/submit)
  const syncFromCloud = useCallback(async (targetDatasetId?: string, targetUid?: string, isManual = false) => {
    const currentDs = targetDatasetId || activeDatasetId;
    const isSupaConfigured = isSupabaseConfigured();

    if (!isSupaConfigured) {
      setSyncStatus('offline');
      if (isManual) {
        toast.info('Mode Lokal Aktif', {
          message: 'Aplikasi berjalan dalam mode penyimpanan lokal & offline cache.',
          badge: 'Offline',
        });
      }
      return;
    }

    if (isSyncingRef.current) {
      return;
    }

    if (isManual) {
      toast.info('Memulai Sinkronisasi', {
        message: 'Mengambil data checklist inspeksi & perbaikan kerusakan dari cloud...',
        duration: 2500,
        badge: 'Sync',
      });
    }

    const syncUid = targetUid || currentUserUid || '';
    const syncDataset = currentDs;
    const isSessionValid = () => {
      const currentAuthUid = currentUserUid || '';
      const uidMatch = !syncUid || !currentAuthUid || currentAuthUid === syncUid;
      return uidMatch && activeDatasetId === syncDataset;
    };

    isSyncingRef.current = true;
    setSyncStatus('syncing');

    try {
      const prevRepo = getPreventiveRepository();
      const corrRepo = getCorrectiveRepository();

      // 1. Gather unsynced local records
      const localPrev = preventiveEntriesRef.current.filter(
        (e) => (e.dataset_id || 'default') === currentDs && !e.synced
      );
      const localCorr = correctiveReportsRef.current.filter(
        (r) => (r.dataset_id || 'default') === currentDs && !r.synced
      );

      // Push unsynced Preventive
      for (const entry of localPrev) {
        try {
          const res = await prevRepo.save(entry, equipments, equipmentTypes);
          if (!isSessionValid()) return;

          if (res.success && res.data) {
            setPreventiveEntries((prev) =>
              prev.map((item) =>
                item.equipment_id === entry.equipment_id &&
                item.checklist_frequency_id === entry.checklist_frequency_id &&
                (item.period_key || '') === (entry.period_key || '') &&
                (item.shift || '') === (entry.shift || '')
                  ? { ...item, ...res.data, synced: true }
                  : item
              )
            );
          }
        } catch (pushErr) {
          console.warn('[Sync] Push preventive record failed:', pushErr);
        }
      }

      // Push unsynced Corrective
      for (const report of localCorr) {
        try {
          const res = await corrRepo.save(report, equipments, locations);
          if (!isSessionValid()) return;

          if (res.success && res.data) {
            setCorrectiveReports((prev) =>
              prev.map((item) =>
                item.id === report.id || (item.corrective_code && item.corrective_code === report.corrective_code)
                  ? { ...item, ...res.data, synced: true }
                  : item
              )
            );
          }
        } catch (pushErr) {
          console.warn('[Sync] Push corrective record failed:', pushErr);
        }
      }

      // 2. Fetch latest records from Supabase
      const [prevRes, corrRes] = await Promise.all([
        prevRepo.fetchByContext(currentDs),
        corrRepo.fetchByDataset(currentDs),
      ]);

      if (!isSessionValid()) return;

      let latestMergedPrev: PreventiveEntry[] = [];
      if (prevRes.success && Array.isArray(prevRes.data)) {
        const cloudRecords = prevRes.data;
        setPreventiveEntries((localEntries) => {
          const otherDsEntries = localEntries.filter((e) => (e.dataset_id || 'default') !== currentDs);
          const currentDsEntries = localEntries.filter((e) => (e.dataset_id || 'default') === currentDs);

          // 1. Authoritative cloud records from Supabase (Source of Truth)
          const authoritativeCloudEntries = cloudRecords.map((cloudRec) => ({
            ...cloudRec,
            equipment_id: Number(cloudRec.equipment_id),
            checklist_frequency_id: Number(cloudRec.checklist_frequency_id),
            dataset_id: currentDs,
            synced: true,
          }));

          const cloudKeys = new Set(
            authoritativeCloudEntries.map(
              (c) => `${Number(c.equipment_id)}_${Number(c.checklist_frequency_id)}_${(c.period_key || '').trim()}_${normalizeShift(c.shift)}`
            )
          );

          // 2. Only keep genuinely pending offline unsynced drafts (never synced and not in cloud)
          const pendingOfflineEntries = currentDsEntries.filter((e) => {
            if (e.synced) return false;
            const key = `${Number(e.equipment_id)}_${Number(e.checklist_frequency_id)}_${(e.period_key || '').trim()}_${normalizeShift(e.shift)}`;
            return !cloudKeys.has(key);
          });

          const deduplicated = dedupePreventiveRecords([...authoritativeCloudEntries, ...pendingOfflineEntries]);
          latestMergedPrev = deduplicated;

          // 3. Purge obsolete / ghost records from IndexedDB so they never resurrect
          localDB.getAllPreventiveEntries(currentDs).then(async (idbEntries) => {
            const validKeys = new Set(
              deduplicated.map(
                (e) => (e as any).canonical_key || `${e.dataset_id || 'default'}_${Number(e.equipment_id)}_${Number(e.checklist_frequency_id)}_${(e.period_key || '').trim()}_${normalizeShift(e.shift)}`
              )
            );
            for (const idbItem of idbEntries) {
              const itemKey = (idbItem as any).canonical_key || `${idbItem.dataset_id || 'default'}_${Number(idbItem.equipment_id)}_${Number(idbItem.checklist_frequency_id)}_${(idbItem.period_key || '').trim()}_${normalizeShift(idbItem.shift)}`;
              if (!validKeys.has(itemKey)) {
                await localDB.deletePreventiveEntry(itemKey);
              }
            }
          }).catch((err) => console.warn('[IndexedDB] Prune preventive error:', err));

          return [...otherDsEntries, ...deduplicated];
        });
      } else {
        latestMergedPrev = preventiveEntriesRef.current.filter((e) => (e.dataset_id || 'default') === currentDs);
      }

      if (corrRes.success && Array.isArray(corrRes.data)) {
        const cloudReports = corrRes.data!;
        setCorrectiveReports((localReports) => {
          const otherDsReports = localReports.filter((r) => (r.dataset_id || 'default') !== currentDs);
          const currentDsReports = localReports.filter((r) => (r.dataset_id || 'default') === currentDs);

          // 1. Authoritative cloud reports from Supabase (Source of Truth)
          const authoritativeCloudReports = cloudReports.map((cloudReport) => {
            const { event_id: canonicalEventId, document_id: canonicalDocId } = normalizeCorrectiveIdentity(cloudReport, currentDs);
            return {
              ...cloudReport,
              event_id: canonicalEventId,
              document_id: canonicalDocId,
              dataset_id: currentDs,
              synced: true,
            };
          });

          // 2. Only keep genuinely pending offline unsynced drafts (never synced and not in cloud)
          const cloudIds = new Set(authoritativeCloudReports.map((c) => c.id).filter(Boolean));
          const cloudEventIds = new Set(authoritativeCloudReports.map((c) => c.event_id));
          const cloudCodes = new Set(authoritativeCloudReports.map((c) => c.corrective_code).filter(Boolean));

          const pendingOfflineDrafts = currentDsReports.filter((r) => {
            if (r.synced) return false;
            if (r.id && cloudIds.has(r.id)) return false;
            if (r.event_id && cloudEventIds.has(r.event_id)) return false;
            if (r.corrective_code && cloudCodes.has(r.corrective_code)) return false;
            return true;
          });

          const finalCurrentDsReports = [...authoritativeCloudReports, ...pendingOfflineDrafts];

          // 3. Purge obsolete / ghost records from IndexedDB so they never resurrect
          localDB.getAllCorrectiveReports(currentDs).then(async (idbReports) => {
            const validIds = new Set(finalCurrentDsReports.map((r) => r.event_id));
            for (const idbItem of idbReports) {
              if (!validIds.has(idbItem.event_id)) {
                await localDB.deleteCorrectiveReport(idbItem.event_id);
              }
            }
          }).catch((err) => console.warn('[IndexedDB] Prune corrective error:', err));

          return [...otherDsReports, ...finalCurrentDsReports];
        });
      }

      const activeCtx = {
        datasetId: currentDs,
        operationalDate: currentSession.operational_date,
        shift: currentSession.shift,
      };
      getActivePreventiveRecords(
        latestMergedPrev.length > 0 ? latestMergedPrev : preventiveEntriesRef.current,
        activeCtx
      );

      setSyncStatus('synced');
      setLastSyncTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
      if (isManual) {
        toast.sync('Sinkronisasi Berhasil', {
          message: 'Data inspeksi pemeliharaan & perbaikan telah diperbarui.',
          badge: 'Tersinkron',
        });
      }
    } catch (err) {
      console.warn('[Sync] Sync error:', err);
      setSyncStatus('error');
      if (isManual) {
        toast.warning('Sinkronisasi Terkendala', {
          message: 'Gagal memperbarui data dari cloud. Data lokal tetap aman.',
          badge: 'Offline Cache',
        });
      }
    } finally {
      isSyncingRef.current = false;
    }
  }, [activeDatasetId, currentUserUid, equipments, equipmentTypes, locations, currentSession.operational_date, currentSession.shift, authStateRef]);

  // Network recovery listener for automatic offline queue synchronization
  useEffect(() => {
    const unsubscribe = offlineSyncService.subscribeNetworkStatus((isOnline) => {
      if (isOnline && isSupabaseConfigured() && isLoggedIn) {
        offlineSyncService.processSyncQueue({
          onComplete: (count) => {
            if (count > 0) {
              syncFromCloud(activeDatasetId, currentUserUid || undefined, false);
            }
          },
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeDatasetId, currentUserUid, isLoggedIn, syncFromCloud]);

  // Supabase Realtime Channel Subscription (Instant live synchronization between multiple devices)
  useEffect(() => {
    if (!isLoggedIn || !isSupabaseConfigured()) return;

    let channel: any = null;
    try {
      const client = getSupabaseClient();
      channel = client
        .channel(`app_realtime_sync_${activeDatasetId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'preventive_records' },
          () => {
            syncFromCloud(activeDatasetId, currentUserUid || undefined, false);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'preventive_entries' },
          () => {
            syncFromCloud(activeDatasetId, currentUserUid || undefined, false);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'corrective_reports' },
          () => {
            syncFromCloud(activeDatasetId, currentUserUid || undefined, false);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'attendance' },
          () => {
            fetchAttendanceHistoryFromServer().catch(() => {});
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('[Realtime] Subscription error:', err);
    }

    return () => {
      if (channel) {
        try {
          getSupabaseClient().removeChannel(channel);
        } catch (_) {}
      }
    };
  }, [isLoggedIn, activeDatasetId, currentUserUid, syncFromCloud]);

  // Switch Active Dataset Handler
  const handleSwitchDataset = (newDsId: string) => {
    const cleanDsId = newDsId.trim() || 'default';
    setActiveDatasetId(cleanDsId);
    syncFromCloud(cleanDsId);
  };

  // Submit Preventive Entry Handler
  const handleSubmitPreventiveEntry = async (entry: Omit<PreventiveEntry, 'id'> & { id?: number; created_at?: string }) => {
    if (!currentSession.technician_ids || currentSession.technician_ids.length === 0) {
      throw new Error('Gagal submit preventif: Belum ada teknisi on duty yang dipilih.');
    }

    const now = new Date().toISOString();
    const fullEntry: PreventiveEntry = {
      ...entry,
      equipment_id: Number(entry.equipment_id),
      checklist_frequency_id: Number(entry.checklist_frequency_id),
      id: entry.id || Date.now(),
      dataset_id: entry.dataset_id || activeDatasetId,
      operational_date: entry.operational_date || currentSession.operational_date,
      shift: entry.shift || currentSession.shift,
      submitted_by_technician_ids: currentSession.technician_ids,
      created_at: entry.created_at || now,
      updated_at: now,
    };

    // 1. Save locally (Memory state + IndexedDB storage)
    setPreventiveEntries((prev) => {
      const existingIndex = prev.findIndex(
        (e) =>
          Number(e.equipment_id) === Number(fullEntry.equipment_id) &&
          Number(e.checklist_frequency_id) === Number(fullEntry.checklist_frequency_id) &&
          (e.period_key || '').trim() === (fullEntry.period_key || '').trim() &&
          normalizeShift(e.shift) === normalizeShift(fullEntry.shift)
      );

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...fullEntry,
          id: prev[existingIndex].id,
        };
        return updated;
      } else {
        return [...prev, fullEntry];
      }
    });

    // Save to IndexedDB immediately for offline resilience
    await localDB.savePreventiveEntry(fullEntry);

    const targetEq = equipments.find((e) => e.id === Number(fullEntry.equipment_id));
    const equipmentName = targetEq ? targetEq.name : `Unit #${fullEntry.equipment_id}`;
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    // 2. Sync to Supabase or Enqueue for Offline Background Sync
    if (isSupabaseConfigured() && isOnline) {
      setSyncStatus('syncing');
      try {
        const prevRepo = getPreventiveRepository();
        const res = await prevRepo.save(fullEntry, equipments, equipmentTypes);
        if (res.success && res.data) {
          const cloudRecord = res.data;
          setPreventiveEntries((prev) => {
            const idx = prev.findIndex(
              (e) =>
                Number(e.equipment_id) === Number(cloudRecord.equipment_id) &&
                Number(e.checklist_frequency_id) === Number(cloudRecord.checklist_frequency_id) &&
                (e.period_key || '').trim() === (cloudRecord.period_key || '').trim() &&
                normalizeShift(e.shift) === normalizeShift(cloudRecord.shift)
            );
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                ...cloudRecord,
                equipment_id: Number(cloudRecord.equipment_id),
                checklist_frequency_id: Number(cloudRecord.checklist_frequency_id),
                synced: true,
              };
              return updated;
            }
            return prev;
          });

          // Mark as synced in IndexedDB
          await localDB.savePreventiveEntry({ ...fullEntry, ...cloudRecord, synced: true });

          setSyncStatus('synced');
          setLastSyncTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
          const locObj = targetEq ? (locations || []).find((l) => l.id === targetEq.location_id) : undefined;
          const locName = locObj ? locObj.name : '';
          const displayLabel = locName ? `${equipmentName} ${locName}` : equipmentName;

          toast.success(`Preventif ${displayLabel} Tersimpan!`);
        } else {
          const errMsg = res.message || (res as any).error || 'Gagal menyimpan ke server.';
          const isPermissionError =
            errMsg.toLowerCase().includes('ditolak') ||
            errMsg.toLowerCase().includes('off duty') ||
            errMsg.toLowerCase().includes('read only') ||
            errMsg.toLowerCase().includes('hak akses') ||
            errMsg.toLowerCase().includes('piket');

          if (isPermissionError) {
            setSyncStatus('error');
            toast.error('Akses Ditolak', errMsg);
            throw new Error(errMsg);
          }

          // Enqueue for background retry if transient network error
          await localDB.enqueueAction({
            type: 'SAVE_PREVENTIVE',
            payload: fullEntry,
            datasetId: fullEntry.dataset_id || activeDatasetId,
          });
          setSyncStatus('error');
          const locObj = targetEq ? (locations || []).find((l) => l.id === targetEq.location_id) : undefined;
          const locName = locObj ? locObj.name : '';
          const displayLabel = locName ? `${equipmentName} ${locName}` : equipmentName;
          toast.success(`Preventif ${displayLabel} Tersimpan (Lokal)!`);
        }
      } catch (err: any) {
        console.warn('Preventive sync exception:', err);
        const errMsg = err?.message || '';
        if (
          errMsg.toLowerCase().includes('ditolak') ||
          errMsg.toLowerCase().includes('off duty') ||
          errMsg.toLowerCase().includes('read only')
        ) {
          setSyncStatus('error');
          throw err;
        }
        await localDB.enqueueAction({
          type: 'SAVE_PREVENTIVE',
          payload: fullEntry,
          datasetId: fullEntry.dataset_id || activeDatasetId,
        });
        setSyncStatus('error');
        const locObj = targetEq ? (locations || []).find((l) => l.id === targetEq.location_id) : undefined;
        const locName = locObj ? locObj.name : '';
        const displayLabel = locName ? `${equipmentName} ${locName}` : equipmentName;
        toast.success(`Preventif ${displayLabel} Tersimpan (Lokal)!`);
      }
    } else {
      // Offline / Local-first mode: enqueue action in IndexedDB queue
      await localDB.enqueueAction({
        type: 'SAVE_PREVENTIVE',
        payload: fullEntry,
        datasetId: fullEntry.dataset_id || activeDatasetId,
      });
      setSyncStatus('offline');
      const locObj = targetEq ? (locations || []).find((l) => l.id === targetEq.location_id) : undefined;
      const locName = locObj ? locObj.name : '';
      const displayLabel = locName ? `${equipmentName} ${locName}` : equipmentName;
      toast.success(`Preventif ${displayLabel} Tersimpan!`);
    }

    // 3. Broadcast to Telegram Bot in background (silent without extra toast popup)
    try {
      const tgConfig = getStoredTelegramConfig();
      if (tgConfig.enable_bot && tgConfig.auto_notify_preventive !== false) {
        const eqType = targetEq ? equipmentTypes.find((t) => t.id === targetEq.equipment_type_id) : undefined;
        const eqLoc = targetEq ? (locations || []).find((l) => l.id === targetEq.location_id) : undefined;
        const techNames = currentSession.technician_names || [];

        const tgHtml = formatPreventiveTelegramHtml({
          entry: fullEntry,
          equipment: targetEq,
          equipmentType: eqType,
          location: eqLoc,
          technicianNames: techNames,
        });

        sendTelegramMessage({ message: tgHtml, parseMode: 'HTML' }).catch((err) =>
          console.warn('Gagal broadcast preventif ke telegram:', err)
        );
      }
    } catch (tgErr) {
      console.warn('Gagal format pesan telegram preventif:', tgErr);
    }
  };

  // Delete Preventive Entry Handler (Admin/Supervisor Only)
  const handleDeletePreventiveEntry = async (entry: PreventiveEntry) => {
    const targetEq = equipments.find((e) => e.id === Number(entry.equipment_id));
    const equipmentName = targetEq ? targetEq.name : `Unit #${entry.equipment_id}`;
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (isOnline && isSupabaseConfigured()) {
      setSyncStatus('syncing');
      try {
        const prevRepo = getPreventiveRepository();
        const res = await prevRepo.delete(entry, equipments, equipmentTypes);

        if (!res.success) {
          setSyncStatus('error');
          toast.error('Gagal Menghapus Preventif', {
            message: res.message || `Tidak dapat menghapus data ${equipmentName} dari database.`,
            badge: 'Supabase DB',
          });
          return;
        }

        // 1. Backend DB deletion succeeded -> Now clean local React state & IndexedDB
        setPreventiveEntries((prev) =>
          prev.filter((e) => {
            const sameEq = Number(e.equipment_id) === Number(entry.equipment_id);
            const sameFreq = Number(e.checklist_frequency_id) === Number(entry.checklist_frequency_id);
            const samePeriod = (e.period_key || '').trim() === (entry.period_key || '').trim();
            const sameShift = normalizeShift(e.shift) === normalizeShift(entry.shift);
            return !(sameEq && sameFreq && samePeriod && sameShift);
          })
        );

        await localDB.deletePreventiveEntry(entry);

        setSyncStatus('synced');
        setLastSyncTime(new Date().toLocaleTimeString());
        toast.success('Data & Foto Preventif Dihapus', {
          message: `Data inspeksi preventif ${equipmentName} berhasil dihapus dari database.`,
          badge: 'Admin Dashboard',
        });
      } catch (err: any) {
        console.warn('Delete preventive cloud error:', err);
        setSyncStatus('error');
        toast.error('Gagal Menghapus Preventif', {
          message: err?.message || `Terjadi kesalahan saat menghapus data ${equipmentName}.`,
          badge: 'Penyimpanan Database',
        });
      }
    } else {
      // Offline fallback
      setPreventiveEntries((prev) =>
        prev.filter((e) => {
          const sameEq = Number(e.equipment_id) === Number(entry.equipment_id);
          const sameFreq = Number(e.checklist_frequency_id) === Number(entry.checklist_frequency_id);
          const samePeriod = (e.period_key || '').trim() === (entry.period_key || '').trim();
          const sameShift = normalizeShift(e.shift) === normalizeShift(entry.shift);
          return !(sameEq && sameFreq && samePeriod && sameShift);
        })
      );
      await localDB.deletePreventiveEntry(entry);

      toast.success('Data Preventif Dihapus (Lokal)', {
        message: `Data inspeksi preventif ${equipmentName} telah dihapus dari sistem lokal.`,
        badge: 'Penyimpanan Lokal',
      });
    }
  };

  // Add/Update Corrective Handler
  const handleAddCorrective = async (
    report: Omit<CorrectiveReport, 'id'> & { id?: number; created_at?: string }
  ): Promise<{ cloudSynced: boolean; queued: boolean }> => {
    const effectiveTechs =
      report.technicians && report.technicians.length > 0
        ? report.technicians
        : currentSession.technician_names && currentSession.technician_names.length > 0
        ? currentSession.technician_names
        : ['Teknisi'];

    const now = new Date().toISOString();
    const datasetId = report.dataset_id || activeDatasetId;
    const initialReport: CorrectiveReport = {
      ...report,
      id: report.id || Date.now(),
      dataset_id: datasetId,
      corrective_date: report.corrective_date || currentSession.operational_date || now.split('T')[0],
      shift: report.shift || currentSession.shift || 'Pagi',
      technicians: effectiveTechs,
      created_by: report.created_by || effectiveTechs.join(', '),
      created_at: report.created_at || now,
      updated_at: now,
    };

    const { event_id: canonicalEventId, document_id: canonicalDocId } = normalizeCorrectiveIdentity(initialReport, datasetId);
    const newReport: CorrectiveReport = {
      ...initialReport,
      event_id: canonicalEventId,
      document_id: canonicalDocId,
    };

    // 1. Save locally (Memory state + IndexedDB storage)
    setCorrectiveReports((prev) => {
      const existingIndex = prev.findIndex(
        (r) =>
          r.id === newReport.id ||
          r.event_id === newReport.event_id ||
          r.document_id === newReport.document_id ||
          (r.corrective_code && r.corrective_code === newReport.corrective_code)
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...newReport, id: prev[existingIndex].id };
        return updated;
      } else {
        return [newReport, ...prev];
      }
    });

    // Save to IndexedDB immediately for offline resilience
    await localDB.saveCorrectiveReport(newReport);

    const targetCorrEq = equipments.find((e) => e.id === Number(newReport.equipment_id));
    const corrEqName = targetCorrEq ? targetCorrEq.name : 'Peralatan';
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    // 2. Sync to Supabase or Enqueue for Offline Background Sync
    if (isSupabaseConfigured() && isOnline) {
      setSyncStatus('syncing');
      try {
        const corrRepo = getCorrectiveRepository();
        const res = await corrRepo.save(newReport, equipments, locations);
        if (res.success && res.data) {
          const cloudRecord = res.data;
          setCorrectiveReports((prev) => {
            const idx = prev.findIndex(
              (r) =>
                r.id === cloudRecord.id ||
                r.event_id === cloudRecord.event_id ||
                r.document_id === cloudRecord.document_id ||
                (r.corrective_code && r.corrective_code === cloudRecord.corrective_code)
            );
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...cloudRecord, synced: true };
              return updated;
            }
            return prev;
          });

          // Mark as synced in IndexedDB
          await localDB.saveCorrectiveReport({ ...newReport, ...cloudRecord, synced: true });

          setSyncStatus('synced');
          setLastSyncTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
          toast.success('Laporan Gangguan Disimpan', {
            message: `Laporan perbaikan ${corrEqName} berhasil disimpan & disinkronkan ke database.`,
            badge: 'Tersinkron Cloud',
          });
          return { cloudSynced: true, queued: false };
        } else {
          // Enqueue for background retry
          await localDB.enqueueAction({
            type: 'SAVE_CORRECTIVE',
            payload: newReport,
            datasetId: newReport.dataset_id || activeDatasetId,
          });
          setSyncStatus('error');
          toast.warning('Laporan Disimpan di IndexedDB', {
            message: `Laporan perbaikan ${corrEqName} tersimpan offline di database lokal. Akan disinkronkan otomatis saat online.`,
            badge: 'IndexedDB Offline',
          });
          return { cloudSynced: false, queued: true };
        }
      } catch (err) {
        console.warn('Corrective sync exception:', err);
        await localDB.enqueueAction({
          type: 'SAVE_CORRECTIVE',
          payload: newReport,
          datasetId: newReport.dataset_id || activeDatasetId,
        });
        setSyncStatus('error');
        toast.warning('Laporan Disimpan di IndexedDB', {
          message: `Laporan perbaikan ${corrEqName} tersimpan offline di database lokal. Akan disinkronkan otomatis saat online.`,
          badge: 'IndexedDB Offline',
        });
        return { cloudSynced: false, queued: true };
      }
    } else {
      // Offline / Local-first mode: enqueue action in IndexedDB queue
      await localDB.enqueueAction({
        type: 'SAVE_CORRECTIVE',
        payload: newReport,
        datasetId: newReport.dataset_id || activeDatasetId,
      });
      setSyncStatus('offline');
      toast.warning('Laporan Disimpan di IndexedDB (Offline)', {
        message: `Koneksi offline: Laporan perbaikan ${corrEqName} tersimpan aman di IndexedDB perangkat & akan disinkronkan saat terhubung kembali.`,
        badge: 'IndexedDB Offline',
        duration: 4500,
      });
      return { cloudSynced: false, queued: true };
    }
  };

  // Delete Corrective Report Handler (Supervisor Only)
  const handleDeleteCorrectiveReport = async (report: CorrectiveReport) => {
    const targetCorrEq = equipments.find((e) => e.id === Number(report.equipment_id));
    const corrEqName = targetCorrEq ? targetCorrEq.name : 'Peralatan';
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (isOnline && isSupabaseConfigured()) {
      setSyncStatus('syncing');
      try {
        const corrRepo = getCorrectiveRepository();
        const res = await corrRepo.delete(report, equipments, locations);
        if (!res.success) {
          setSyncStatus('error');
          toast.error('Gagal Menghapus Corrective', {
            message: res.message || `Tidak dapat menghapus data ${corrEqName} dari database.`,
            badge: 'Supabase DB',
          });
          return;
        }

        // 1. Backend DB deletion succeeded -> Now clean local React state & IndexedDB
        setCorrectiveReports((prev) =>
          prev.filter((r) => r.id !== report.id && r.corrective_code !== report.corrective_code)
        );

        await localDB.deleteCorrectiveReport(report.event_id || String(report.id));

        setSyncStatus('synced');
        setLastSyncTime(new Date().toLocaleTimeString());
        toast.success('Data Corrective Dihapus', {
          message: `Laporan perbaikan ${corrEqName} (${report.corrective_code}) berhasil dihapus dari database.`,
          badge: 'Supervisor',
        });
      } catch (err: any) {
        console.warn('Delete corrective cloud error:', err);
        setSyncStatus('error');
        toast.error('Gagal Menghapus Corrective', {
          message: err?.message || `Terjadi kesalahan saat menghapus data ${corrEqName}.`,
        });
      }
    } else {
      // Offline fallback
      setCorrectiveReports((prev) =>
        prev.filter((r) => r.id !== report.id && r.corrective_code !== report.corrective_code)
      );
      await localDB.deleteCorrectiveReport(report.event_id || String(report.id));
      toast.success('Data Corrective Dihapus (Lokal)', {
        message: `Laporan perbaikan ${corrEqName} telah dihapus dari sistem lokal.`,
      });
    }
  };

  const clearDataOnLogout = useCallback(() => {
    setPreventiveEntries([]);
    setCorrectiveReports([]);
  }, []);

  return {
    activeDatasetId,
    syncStatus,
    lastSyncTime,
    preventiveEntries,
    correctiveReports,
    setPreventiveEntries,
    setCorrectiveReports,
    syncFromCloud,
    handleSwitchDataset,
    handleSubmitPreventiveEntry,
    handleDeletePreventiveEntry,
    handleAddCorrective,
    handleDeleteCorrectiveReport,
    clearDataOnLogout,
  };
}
