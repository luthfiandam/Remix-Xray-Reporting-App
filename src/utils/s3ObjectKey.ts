/**
 * Canonical S3 object references are durable. Signed HTTP URLs are not.
 * Legacy URLs from IDCloudHost and our own proxy are accepted for migration.
 */
export function extractS3ObjectKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const original = value.trim();
  if (!original || /[\x00-\x1f\x7f]/.test(original)) return null;
  let candidate = original;
  // Our stable proxy stores the real S3 key in a query parameter.
  if (original.startsWith('/api/storage/') || /^https?:\/\//i.test(original)) {
    try {
      const url = new URL(original, 'https://internal.invalid');
      const queryKey = url.searchParams.get('key');
      candidate = queryKey || url.pathname;
    } catch { return null; }
  } else {
    candidate = candidate.split('?')[0].split('#')[0];
  }
  try {
    for (let i = 0; i < 3 && candidate.includes('%'); i++) {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    }
  } catch { return null; }
  const marker = '!Kantor/';
  const idx = candidate.indexOf(marker);
  if (idx < 0) return null;
  // Do not normalize dangerous segments: reject ambiguous keys instead.
  let key = candidate.substring(idx).split('?')[0].split('#')[0].trim();
  if (!key || key.includes('\\') || /[\x00-\x1f\x7f]/.test(key) ||
      key.split('/').some(s => s === '.' || s === '..' || s === '')) return null;
  return key;
}

export function storageProxyPath(value: unknown): string | null {
  const key = extractS3ObjectKey(value);
  return key ? `/api/storage/proxy-image?key=${encodeURIComponent(key)}` : null;
}
