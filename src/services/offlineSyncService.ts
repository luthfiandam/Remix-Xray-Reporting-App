/**
 * X-RAY REPORTING APP — OFFLINE SYNC SERVICE
 * Orchestrates IndexedDB local-first queue synchronization,
 * online/offline state transitions, and toast notifications.
 */

import { localDB, OfflineSyncAction } from './indexedDB';
import { getPreventiveRepository } from './preventiveRepository';
import { getCorrectiveRepository } from './correctiveRepository';
import { isSupabaseConfigured } from '../lib/supabase';
import { toast } from '../components/Toast';

type NetworkStatusListener = (isOnline: boolean) => void;
const networkListeners = new Set<NetworkStatusListener>();

class OfflineSyncService {
  private isProcessingQueue = false;
  private isOnlineState = typeof navigator !== 'undefined' ? navigator.onLine : true;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  public get isOnline(): boolean {
    if (typeof navigator !== 'undefined') {
      return navigator.onLine;
    }
    return this.isOnlineState;
  }

  public subscribeNetworkStatus(listener: NetworkStatusListener): () => void {
    networkListeners.add(listener);
    // Emit initial status
    listener(this.isOnline);
    return () => {
      networkListeners.delete(listener);
    };
  }

  private handleOffline = () => {
    this.isOnlineState = false;
    networkListeners.forEach((fn) => fn(false));

    toast.warning('Mode Offline Terdeteksi', {
      message: 'Koneksi internet terputus. Seluruh checklist inspeksi & perbaikan tetap tersimpan otomatis di perangkat (IndexedDB) dan disinkronkan saat terhubung kembali.',
      duration: 5000,
      badge: 'Offline Storage',
    });
  };

  private handleOnline = () => {
    this.isOnlineState = true;
    networkListeners.forEach((fn) => fn(true));

    toast.success('Koneksi Internet Pulih', {
      message: 'Perangkat kembali terhubung. Memulai sinkronisasi otomatis antrean data lokal ke database...',
      duration: 4000,
      badge: 'Auto Sync',
    });

    // Automatically trigger queue processing on reconnection
    this.processSyncQueue();
  };

  /**
   * Process all pending actions stored in IndexedDB queue
   */
  public async processSyncQueue(options?: { silent?: boolean; onComplete?: (syncedCount: number) => void }): Promise<number> {
    if (this.isProcessingQueue) return 0;
    if (!this.isOnline || !isSupabaseConfigured()) return 0;

    const queue = await localDB.getPendingQueue();
    if (queue.length === 0) return 0;

    this.isProcessingQueue = true;
    let syncedCount = 0;

    try {
      const prevRepo = getPreventiveRepository();
      const corrRepo = getCorrectiveRepository();

      for (const item of queue) {
        try {
          let success = false;

          switch (item.type) {
            case 'SAVE_PREVENTIVE': {
              const res = await prevRepo.save(item.payload);
              if (res.success) {
                // Update local status in IndexedDB
                await localDB.savePreventiveEntry({ ...item.payload, synced: true });
                success = true;
              }
              break;
            }
            case 'DELETE_PREVENTIVE': {
              const res = await prevRepo.delete(item.payload);
              if (res.success) {
                await localDB.deletePreventiveEntry(item.payload);
                success = true;
              }
              break;
            }
            case 'SAVE_CORRECTIVE': {
              const res = await corrRepo.save(item.payload);
              if (res.success) {
                await localDB.saveCorrectiveReport({ ...item.payload, synced: true });
                success = true;
              }
              break;
            }
          }

          if (success) {
            await localDB.removeQueueItem(item.id);
            syncedCount++;
          } else {
            // Increment retry count
            item.retryCount += 1;
            item.lastError = 'Gagal sinkronisasi ke cloud';
            await localDB.updateQueueItem(item);
          }
        } catch (err: any) {
          console.warn('[OfflineSync] Item processing failed:', item.id, err);
          item.retryCount += 1;
          item.lastError = err?.message || 'Exception during queue sync';
          await localDB.updateQueueItem(item);
        }
      }

      if (syncedCount > 0 && !options?.silent) {
        toast.sync('Sinkronisasi Berhasil', {
          message: `${syncedCount} data perubahan lokal berhasil diunggah dan disinkronkan ke database.`,
          duration: 3500,
          badge: 'Tersinkron Cloud',
        });
      }

      if (options?.onComplete) {
        options.onComplete(syncedCount);
      }
    } catch (globalErr) {
      console.warn('[OfflineSync] Queue processing error:', globalErr);
    } finally {
      this.isProcessingQueue = false;
    }

    return syncedCount;
  }
}

export const offlineSyncService = new OfflineSyncService();
