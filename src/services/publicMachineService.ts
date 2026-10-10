/**
 * Service for fetching Public Machine History (Read-Only Guest Mode)
 * Calls the public endpoint /api/public/equipment/:equipmentCode/history
 */

export interface PublicEquipmentInfo {
  id: number;
  equipment_code: string;
  name: string;
  type: string;
  brand: string;
  model: string;
  serial_number: string;
  location: string;
  status: string;
  installation_year: number | null;
  description?: string;
}

export interface PublicPreventiveItem {
  date: string;
  frequency: string;
  status: string;
  summary: string;
  technician_name: string;
}

export interface PublicCorrectiveItem {
  date: string;
  code: string;
  problem: string;
  action: string;
  result: string;
  root_cause: string;
  technicians: string[];
  completion_date?: string;
}

export interface PublicComponentReplacementItem {
  date: string;
  component_name: string;
  part_number: string;
  quantity: number;
  reason: string;
  origin: string;
  technicians: string[];
  remarks?: string;
}

export interface PublicMachineHistoryData {
  equipment: PublicEquipmentInfo;
  stats: {
    total_preventive: number;
    total_corrective: number;
    total_replacements: number;
    last_preventive_date: string | null;
    last_corrective_date: string | null;
  };
  preventive_history: PublicPreventiveItem[];
  corrective_history: PublicCorrectiveItem[];
  component_replacements: PublicComponentReplacementItem[];
}

export interface PublicHistoryResult {
  success: boolean;
  data?: PublicMachineHistoryData;
  error?: string;
}

export async function fetchPublicMachineHistory(equipmentCode: string): Promise<PublicHistoryResult> {
  const cleanCode = (equipmentCode || '').trim();
  if (!cleanCode) {
    return { success: false, error: 'Kode atau nomor mesin tidak valid.' };
  }

  try {
    const res = await fetch(`/api/public/equipment/${encodeURIComponent(cleanCode)}/history`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const json = await res.json();
    if (res.ok && json.success && json.data) {
      return { success: true, data: json.data };
    }

    return {
      success: false,
      error: json.error || `Gagal memuat riwayat mesin (${res.status})`,
    };
  } catch (err: any) {
    console.error('[PublicMachineService] Error:', err);
    return {
      success: false,
      error: 'Tidak dapat terhubung ke server. Pastikan koneksi internet aktif.',
    };
  }
}
