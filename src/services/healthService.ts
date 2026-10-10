import { getAuthHeaders } from './authService';

export async function fetchDetailedServerHealth(): Promise<{
  success: boolean;
  health?: any;
  error?: string;
}> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/health/details', { headers });
    if (res.ok) {
      const data = await res.json();
      return { success: true, health: data };
    }
    const errData = await res.json().catch(() => ({}));
    return { success: false, error: errData.error || `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Gagal memuat status kesehatan server' };
  }
}
