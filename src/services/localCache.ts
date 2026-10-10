/**
 * X-RAY REPORTING APP — v0.6.5
 * CENTRAL RUNTIME CACHE STABILIZATION & CLIENT STATE HARDENING
 */

import { PreventiveEntry, CorrectiveReport } from '../types';
import { localDB } from './indexedDB';

const CACHE_PREFIX = 'nti_';
const CACHE_SCHEMA_VERSION = 'v1';

/**
 * Generates a fully isolated, namespaced cache key based on User UID and Dataset ID.
 */
export function getNamespacedKey(key: string, uid?: string | null, datasetId?: string | null): string {
  // Only namespace protected business data
  const isProtected = ['preventive_entries', 'corrective_reports', 'technician_schedules'].includes(key);
  if (isProtected && uid) {
    const cleanDs = (datasetId || 'default').trim();
    return `${CACHE_PREFIX}${CACHE_SCHEMA_VERSION}_user_${uid}_ds_${cleanDs}_${key}`;
  }
  return `${CACHE_PREFIX}${key}`;
}

/**
 * Safely reads and parses JSON from localStorage with malformed JSON protection.
 */
export function safeReadJson<T>(key: string, fallback: T, uid?: string | null, datasetId?: string | null): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }

  const namespacedKey = getNamespacedKey(key, uid, datasetId);
  try {
    const data = localStorage.getItem(namespacedKey);
    if (!data) return fallback;

    // Check for malformed JSON structure before parsing
    const trimmed = data.trim();
    if (
      (trimmed.startsWith('{') && !trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && !trimmed.endsWith(']'))
    ) {
      console.warn(`[LocalCache] Detected truncated/malformed JSON for key: ${namespacedKey}. Clearing item.`);
      localStorage.removeItem(namespacedKey);
      return fallback;
    }

    const parsed = JSON.parse(data);
    return parsed as T;
  } catch (err) {
    console.warn(`[LocalCache] Parse error for key: ${namespacedKey}. Safely ignoring cache and fetching remote.`, err);
    try {
      localStorage.removeItem(namespacedKey);
    } catch {}
    return fallback;
  }
}

/**
 * Safely writes a JSON object to localStorage with QuotaExceeded and write failure protection.
 */
export function safeWriteJson<T>(key: string, value: T, uid?: string | null, datasetId?: string | null): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }

  const namespacedKey = getNamespacedKey(key, uid, datasetId);
  try {
    // Audit long-lived caches for raw Base64 data (e.g. data:image/)
    let processedValue: any = value;
    if (Array.isArray(value)) {
      processedValue = value.map((item) => {
        if (item && typeof item === 'object') {
          const newItem = { ...item };
          // If the report is already synced (or even unsynced but we want to avoid long-lived base64 bloat),
          // ensure no raw base64 data is retained indefinitely in long-lived storage.
          if (newItem.synced && Array.isArray(newItem.evidences)) {
            newItem.evidences = newItem.evidences.filter(
              (ev: any) => typeof ev === 'string' && !ev.startsWith('data:image/')
            );
          }
          return newItem;
        }
        return item;
      });
    }

    const serialized = JSON.stringify(processedValue);
    localStorage.setItem(namespacedKey, serialized);

    // Dual-write to IndexedDB for high durability & large photo support
    if (key === 'preventive_entries' && Array.isArray(value)) {
      (async () => {
        for (const entry of value) {
          if (entry && typeof entry === 'object') {
            await localDB.savePreventiveEntry(entry);
          }
        }
      })().catch((err) => console.warn('[LocalCache] Dual-write to IndexedDB failed:', err));
    } else if (key === 'corrective_reports' && Array.isArray(value)) {
      (async () => {
        for (const report of value) {
          if (report && typeof report === 'object') {
            await localDB.saveCorrectiveReport(report);
          }
        }
      })().catch((err) => console.warn('[LocalCache] Dual-write to IndexedDB failed:', err));
    }

    return true;
  } catch (err) {
    console.warn(`[LocalCache] Failed to write cache for key: ${namespacedKey}. Runtime will continue using memory state.`, err);
    return false;
  }
}

/**
 * Removes a specific cache key from localStorage safely.
 */
export function safeRemove(key: string, uid?: string | null, datasetId?: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const namespacedKey = getNamespacedKey(key, uid, datasetId);
  try {
    localStorage.removeItem(namespacedKey);
  } catch {}
}

/**
 * Wipes all protected business data from localStorage while preserving user preferences like dataset or theme.
 */
export function clearProtectedCache(uid?: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        // Exclude active dataset selection or general preferences
        const isPreference = key.includes('active_dataset') || key.includes('theme');
        if (!isPreference) {
          if (uid) {
            // Target specific user cache
            if (key.includes(`_user_${uid}_`)) {
              keysToRemove.push(key);
            }
          } else {
            // Remove all protected caches
            keysToRemove.push(key);
          }
        }
      }
    }
    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
    });
    console.log(`[LocalCache] Successfully cleared ${keysToRemove.length} protected cache items.`);
  } catch (err) {
    console.warn('[LocalCache] Error clearing protected cache:', err);
  }
}
