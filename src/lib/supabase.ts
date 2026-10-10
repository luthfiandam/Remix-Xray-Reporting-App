import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_KEY_URL = 'faskampen_supabase_url';
const STORAGE_KEY_ANON = 'faskampen_supabase_anon_key';

export function getSupabaseUrl(): string {
  const custom = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_URL) : null;
  if (custom && custom.trim()) return custom.trim();

  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
  return envUrl.trim();
}

export function getSupabaseAnonKey(): string {
  const custom = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_ANON) : null;
  if (custom && custom.trim()) return custom.trim();

  const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  const key = (env?.VITE_SUPABASE_PUBLISHABLE_KEY || env?.VITE_SUPABASE_ANON_KEY || '');
  return key.trim();
}

export function setCustomSupabaseConfig(url: string, key: string) {
  if (typeof window !== 'undefined') {
    if (url.trim()) {
      localStorage.setItem(STORAGE_KEY_URL, url.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY_URL);
    }

    if (key.trim()) {
      localStorage.setItem(STORAGE_KEY_ANON, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY_ANON);
    }
  }
  supabaseInstance = null; // reset client instance
}

export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  return Boolean(url && key && url.startsWith('http') && key.length > 10);
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const url = getSupabaseUrl();
    const key = getSupabaseAnonKey();
    if (!url || !key) {
      throw new Error('Supabase client initialized without VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
    supabaseInstance = createClient(url, key, {
      auth: {
        storageKey: 'faskampen_supabase_auth_token',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // Prevent multiple GoTrue URL listener registrations
      },
    });
  }
  return supabaseInstance;
}

export interface SupabaseTestResult {
  success: boolean;
  url: string;
  keyProvided: boolean;
  statusCode?: number;
  message: string;
  latencyMs?: number;
}

export async function testSupabaseConnection(
  overrideUrl?: string,
  overrideKey?: string
): Promise<SupabaseTestResult> {
  const url = (overrideUrl !== undefined ? overrideUrl : getSupabaseUrl()).trim();
  const key = (overrideKey !== undefined ? overrideKey : getSupabaseAnonKey()).trim();

  if (!url) {
    return {
      success: false,
      url: '',
      keyProvided: Boolean(key),
      message: 'URL Supabase belum diisi (VITE_SUPABASE_URL kosong).',
    };
  }

  if (!key) {
    return {
      success: false,
      url,
      keyProvided: false,
      message: 'Publishable/Anon Key Supabase belum diisi.',
    };
  }

  const startTime = Date.now();
  try {
    const healthUrl = `${url.replace(/\/$/, '')}/auth/v1/health`;
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        apikey: key,
      },
    });
    const latencyMs = Date.now() - startTime;

    if (res.ok) {
      return {
        success: true,
        url,
        keyProvided: true,
        statusCode: res.status,
        latencyMs,
        message: `Koneksi ke Supabase BERHASIL! (Latency: ${latencyMs}ms, Status: ${res.status})`,
      };
    } else {
      const errorText = await res.text().catch(() => '');
      return {
        success: false,
        url,
        keyProvided: true,
        statusCode: res.status,
        latencyMs,
        message: `Supabase merespon dengan status HTTP ${res.status}: ${errorText || res.statusText}`,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      url,
      keyProvided: true,
      latencyMs,
      message: `Gagal terhubung ke Supabase (${err?.message || 'Network/DNS Error'}). Pastikan URL Supabase valid (contoh: https://xxx.supabase.co).`,
    };
  }
}


