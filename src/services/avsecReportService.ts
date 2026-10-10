/**
 * AVSEC ERROR REPORTING SERVICE
 * 
 * Handles public QR error reporting workflows for AVSEC personnel
 * and internal review/acknowledgment/conversion flows for Technicians & Supervisors.
 */

import { ExternalErrorReport, ExternalReportStatus } from '../types';
import { getAuthHeaders } from './authService';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';

export interface PublicEquipmentInfo {
  id: number;
  public_id: string;
  name: string;
  equipment_code?: string;
  location_name?: string;
  brand?: string;
  model?: string;
  type?: string;
}

export interface ReportSessionResponse {
  success: boolean;
  session_id: string;
  expires_at: number;
  error?: string;
}

export interface SubmitReportPayload {
  session_id: string;
  public_id: string;
  reporter_name: string;
  reporter_unit?: string;
  issue_type: string;
  description: string;
  photo_object_key?: string;
  photo_url?: string;
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy?: number | null;
}

export interface SubmitReportResponse {
  success: boolean;
  report_number?: string;
  created_at?: string;
  error?: string;
}

// 1. PUBLIC ENDPOINTS (NO INTERNAL AUTH REQUIRED)

/**
 * Validates public equipment ID from scanned QR URL
 */
export async function fetchPublicEquipment(publicId: string): Promise<{ success: boolean; equipment?: PublicEquipmentInfo; error?: string }> {
  try {
    const res = await fetch(`/api/public/equipment/${encodeURIComponent(publicId)}`);
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal memvalidasi kode QR mesin' };
  }
}

/**
 * Creates temporary 10-minute report session
 */
export async function createReportSession(publicId: string): Promise<ReportSessionResponse> {
  try {
    const res = await fetch('/api/public/report-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_id: publicId }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, session_id: '', expires_at: 0, error: err.message || 'Gagal membuat sesi laporan' };
  }
}

/**
 * Uploads incident photo to private IDCloudHost S3 under !Kantor/2. Foto Laporan/...
 */
export async function uploadAvsecIncidentPhoto(
  sessionId: string,
  base64Data: string,
  fileName?: string
): Promise<{ success: boolean; object_key?: string; photo_url?: string; error?: string }> {
  try {
    const res = await fetch('/api/public/upload-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        image_base64: base64Data,
        file_name: fileName,
      }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal mengunggah foto laporan' };
  }
}

/**
 * Submits AVSEC incident error report
 */
export async function submitAvsecErrorReport(payload: SubmitReportPayload): Promise<SubmitReportResponse> {
  try {
    const res = await fetch('/api/public/submit-error-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal mengirim laporan gangguan' };
  }
}

// 2. INTERNAL ENDPOINTS (TECHNICIAN / SUPERVISOR AUTH REQUIRED)

/**
 * Fetches all external AVSEC error reports with optional status filter
 */
export async function fetchAvsecErrorReports(
  statusFilter?: ExternalReportStatus | 'ALL'
): Promise<{ success: boolean; reports: ExternalErrorReport[]; error?: string; statusCode?: number }> {
  try {
    const url = statusFilter && statusFilter !== 'ALL'
      ? `/api/avsec-reports?status=${encodeURIComponent(statusFilter)}`
      : '/api/avsec-reports';
    const authHeaders = await getAuthHeaders();
    const res = await fetch(url, { headers: authHeaders });

    if (res.ok) {
      const data = await res.json();
      return { success: true, reports: data.reports || [] };
    }

    // Direct Supabase query fallback if API returns 401/error or server is unreachable
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseClient();
        let query = supabase
          .from('external_error_reports')
          .select('*')
          .order('created_at', { ascending: false });

        if (statusFilter && statusFilter !== 'ALL') {
          query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          return { success: true, reports: data as ExternalErrorReport[] };
        }
      } catch (_) {}
    }

    if (res.status === 401) {
      return {
        success: false,
        reports: [],
        statusCode: 401,
        error: 'Sesi login telah kedaluwarsa atau belum terautentikasi. Silakan refresh halaman atau login kembali.',
      };
    }

    return { success: false, reports: [], statusCode: res.status, error: `HTTP ${res.status}: Gagal memuat data laporan AVSEC` };
  } catch (err: any) {
    // Supabase fallback on network exception
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseClient();
        let query = supabase
          .from('external_error_reports')
          .select('*')
          .order('created_at', { ascending: false });

        if (statusFilter && statusFilter !== 'ALL') {
          query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          return { success: true, reports: data as ExternalErrorReport[] };
        }
      } catch (_) {}
    }

    return {
      success: false,
      reports: [],
      error: err.message || 'Terjadi kesalahan jaringan saat memuat laporan AVSEC.',
    };
  }
}

/**
 * Acknowledges an AVSEC error report
 */
export async function acknowledgeAvsecReport(
  reportId: string | number,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/avsec-reports/${encodeURIComponent(String(reportId))}/acknowledge`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ notes }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal mengonfirmasi laporan' };
  }
}

/**
 * Converts an AVSEC report to Corrective Action record
 */
export async function convertAvsecReportToCorrective(
  reportId: string | number,
  correctiveData: {
    action_taken: string;
    result: string;
    result_text?: string;
    notes?: string;
    technicians?: string[];
  }
): Promise<{ success: boolean; corrective_code?: string; error?: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/avsec-reports/${encodeURIComponent(String(reportId))}/convert-to-corrective`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(correctiveData),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal mengonversi ke Corrective' };
  }
}

/**
 * Closes an AVSEC report as false alarm / non-issue
 */
export async function closeAvsecReport(
  reportId: string | number,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/avsec-reports/${encodeURIComponent(String(reportId))}/close`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ notes }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal menutup laporan' };
  }
}

/**
 * Deletes an AVSEC report and cleans up its photo in S3 storage (Supervisor only)
 */
export async function deleteAvsecReport(
  reportId: string | number
): Promise<{ success: boolean; error?: string }> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/avsec-reports/${encodeURIComponent(String(reportId))}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal menghapus laporan AVSEC' };
  }
}
