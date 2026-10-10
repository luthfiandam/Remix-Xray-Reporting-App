/**
 * X-RAY REPORTING APP — LOCAL-FIRST INDEXEDDB PERSISTENCE ENGINE
 * High-capacity offline database for Preventive & Corrective entries,
 * Master Data, Photo Evidences, and Sync Queue.
 */

import { PreventiveEntry, CorrectiveReport, Equipment, EquipmentType, Location, ChecklistItem, ChecklistFrequency } from '../types';

const DB_NAME = 'nti_xray_local_db';
const DB_VERSION = 3;

export interface OfflineSyncAction {
  id: string;
  type: 'SAVE_PREVENTIVE' | 'DELETE_PREVENTIVE' | 'SAVE_CORRECTIVE' | 'DELETE_CORRECTIVE';
  payload: any;
  datasetId: string;
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

export type PhotoUploadStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'COMPLETED';

export interface OfflinePhotoRecord {
  id: string; // Stable unique ID e.g. prev_${userId}_${entityId}_${index}
  userId?: string; // Per-user isolation for shared mobile devices
  entityId: string; // Report ID / equipmentCode / eventId
  category: string; // e.g. 'preventif', 'kolase', 'corrective'
  caption?: string;
  fileName?: string;
  folderPath?: string;
  dataUrl: string; // Base64 or Blob URL of compressed/original image
  timestamp: number;
  status: PhotoUploadStatus;
  synced: boolean;
  s3Url?: string;
  s3Key?: string;
  retryCount: number;
  lastError?: string;
  metadataSynced?: boolean;
}

export interface StorageQuotaInfo {
  quota?: number;
  usage?: number;
  percentUsed?: number;
  isLowSpace: boolean;
}

class IndexedDBManager {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Initializes and returns the IndexedDB instance
   */
  public async getDB(): Promise<IDBDatabase> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      throw new Error('IndexedDB is not supported in this environment');
    }

    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // 1. Preventive entries store
          if (!db.objectStoreNames.contains('preventive_entries')) {
            const store = db.createObjectStore('preventive_entries', { keyPath: 'canonical_key' });
            store.createIndex('dataset_id', 'dataset_id', { unique: false });
            store.createIndex('equipment_id', 'equipment_id', { unique: false });
            store.createIndex('operational_date', 'operational_date', { unique: false });
            store.createIndex('synced', 'synced', { unique: false });
          }

          // 2. Corrective reports store
          if (!db.objectStoreNames.contains('corrective_reports')) {
            const store = db.createObjectStore('corrective_reports', { keyPath: 'event_id' });
            store.createIndex('dataset_id', 'dataset_id', { unique: false });
            store.createIndex('equipment_id', 'equipment_id', { unique: false });
            store.createIndex('corrective_date', 'corrective_date', { unique: false });
            store.createIndex('synced', 'synced', { unique: false });
          }

          // 3. Master data cache store
          if (!db.objectStoreNames.contains('master_cache')) {
            db.createObjectStore('master_cache', { keyPath: 'key' });
          }

          // 4. Offline sync queue store
          if (!db.objectStoreNames.contains('sync_queue')) {
            const store = db.createObjectStore('sync_queue', { keyPath: 'id' });
            store.createIndex('createdAt', 'createdAt', { unique: false });
            store.createIndex('type', 'type', { unique: false });
          }

          // 5. Offline photos store (handles high-res base64 without localStorage 5MB quota)
          let photoStore: IDBObjectStore;
          if (!db.objectStoreNames.contains('offline_photos')) {
            photoStore = db.createObjectStore('offline_photos', { keyPath: 'id' });
            photoStore.createIndex('entityId', 'entityId', { unique: false });
            photoStore.createIndex('synced', 'synced', { unique: false });
            photoStore.createIndex('userId', 'userId', { unique: false });
            photoStore.createIndex('status', 'status', { unique: false });
          } else {
            photoStore = (event.target as any).transaction.objectStore('offline_photos');
            if (!photoStore.indexNames.contains('userId')) {
              photoStore.createIndex('userId', 'userId', { unique: false });
            }
            if (!photoStore.indexNames.contains('status')) {
              photoStore.createIndex('status', 'status', { unique: false });
            }
          }

          // 6. Form Drafts store (isolated by userId + formKey)
          if (!db.objectStoreNames.contains('drafts')) {
            const draftStore = db.createObjectStore('drafts', { keyPath: 'key' });
            draftStore.createIndex('userId', 'userId', { unique: false });
            draftStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          console.error('[IndexedDB] Database open error:', request.error);
          reject(request.error);
        };
      });
    }

    return this.dbPromise;
  }

  // ==========================================
  // PREVENTIVE ENTRIES METHODS
  // ==========================================

  private getPreventiveCanonicalKey(entry: Partial<PreventiveEntry>): string {
    const ds = (entry.dataset_id || 'default').trim();
    const eqId = entry.equipment_id;
    const freqId = entry.checklist_frequency_id;
    const period = (entry.period_key || '').trim();
    const shift = (entry.shift || 'Shift 1').trim();
    return `${ds}__${eqId}__${freqId}__${period}__${shift}`;
  }

  public async savePreventiveEntry(entry: PreventiveEntry): Promise<void> {
    try {
      const db = await this.getDB();
      const canonicalKey = this.getPreventiveCanonicalKey(entry);
      const record = {
        ...entry,
        canonical_key: canonicalKey,
        saved_locally_at: Date.now(),
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction('preventive_entries', 'readwrite');
        const store = tx.objectStore('preventive_entries');
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error saving preventive entry:', err);
    }
  }

  public async getAllPreventiveEntries(datasetId?: string): Promise<PreventiveEntry[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('preventive_entries', 'readonly');
        const store = tx.objectStore('preventive_entries');
        const req = store.getAll();
        req.onsuccess = () => {
          let results: PreventiveEntry[] = req.result || [];
          if (datasetId) {
            results = results.filter((r) => (r.dataset_id || 'default') === datasetId);
          }
          resolve(results);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error fetching preventive entries:', err);
      return [];
    }
  }

  public async deletePreventiveEntry(entry: PreventiveEntry): Promise<void> {
    try {
      const db = await this.getDB();
      const canonicalKey = this.getPreventiveCanonicalKey(entry);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('preventive_entries', 'readwrite');
        const store = tx.objectStore('preventive_entries');
        const req = store.delete(canonicalKey);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error deleting preventive entry:', err);
    }
  }

  // ==========================================
  // CORRECTIVE REPORTS METHODS
  // ==========================================

  public async saveCorrectiveReport(report: CorrectiveReport): Promise<void> {
    try {
      const db = await this.getDB();
      const eventId = report.event_id || `corr_${report.id || Date.now()}`;
      const record = {
        ...report,
        event_id: eventId,
        saved_locally_at: Date.now(),
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction('corrective_reports', 'readwrite');
        const store = tx.objectStore('corrective_reports');
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error saving corrective report:', err);
    }
  }

  public async getAllCorrectiveReports(datasetId?: string): Promise<CorrectiveReport[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('corrective_reports', 'readonly');
        const store = tx.objectStore('corrective_reports');
        const req = store.getAll();
        req.onsuccess = () => {
          let results: CorrectiveReport[] = req.result || [];
          if (datasetId) {
            results = results.filter((r) => (r.dataset_id || 'default') === datasetId);
          }
          resolve(results);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error fetching corrective reports:', err);
      return [];
    }
  }

  public async deleteCorrectiveReport(eventId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('corrective_reports', 'readwrite');
        const store = tx.objectStore('corrective_reports');
        const req = store.delete(eventId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error deleting corrective report:', err);
    }
  }

  // ==========================================
  // MASTER DATA CACHE METHODS
  // ==========================================

  public async setMasterCache<T>(key: string, data: T): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('master_cache', 'readwrite');
        const store = tx.objectStore('master_cache');
        const req = store.put({ key, data, updatedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error setting master cache:', err);
    }
  }

  public async getMasterCache<T>(key: string): Promise<T | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('master_cache', 'readonly');
        const store = tx.objectStore('master_cache');
        const req = store.get(key);
        req.onsuccess = () => {
          resolve(req.result ? req.result.data : null);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error getting master cache:', err);
      return null;
    }
  }

  // ==========================================
  // SYNC QUEUE METHODS
  // ==========================================

  public async enqueueAction(action: Omit<OfflineSyncAction, 'id' | 'createdAt' | 'retryCount'>): Promise<string> {
    try {
      const db = await this.getDB();
      const id = `queue_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const queueItem: OfflineSyncAction = {
        ...action,
        id,
        createdAt: Date.now(),
        retryCount: 0,
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction('sync_queue', 'readwrite');
        const store = tx.objectStore('sync_queue');
        const req = store.put(queueItem);
        req.onsuccess = () => resolve(id);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error enqueuing sync action:', err);
      return '';
    }
  }

  public async getPendingQueue(): Promise<OfflineSyncAction[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sync_queue', 'readonly');
        const store = tx.objectStore('sync_queue');
        const req = store.getAll();
        req.onsuccess = () => {
          const items: OfflineSyncAction[] = req.result || [];
          // Sort oldest first
          items.sort((a, b) => a.createdAt - b.createdAt);
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error getting pending queue:', err);
      return [];
    }
  }

  public async removeQueueItem(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sync_queue', 'readwrite');
        const store = tx.objectStore('sync_queue');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error removing queue item:', err);
    }
  }

  public async updateQueueItem(item: OfflineSyncAction): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sync_queue', 'readwrite');
        const store = tx.objectStore('sync_queue');
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error updating queue item:', err);
    }
  }

  // ==========================================
  // HIGH-RES PHOTO CACHE METHODS & STATUS
  // ==========================================

  public async savePhoto(record: OfflinePhotoRecord): Promise<boolean> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('offline_photos', 'readwrite');
        const store = tx.objectStore('offline_photos');
        const req = store.put({
          ...record,
          timestamp: record.timestamp || Date.now(),
          status: record.status || 'PENDING',
          retryCount: record.retryCount || 0,
        });
        req.onsuccess = () => resolve(true);
        req.onerror = () => {
          console.warn('[IndexedDB] savePhoto request error:', req.error);
          resolve(false);
        };
      });
    } catch (err) {
      console.warn('[IndexedDB] Error saving photo to IndexedDB:', err);
      return false;
    }
  }

  public async updatePhotoStatus(
    id: string,
    status: PhotoUploadStatus,
    updates?: Partial<OfflinePhotoRecord>
  ): Promise<boolean> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offline_photos', 'readwrite');
        const store = tx.objectStore('offline_photos');
        const getReq = store.get(id);

        getReq.onsuccess = () => {
          const existing: OfflinePhotoRecord = getReq.result;
          if (!existing) {
            resolve(false);
            return;
          }
          const updated: OfflinePhotoRecord = {
            ...existing,
            ...updates,
            status,
            synced: status === 'UPLOADED' || status === 'COMPLETED',
          };
          const putReq = store.put(updated);
          putReq.onsuccess = () => resolve(true);
          putReq.onerror = () => resolve(false);
        };

        getReq.onerror = () => resolve(false);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error updating photo status:', err);
      return false;
    }
  }

  public async getPhotoById(id: string): Promise<OfflinePhotoRecord | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offline_photos', 'readonly');
        const store = tx.objectStore('offline_photos');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error getting photo by id:', err);
      return null;
    }
  }

  public async getPhotosForEntity(entityId: string, userId?: string): Promise<OfflinePhotoRecord[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offline_photos', 'readonly');
        const store = tx.objectStore('offline_photos');
        const index = store.index('entityId');
        const req = index.getAll(entityId);
        req.onsuccess = () => {
          let list: OfflinePhotoRecord[] = req.result || [];
          if (userId) {
            list = list.filter((p) => !p.userId || p.userId === userId);
          }
          resolve(list);
        };
        req.onerror = () => resolve([]);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error getting photos for entity:', err);
      return [];
    }
  }

  public async getPhotosForUser(userId: string): Promise<OfflinePhotoRecord[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offline_photos', 'readonly');
        const store = tx.objectStore('offline_photos');
        if (store.indexNames.contains('userId')) {
          const index = store.index('userId');
          const req = index.getAll(userId);
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } else {
          const req = store.getAll();
          req.onsuccess = () => {
            const all: OfflinePhotoRecord[] = req.result || [];
            resolve(all.filter((p) => p.userId === userId));
          };
          req.onerror = () => resolve([]);
        }
      });
    } catch (err) {
      console.warn('[IndexedDB] Error getting photos for user:', err);
      return [];
    }
  }

  public async getPendingOrFailedPhotos(userId?: string): Promise<OfflinePhotoRecord[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offline_photos', 'readonly');
        const store = tx.objectStore('offline_photos');
        const req = store.getAll();
        req.onsuccess = () => {
          let all: OfflinePhotoRecord[] = req.result || [];
          if (userId) {
            all = all.filter((p) => !p.userId || p.userId === userId);
          }
          // Filter only PENDING, UPLOADING, or FAILED
          const pendingOrFailed = all.filter(
            (p) => p.status === 'PENDING' || p.status === 'UPLOADING' || p.status === 'FAILED'
          );
          resolve(pendingOrFailed);
        };
        req.onerror = () => resolve([]);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error getting pending or failed photos:', err);
      return [];
    }
  }

  public async recoverOrphanedUploadingPhotos(userId?: string): Promise<number> {
    try {
      const db = await this.getDB();
      const orphaned = await new Promise<OfflinePhotoRecord[]>((resolve) => {
        const tx = db.transaction('offline_photos', 'readonly');
        const store = tx.objectStore('offline_photos');
        const req = store.getAll();
        req.onsuccess = () => {
          const all: OfflinePhotoRecord[] = req.result || [];
          const now = Date.now();
          // Photos that were left in UPLOADING status for more than 90 seconds (abrupt browser close or reload)
          const target = all.filter(
            (p) => p.status === 'UPLOADING' && (!userId || p.userId === userId) && now - p.timestamp > 90000
          );
          resolve(target);
        };
        req.onerror = () => resolve([]);
      });

      if (orphaned.length === 0) return 0;

      const tx = db.transaction('offline_photos', 'readwrite');
      const store = tx.objectStore('offline_photos');
      for (const photo of orphaned) {
        photo.status = 'PENDING';
        photo.lastError = 'Upload terputus (aplikasi ditutup saat upload). Siap di-retry.';
        store.put(photo);
      }
      return orphaned.length;
    } catch (err) {
      console.warn('[IndexedDB] Error recovering orphaned photos:', err);
      return 0;
    }
  }

  public async deletePhoto(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offline_photos', 'readwrite');
        const store = tx.objectStore('offline_photos');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (_) {}
  }

  // ==========================================
  // FORM DRAFTS PERSISTENCE (ISOLATED BY USER)
  // ==========================================

  public async saveDraft(key: string, data: any, userId: string = 'global'): Promise<boolean> {
    try {
      const db = await this.getDB();
      const storageKey = `draft_${userId}_${key}`;
      return new Promise((resolve) => {
        const tx = db.transaction('drafts', 'readwrite');
        const store = tx.objectStore('drafts');
        const req = store.put({
          key: storageKey,
          userId,
          rawKey: key,
          data,
          updatedAt: Date.now(),
        });
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error saving draft:', err);
      return false;
    }
  }

  public async getDraft<T>(key: string, userId: string = 'global'): Promise<T | null> {
    try {
      const db = await this.getDB();
      const storageKey = `draft_${userId}_${key}`;
      return new Promise((resolve) => {
        const tx = db.transaction('drafts', 'readonly');
        const store = tx.objectStore('drafts');
        const req = store.get(storageKey);
        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result.data as T);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch (err) {
      console.warn('[IndexedDB] Error getting draft:', err);
      return null;
    }
  }

  public async clearDraft(key: string, userId: string = 'global'): Promise<void> {
    try {
      const db = await this.getDB();
      const storageKey = `draft_${userId}_${key}`;
      return new Promise((resolve) => {
        const tx = db.transaction('drafts', 'readwrite');
        const store = tx.objectStore('drafts');
        const req = store.delete(storageKey);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (_) {}
  }

  // ==========================================
  // STORAGE QUOTA ESTIMATION
  // ==========================================

  public async checkStorageQuota(): Promise<StorageQuotaInfo> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const quota = estimate.quota || 0;
        const usage = estimate.usage || 0;
        const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
        return {
          quota,
          usage,
          percentUsed: Math.round(percentUsed * 10) / 10,
          isLowSpace: percentUsed > 85,
        };
      } catch (_) {}
    }
    return { isLowSpace: false };
  }
}

export const localDB = new IndexedDBManager();
