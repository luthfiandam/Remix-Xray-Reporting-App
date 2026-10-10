import { getAuthHeaders, refreshAuthSession } from './authService';
import { storageProxyPath } from '../utils/s3ObjectKey';
import { normalizeOperationalDate } from '../utils/dateTimeUtils';

export { storageProxyPath, normalizeOperationalDate };

export interface StorageConfig {
  provider: 'idcloudhost' | 'local';
  endpoint: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName: string;
  region: string;
  publicUrlBase?: string;
  enabled: boolean;
  isConfigured?: boolean;
  lastCheck?: string;
}

export interface StorageUploadResponse {
  success: boolean;
  url?: string;
  file_name?: string;
  key?: string;
  bucket?: string;
  file_size?: number;
  error?: string;
}

export interface StorageTestResponse {
  success: boolean;
  message: string;
  buckets?: string[];
  details?: any;
}

let cachedConfigState: { isConfigured: boolean; timestamp: number } | null = null;

/**
 * Fetch storage configuration from server (Server-side storage, no secrets in browser)
 */
export async function getStorageConfig(): Promise<StorageConfig> {
  const defaultConfig: StorageConfig = {
    provider: 'idcloudhost',
    endpoint: 'https://is3.cloudhost.id',
    bucketName: '',
    region: 'us-east-1',
    publicUrlBase: '',
    enabled: true,
    isConfigured: false,
  };

  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/storage/config', {
      headers: { ...authHeaders, Accept: 'application/json' },
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      const merged: StorageConfig = {
        provider: data.provider || defaultConfig.provider,
        endpoint: data.endpoint || defaultConfig.endpoint,
        accessKeyId: data.accessKeyId || '',
        secretAccessKey: data.secretAccessKey ? '********' : '',
        bucketName: data.bucketName || defaultConfig.bucketName,
        region: data.region || defaultConfig.region,
        publicUrlBase: data.publicUrlBase || defaultConfig.publicUrlBase,
        enabled: data.enabled !== undefined ? data.enabled : defaultConfig.enabled,
        isConfigured: Boolean(data.isConfigured && data.enabled !== false),
        lastCheck: new Date().toLocaleTimeString('id-ID'),
      };

      cachedConfigState = {
        isConfigured: Boolean(merged.isConfigured && merged.enabled),
        timestamp: Date.now(),
      };
      return merged;
    }
  } catch (err) {
    console.warn('[StorageService] Error fetching storage config from server:', err);
  }

  return defaultConfig;
}

/**
 * Save storage configuration to server (Supervisor only, stored securely on server/VPS)
 */
export async function saveStorageConfig(config: Partial<StorageConfig>): Promise<{ success: boolean; message: string }> {
  // Invalidate cache
  cachedConfigState = {
    isConfigured: Boolean(config.bucketName && config.enabled !== false),
    timestamp: Date.now(),
  };

  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/storage/config', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(config),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    return { success: true, message: 'Konfigurasi storage berhasil diperbarui.' };
  } catch (err: any) {
    return { success: false, message: 'Gagal menghubungi server storage: ' + err.message };
  }
}

/**
 * Test IDCloudHost S3 connection via backend
 */
export async function testStorageConnection(config?: Partial<StorageConfig>): Promise<StorageTestResponse> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/storage/test', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(config || {}),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    return { success: false, message: `Server mengembalikan status HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, message: `Gagal menghubungi server storage: ${err?.message || 'Network Error'}` };
  }
}

/**
 * List available S3 buckets
 */
export async function listStorageBuckets(): Promise<{ success: boolean; buckets: string[]; message?: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/storage/buckets', {
      headers: { ...authHeaders, Accept: 'application/json' },
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
    return { success: false, buckets: [] };
  } catch (err: any) {
    return { success: false, buckets: [], message: err?.message };
  }
}

/**
 * Create a new S3 bucket in IDCloudHost
 */
export async function createStorageBucket(bucketName: string): Promise<{ success: boolean; message: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/storage/create-bucket', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ bucketName }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    return { success: false, message: `Gagal membuat bucket (Status ${res.status})` };
  } catch (err: any) {
    return { success: false, message: `Network error: ${err?.message}` };
  }
}

/**
 * Request Presigned Direct PUT Upload URL from server
 */
export async function requestPresignedUploadUrl(options: {
  fileName: string;
  contentType?: string;
  entityType?: string;
  dateStr?: string;
  shift?: string;
  entityId?: string | number;
  recordId?: string | number;
  folderPath?: string;
  technicianName?: string;
  attendanceType?: string;
}): Promise<{
  success: boolean;
  uploadUrl?: string;
  key?: string;
  bucket?: string;
  file_name?: string;
  contentType?: string;
  expiresIn?: number;
  error?: string;
}> {
  try {
    let authHeaders = await getAuthHeaders();
    let res = await fetch('/api/storage/presigned-upload-url', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(options),
    });

    // Handle 401: Controlled single session recovery attempt
    if (res.status === 401) {
      const freshToken = await refreshAuthSession();
      if (freshToken) {
        authHeaders = await getAuthHeaders();
        res = await fetch('/api/storage/presigned-upload-url', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(options),
        });
      }
      if (res.status === 401) {
        return {
          success: false,
          error: 'S3 Upload Gagal: Sesi autentikasi telah kedaluwarsa. Silakan login kembali.',
        };
      }
    }

    if (res.ok) {
      return await res.json();
    }
    const errData = await res.json().catch(() => ({}));
    return { success: false, error: errData.error || `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error requesting presigned URL' };
  }
}

/**
 * Upload binary Blob / File directly to IDCloudHost S3 via Presigned PUT URL.
 * Falls back safely to backend proxy upload if direct PUT fails (e.g. CORS/network limit).
 */
export async function uploadBlobDirectToStorage(
  blobData: Blob,
  folderPath: string,
  fileName: string,
  contentType: string = 'image/jpeg',
  extra?: {
    entityType?: string;
    dateStr?: string;
    shift?: string;
    entityId?: string | number;
    recordId?: string | number;
    technicianName?: string;
    attendanceType?: string;
    onLog?: (msg: string) => void;
  }
): Promise<StorageUploadResponse> {
  if (!blobData || blobData.size === 0) {
    extra?.onLog?.('[ERROR] Data file gambar kosong.');
    return { success: false, error: 'Data file kosong.' };
  }

  const startTime = Date.now();
  const log = (msg: string) => {
    if (extra?.onLog) extra.onLog(msg);
    else console.log(msg);
  };

  const fileSizeKb = Math.round(blobData.size / 1024);
  log(`[INFO] Menyiapkan upload file "${fileName}" (${fileSizeKb} KB)...`);

  // 1. Try Direct Presigned PUT Upload
  try {
    log(`[INFO] Requesting Presigned S3 Upload URL dari server...`);
    const presignRes = await requestPresignedUploadUrl({
      fileName,
      contentType,
      folderPath,
      ...extra,
    });

    if (presignRes.success && presignRes.uploadUrl && presignRes.key) {
      log(`[INFO] Presigned S3 URL diterima. Key: ${presignRes.key}. Mencoba Direct PUT S3...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for mobile networks

      let putRes: Response | null = null;
      try {
        putRes = await fetch(presignRes.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
          },
          body: blobData,
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        const durationMs = Date.now() - startTime;
        log(`[WARN] Direct S3 PUT gagal/CORS/Timeout (${durationMs}ms, ${fetchErr?.name || fetchErr?.message || 'NetworkError'}). beralih ke Fallback Proxy...`);
      } finally {
        clearTimeout(timeoutId);
      }

      if (putRes && putRes.ok) {
        const durationMs = Date.now() - startTime;
        log(`[OK] Direct S3 PUT Berhasil dalam ${durationMs}ms! Key: ${presignRes.key}`);

        return {
          success: true,
          url: `/api/storage/proxy-image?key=${encodeURIComponent(presignRes.key)}`,
          key: presignRes.key,
          bucket: presignRes.bucket,
          file_name: presignRes.file_name || fileName,
          file_size: blobData.size,
        };
      } else if (putRes) {
        const durationMs = Date.now() - startTime;
        log(`[WARN] Direct S3 PUT mengembalikan HTTP ${putRes.status} (${durationMs}ms).`);
      }
    } else {
      const presignErr = (presignRes.error || '').toLowerCase();
      // If rejected due to 401 Auth or 403 Forbidden/Off-Duty, DO NOT attempt fallback proxy with the same invalid token
      if (
        presignErr.includes('autentikasi') ||
        presignErr.includes('login') ||
        presignErr.includes('sesi') ||
        presignErr.includes('401')
      ) {
        log(`[ERROR] S3 Upload Ditolak: ${presignRes.error}`);
        return {
          success: false,
          error: presignRes.error || 'S3 Upload Gagal: Autentikasi diperlukan. Silakan login terlebih dahulu.',
        };
      }
      if (
        presignErr.includes('akses ditolak') ||
        presignErr.includes('read only') ||
        presignErr.includes('off duty') ||
        presignErr.includes('403')
      ) {
        log(`[ERROR] S3 Upload Ditolak (RBAC): ${presignRes.error}`);
        return {
          success: false,
          error: presignRes.error || 'Akses ditolak: Teknisi sedang OFF DUTY / Read Only.',
        };
      }
      log(`[WARN] Gagal mendapatkan Presigned URL (${presignRes.error || 'Unknown'}). beralih ke Fallback Proxy...`);
    }
  } catch (directPutErr: any) {
    const durationMs = Date.now() - startTime;
    log(`[WARN] Direct S3 PUT exception: ${directPutErr?.message || 'Error'} -> beralih ke Fallback Proxy...`);
  }

  // 2. Fallback to Express Proxy Upload (Base64)
  const fallbackStart = Date.now();
  log(`[INFO] Mengirim file via Express Server Proxy Upload...`);
  try {
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blobData);
    });

    const base64 = await base64Promise;
    const res = await uploadToStorage(base64, folderPath, fileName, contentType, extra);
    const durationMs = Date.now() - fallbackStart;

    if (res.success) {
      log(`[OK] Proxy Upload Berhasil dalam ${durationMs}ms! Key: ${res.key || 'N/A'}`);
    } else {
      log(`[ERROR] Proxy Upload Gagal (${durationMs}ms): ${res.error || 'Server Error'}`);
    }
    return res;
  } catch (fallbackErr: any) {
    const durationMs = Date.now() - fallbackStart;
    log(`[ERROR] Proxy Upload Network Exception (${durationMs}ms): ${fallbackErr?.message || 'Error'}`);
    return { success: false, error: `Upload gagal: ${fallbackErr?.message || 'Error'}` };
  }
}

/**
 * Upload an image or document (base64) securely via backend to IDCloudHost S3 Object Storage
 */
export async function uploadToStorage(
  base64Data: string,
  folderPath: string,
  fileName: string,
  contentType: string = 'image/jpeg',
  extra?: {
    entityType?: string;
    dateStr?: string;
    shift?: string;
    entityId?: string | number;
    recordId?: string | number;
  }
): Promise<StorageUploadResponse> {
  if (!base64Data) {
    return { success: false, error: 'Data gambar kosong.' };
  }

  try {
    let authHeaders = await getAuthHeaders();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for proxy upload (large base64 files over network)

    let res: Response;
    try {
      res = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          base64: base64Data,
          folderPath,
          fileName,
          contentType,
          ...extra,
        }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        const freshToken = await refreshAuthSession();
        if (freshToken) {
          authHeaders = await getAuthHeaders();
          res = await fetch('/api/storage/upload', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              base64: base64Data,
              folderPath,
              fileName,
              contentType,
              ...extra,
            }),
            signal: controller.signal,
          });
        }
        if (res.status === 401) {
          return {
            success: false,
            error: 'S3 Upload Gagal: Sesi autentikasi telah kedaluwarsa. Silakan login kembali.',
          };
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const contentTypeHeader = res.headers.get('content-type') || '';
    if (contentTypeHeader.includes('application/json')) {
      const data = await res.json();
      return data;
    }

    return {
      success: false,
      error: `Server mengembalikan response non-JSON (HTTP ${res.status})`,
    };
  } catch (err: any) {
    console.error('[StorageService] Proxy upload error:', err?.name === 'AbortError' ? 'Timeout (60s)' : err?.message);
    return {
      success: false,
      error: `Gagal upload ke storage server: ${err?.name === 'AbortError' ? 'Waktu upload habis (Timeout 60 detik).' : err?.message || 'Network exception'}`,
    };
  }
}


export async function deleteStorageObjects(objectKeys: string[]): Promise<{ success: boolean; deleted?: string[] }> {
  try {
    const validKeys = objectKeys.filter((k) => typeof k === 'string' && k.startsWith('!Kantor/'));
    if (validKeys.length === 0) return { success: true, deleted: [] };

    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/storage/delete-objects', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ object_keys: validKeys }),
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[StorageService] Delete S3 objects error:', err);
  }
  return { success: false };
}

/**
 * Register generated report file into Supabase report_files archive catalog
 */
export async function registerReportArchiveFile(metadata: {
  report_type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semester' | 'yearly' | 'adhoc' | 'corrective' | 'attendance';
  operational_date: string;
  shift?: string;
  frequency_id?: number;
  object_key: string;
  file_name: string;
  file_size?: number;
  content_type?: string;
  checksum?: string;
  bucket?: string;
  generated_by?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; report?: any; error?: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const cleanPayload = {
      ...metadata,
      operational_date: normalizeOperationalDate(metadata.operational_date),
    };
    const res = await fetch('/api/reports/archive', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(cleanPayload),
    });

    if (res.ok) {
      return await res.json();
    }
    const errData = await res.json().catch(() => ({}));
    return { success: false, error: errData.error || `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error registering report' };
  }
}

/**
 * Fetch list of archived report files from Supabase catalog
 */
export async function getReportArchiveList(filter?: {
  date?: string;
  shift?: string;
  type?: string;
  frequency_id?: number;
  presign?: boolean;
}): Promise<any[]> {
  try {
    const authHeaders = await getAuthHeaders();
    const params = new URLSearchParams();
    if (filter?.date) params.set('date', filter.date);
    if (filter?.shift) params.set('shift', filter.shift);
    if (filter?.type) params.set('type', filter.type);
    if (filter?.frequency_id) params.set('frequency_id', String(filter.frequency_id));
    if (filter?.presign) params.set('presign', 'true');

    const res = await fetch(`/api/reports/archive?${params.toString()}`, {
      headers: { ...authHeaders, Accept: 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      return data.reports || [];
    }
  } catch (err) {
    console.warn('[StorageService] Error loading report archives:', err);
  }
  return [];
}

/**
 * Request temporary presigned URL for a private object key
 */
export async function getPresignedObjectUrl(key: string): Promise<string | null> {
  if (!key) return null;
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/storage/presigned-url?key=${encodeURIComponent(key)}`, {
      headers: { ...authHeaders, Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.url) {
        return data.url;
      }
    }
  } catch (e) {
    console.warn('[StorageService] Error getting presigned URL:', e);
  }
  return null;
}

/**
 * Request batch temporary presigned URLs for multiple private object keys
 */
export async function getBatchPresignedUrls(keys: string[]): Promise<Record<string, string>> {
  const validKeys = keys.filter((k) => typeof k === 'string' && k.trim());
  if (validKeys.length === 0) return {};
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/storage/presigned-urls', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ keys: validKeys }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.urls) {
        return data.urls;
      }
    }
  } catch (e) {
    console.warn('[StorageService] Error getting batch presigned URLs:', e);
  }
  return {};
}

export function extractS3Key(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null;

  let decoded = trimmed;
  try {
    while (decoded.includes('%')) {
      const prev = decoded;
      decoded = decodeURIComponent(decoded);
      if (decoded === prev) break;
    }
  } catch (_) {}

  const kIdx = decoded.indexOf('!Kantor/');
  if (kIdx !== -1) {
    return decoded.substring(kIdx).split('?')[0].trim();
  }
  if (decoded.startsWith('!Kantor/')) {
    return decoded.split('?')[0].trim();
  }
  return null;
}

const presignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function resolveBatchPresignedUrls(rawKeysOrUrls: (string | null | undefined)[]): Promise<Record<string, string>> {
  const keysToFetch: string[] = [];
  const resultMap: Record<string, string> = {};
  const now = Date.now();

  for (const item of rawKeysOrUrls) {
    const key = extractS3Key(item);
    if (key) {
      const cached = presignedUrlCache.get(key);
      if (cached && cached.expiresAt > now + 60000) {
        resultMap[key] = cached.url;
        if (typeof item === 'string') resultMap[item] = cached.url;
      } else if (!keysToFetch.includes(key)) {
        keysToFetch.push(key);
      }
    }
  }

  if (keysToFetch.length === 0) {
    return resultMap;
  }

  // Chunk keysToFetch into batches of 50
  for (let i = 0; i < keysToFetch.length; i += 50) {
    const chunk = keysToFetch.slice(i, i + 50);
    try {
      const fetchedMap = await getBatchPresignedUrls(chunk);
      for (const [key, url] of Object.entries(fetchedMap)) {
        presignedUrlCache.set(key, { url, expiresAt: now + 3500 * 1000 }); // 1 hour validity
        resultMap[key] = url;
      }
    } catch (e) {
      console.warn('[StorageService] Error in resolveBatchPresignedUrls chunk:', e);
    }
  }

  // Map original raw strings to resolved URLs
  for (const item of rawKeysOrUrls) {
    if (typeof item === 'string') {
      const key = extractS3Key(item);
      if (key && resultMap[key]) {
        resultMap[item] = resultMap[key];
      }
    }
  }

  return resultMap;
}

/**
 * Checks if IDCloudHost Object Storage S3 is active and configured on backend
 */
export async function isIdCloudHostStorageActive(): Promise<boolean> {
  const now = Date.now();
  if (cachedConfigState && now - cachedConfigState.timestamp < 30000) {
    return cachedConfigState.isConfigured;
  }

  try {
    const config = await getStorageConfig();
    return Boolean(config.enabled && config.isConfigured);
  } catch {
    return false;
  }
}
