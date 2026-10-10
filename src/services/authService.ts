import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import {
  signInTechnicianWithSupabase,
  signInSupervisorWithSupabase,
  signOutSupabase,
  subscribeSupabaseAuthState,
  fetchSupabaseUserProfile,
  registerUserWithSupabase,
  refreshSupabaseSession,
} from './supabaseAuthService';
import {
  fetchTechniciansFromSupabase,
  syncTechnicianToSupabase,
} from './supabaseMasterDataService';
import { INITIAL_TECHNICIANS } from '../data/initialData';
import { Technician } from '../types';
import { formatPersonName } from '../utils/entityLookup';
import {
  AuthState,
  ClientAuthUser,
  FirestoreUserProfile,
  AuthOperationResult,
} from '../types/auth';

const TECHNICIAN_SESSION_KEY = 'faskampen_technicians_table_auth_session';
const TECHNICIAN_TOKEN_KEY = 'faskampen_technician_token';

/**
 * Returns active authentication token.
 * Strictly prioritizes Supabase Auth Access Token over legacy tokens.
 */
export async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  // 1. Supabase Auth Session Token (Primary)
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) {
        try {
          localStorage.setItem('supabase_access_token', data.session.access_token);
        } catch (_) {}
        return data.session.access_token;
      }
    } catch (_) {}

    // Fallback: Check cached supabase access token
    try {
      const cachedSupabaseToken = localStorage.getItem('supabase_access_token');
      if (cachedSupabaseToken) return cachedSupabaseToken;
    } catch (_) {}
  }

  // 2. Legacy Technician Token (Fallback only when Supabase Auth has no active session)
  try {
    const techToken =
      localStorage.getItem(TECHNICIAN_TOKEN_KEY) ||
      localStorage.getItem('nti_technician_token');
    if (techToken) return techToken;
  } catch {}

  return null;
}

/**
 * Recovers or refreshes active user session.
 */
export async function refreshAuthSession(): Promise<string | null> {
  if (isSupabaseConfigured()) {
    return refreshSupabaseSession();
  }
  return getAuthToken();
}

/**
 * Returns Authorization header object for secure backend API requests
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
      'x-technician-token': token,
    };
  }
  return {};
}

/**
 * Reads any active technician table session from local storage.
 */
export function getActiveTechnicianSession(): Technician | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TECHNICIAN_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Saves or clears active technician table session.
 */
export function setActiveTechnicianSession(tech: Technician | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (tech) {
      localStorage.setItem(TECHNICIAN_SESSION_KEY, JSON.stringify(tech));
    } else {
      localStorage.removeItem(TECHNICIAN_SESSION_KEY);
      localStorage.removeItem(TECHNICIAN_TOKEN_KEY);
    }
  } catch {}
  window.dispatchEvent(new Event('faskampen-tech-auth-change'));
}

/**
 * Builds user and profile structures from a Technician record.
 */
export function buildAuthFromTechnician(tech: Technician): {
  user: ClientAuthUser;
  profile: FirestoreUserProfile;
} {
  // Enforce Luthfi as standard technician account
  const isLuthfi = tech.id === 1 || (tech.name || '').trim().toLowerCase() === 'luthfi' || (tech.email || '').toLowerCase().includes('luthfi');
  const role = isLuthfi ? 'technician' : (tech.role || 'technician');
  const email = tech.email || `${tech.code.toLowerCase().replace(/[^a-z0-9]/g, '')}@bandara.id`;
  const uid = `tech_${tech.id}`;
  const formattedName = formatPersonName(tech.name);
  return {
    user: {
      uid,
      email,
      displayName: formattedName,
      isAnonymous: false,
      providerId: 'technicians',
    },
    profile: {
      uid,
      email,
      display_name: formattedName,
      technician_id: tech.id,
      role,
      active: tech.active ?? true,
      account_type: role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * Fetches all available technicians (Supabase table first, then local cache, then initial fallback).
 */
export async function getAllTechniciansList(): Promise<Technician[]> {
  const sanitizeTechRoles = (list: Technician[]) =>
    list.map((t) => {
      const isLuthfi = t.id === 1 || (t.name || '').trim().toLowerCase() === 'luthfi' || (t.email || '').toLowerCase().includes('luthfi');
      return {
        ...t,
        name: formatPersonName(t.name),
        role: isLuthfi ? ('technician' as const) : t.role,
      };
    });

  try {
    if (isSupabaseConfigured()) {
      const remote = await fetchTechniciansFromSupabase();
      if (remote && remote.length > 0) {
        return sanitizeTechRoles(remote);
      }
    }
  } catch {}

  // Fallback to local storage
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('master_technicians');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return sanitizeTechRoles(parsed);
        }
      }
    } catch {}
  }

  return sanitizeTechRoles(INITIAL_TECHNICIANS);
}

/**
 * Authenticates user directly against the backend (/api/auth/technician-login)
 * Supports server-side bcrypt hashing & lazy migration.
 */
export async function signInWithTechniciansTable(
  identifier: string,
  pass?: string
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  const cleanId = (identifier || '').trim();
  if (!cleanId) {
    return {
      success: false,
      error: 'Nama, kode ID, atau email wajib diisi.',
    };
  }

  // 1. Attempt secure backend authentication (with salt/pepper & lazy hash upgrade)
  try {
    const res = await fetch('/api/auth/technician-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        identifier: cleanId,
        password: pass || '',
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (res.ok && data.success && data.user) {
        if (data.token) {
          localStorage.setItem(TECHNICIAN_TOKEN_KEY, data.token);
        }
        const techUser: Technician = {
          id: data.user.id,
          code: data.user.code || `TECH-0${data.user.id}`,
          name: data.user.name,
          email: data.user.email || '',
          role: data.user.role || 'technician',
          active: true,
        };
        setActiveTechnicianSession(techUser);
        return {
          success: true,
          data: buildAuthFromTechnician(techUser),
        };
      } else if (!res.ok) {
        return {
          success: false,
          error: data.error || `Autentikasi gagal (Status ${res.status})`,
        };
      }
    }
  } catch (backendErr) {
    console.warn('[AuthService] Backend login unreachable, checking local fallback:', backendErr);
  }

  // 2. Offline / Local fallback
  const list = await getAllTechniciansList();
  const matched = list.find((t) => {
    const nameMatch = (t.name || '').trim().toLowerCase() === cleanId.toLowerCase();
    const codeMatch = (t.code || '').trim().toLowerCase() === cleanId.toLowerCase();
    const emailMatch = (t.email || '').trim().toLowerCase() === cleanId.toLowerCase();
    return nameMatch || codeMatch || emailMatch;
  });

  if (!matched) {
    return {
      success: false,
      error: `Akun "${identifier}" tidak ditemukan pada daftar teknisi / supervisor.`,
    };
  }

  if (matched.active === false) {
    return {
      success: false,
      error: `Akun "${matched.name}" saat ini berstatus non-aktif.`,
    };
  }

  // Set active session
  setActiveTechnicianSession(matched);
  const authData = buildAuthFromTechnician(matched);

  return {
    success: true,
    data: authData,
  };
}

/**
 * Registers a new technician/supervisor directly into the technicians table.
 */
export async function registerTechnicianToTable(
  name: string,
  role: 'supervisor' | 'technician' = 'technician',
  password?: string,
  code?: string,
  email?: string
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    return { success: false, error: 'Nama teknisi / supervisor wajib diisi.' };
  }

  // Try backend registration if supervisor token is present
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/auth/technician-register', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: cleanName,
        role,
        password: password || '',
        code,
        email,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.technician) {
        const createdTech: Technician = {
          id: data.technician.id,
          name: data.technician.name,
          code: data.technician.code,
          email: data.technician.email,
          role: data.technician.role,
          active: true,
        };
        return {
          success: true,
          data: buildAuthFromTechnician(createdTech),
        };
      }
    }
  } catch (_) {}

  const currentList = await getAllTechniciansList();
  const nextId = currentList.length > 0 ? Math.max(...currentList.map((t) => t.id)) + 1 : 1;
  const nextCode = (code || (role === 'supervisor' ? `SPV-0${nextId}` : `TECH-0${nextId}`)).trim().toUpperCase();
  const cleanEmail = (email || `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}@bandara.id`).trim().toLowerCase();

  const newTech: Technician = {
    id: nextId,
    name: cleanName,
    code: nextCode,
    email: cleanEmail,
    role,
    active: true,
  };

  // Sync to Supabase table
  try {
    if (isSupabaseConfigured()) {
      await syncTechnicianToSupabase(newTech);
    }
  } catch {}

  // Update local storage
  if (typeof window !== 'undefined') {
    try {
      const updated = [...currentList, newTech];
      localStorage.setItem('master_technicians', JSON.stringify(updated));
    } catch {}
  }

  setActiveTechnicianSession(newTech);
  return {
    success: true,
    data: buildAuthFromTechnician(newTech),
  };
}

/**
 * Controlled Authentication Provider Guard:
 * Returns true if Supabase is configured.
 */
export function isSupabaseAuthEnabled(): boolean {
  return isSupabaseConfigured();
}

/**
 * Fetches application user profile from Supabase profiles table.
 */
export async function fetchUserProfile(uid: string): Promise<FirestoreUserProfile | null> {
  if (!uid) return null;
  const techSession = getActiveTechnicianSession();
  if (techSession && `tech_${techSession.id}` === uid) {
    return buildAuthFromTechnician(techSession).profile;
  }
  return fetchSupabaseUserProfile(uid);
}

export const GENERIC_SUPERVISOR_AUTH_ERROR = 'Password supervisor salah atau akses tidak tersedia.';

/**
 * Resolves the canonical supervisor email from environment variable VITE_SUPERVISOR_EMAIL.
 * Default fallback is 'supervisor@bandara.id'.
 */
export function getSupervisorCanonicalEmail(): string {
  const envEmail = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPERVISOR_EMAIL) || '';
  return (envEmail || 'supervisor@bandara.id').trim();
}

/**
 * Validates whether a user profile meets supervisor authorization criteria.
 * Strictly requires role === 'supervisor' and active === true.
 */
export function validateSupervisorProfile(profile: FirestoreUserProfile | null): { isValid: boolean; error: string | null } {
  if (!profile) {
    return { isValid: false, error: GENERIC_SUPERVISOR_AUTH_ERROR };
  }
  if (!profile.active || profile.role !== 'supervisor') {
    return { isValid: false, error: GENERIC_SUPERVISOR_AUTH_ERROR };
  }
  return { isValid: true, error: null };
}

/**
 * Signs in technician or supervisor strictly using Supabase Auth credentials.
 */
export async function signInTechnicianWithCredentials(
  email: string,
  pass: string
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  if (!email || !email.trim() || !pass || !pass.trim()) {
    return {
      success: false,
      error: 'Email dan password wajib diisi.',
    };
  }

  // Pure Supabase GoTrue Auth
  if (isSupabaseAuthEnabled()) {
    return signInTechnicianWithSupabase(email, pass);
  }

  return {
    success: false,
    error: 'Supabase Auth belum aktif atau belum dikonfigurasi.',
  };
}

/**
 * Signs in supervisor strictly using Supabase Auth.
 */
export async function signInSupervisorWithPassword(
  pass: string,
  supervisorEmailOverride?: string
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  const cleanPass = (pass || '').trim();
  if (!cleanPass) {
    return {
      success: false,
      error: GENERIC_SUPERVISOR_AUTH_ERROR,
    };
  }

  // Pure Supabase GoTrue Auth
  if (isSupabaseAuthEnabled()) {
    const canonicalEmail = supervisorEmailOverride || getSupervisorCanonicalEmail();
    return signInSupervisorWithSupabase(cleanPass, canonicalEmail);
  }

  return {
    success: false,
    error: GENERIC_SUPERVISOR_AUTH_ERROR,
  };
}

/**
 * Signs out Technician
 */
export async function signOutTechnician(): Promise<AuthOperationResult<void>> {
  setActiveTechnicianSession(null);
  if (isSupabaseAuthEnabled()) {
    return signOutSupabase();
  }
  return { success: true };
}

/**
 * Registers a new user (technician or supervisor) strictly in Supabase Auth.
 */
export async function registerUser(
  emailInput: string,
  pass: string,
  displayName: string,
  role: 'technician' | 'supervisor' = 'supervisor',
  technicianId?: number | null
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  return registerUserWithSupabase(emailInput, pass, displayName, role, technicianId);
}

/**
 * Supervisor Password Login (via technicians table or Supabase Auth)
 */
export async function signInSupervisorFast(
  passwordInput: string
): Promise<AuthOperationResult<{ user: ClientAuthUser; profile: FirestoreUserProfile }>> {
  return signInSupervisorWithPassword(passwordInput);
}

import { clearAuthenticatedImageCache } from '../utils/evidenceUtils';

/**
 * Signs out active user and clears local operational state.
 */
export async function signOutUser(): Promise<AuthOperationResult<void>> {
  // 1. Clear technicians table session & token
  setActiveTechnicianSession(null);

  // Clear authenticated image blob memory cache
  try {
    clearAuthenticatedImageCache();
  } catch (_) {}

  // 2. Sign out from Supabase Auth
  try {
    if (isSupabaseConfigured()) {
      await signOutSupabase();
    }
  } catch {}

  // 3. Clear non-critical operational caches
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('faskampen_v2_operational_shift_session');
      localStorage.removeItem('faskampen_attendance_history');
      localStorage.removeItem(TECHNICIAN_TOKEN_KEY);
      sessionStorage.removeItem('faskampen_active_tab');
      sessionStorage.removeItem('faskampen_master_sub_tab');
    } catch {}

    window.dispatchEvent(new Event('faskampen-auth-change'));
  }

  return { success: true };
}

export const logoutAllAccounts = signOutUser;

/**
 * Authoritative Auth State Subscriber:
 * Supabase Auth is the primary source of truth.
 * Stale localStorage technician session cannot override an authenticated Supabase user.
 */
export function subscribeAuthState(onChange: (state: AuthState) => void): () => void {
  let isSupabaseActive = false;
  let supabaseUnsub = () => {};

  const handleTechSessionFallback = (): boolean => {
    const techSession = getActiveTechnicianSession();
    if (!isSupabaseActive && techSession && techSession.active !== false) {
      const { user, profile } = buildAuthFromTechnician(techSession);
      onChange({
        user,
        profile,
        isAuthenticated: true,
        isAuthorized: true,
        role: profile.role,
        isLoading: false,
        error: null,
      });
      return true;
    }
    return false;
  };

  // 1. Primary: Subscribe to Supabase GoTrue Auth
  if (isSupabaseAuthEnabled()) {
    supabaseUnsub = subscribeSupabaseAuthState((s) => {
      if (s.isAuthenticated && s.user) {
        isSupabaseActive = true;
        onChange(s);
      } else {
        isSupabaseActive = false;
        const hasLegacy = handleTechSessionFallback();
        if (!hasLegacy) {
          onChange(s);
        }
      }
    });
  } else {
    handleTechSessionFallback();
  }

  // 2. Legacy event listeners for technician session changes
  const handleTechAuthChange = () => {
    if (!isSupabaseActive) {
      if (!handleTechSessionFallback()) {
        onChange({
          user: null,
          profile: null,
          isAuthenticated: false,
          isAuthorized: false,
          role: null,
          isLoading: false,
          error: null,
        });
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('faskampen-tech-auth-change', handleTechAuthChange);
    window.addEventListener('storage', handleTechAuthChange);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('faskampen-tech-auth-change', handleTechAuthChange);
      window.removeEventListener('storage', handleTechAuthChange);
    }
    supabaseUnsub();
  };
}
