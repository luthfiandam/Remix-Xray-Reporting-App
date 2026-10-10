/**
 * Safely extracts a human-readable string error message from unknown caught errors.
 */
export function getErrorMessage(
  error: unknown,
  fallback: string = 'Terjadi kesalahan tidak terduga'
): string {
  if (!error) return fallback;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return String(error);
}
