/**
 * Audit Log Service (With Supabase Persistence)
 * Tracks and persists user activities, login sessions, report submissions, deletions, and attendance.
 * Dedicated table in Supabase: `audit_activity_logs` (or fallback `audit_logs`).
 */

import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';

export type AuditActionType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'PREVENTIVE_INPUT'
  | 'CORRECTIVE_INPUT'
  | 'CORRECTIVE_UPDATE'
  | 'CORRECTIVE_DELETE'
  | 'AVSEC_REPORT'
  | 'AVSEC_CONVERT'
  | 'AVSEC_DELETE'
  | 'ATTENDANCE'
  | 'SYSTEM_CONFIG';

export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO string with WIB offset
  user_name: string;
  role: 'supervisor' | 'technician' | 'avsec' | 'system' | 'admin' | 'system_admin' | 'operations_admin';
  action_type: AuditActionType;
  title: string;
  details: string;
  metadata?: Record<string, any>;
}

const AUDIT_STORAGE_KEY = 'nti_audit_activity_logs_v1';

// Initial sample logs if empty
const DEFAULT_INITIAL_LOGS: AuditLogEntry[] = [
  {
    id: 'log-001',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
    user_name: 'Supervisor Utama',
    role: 'supervisor',
    action_type: 'LOGIN',
    title: 'Login Supervisor',
    details: 'User Supervisor Utama berhasil masuk ke sesi On-Duty.',
  },
  {
    id: 'log-002',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    user_name: 'Luthfi',
    role: 'technician',
    action_type: 'ATTENDANCE',
    title: 'Presensi Masuk',
    details: 'Presensi Masuk Shift PS (Lokasi: Terverifikasi dalam radius).',
  },
  {
    id: 'log-003',
    timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(),
    user_name: 'Zaky',
    role: 'technician',
    action_type: 'PREVENTIVE_INPUT',
    title: 'Input Preventive Maintenance',
    details: 'Menyimpan hasil pemeriksaan rutin X-Ray Pintu Laud (Shift PS).',
  },
];

/**
 * Get all stored audit logs from LocalStorage
 */
export function getAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(DEFAULT_INITIAL_LOGS));
      return DEFAULT_INITIAL_LOGS;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[AuditLog] Error reading local logs:', err);
    return DEFAULT_INITIAL_LOGS;
  }
}

/**
 * Fetch latest audit logs directly from Supabase table `audit_activity_logs`
 */
export async function fetchAuditLogsFromSupabase(): Promise<AuditLogEntry[]> {
  if (!isSupabaseConfigured()) {
    return getAuditLogs();
  }

  const client = getSupabaseClient();
  if (!client) return getAuditLogs();

  try {
    // 1. Try fetching from dedicated table `audit_activity_logs`
    let { data, error } = await client
      .from('audit_activity_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(500);

    // 2. Fallback to `audit_logs` if table name is different
    if (error || !data) {
      const res = await client
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(500);
      data = res.data;
      error = res.error;
    }

    if (error || !data) {
      console.warn('[AuditLog] Supabase fetch error or table empty, using local cache:', error);
      return getAuditLogs();
    }

    const logs: AuditLogEntry[] = data.map((row: any) => ({
      id: String(row.id || row.log_id || Date.now()),
      timestamp: row.timestamp || row.created_at || new Date().toISOString(),
      user_name: row.user_name || row.user_display_name || row.user || 'Pengguna',
      role: (row.role || row.user_role || 'technician').toLowerCase() as any,
      action_type: (row.action_type || row.action || 'SYSTEM').toUpperCase() as any,
      title: row.title || row.action_title || 'Aktivitas Sistem',
      details: row.details || row.description || row.message || '',
      metadata: row.metadata || undefined,
    }));

    // Update local cache
    if (logs.length > 0) {
      try {
        localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(logs));
      } catch (_) {}
    }

    return logs;
  } catch (err) {
    console.warn('[AuditLog] Exception fetching logs from Supabase:', err);
    return getAuditLogs();
  }
}

/**
 * Log a new user activity event (Saves locally & persists to Supabase)
 */
export function recordAuditLog(entry: {
  user_name: string;
  role?: 'supervisor' | 'technician' | 'avsec' | 'system' | 'admin' | 'system_admin' | 'operations_admin';
  action_type: AuditActionType;
  title: string;
  details: string;
  metadata?: Record<string, any>;
}): AuditLogEntry {
  const logs = getAuditLogs();

  const newLog: AuditLogEntry = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    user_name: entry.user_name || 'Pengguna',
    role: entry.role || 'technician',
    action_type: entry.action_type,
    title: entry.title,
    details: entry.details,
    metadata: entry.metadata,
  };

  const updatedLogs = [newLog, ...logs].slice(0, 500); // Keep last 500 logs
  try {
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(updatedLogs));
  } catch (e) {
    console.warn('[AuditLog] Storage write error:', e);
  }

  // Background Insert into Supabase table `audit_activity_logs`
  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    if (client) {
      const payload = {
        id: newLog.id,
        timestamp: newLog.timestamp,
        user_name: newLog.user_name,
        role: newLog.role,
        action_type: newLog.action_type,
        title: newLog.title,
        details: newLog.details,
        metadata: newLog.metadata || {},
      };

      // Fire & forget background insert into `audit_activity_logs`
      (async () => {
        try {
          const { error } = await client.from('audit_activity_logs').insert([payload]);
          if (error) {
            // Try fallback table `audit_logs`
            await client.from('audit_logs').insert([payload]);
          }
        } catch (_) {}
      })();
    }
  }

  // Background fallback API server sync
  try {
    fetch('/api/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLog),
    }).catch(() => {});
  } catch (_) {}

  return newLog;
}

/**
 * Clear or reset local logs
 */
export function clearAuditLogs(): void {
  try {
    localStorage.removeItem(AUDIT_STORAGE_KEY);
  } catch (_) {}
}
