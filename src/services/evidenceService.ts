import { uploadBlobDirectToStorage, isIdCloudHostStorageActive } from './storageService';
import { PreventiveEvidence, EvidenceUploadStatus } from '../types';
import { generateStorageFileName, sanitizeFileNamePart } from '../utils/watermark';
import { compressImage } from '../utils/imageCompressor';
import { localDB } from './indexedDB';

export interface UploadResult {
  success: boolean;
  drive_url?: string;
  url?: string;
  file_id?: string;
  file_name?: string;
  folder_url?: string;
  error?: string;
}

/**
 * Converts a Data URL (base64) to a binary Blob for direct binary upload
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Checks if a given string is a raw Base64 image data URI.
 */
export function isBase64DataUrl(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  return str.startsWith('data:image/') || str.startsWith('data:application/pdf');
}

/**
 * Extracts clean S3 object key from URL or candidate key string.
 */
export function extractPermanentS3ObjectKey(str: unknown): string {
  if (typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.startsWith('!Kantor/')) {
    return trimmed.split('?')[0].trim();
  }
  const kIdx = trimmed.indexOf('!Kantor/');
  if (kIdx !== -1) {
    try {
      const decoded = decodeURIComponent(trimmed.substring(kIdx));
      return decoded.split('?')[0].trim();
    } catch (_) {
      return trimmed.substring(kIdx).split('?')[0].trim();
    }
  }
  return '';
}

/**
 * Checks if a given string is a valid web, storage URL, or S3 object key reference.
 * Accepts:
 * - http:// and https:// URLs
 * - Relative /api/storage/ proxy URLs
 * - Permanent S3 object keys (starting with !Kantor/)
 * - s3:// URIs
 */
export function isDriveOrWebUrl(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/api/storage/') ||
    trimmed.startsWith('!Kantor/') ||
    trimmed.startsWith('s3://')
  );
}

export const isStorageOrWebUrl = isDriveOrWebUrl;

/**
 * Concurrency helper: processes items with an exact maximum concurrency limit.
 */
async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items || items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(limit, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Uploads a single photo to IDCloudHost S3 Object Storage.
 * If already a URL, returns it immediately (idempotent, no double upload).
 * Compresses raw Base64 images (1280px, 0.78 quality) and logs precise upload timing.
 */
export async function uploadEvidencePhoto(
  base64OrUrl: string,
  folderPath: string,
  fileName: string,
  photoType: string = 'evidence',
  index: number = 0,
  caption: string = '',
  extra?: {
    userId?: string;
    entityType?: string;
    dateStr?: string;
    shift?: string;
    entityId?: string | number;
    recordId?: string | number;
    onLog?: (msg: string) => void;
  }
): Promise<UploadResult> {
  const log = (msg: string) => {
    if (extra?.onLog) extra.onLog(msg);
    else console.log(msg);
  };

  // If already a URL, no need to upload
  if (isDriveOrWebUrl(base64OrUrl)) {
    log(`[OK] Foto #${index + 1} ("${caption || fileName}") sudah berupa URL, dilewati upload.`);
    return {
      success: true,
      drive_url: base64OrUrl.trim(),
      url: base64OrUrl.trim(),
      file_name: fileName,
    };
  }

  if (!isBase64DataUrl(base64OrUrl)) {
    log(`[ERROR] Data foto #${index + 1} tidak valid (bukan URL / Base64).`);
    return {
      success: false,
      error: 'Data foto tidak valid (bukan URL dan bukan Base64 image).',
    };
  }

  // Pre-upload image optimization: Compress to max 1280px, quality 0.78 JPEG
  const tCompStart = performance.now();
  let uploadPayload = base64OrUrl;
  if (base64OrUrl.startsWith('data:image/')) {
    try {
      log(`[INFO] Mengompresi foto #${index + 1} ("${caption || fileName}")...`);
      uploadPayload = await compressImage(base64OrUrl, 1280, 0.78);
      const tCompDuration = performance.now() - tCompStart;
      log(`[OK] Foto #${index + 1} dikompresi dalam ${tCompDuration.toFixed(0)}ms (max 1280px, 0.78 quality).`);
    } catch (compressErr) {
      log(`[WARN] Kompresi foto #${index + 1} warning, menggunakan file asli.`);
    }
  }

  // Stable Unique Photo ID for IndexedDB & Duplicate Upload Prevention
  const effectiveUserId = extra?.userId || (typeof window !== 'undefined' ? localStorage.getItem('faskampen_session_uid') || 'tech' : 'tech');
  const recordIdentifier = String(extra?.recordId || extra?.entityId || 'draft');
  // Stable across retry, distinct for different photo content even at same index/file name.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uploadPayload));
  const imageFingerprint = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const stablePhotoId = `photo_${effectiveUserId}_${recordIdentifier}_${photoType}_${imageFingerprint}`;

  // 1. Check if this photo was ALREADY uploaded to S3 in IndexedDB (Prevents duplicate upload when metadata failed)
  try {
    const existingPhoto = await localDB.getPhotoById(stablePhotoId);
    if (existingPhoto && (existingPhoto.status === 'UPLOADED' || existingPhoto.status === 'COMPLETED') && existingPhoto.s3Url && existingPhoto.s3Key) {
      log(`[OK] Foto #${index + 1} ("${caption || fileName}") sudah terverifikasi di Object Storage S3 (${existingPhoto.s3Key}), menggunakan objek yang ada.`);
      return {
        success: true,
        drive_url: existingPhoto.s3Url,
        url: existingPhoto.s3Url,
        file_name: existingPhoto.fileName || fileName,
        file_id: existingPhoto.s3Key,
        folder_url: existingPhoto.s3Url.substring(0, existingPhoto.s3Url.lastIndexOf('/')),
      };
    }
  } catch (_) {}

  // 2. MANDATORY: Persist photo to IndexedDB BEFORE attempting S3 upload
  const photoRecord = {
    id: stablePhotoId,
    userId: effectiveUserId,
    entityId: recordIdentifier,
    category: photoType,
    caption: caption || fileName,
    fileName,
    folderPath,
    dataUrl: uploadPayload,
    timestamp: Date.now(),
    status: 'UPLOADING' as const,
    synced: false,
    retryCount: 0,
  };

  const isSavedToDb = await localDB.savePhoto(photoRecord);
  if (!isSavedToDb) {
    log(`[WARN] Foto #${index + 1} tidak dapat diamankan ke IndexedDB (kuota peramban penuh/terbatas). Melanjutkan upload...`);
  } else {
    log(`[OK] Foto #${index + 1} diamankan ke IndexedDB sebelum upload (Status: UPLOADING).`);
  }

  // 3. Check network status: if offline, set PENDING in IndexedDB and halt upload safely
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await localDB.updatePhotoStatus(stablePhotoId, 'PENDING', { lastError: 'Perangkat offline' });
    log(`[WARN] Perangkat sedang offline. Foto #${index + 1} aman di IndexedDB antrean lokal.`);
    return {
      success: false,
      error: 'Perangkat sedang offline. Foto tersimpan aman di penyimpanan lokal IndexedDB dan dapat di-retry saat online.',
    };
  }

  const tUploadStart = performance.now();

  // 4. Hybrid Auto-Retry: Exponential Backoff for 5xx/Timeout (Delays: 5s, 15s, 45s)
  try {
    const isS3Active = await isIdCloudHostStorageActive();
    if (!isS3Active) {
      log(`[ERROR] IDCloudHost S3 Object Storage belum aktif/terkonfigurasi.`);
      await localDB.updatePhotoStatus(stablePhotoId, 'FAILED', { lastError: 'S3 belum terkonfigurasi' });
      return {
        success: false,
        error: 'IDCloudHost Object Storage S3 belum dikonfigurasi lengkap (Access Key, Secret Key, atau Bucket Name).',
      };
    }

    const blob = dataUrlToBlob(uploadPayload);
    const RETRY_DELAYS = [5000, 15000, 45000];
    let attempt = 0;
    let s3Res: any = null;
    let lastError = '';

    while (attempt <= 3) {
      if (attempt > 0) {
        const delayMs = RETRY_DELAYS[attempt - 1] || 5000;
        log(`[INFO] Auto-retry upload foto #${index + 1} (Percobaan ${attempt}/3 setelah jeda ${delayMs / 1000} detik)...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        s3Res = await uploadBlobDirectToStorage(blob, folderPath, fileName, 'image/jpeg', {
          entityType: extra?.entityType || photoType,
          dateStr: extra?.dateStr,
          shift: extra?.shift,
          entityId: extra?.entityId || extra?.recordId,
          recordId: extra?.recordId,
          onLog: extra?.onLog,
        });

        if (s3Res.success && s3Res.url) {
          break; // Upload succeeded!
        }

        lastError = s3Res?.error || 'Unknown S3 error';

        // Check if error is non-retryable (401 Auth Expired, 403 Forbidden/Off-Duty, 400 Invalid)
        const errLower = lastError.toLowerCase();
        const isAuthError = errLower.includes('autentikasi') || errLower.includes('login') || errLower.includes('401');
        const isPermissionError = errLower.includes('akses ditolak') || errLower.includes('read only') || errLower.includes('off duty') || errLower.includes('403');
        const isFileError = errLower.includes('tipe file') || errLower.includes('tidak diizinkan') || errLower.includes('400');

        if (isAuthError || isPermissionError || isFileError) {
          log(`[ERROR] Upload foto #${index + 1} ditolak permanen (${lastError}). Menghentikan auto-retry.`);
          await localDB.updatePhotoStatus(stablePhotoId, 'FAILED', { lastError, retryCount: attempt });
          return {
            success: false,
            error: lastError,
          };
        }
      } catch (uploadException: any) {
        lastError = uploadException?.message || 'Network exception';
      }

      attempt++;
    }

    const tUploadDuration = performance.now() - tUploadStart;

    if (s3Res && s3Res.success && s3Res.url) {
      log(`[OK] Foto #${index + 1} ("${caption || fileName}") SUKSES tersimpan ke Object Storage (${tUploadDuration.toFixed(0)}ms)! URL: ${s3Res.url}`);
      // Update IndexedDB record status to UPLOADED
      await localDB.updatePhotoStatus(stablePhotoId, 'UPLOADED', {
        s3Url: s3Res.url,
        s3Key: s3Res.key || fileName,
        synced: true,
        retryCount: attempt,
      });

      return {
        success: true,
        drive_url: s3Res.url,
        url: s3Res.url,
        file_name: s3Res.file_name || fileName,
        file_id: s3Res.key || fileName,
        folder_url: s3Res.url.substring(0, s3Res.url.lastIndexOf('/')),
      };
    } else {
      log(`[ERROR] S3 upload gagal setelah percobaan auto-retry untuk foto #${index + 1}: ${lastError}`);
      await localDB.updatePhotoStatus(stablePhotoId, 'FAILED', { lastError, retryCount: attempt });
      return {
        success: false,
        error: lastError || 'Gagal mengunggah foto ke IDCloudHost S3 Object Storage setelah retry.',
      };
    }
  } catch (s3Err: any) {
    log(`[ERROR] Network exception foto #${index + 1}: ${s3Err?.message || 'Error'}`);
    await localDB.updatePhotoStatus(stablePhotoId, 'FAILED', { lastError: s3Err?.message });
    return {
      success: false,
      error: `Terjadi kendala jaringan saat upload ke IDCloudHost: ${s3Err?.message || 'Error'}`,
    };
  }
}

export interface UploadProgressInfo {
  completed: number;
  total: number;
  currentItemName: string;
  percent: number;
}

export interface BatchEvidenceUploadResult {
  success: boolean;
  evidences: PreventiveEvidence[];
  folder_url?: string;
  warning?: string;
  error?: string;
  expected_evidence_count: number;
  uploaded_evidence_count: number;
  upload_status: EvidenceUploadStatus;
  last_upload_error?: string;
}

/**
 * Uploads an array of Preventive evidences to IDCloudHost Object Storage with concurrency limit.
 */
export async function processAndUploadPreventiveEvidences(
  evidences: PreventiveEvidence[],
  folderPath: string,
  options: {
    equipmentCode: string;
    locationName?: string;
    operationalDate?: string;
    timeStr?: string;
    shift?: string;
    recordId?: string | number;
    collageFolderPath?: string;
    onProgress?: (progress: UploadProgressInfo) => void;
    onLog?: (msg: string) => void;
  }
): Promise<BatchEvidenceUploadResult> {
  const totalCount = evidences ? evidences.length : 0;
  const log = (msg: string) => {
    if (options.onLog) options.onLog(msg);
    else console.log(msg);
  };

  log(`[INFO] Memulai batch upload untuk ${totalCount} foto (${options.equipmentCode})...`);

  if (!evidences || evidences.length === 0) {
    log(`[INFO] Tidak ada foto yang diunggah untuk dikirim.`);
    return {
      success: true,
      evidences: [],
      expected_evidence_count: 0,
      uploaded_evidence_count: 0,
      upload_status: 'completed',
    };
  }

  const tBatchStart = performance.now();
  const cleanBaseFolder = folderPath.replace(/\/Foto (Preventif|Kolase)$/, '');
  const failures: string[] = [];
  let resolvedFolderUrl: string | undefined = undefined;

  const CONCURRENCY_LIMIT = 3;
  let completedCount = 0;
  let successfullyUploaded = 0;

  const processed = await runWithConcurrencyLimit(
    evidences,
    CONCURRENCY_LIMIT,
    async (item, i): Promise<PreventiveEvidence> => {
      const candidate = item.file_path || item.dataUrl || item.drive_url || item.url || '';
      const capLower = (item.caption || '').toLowerCase();
      const isCollage = (item as any).is_collage === true || capLower.includes('kolase');
      const itemCaption = item.caption || (isCollage ? 'Foto Kolase' : `Dokumentasi #${i + 1}`);

      // Target folder
      let targetFolder = folderPath;
      if (isCollage) {
        if (options.collageFolderPath) {
          targetFolder = options.collageFolderPath;
        } else {
          // Replace equipment subfolder with FOTO KOLASE
          const parts = folderPath.split('/');
          parts[parts.length - 1] = 'FOTO KOLASE';
          targetFolder = parts.join('/');
        }
      }

      const notifyProgress = () => {
        completedCount++;
        if (options.onProgress) {
          options.onProgress({
            completed: completedCount,
            total: evidences.length,
            currentItemName: itemCaption,
            percent: Math.min(100, Math.round((completedCount / evidences.length) * 100)),
          });
        }
      };

      // 1. If already a valid web / S3 URL, reuse immediately (no duplicate request)
      if (isDriveOrWebUrl(candidate)) {
        successfullyUploaded++;
        notifyProgress();
        return {
          id: item.id || Date.now() + i,
          file_path: candidate,
          drive_url: candidate,
          file_id: item.file_id || '',
          caption: itemCaption,
          is_collage: isCollage,
        };
      }

      // 2. If Base64 image, compress & upload to IDCloudHost S3
      if (isBase64DataUrl(candidate)) {
        const fileName = isCollage
          ? `kolase_${sanitizeFileNamePart(options.equipmentCode || 'EQUIPMENT')}_${options.timeStr ? options.timeStr.replace(/[^0-9]/g, '') : Date.now()}.jpg`
          : generateStorageFileName(
              options.equipmentCode || options.locationName || 'EQUIPMENT',
              options.timeStr,
              options.operationalDate,
              i
            );

        try {
          const upload = await uploadEvidencePhoto(
            candidate,
            targetFolder,
            fileName,
            isCollage ? 'preventive_collage' : 'preventive_evidence',
            i,
            itemCaption,
            {
              entityType: isCollage ? 'preventive_collage' : 'preventive_evidence',
              dateStr: options.operationalDate,
              shift: options.shift,
              recordId: options.recordId,
              onLog: options.onLog,
            }
          );

          notifyProgress();

          if (upload.success && upload.drive_url) {
            successfullyUploaded++;
            if (!resolvedFolderUrl && upload.folder_url) {
              resolvedFolderUrl = upload.folder_url;
            }
            return {
              id: item.id || Date.now() + i,
              file_path: upload.drive_url,
              drive_url: upload.drive_url,
              file_id: upload.file_id || '',
              caption: itemCaption,
              is_collage: isCollage,
            };
          } else {
            console.warn(`[EvidenceService] S3 upload failed for "${itemCaption}":`, upload.error);
            failures.push(`Foto "${itemCaption}": ${upload.error}`);

            return {
              id: item.id || Date.now() + i,
              file_path: '',
              drive_url: '',
              file_id: '',
              caption: itemCaption,
              is_collage: isCollage,
            };
          }
        } catch (uploadErr: any) {
          notifyProgress();
          console.warn(`[EvidenceService] Upload exception for "${itemCaption}":`, uploadErr);
          failures.push(`Foto "${itemCaption}": ${uploadErr?.message || 'Error'}`);

          return {
            id: item.id || Date.now() + i,
            file_path: '',
            drive_url: '',
            file_id: '',
            caption: itemCaption,
            is_collage: isCollage,
          };
        }
      }

      notifyProgress();
      return {
        id: item.id || Date.now() + i,
        file_path: isDriveOrWebUrl(candidate) ? candidate : '',
        drive_url: isDriveOrWebUrl(candidate) ? candidate : '',
        file_id: item.file_id || '',
        caption: itemCaption,
        is_collage: isCollage,
      };
    }
  );

  const tBatchTotal = performance.now() - tBatchStart;
  console.log(`[UploadTiming] preventive batch total (${evidences.length} photos): ${tBatchTotal.toFixed(0)}ms`);

  let uploadStatus: EvidenceUploadStatus = 'completed';
  if (totalCount > 0) {
    if (successfullyUploaded === totalCount) {
      uploadStatus = 'completed';
    } else if (successfullyUploaded > 0) {
      uploadStatus = 'partial';
    } else {
      uploadStatus = 'failed';
    }
  }

  return {
    success: failures.length === 0,
    evidences: processed,
    folder_url: resolvedFolderUrl,
    warning: failures.length > 0 ? failures.join('; ') : undefined,
    expected_evidence_count: totalCount,
    uploaded_evidence_count: successfullyUploaded,
    upload_status: uploadStatus,
    last_upload_error: failures.length > 0 ? failures[0] : undefined,
  };
}

export interface CorrectiveEvidenceBatchResult {
  success: boolean;
  evidences: string[];
  uploaded_results?: (string | null)[];
  warning?: string;
  error?: string;
  expected_evidence_count: number;
  uploaded_evidence_count: number;
  upload_status: EvidenceUploadStatus;
  last_upload_error?: string;
}

/**
 * Uploads an array of Corrective evidences (strings) to IDCloudHost S3.
 */
export async function processAndUploadCorrectiveEvidences(
  evidences: string[],
  folderPath: string,
  options: {
    locationOrEquipment: string;
    startTime?: string;
    correctiveDate?: string;
    shift?: string;
    recordId?: string | number;
  }
): Promise<CorrectiveEvidenceBatchResult> {
  const totalCount = evidences ? evidences.length : 0;
  if (!evidences || evidences.length === 0) {
    return {
      success: true,
      evidences: [],
      expected_evidence_count: 0,
      uploaded_evidence_count: 0,
      upload_status: 'completed',
    };
  }

  const tBatchStart = performance.now();
  const failures: string[] = [];
  const CONCURRENCY_LIMIT = 3;
  let successfullyUploaded = 0;

  const processedResults = await runWithConcurrencyLimit(
    evidences,
    CONCURRENCY_LIMIT,
    async (ev, i): Promise<string | null> => {
      if (typeof ev !== 'string') {
        failures.push(`Evidence #${i + 1}: format foto tidak valid.`);
        return null;
      }

      // If already a URL, return immediately (no duplicate request)
      if (isDriveOrWebUrl(ev)) {
        successfullyUploaded++;
        return ev.trim();
      }

      if (isBase64DataUrl(ev)) {
        const fileName = generateStorageFileName(
          options.locationOrEquipment || 'CORRECTIVE',
          options.startTime,
          options.correctiveDate,
          i
        );

        try {
          const upload = await uploadEvidencePhoto(
            ev,
            folderPath,
            fileName,
            'corrective_evidence',
            i,
            `Corrective #${i + 1}`,
            {
              entityType: 'corrective_evidence',
              dateStr: options.correctiveDate,
              shift: options.shift,
              recordId: options.recordId,
            }
          );

          if (upload.success && upload.drive_url) {
            successfullyUploaded++;
            return upload.drive_url;
          } else {
            failures.push(`Evidence #${i + 1}: ${upload.error}`);
            return null;
          }
        } catch (uploadErr: any) {
          failures.push(`Evidence #${i + 1}: ${uploadErr?.message || 'Error'}`);
          return null;
        }
      }

      failures.push(`Evidence #${i + 1}: bukan foto Base64 atau referensi storage yang valid.`);
      return null;
    }
  );

  const cleanProcessed = processedResults.filter((url): url is string => Boolean(url));
  const tBatchTotal = performance.now() - tBatchStart;
  console.log(`[UploadTiming] corrective batch total (${evidences.length} photos): ${tBatchTotal.toFixed(0)}ms`);

  let uploadStatus: EvidenceUploadStatus = 'completed';
  if (totalCount > 0) {
    if (successfullyUploaded === totalCount) {
      uploadStatus = 'completed';
    } else if (successfullyUploaded > 0) {
      uploadStatus = 'partial';
    } else {
      uploadStatus = 'failed';
    }
  }

  return {
    success: failures.length === 0,
    evidences: cleanProcessed,
    uploaded_results: processedResults,
    warning: failures.length > 0 ? failures.join('; ') : undefined,
    expected_evidence_count: totalCount,
    uploaded_evidence_count: successfullyUploaded,
    upload_status: uploadStatus,
    last_upload_error: failures.length > 0 ? failures[0] : undefined,
  };
}

/**
 * Sanitizes Preventive evidences strictly for Supabase storage.
 * GUARANTEE: NEVER returns any Base64 data URLs.
 * Extracts permanent S3 object keys and normalizes expiring presigned URLs to durable proxy URLs
 * so photos never blank out when temporary signatures expire.
 */
export function sanitizePreventiveEvidencesForSupabase(evidences: any[]): PreventiveEvidence[] {
  if (!Array.isArray(evidences)) return [];

  const cleanList: PreventiveEvidence[] = [];

  for (let i = 0; i < evidences.length; i++) {
    const item = evidences[i];
    if (!item || typeof item !== 'object') continue;

    let validLink = '';
    const candidates = [item.drive_url, item.file_path, item.url];
    for (const c of candidates) {
      if (typeof c === 'string' && isDriveOrWebUrl(c)) {
        validLink = c.trim();
        break;
      }
    }

    // Check if an object_key or file_id already exists
    let objectKey = item.object_key || item.file_id || extractPermanentS3ObjectKey(validLink);

    // If validLink is an expiring presigned URL, convert to durable proxy URL
    if (validLink.includes('X-Amz-Signature') || validLink.includes('Signature=') || validLink.includes('AWSAccessKeyId')) {
      const extractedKey = extractPermanentS3ObjectKey(validLink);
      if (extractedKey) {
        objectKey = extractedKey;
        validLink = `/api/storage/proxy-image?key=${encodeURIComponent(extractedKey)}`;
      }
    }

    if (validLink || objectKey) {
      const finalLink = validLink || (objectKey ? `/api/storage/proxy-image?key=${encodeURIComponent(objectKey)}` : '');
      cleanList.push({
        id: item.id || i + 1,
        file_path: finalLink,
        drive_url: finalLink,
        file_id: objectKey || item.file_id || '',
        caption: item.caption || `Dokumentasi #${i + 1}`,
        is_collage: Boolean(item.is_collage),
      });
    }
  }

  return cleanList;
}

/**
 * Sanitizes Corrective evidences strictly for Supabase storage.
 * GUARANTEE: NEVER returns any Base64 data URLs.
 * Normalizes expiring presigned URLs to durable S3 proxy URLs.
 */
export function sanitizeCorrectiveEvidencesForSupabase(evidences: any[]): string[] {
  if (!Array.isArray(evidences)) return [];

  const cleanList: string[] = [];

  for (let i = 0; i < evidences.length; i++) {
    const item = evidences[i];
    let candidate = '';
    if (typeof item === 'string') {
      candidate = item.trim();
    } else if (item && typeof item === 'object') {
      candidate = (item.drive_url || item.file_path || item.url || item.key || '').trim();
    }

    if (candidate && isDriveOrWebUrl(candidate)) {
      // If expiring presigned URL, convert to permanent proxy URL
      if (candidate.includes('X-Amz-Signature') || candidate.includes('Signature=') || candidate.includes('AWSAccessKeyId')) {
        const extractedKey = extractPermanentS3ObjectKey(candidate);
        if (extractedKey) {
          candidate = `/api/storage/proxy-image?key=${encodeURIComponent(extractedKey)}`;
        }
      }
      cleanList.push(candidate);
    }
  }

  return cleanList;
}

/**
 * Defense-in-Depth Guard:
 * Strictly checks that no base64 string exists in evidences.
 */
export function assertNoBase64Evidences(evidences: any[]): void {
  if (!Array.isArray(evidences)) return;

  for (let i = 0; i < evidences.length; i++) {
    const item = evidences[i];
    let candidate = '';
    if (typeof item === 'string') {
      candidate = item;
    } else if (item && typeof item === 'object') {
      candidate = item.file_path || item.dataUrl || item.drive_url || item.url || '';
    }

    if (isBase64DataUrl(candidate)) {
      console.error(
        `[CRITICAL Evidence Guard] Detected forbidden Base64 string in evidence #${i + 1}! It must be stripped before database write.`
      );
    }
  }
}

/**
 * Manual and Reconnection Retry Engine:
 * Retries all pending or failed photo uploads stored in IndexedDB for the current user.
 * Avoids duplicate uploads if the S3 key already exists.
 */
export async function retryPendingOrFailedPhotos(
  userId: string,
  onProgress?: (info: { completed: number; total: number; failed: number; currentName?: string }) => void,
  onLog?: (msg: string) => void
): Promise<{ success: boolean; succeeded: number; failed: number; remaining: number }> {
  const log = onLog || console.log;
  const queue = await localDB.getPendingOrFailedPhotos(userId);

  if (!queue || queue.length === 0) {
    log('[INFO] Tidak ada antrean foto pending atau gagal di penyimpanan lokal IndexedDB.');
    return { success: true, succeeded: 0, failed: 0, remaining: 0 };
  }

  log(`[INFO] Menemukan ${queue.length} foto pending/gagal di IndexedDB. Memulai proses retry upload...`);

  let succeeded = 0;
  let failed = 0;

  for (let idx = 0; idx < queue.length; idx++) {
    const item = queue[idx];
    if (onProgress) {
      onProgress({
        completed: succeeded + failed,
        total: queue.length,
        failed,
        currentName: item.caption || item.fileName || `Foto #${idx + 1}`,
      });
    }

    // If S3 already has key, skip S3 upload
    if (item.status === 'UPLOADED' && item.s3Key) {
      succeeded++;
      continue;
    }

    try {
      const uploadRes = await uploadEvidencePhoto(
        item.dataUrl,
        item.folderPath || '!Kantor/2. Foto Laporan',
        item.fileName || `retry_${Date.now()}_${idx}.jpg`,
        item.category || 'preventive_evidence',
        idx,
        item.caption || item.fileName || `Retry #${idx + 1}`,
        {
          userId,
          recordId: item.entityId,
          onLog,
        }
      );

      if (uploadRes.success) {
        succeeded++;
        log(`[OK] Foto "${item.caption || item.fileName}" berhasil diunggah ulang.`);
      } else {
        failed++;
        log(`[WARN] Foto "${item.caption || item.fileName}" gagal pada retry: ${uploadRes.error}`);
      }
    } catch (err: any) {
      failed++;
      log(`[ERROR] Kendala retry foto: ${err?.message}`);
    }
  }

  const remaining = await localDB.getPendingOrFailedPhotos(userId);

  return {
    success: failed === 0,
    succeeded,
    failed,
    remaining: remaining.length,
  };
}

