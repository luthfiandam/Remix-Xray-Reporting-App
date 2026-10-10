import { User as SupabaseUser } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured, getSupabaseUrl } from '../lib/supabase';
import {
  AppRole,
  AuthState,
  ClientAuthUser,
  FirestoreUserProfile,
  AuthOperationResult,
} from '../types/auth';
import { getSupervisorCanonicalEmail } from './authService';

/**
 * Converts Supabase User object into clean ClientAuthUser identity
 */
export function sanitizeSupabaseUser(user: SupabaseUser | null): ClientAuthUser | null {
  if (!user) return null;
  return {
    uid: user.id,
    email: user.email || null,
    displayName: user.user_metadata?.full_name || user.user_metadata?.display_name || user.email?.split('@')[0] || null,
    isAnonymous: false,
    providerId: 'supabase',
  };
}

/**
 * Fetches user profile from Supabase `profiles` table by user ID (uid).
 */
export async function fetchSupabaseUserProfile(uid: string): Promise<FirestoreUserProfile | null> {
  if (!uid || !isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, technician_id, role, active, account_type, created_at, updated_at')
      .eq('id', uid)
      .maybeSingle();

    if (error || !data) {
      // Fallback: If profile row doesn't exist yet, construct from user metadata if possible
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user && userData.user.id === uid) {
        const email = (userData.user.email || '').toLowerCase();
        let determinedRole: AppRole = 'technician';
        let isActive = false;
        let techId: number | null = userData.user.user_metadata?.technician_id ? Number(userData.user.user_metadata.technician_id) : null;
        if (email === 'admin@ntiapps.net' || userData.user.user_metadata?.role === 'system_admin' || userData.user.user_metadata?.role === 'admin') {
          determinedRole = 'system_admin';
          isActive = true;
          techId = userData.user.user_metadata?.technician_id ? Number(userData.user.user_metadata.technician_id) : null;
        } else if (email === 'desi@ntiapps.net' || userData.user.user_metadata?.role === 'operations_admin') {
          determinedRole = 'operations_admin';
          isActive = true;
          techId = userData.user.user_metadata?.technician_id ? Number(userData.user.user_metadata.technician_id) : null;
        } else if (email === getSupervisorCanonicalEmail().toLowerCase() || userData.user.user_metadata?.role === 'supervisor') {
          determinedRole = 'supervisor';
          isActive = true;
          techId = techId || 1;
        } else if (email === 'luthfi@ntiapps.net') {
          determinedRole = 'technician';
          isActive = true;
          techId = 1;
        } else if (email === 'kamal@ntiapps.net') {
          determinedRole = 'technician';
          isActive = false;
        }
        return {
          uid,
          email,
          display_name: userData.user.user_metadata?.display_name || email.split('@')[0] || 'User',
          technician_id: techId,
          role: determinedRole,
          active: isActive,
          account_type: determinedRole,
          created_at: userData.user.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return null;
    }

    return {
      uid: data.id,
      email: data.email || '',
      display_name: data.display_name || '',
      technician_id: data.technician_id != null ? Number(data.technician_id) : null,
      role: (data.role as AppRole) || 'technician',
      active: Boolean(data.active),
      account_type: data.account_type || 'technician',
      created_at: data.created_at || '',
      updated_at: data.updated_at || '',
    };
  } catch (err) {
    console.warn('[SupabaseAuth] Error fetching user profile:', err);
    return null;
  }
}

/**
 * Upserts / provisions user profile in `profiles` table
 */
export async function upsertSupabaseUserProfile(profile: Partial<FirestoreUserProfile> & { uid: string; email: string }): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('profiles').upsert(
      {
        id: profile.uid,
        email: profile.email,
        display_name: profile.display_name || profile.email.split('@')[0],
        technician_id: profile.technician_id ?? null,
        role: profile.role || 'technician',
        active: profile.active ?? true,
        account_type: profile.account_type || profile.role || 'technician',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
    if (error) {
      console.warn('[SupabaseAuth] Upsert profile warning:', error.message);
    }
    return !error;
  } catch (err) {
    console.warn('[SupabaseAuth] Failed to upsert profile:', err);
    return false;
  }
}

function normalizeEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  if (!trimmed.includes('@')) {
    return `${trimmed}@ntiapps.net`;
  }
  return trimmed;
}

/**
 * Signs in technician using Supabase Auth credentials.
 */
export async function signInTechnicianWithSupabase(
  emailInput: string,
  pass: string
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  if (!emailInput || !emailInput.trim() || !pass || !pass.trim()) {
    return {
      success: false,
      error: 'Email/Username dan password teknisi wajib diisi.',
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: 'Supabase Auth belum terkonfigurasi.',
    };
  }

  const normalizedEmail = normalizeEmail(emailInput);

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: pass.trim(),
    });

    if (error || !data.user) {
      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) {
        return {
          success: false,
          error: `Gagal terhubung ke server Supabase (${getSupabaseUrl()}). Silakan klik tombol 'Tes Supabase' untuk memeriksa Project URL.`,
        };
      }

      if (msg.includes('invalid login credentials')) {
        return {
          success: false,
          error: `Email atau kata sandi yang Anda masukkan salah. Silakan periksa kembali.`,
        };
      }
      if (msg.includes('email not confirmed')) {
        return {
          success: false,
          error: `Akun '${normalizedEmail}' belum diverifikasi. Silakan hubungi Administrator.`,
        };
      }
      return {
        success: false,
        error: error?.message || 'Email atau kata sandi yang Anda masukkan salah.',
      };
    }

    const clientUser = sanitizeSupabaseUser(data.user);
    if (!clientUser) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'Gagal melakukan otentikasi akun teknisi.',
      };
    }

    // Hard reject inactive accounts immediately (Kamal)
    if (clientUser.email?.toLowerCase() === 'kamal@ntiapps.net') {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'Akun Anda berstatus nonaktif. Silakan hubungi Administrator.',
      };
    }

    let profile = await fetchSupabaseUserProfile(clientUser.uid);
    if (!profile) {
      // Auto-provision profile if first-time login
      const cleanEmail = normalizedEmail.toLowerCase();
      let determinedRole: AppRole = 'technician';
      let isActive = false;
      let techId: number | null = data.user.user_metadata?.technician_id ? Number(data.user.user_metadata.technician_id) : null;

      if (cleanEmail === 'admin@ntiapps.net' || data.user.user_metadata?.role === 'system_admin' || data.user.user_metadata?.role === 'admin') {
        determinedRole = 'system_admin';
        isActive = true;
        techId = data.user.user_metadata?.technician_id ? Number(data.user.user_metadata.technician_id) : null;
      } else if (cleanEmail === 'desi@ntiapps.net' || data.user.user_metadata?.role === 'operations_admin') {
        determinedRole = 'operations_admin';
        isActive = true;
        techId = data.user.user_metadata?.technician_id ? Number(data.user.user_metadata.technician_id) : null;
      } else if (cleanEmail === getSupervisorCanonicalEmail().toLowerCase() || data.user.user_metadata?.role === 'supervisor') {
        determinedRole = 'supervisor';
        isActive = true;
        techId = techId || 1;
      } else if (cleanEmail === 'luthfi@ntiapps.net') {
        determinedRole = 'technician';
        isActive = true;
        techId = 1;
      } else if (cleanEmail === 'kamal@ntiapps.net') {
        determinedRole = 'technician';
        isActive = false;
      }

      const defaultProfile: FirestoreUserProfile = {
        uid: clientUser.uid,
        email: clientUser.email || normalizedEmail.trim(),
        display_name: data.user.user_metadata?.display_name || clientUser.displayName || normalizedEmail.split('@')[0],
        technician_id: techId,
        role: determinedRole,
        active: isActive,
        account_type: determinedRole,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await upsertSupabaseUserProfile(defaultProfile);
      profile = defaultProfile;
    }

    if (!profile.active) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'Akun Anda berstatus nonaktif. Silakan hubungi Administrator.',
      };
    }

    return {
      success: true,
      data: {
        user: clientUser,
        profile,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Terjadi kesalahan saat masuk dengan Supabase.',
    };
  }
}

/**
 * Registers a new user directly in Supabase Auth and creates profile.
 * Can be used on mobile without needing CLI or Supabase Dashboard.
 */
export async function registerUserWithSupabase(
  emailInput: string,
  pass: string,
  displayName: string,
  role: 'technician' | 'supervisor' = 'supervisor',
  technicianId?: number | null
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  if (!emailInput || !emailInput.trim() || !pass || !pass.trim() || !displayName || !displayName.trim()) {
    return {
      success: false,
      error: 'Nama, email, dan kata sandi wajib diisi.',
    };
  }

  if (pass.trim().length < 6) {
    return {
      success: false,
      error: 'Kata sandi minimal 6 karakter.',
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: 'Supabase Auth belum terkonfigurasi pada sistem.',
    };
  }

  const normalizedEmail = normalizeEmail(emailInput);
  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: pass.trim(),
      options: {
        data: {
          display_name: displayName.trim(),
          role,
          account_type: role,
          technician_id: technicianId ?? null,
        },
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('user already exists')) {
        return {
          success: false,
          error: `Email '${normalizedEmail}' sudah terdaftar. Silakan gunakan menu Masuk dengan kata sandi Anda.`,
        };
      }
      return {
        success: false,
        error: error.message || 'Gagal mendaftarkan akun di Supabase.',
      };
    }

    if (!data.user) {
      return {
        success: false,
        error: 'Gagal membuat akun. Silakan periksa kembali data Anda.',
      };
    }

    const clientUser = sanitizeSupabaseUser(data.user);
    const newProfile: FirestoreUserProfile = {
      uid: data.user.id,
      email: normalizedEmail,
      display_name: displayName.trim(),
      technician_id: technicianId ?? null,
      role,
      active: true,
      account_type: role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Upsert profile in `profiles` table
    await upsertSupabaseUserProfile(newProfile);

    // If session is already created (email confirmation is off or auto-confirmed)
    if (!data.session) {
      // Try to sign in immediately
      const loginAttempt = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: pass.trim(),
      });
      if (loginAttempt.data?.session && loginAttempt.data?.user) {
        return {
          success: true,
          data: {
            user: sanitizeSupabaseUser(loginAttempt.data.user) || clientUser!,
            profile: newProfile,
          },
        };
      }
    }

    return {
      success: true,
      data: {
        user: clientUser!,
        profile: newProfile,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Terjadi kesalahan sistem saat mendaftarkan akun.',
    };
  }
}

/**
 * Signs in supervisor using Supabase Auth.
 */
export async function signInSupervisorWithSupabase(
  pass: string,
  supervisorEmailOverride?: string
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  if (!pass || !pass.trim()) {
    return {
      success: false,
      error: 'Password supervisor salah atau akses tidak tersedia.',
    };
  }

  const supervisorEmail = (supervisorEmailOverride || getSupervisorCanonicalEmail()).trim();

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: 'Supabase Auth belum terkonfigurasi.',
    };
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: supervisorEmail,
      password: pass.trim(),
    });

    if (error || !data.user) {
      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) {
        return {
          success: false,
          error: `Gagal terhubung ke server Supabase (${getSupabaseUrl()}). Silakan klik tombol 'Tes Supabase' untuk memeriksa Project URL.`,
        };
      }
      if (msg.includes('invalid login credentials')) {
        return {
          success: false,
          error: `Password atau email supervisor salah. Silakan periksa kembali kredensial Anda.`,
        };
      }
      if (msg.includes('email not confirmed')) {
        return {
          success: false,
          error: `Akun supervisor belum aktif atau diverifikasi. Silakan hubungi Administrator.`,
        };
      }
      return {
        success: false,
        error: error?.message || 'Password supervisor salah atau akses tidak tersedia.',
      };
    }

    const clientUser = sanitizeSupabaseUser(data.user);
    if (!clientUser) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'Password supervisor salah atau akses tidak tersedia.',
      };
    }

    let profile = await fetchSupabaseUserProfile(clientUser.uid);
    if (!profile) {
      // Auto-provision supervisor profile if needed
      const supProfile: FirestoreUserProfile = {
        uid: clientUser.uid,
        email: supervisorEmail,
        display_name: 'Supervisor',
        technician_id: null,
        role: 'supervisor',
        active: true,
        account_type: 'supervisor',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await upsertSupabaseUserProfile(supProfile);
      profile = supProfile;
    }

    if (!profile.active || (profile.role !== 'supervisor' && profile.role !== 'system_admin' && profile.role !== 'admin')) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'Password supervisor salah atau akses tidak tersedia.',
      };
    }

    return {
      success: true,
      data: {
        user: clientUser,
        profile,
      },
    };
  } catch {
    return {
      success: false,
      error: 'Password supervisor salah atau akses tidak tersedia.',
    };
  }
}

export const MAX_SESSION_DURATION_MS = 16 * 60 * 60 * 1000; // 16 hours max from login
export const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours idle timeout

const SESSION_LOGIN_TIME_KEY = 'faskampen_session_login_time';
const SESSION_LAST_ACTIVE_KEY = 'faskampen_session_last_active';

export function recordSessionLogin(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now().toString();
  try {
    localStorage.setItem(SESSION_LOGIN_TIME_KEY, now);
    localStorage.setItem(SESSION_LAST_ACTIVE_KEY, now);
  } catch (_) {}
}

export function recordUserActivity(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_LAST_ACTIVE_KEY, Date.now().toString());
  } catch (_) {}
}

export function clearSessionTracking(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_LOGIN_TIME_KEY);
    localStorage.removeItem(SESSION_LAST_ACTIVE_KEY);
  } catch (_) {}
}

export function validateSessionTimeout(): { valid: boolean; reason?: 'MAX_DURATION_EXCEEDED' | 'INACTIVITY_TIMEOUT' } {
  if (typeof window === 'undefined') return { valid: true };
  try {
    const loginTimeStr = localStorage.getItem(SESSION_LOGIN_TIME_KEY);
    const lastActiveStr = localStorage.getItem(SESSION_LAST_ACTIVE_KEY);
    const now = Date.now();

    if (loginTimeStr) {
      const loginTime = parseInt(loginTimeStr, 10);
      if (!isNaN(loginTime) && now - loginTime > MAX_SESSION_DURATION_MS) {
        return { valid: false, reason: 'MAX_DURATION_EXCEEDED' };
      }
    }

    if (lastActiveStr) {
      const lastActive = parseInt(lastActiveStr, 10);
      if (!isNaN(lastActive) && now - lastActive > INACTIVITY_TIMEOUT_MS) {
        return { valid: false, reason: 'INACTIVITY_TIMEOUT' };
      }
    }
  } catch (_) {}
  return { valid: true };
}

/**
 * Signs out from Supabase Auth
 */
export async function signOutSupabase(): Promise<AuthOperationResult<void>> {
  clearSessionTracking();
  if (!isSupabaseConfigured()) return { success: true };
  try {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Attempts a genuine session refresh/recovery for active Supabase Auth user.
 * Returns the fresh access token, or null if cannot recover.
 */
export async function refreshSupabaseSession(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  // Enforce session timeout bounds before refreshing
  const timeoutCheck = validateSessionTimeout();
  if (!timeoutCheck.valid) {
    console.warn('[SupabaseAuth] Cannot refresh session: session expired due to timeout limits:', timeoutCheck.reason);
    return null;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data?.session?.access_token) {
      try {
        localStorage.setItem('supabase_access_token', data.session.access_token);
        recordUserActivity();
      } catch (_) {}
      return data.session.access_token;
    }
  } catch (_) {}
  return null;
}

/**
 * Subscribes to Supabase Auth State changes & handles Session Restore
 */
export function subscribeSupabaseAuthState(onChange: (state: AuthState) => void): () => void {
  if (!isSupabaseConfigured()) {
    onChange({
      user: null,
      profile: null,
      isAuthenticated: false,
      isAuthorized: false,
      role: null,
      isLoading: false,
      error: 'Supabase Auth belum terkonfigurasi.',
    });
    return () => {};
  }

  const supabase = getSupabaseClient();

  // Activity tracker (throttled every 60s)
  let lastRecordedActivity = Date.now();
  const handleUserActivity = () => {
    const now = Date.now();
    if (now - lastRecordedActivity > 60000) {
      lastRecordedActivity = now;
      recordUserActivity();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleUserActivity, { passive: true });
    window.addEventListener('touchstart', handleUserActivity, { passive: true });
  }

  // Periodic session timeout checker (runs every 60 seconds)
  const intervalId = setInterval(async () => {
    const sessionCheck = validateSessionTimeout();
    if (!sessionCheck.valid) {
      console.warn('[SupabaseAuth] Session duration limit reached, terminating session:', sessionCheck.reason);
      // Dispatch draft save event before logout
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('faskampen-session-timeout-save', { detail: { reason: sessionCheck.reason } }));
      }
      clearSessionTracking();
      try {
        await supabase.auth.signOut();
      } catch (_) {}
      onChange({
        user: null,
        profile: null,
        isAuthenticated: false,
        isAuthorized: false,
        role: null,
        isLoading: false,
        error:
          sessionCheck.reason === 'MAX_DURATION_EXCEEDED'
            ? 'Sesi login telah mencapai batas maksimal 16 jam. Draft data telah tersimpan. Silakan login kembali.'
            : 'Sesi berakhir karena tidak ada aktivitas selama 6 jam. Draft data telah tersimpan. Silakan login kembali.',
      });
    }
  }, 60000);

  // Initial session restoration
  supabase.auth
    .getSession()
    .then(async ({ data: { session } }) => {
      if (!session?.user) {
        clearSessionTracking();
        try {
          localStorage.removeItem('supabase_access_token');
        } catch (_) {}
        onChange({
          user: null,
          profile: null,
          isAuthenticated: false,
          isAuthorized: false,
          role: null,
          isLoading: false,
          error: null,
        });
        return;
      }

      // Check session limits on initial load
      const timeoutCheck = validateSessionTimeout();
      if (!timeoutCheck.valid) {
        clearSessionTracking();
        try {
          await supabase.auth.signOut();
        } catch (_) {}
        onChange({
          user: null,
          profile: null,
          isAuthenticated: false,
          isAuthorized: false,
          role: null,
          isLoading: false,
          error: 'Sesi login telah kedaluwarsa. Silakan login kembali.',
        });
        return;
      }

      // Ensure session tracking is initialized if missing
      if (!localStorage.getItem(SESSION_LOGIN_TIME_KEY)) {
        recordSessionLogin();
      } else {
        recordUserActivity();
      }

      if (session?.access_token) {
        try {
          localStorage.setItem('supabase_access_token', session.access_token);
        } catch (_) {}
      }

      try {
        const clientUser = sanitizeSupabaseUser(session.user);
        const profile = await fetchSupabaseUserProfile(session.user.id);
        const isKamal = session.user.email?.toLowerCase() === 'kamal@ntiapps.net';
        const isAuthorized = Boolean(profile && profile.active && !isKamal);

        if (isKamal || (profile && !profile.active)) {
          clearSessionTracking();
          try {
            await supabase.auth.signOut();
          } catch (_) {}
          onChange({
            user: null,
            profile: null,
            isAuthenticated: false,
            isAuthorized: false,
            role: null,
            isLoading: false,
            error: 'Akun Anda berstatus nonaktif. Silakan hubungi Administrator.',
          });
          return;
        }

        onChange({
          user: clientUser,
          profile,
          isAuthenticated: true,
          isAuthorized,
          role: isAuthorized && profile ? profile.role : null,
          isLoading: false,
          error: !profile ? 'Profil pengguna tidak ditemukan.' : !profile.active ? 'Akun berstatus nonaktif.' : null,
        });
      } catch (profileErr: any) {
        onChange({
          user: null,
          profile: null,
          isAuthenticated: false,
          isAuthorized: false,
          role: null,
          isLoading: false,
          error: profileErr?.message || 'Gagal memuat profil',
        });
      }
    })
    .catch((sessionErr) => {
      onChange({
        user: null,
        profile: null,
        isAuthenticated: false,
        isAuthorized: false,
        role: null,
        isLoading: false,
        error: sessionErr?.message || null,
      });
    });

  // Auth state change listener (Decoupled profile load to prevent Supabase callback deadlock)
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (session?.access_token) {
      try {
        localStorage.setItem('supabase_access_token', session.access_token);
        if (event === 'SIGNED_IN') {
          recordSessionLogin();
        } else {
          recordUserActivity();
        }
      } catch (_) {}
    } else if (event === 'SIGNED_OUT') {
      clearSessionTracking();
      try {
        localStorage.removeItem('supabase_access_token');
      } catch (_) {}
    }

    if (event === 'SIGNED_OUT' || !session?.user) {
      onChange({
        user: null,
        profile: null,
        isAuthenticated: false,
        isAuthorized: false,
        role: null,
        isLoading: false,
        error: null,
      });
      return;
    }

    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      const clientUser = sanitizeSupabaseUser(session.user);
      // Decouple profile fetch out of the auth lock callback to prevent mutex deadlock
      setTimeout(async () => {
        try {
          const profile = await fetchSupabaseUserProfile(session.user.id);
          const isKamal = session.user.email?.toLowerCase() === 'kamal@ntiapps.net';
          const isAuthorized = Boolean(profile && profile.active && !isKamal);

          if (isKamal || (profile && !profile.active)) {
            clearSessionTracking();
            try {
              await supabase.auth.signOut();
            } catch (_) {}
            onChange({
              user: null,
              profile: null,
              isAuthenticated: false,
              isAuthorized: false,
              role: null,
              isLoading: false,
              error: 'Akun Anda berstatus nonaktif. Silakan hubungi Administrator.',
            });
            return;
          }

          onChange({
            user: clientUser,
            profile,
            isAuthenticated: true,
            isAuthorized,
            role: isAuthorized && profile ? profile.role : null,
            isLoading: false,
            error: !profile ? 'Profil pengguna tidak ditemukan.' : !profile.active ? 'Akun berstatus nonaktif.' : null,
          });
        } catch (profileErr: any) {
          onChange({
            user: clientUser,
            profile: null,
            isAuthenticated: true,
            isAuthorized: false,
            role: null,
            isLoading: false,
            error: profileErr?.message || 'Gagal memuat profil',
          });
        }
      }, 0);
    }
  });

  return () => {
    clearInterval(intervalId);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
    }
    subscription.unsubscribe();
  };
}
