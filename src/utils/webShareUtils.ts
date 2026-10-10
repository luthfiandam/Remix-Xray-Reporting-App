/**
 * Web Share API Utility for X-Ray Reporting App
 * Provides progressive enhancement for native sharing on mobile (Android / iOS)
 * with robust fallback to WhatsApp web/app links.
 */

export interface ShareReportOptions {
  title?: string;
  text: string;
  files?: File[];
  fallbackUrl?: string;
}

export interface ShareReportResult {
  success: boolean;
  method: 'web-share-files' | 'web-share-text' | 'fallback';
  cancelled?: boolean;
  error?: unknown;
}

/**
 * Checks whether the Web Share API is available in current browser environment.
 */
export function isWebShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Checks whether the browser supports sharing specific files (e.g. image collage).
 */
export function canShareFiles(files: File[]): boolean {
  if (!isWebShareSupported()) return false;
  if (!files || files.length === 0) return false;
  if (typeof navigator.canShare !== 'function') return false;

  try {
    return navigator.canShare({ files });
  } catch (e) {
    return false;
  }
}

/**
 * Opens fallback URL (defaults to WhatsApp web / app link).
 * Safely copies full text to clipboard and prevents URL query parameter overflow.
 */
export function openWhatsAppFallback(text: string, customUrl?: string): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  } catch (_) {}

  if (customUrl) {
    window.open(customUrl, '_blank');
    return;
  }

  // Safe URI encoding: wa.me breaks if URI query param > 1800 chars
  let safeText = text || '';
  if (encodeURIComponent(safeText).length > 1800) {
    const lines = safeText.split('\n');
    const headerLines = lines.slice(0, 10).join('\n');
    safeText = `${headerLines}\n\n[... Teks laporan lengkap telah otomatis disalin ke Clipboard HP/Laptop Anda. Silakan tekan Tempel / Paste untuk mengirim seluruh laporan ...]`;
  }
  const targetUrl = `https://wa.me/?text=${encodeURIComponent(safeText)}`;
  window.open(targetUrl, '_blank');
}

/**
 * Converts a Data URL (Base64) string into a binary Blob object.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith('data:')) {
    return new Blob([], { type: 'image/jpeg' });
  }
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
 * Converts a Data URL (Base64) string into a File object.
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

/**
 * Programmatically triggers download of a File, Blob, or DataURL string with a given filename.
 * Mobile friendly: converts Base64 DataURLs to Blob ObjectURLs to bypass mobile browser download blocks.
 */
export function triggerFileDownload(file: Blob | File | string, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    let targetBlob: Blob;
    if (typeof file === 'string') {
      targetBlob = dataUrlToBlob(file);
    } else {
      targetBlob = file;
    }

    const url = URL.createObjectURL(targetBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 4000);
  } catch (err) {
    console.warn('[triggerFileDownload Error]:', err);
  }
}

/**
 * Shares report text and optional image collage files via Native Share Sheet.
 * Gracefully falls back to text-only share or WhatsApp web/app link.
 */
export async function shareReport(options: ShareReportOptions): Promise<ShareReportResult> {
  const { title, text, files, fallbackUrl } = options;

  // 1. If Web Share is not supported, execute fallback directly
  if (!isWebShareSupported()) {
    openWhatsAppFallback(text, fallbackUrl);
    return { success: true, method: 'fallback' };
  }

  // 2. If files are provided and supported, attempt text + file sharing
  if (files && files.length > 0 && canShareFiles(files)) {
    try {
      await navigator.share({
        title: title || 'Laporan Maintenance',
        text,
        files,
      });
      return { success: true, method: 'web-share-files' };
    } catch (err: unknown) {
      const shareErr = err as { name?: string; message?: string } | undefined;
      // Check for user cancellation (not an error)
      if (
        shareErr?.name === 'AbortError' ||
        shareErr?.name === 'NotAllowedError' ||
        String(shareErr?.message || '').toLowerCase().includes('cancel')
      ) {
        return { success: true, method: 'web-share-files', cancelled: true };
      }

      console.warn('[WebShare] Native file share failed, falling back to text-only share:', err);

      // Attempt text-only share as second progressive enhancement tier
      try {
        await navigator.share({
          title: title || 'Laporan Maintenance',
          text,
        });
        return { success: true, method: 'web-share-text' };
      } catch (textShareErr: unknown) {
        const textErr = textShareErr as { name?: string; message?: string } | undefined;
        if (
          textErr?.name === 'AbortError' ||
          textErr?.name === 'NotAllowedError' ||
          String(textErr?.message || '').toLowerCase().includes('cancel')
        ) {
          return { success: true, method: 'web-share-text', cancelled: true };
        }

        console.warn('[WebShare] Native text share failed, falling back to WhatsApp URL:', textShareErr);
        openWhatsAppFallback(text, fallbackUrl);
        return { success: true, method: 'fallback', error: textShareErr };
      }
    }
  }

  // 3. Text-only Native Share (if no files or files unsupported)
  try {
    await navigator.share({
      title: title || 'Laporan Maintenance',
      text,
    });
    return { success: true, method: 'web-share-text' };
  } catch (err: unknown) {
    const fallbackErr = err as { name?: string; message?: string } | undefined;
    if (
      fallbackErr?.name === 'AbortError' ||
      fallbackErr?.name === 'NotAllowedError' ||
      String(fallbackErr?.message || '').toLowerCase().includes('cancel')
    ) {
      return { success: true, method: 'web-share-text', cancelled: true };
    }

    console.warn('[WebShare] Native share failed, falling back to WhatsApp URL:', err);
    openWhatsAppFallback(text, fallbackUrl);
    return { success: true, method: 'fallback', error: err };
  }
}
