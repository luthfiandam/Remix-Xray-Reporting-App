import { getAuthHeaders } from './authService';

export interface BackupItem {
  filename: string;
  size_bytes: number;
  size_kb: string;
  created_at: string;
  type: string;
}

export interface BackupSummary {
  technicians_count: number;
  equipment_count: number;
  attendance_count: number;
  preventive_count: number;
  corrective_count: number;
  schedules_count: number;
  avsec_reports_count: number;
  storage_objects_count: number;
}

export async function fetchBackupList(): Promise<BackupItem[]> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/backup/list', {
      headers: { ...authHeaders },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.backups || [];
  } catch (err) {
    console.warn('Gagal memuat daftar backup:', err);
    return [];
  }
}

export async function triggerManualBackup(userDisplayName?: string): Promise<{
  success: boolean;
  message: string;
  backup?: any;
}> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/backup/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ user: userDisplayName || 'Supervisor' }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, message: err.message || 'Gagal menjalankan backup' };
  }
}

export function getBackupDownloadUrl(filename: string): string {
  return `/api/backup/download/${encodeURIComponent(filename)}`;
}

export async function deleteBackupFile(filename: string): Promise<boolean> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/backup/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      headers: { ...authHeaders },
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('Gagal menghapus file backup:', err);
    return false;
  }
}

export async function restoreBackupData(payload: any): Promise<{ success: boolean; message: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, message: err.message || 'Gagal memulihkan backup' };
  }
}
