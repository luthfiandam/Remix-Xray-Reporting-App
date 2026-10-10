import { ReportEvidenceItem, PreventiveEvidence } from '../types';
import { extractS3ObjectKey } from './s3ObjectKey';
import { getAuthHeaders, refreshAuthSession } from '../services/authService';

/**
 * Resolves whether an evidence item is a collage.
 * Explicit metadata `is_collage` takes strict precedence:
 * - `is_collage === true` -> true
 * - `is_collage === false` -> false
 * Legacy fallback checks caption / path for 'kolase' or 'collage'.
 */
export function isCollageEvidence(ev: unknown): boolean {
  if (!ev) return false;
  if (typeof ev === 'object' && ev !== null) {
    if ((ev as any).is_collage === true) return true;
    if ((ev as any).is_collage === false) return false;
    const cap = String((ev as any).caption || '').toLowerCase();
    const path = String(
      (ev as any).file_path ||
      (ev as any).drive_url ||
      (ev as any).url ||
      (ev as any).key ||
      ''
    ).toLowerCase();
    return (
      cap.includes('kolase') ||
      cap.includes('collage') ||
      path.includes('kolase') ||
      path.includes('collage')
    );
  }
  if (typeof ev === 'string') {
    const lower = ev.toLowerCase();
    return lower.includes('kolase') || lower.includes('collage');
  }
  return false;
}

/**
 * Checks whether an evidence item is an original photo (not a collage).
 */
export function isOriginalEvidence(ev: unknown): boolean {
  return !isCollageEvidence(ev);
}

/**
 * Filters an array of evidences to return only original photos (excluding all collages).
 */
export function filterOriginalEvidences<T>(evidences?: T[] | null): T[] {
  if (!Array.isArray(evidences)) return [];
  return evidences.filter(isOriginalEvidence);
}

/**
 * Finds the single collage item from an array of evidences, if present.
 */
export function findCollageEvidence<T>(evidences?: T[] | null): T | null {
  if (!Array.isArray(evidences)) return null;
  return evidences.find(isCollageEvidence) || null;
}

/**
 * Resolves the primary URL / file path for an evidence item.
 * Supports string URLs, PreventiveEvidence objects, and structured ReportEvidenceItems.
 */
export function getEvidenceUrl(
  ev: ReportEvidenceItem | PreventiveEvidence | string | undefined | null
): string {
  if (!ev) return '';
  let raw = '';
  if (typeof ev === 'string') raw = ev.trim();
  else {
    raw = (
      ev.file_path?.trim() ||
      (ev as { drive_url?: string }).drive_url?.trim() ||
      (ev as { url?: string }).url?.trim() ||
      (ev as { dataUrl?: string }).dataUrl?.trim() ||
      ''
    );
  }
  return getProxySafeImageUrl(raw);
}

const localPresignedUrlCache = new Map<string, string>();

export function registerPresignedUrls(urlMap: Record<string, string>): void {
  for (const [key, url] of Object.entries(urlMap)) {
    if (key && url) {
      localPresignedUrlCache.set(key, url);
      const clean = extractS3ObjectKey(key);
      if (clean) {
        localPresignedUrlCache.set(clean, url);
      }
    }
  }
}

/**
 * In-memory Blob URL cache for authenticated image downloads.
 * Bounded with LRU/FIFO eviction and object URL revocation to prevent memory leaks.
 */
const MAX_BLOB_CACHE_SIZE = 120;
const authenticatedBlobUrlCache = new Map<string, string>();
const pendingImageLoads = new Map<string, Promise<string>>();
let imageCacheGeneration = 0;

function setBlobCache(key: string, blobUrl: string): void {
  if (!key || !blobUrl) return;
  if (authenticatedBlobUrlCache.size >= MAX_BLOB_CACHE_SIZE) {
    const oldestKey = authenticatedBlobUrlCache.keys().next().value;
    if (oldestKey) {
      const oldUrl = authenticatedBlobUrlCache.get(oldestKey);
      if (oldUrl && oldUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(oldUrl);
        } catch (_) {}
      }
      authenticatedBlobUrlCache.delete(oldestKey);
    }
  }
  authenticatedBlobUrlCache.set(key, blobUrl);
}

/**
 * Explicit cache invalidation upon user logout or session switch.
 */
export function clearAuthenticatedImageCache(): void {
  imageCacheGeneration++;
  pendingImageLoads.clear();
  for (const [, blobUrl] of authenticatedBlobUrlCache.entries()) {
    if (blobUrl && blobUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (_) {}
    }
  }
  authenticatedBlobUrlCache.clear();
  localPresignedUrlCache.clear();
}

/**
 * Loads an authenticated image securely via Blob URL using HTTP Authorization headers.
 * Converts canonical S3 object keys and expired presigned URLs to durable authenticated proxy requests.
 * NEVER exposes the Supabase access token in query parameters.
 */
export async function fetchAuthenticatedImageBlob(keyOrUrl?: string | null): Promise<string> {
  if (!keyOrUrl || typeof keyOrUrl !== 'string') return '';
  const trimmed = keyOrUrl.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  // 1. If already in memory blob cache, return immediately
  if (authenticatedBlobUrlCache.has(trimmed)) {
    return authenticatedBlobUrlCache.get(trimmed)!;
  }

  // 2. Canonical S3 Key Resolution
  const cleanKey = extractS3ObjectKey(trimmed);

  if (cleanKey && authenticatedBlobUrlCache.has(cleanKey)) {
    return authenticatedBlobUrlCache.get(cleanKey)!;
  }

  // 3. Build target proxy URL
  let targetUrl = '';
  if (cleanKey) {
    targetUrl = `/api/storage/proxy-image?key=${encodeURIComponent(cleanKey)}`;
  } else if (trimmed.startsWith('/api/storage/')) {
    targetUrl = trimmed;
  } else if (
    trimmed.includes('X-Amz-Signature') ||
    trimmed.includes('AWSAccessKeyId') ||
    trimmed.includes('Signature=')
  ) {
    // Unknown signed links cannot serve as durable evidence.
    return '';
  } else {
    // Standard external HTTP/HTTPS URL
    return trimmed;
  }

  const cacheKey = cleanKey || trimmed;
  const pending = pendingImageLoads.get(cacheKey);
  if (pending) return pending;

  // Coalesce concurrent requests for the same private object. A completed request
  // from a previous login must never repopulate the cache after logout.
  const requestedGeneration = imageCacheGeneration;
  const loading = (async (): Promise<string> => {
    try {
      const authHeaders = await getAuthHeaders();
      let res = await fetch(targetUrl, { headers: { Accept: 'image/*', ...authHeaders } });

      if (res.status === 401) {
        try {
          await refreshAuthSession();
          const freshHeaders = await getAuthHeaders();
          res = await fetch(targetUrl, { headers: { Accept: 'image/*', ...freshHeaders } });
        } catch (_) {}
      }

      if (requestedGeneration !== imageCacheGeneration) return '';
      if (!res.ok) {
        console.warn(`[EvidenceUtils] Proxy image fetch failed (HTTP ${res.status}):`, targetUrl);
        return '';
      }
      const blob = await res.blob();
      if (requestedGeneration !== imageCacheGeneration) return '';
      if (!blob.type.startsWith('image/')) {
        console.warn('[EvidenceUtils] Proxy returned non-image content for evidence.');
        return '';
      }
      const blobUrl = URL.createObjectURL(blob);
      setBlobCache(cacheKey, blobUrl);
      return blobUrl;
    } catch (err) {
      console.warn('[EvidenceUtils] Error fetching authenticated image blob:', err);
      return '';
    }
  })();
  pendingImageLoads.set(cacheKey, loading);
  try {
    return await loading;
  } finally {
    if (pendingImageLoads.get(cacheKey) === loading) pendingImageLoads.delete(cacheKey);
  }
}

/**
 * Ensures an image URL can be loaded without exposing Bearer tokens in URLs.
 * Sanitizes URLs to remove any leaked bearer tokens from query parameters.
 * Canonicalizes expiring S3 URLs and permanent S3 keys to durable `/api/storage/proxy-image` routes.
 */
export function getProxySafeImageUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let trimmed = rawUrl.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  // SECURITY: Strip any leaked token query parameters (&token=... or ?token=...)
  if (trimmed.includes('token=')) {
    trimmed = trimmed
      .replace(/[?&]token=[^&]+/g, '')
      .replace(/\?&/, '?')
      .replace(/&&/, '&')
      .replace(/\?$/, '');
  }

  // If in Blob cache, return cached object URL
  if (authenticatedBlobUrlCache.has(trimmed)) {
    return authenticatedBlobUrlCache.get(trimmed)!;
  }

  // 1. Canonical S3 Key Resolution
  // Prioritize extracting S3 object key EVEN IF the URL has an expiring AWS signature (Bagian C)
  const cleanKey = extractS3ObjectKey(trimmed);
  if (cleanKey) {
    if (authenticatedBlobUrlCache.has(cleanKey)) {
      return authenticatedBlobUrlCache.get(cleanKey)!;
    }
    return `/api/storage/proxy-image?key=${encodeURIComponent(cleanKey)}`;
  }

  // 2. If already a valid external presigned URL not belonging to our S3 storage
  if (
    trimmed.includes('X-Amz-Signature') ||
    trimmed.includes('AWSAccessKeyId') ||
    trimmed.includes('Signature=') ||
    trimmed.includes('ticket=')
  ) {
    // No validated S3 key: never use an expiring URL as the permanent preview.
    return '';
  }

  return trimmed;
}

/**
 * Extracts an array of non-empty photo URLs from a list of evidence items.
 */
export function extractValidPhotoUrls(
  evidences?: (ReportEvidenceItem | PreventiveEvidence | string)[] | null
): string[] {
  if (!evidences || !Array.isArray(evidences)) return [];
  return evidences
    .map(getEvidenceUrl)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

/**
 * Resolves exactly 1 photo for official PDF and report documentation table.
 * Strictly prioritizes the Collage photo (is_collage === true or caption containing 'kolase').
 * If no explicit collage is found, falls back to the last evidence photo or single photo.
 * Always returns at most ONE URL string (or empty string if none).
 */
export function getSingleCollagePhotoUrl(
  evidences?: (ReportEvidenceItem | PreventiveEvidence | string)[] | null
): string {
  if (!evidences || !Array.isArray(evidences) || evidences.length === 0) return '';

  // 1. Look for explicit collage item using normalized helper
  const collageItem = findCollageEvidence(evidences);
  if (collageItem) {
    return getEvidenceUrl(collageItem);
  }

  // 2. Fallback: if multiple photos exist, take the last photo or single photo
  const valid = extractValidPhotoUrls(evidences);
  if (valid.length > 0) {
    return valid[valid.length - 1];
  }

  return '';
}

/**
 * Binds/slices evidences to a maximum limit (default 9) per equipment.
 * Logs a warning if evidences exceed the limit, without crashing or failing report generation.
 */
export function extractBoundedEvidences(
  evidences?: (ReportEvidenceItem | PreventiveEvidence | string)[] | null,
  maxCount: number = 9
): string[] {
  const valid = extractValidPhotoUrls(evidences);
  if (valid.length > maxCount) {
    console.warn(`[Evidence] Equipment has ${valid.length} photos, which exceeds maximum limit of ${maxCount}. Truncating to first ${maxCount}.`);
    return valid.slice(0, maxCount);
  }
  return valid;
}
