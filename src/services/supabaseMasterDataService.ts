import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { Equipment, EquipmentType, Location, Technician, Role } from '../types';
import { INITIAL_EQUIPMENTS } from '../data/initialData';

/**
 * Service to automatically synchronize Master Data (Lokasi, Jenis Mesin, Equipment, Teknisi)
 * directly with Supabase Postgres tables.
 */

let hasPermissionIssue = false;
let lastSupabaseError: string | null = null;
const loggedActions = new Set<string>();

export function getSupabaseMasterDataStatus() {
  return {
    hasPermissionIssue,
    lastError: lastSupabaseError,
  };
}

export const SUPABASE_GRANT_PERMISSIONS_SQL = `-- ==============================================================================
-- SQL PERBAIKAN: IZIN AKSES (GRANT & RLS HARDENED) TABEL SUPABASE POSTGRESQL
-- Jalankan script ini di Supabase Dashboard > SQL Editor > New Query > Run
-- ==============================================================================

-- 1. Berikan hak akses schema public
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Hak akses tabel terkontrol
GRANT SELECT ON TABLE public.lokasi TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.jenis_mesin TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.equipment TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.technicians TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.preventive_records TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.corrective_records TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.shift_schedules TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.component_replacements TO anon, authenticated, service_role;

-- 3. Berikan izin sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 4. Kebijakan Row Level Security (RLS) Terproteksi
ALTER TABLE public.lokasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to lokasi" ON public.lokasi;
DROP POLICY IF EXISTS "Allow read lokasi" ON public.lokasi;
CREATE POLICY "Allow read lokasi" ON public.lokasi FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.jenis_mesin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to jenis_mesin" ON public.jenis_mesin;
DROP POLICY IF EXISTS "Allow read jenis_mesin" ON public.jenis_mesin;
CREATE POLICY "Allow read jenis_mesin" ON public.jenis_mesin FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to equipment" ON public.equipment;
DROP POLICY IF EXISTS "Allow read equipment" ON public.equipment;
CREATE POLICY "Allow read equipment" ON public.equipment FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow read technicians" ON public.technicians;
CREATE POLICY "Allow read technicians" ON public.technicians FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

ALTER TABLE public.preventive_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to preventive_records" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow read preventive_records" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow insert preventive_records" ON public.preventive_records;
DROP POLICY IF EXISTS "Allow update preventive_records" ON public.preventive_records;
CREATE POLICY "Allow read preventive_records" ON public.preventive_records FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert preventive_records" ON public.preventive_records FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update preventive_records" ON public.preventive_records FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.corrective_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to corrective_records" ON public.corrective_records;
DROP POLICY IF EXISTS "Allow read corrective_records" ON public.corrective_records;
DROP POLICY IF EXISTS "Allow insert corrective_records" ON public.corrective_records;
DROP POLICY IF EXISTS "Allow update corrective_records" ON public.corrective_records;
CREATE POLICY "Allow read corrective_records" ON public.corrective_records FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert corrective_records" ON public.corrective_records FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update corrective_records" ON public.corrective_records FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to shift_schedules" ON public.shift_schedules;
DROP POLICY IF EXISTS "Allow read shift_schedules" ON public.shift_schedules;
CREATE POLICY "Allow read shift_schedules" ON public.shift_schedules FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.component_replacements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to component_replacements" ON public.component_replacements;
DROP POLICY IF EXISTS "Allow read component_replacements" ON public.component_replacements;
CREATE POLICY "Allow read component_replacements" ON public.component_replacements FOR SELECT TO anon, authenticated USING (true);
`;

let hasTableMissingIssue = false;

function handleSupabaseError(action: string, error?: any) {
  const msg: string = error?.message || (typeof error === 'string' ? error : 'Unknown error');
  const isPermission = msg.toLowerCase().includes('permission denied') || error?.code === '42501';
  const isTableMissing =
    msg.toLowerCase().includes('could not find the table') ||
    msg.toLowerCase().includes('schema cache') ||
    error?.code === 'PGRST205' ||
    error?.code === '42P01';

  if (isTableMissing) {
    hasTableMissingIssue = true;
    lastSupabaseError = msg;
    if (!loggedActions.has(action)) {
      loggedActions.add(action);
      console.info(
        `[SupabaseMasterData] ${action}: Tabel belum dibuat di Supabase (${msg}). Data tetap aman tersimpan di cache lokal.`
      );
    }
  } else if (isPermission) {
    hasPermissionIssue = true;
    lastSupabaseError = msg;
    // Log once as informational note without triggering loud App Warning toast in dev preview
    if (!loggedActions.has(action)) {
      loggedActions.add(action);
      console.info(
        `[SupabaseMasterData] ${action}: Izin tabel Postgres belum diberikan (RLS/Permissions). Menggunakan data lokal/cache.`
      );
    }
  } else {
    lastSupabaseError = msg;
    if (!loggedActions.has(action)) {
      loggedActions.add(action);
      console.warn(`[SupabaseMasterData] ${action}:`, msg);
    }
  }
}

export async function fetchLocationsFromSupabase(): Promise<Location[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('lokasi')
      .select('*')
      .order('id', { ascending: true });

    if (error || !data) {
      handleSupabaseError('Gagal fetch lokasi dari Supabase', error);
      return null;
    }

    return data.map((row: any) => ({
      id: Number(row.id),
      code: row.kode_lokasi || row.code || `LOC-${row.id}`,
      name: row.nama_lokasi || row.name || `Lokasi ${row.id}`,
      active: row.active ?? true,
    }));
  } catch (err) {
    handleSupabaseError('Supabase fetch lokasi exception', err);
    return null;
  }
}

export async function fetchEquipmentTypesFromSupabase(): Promise<EquipmentType[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('jenis_mesin')
      .select('*')
      .order('id', { ascending: true });

    if (error || !data) {
      handleSupabaseError('Gagal fetch jenis_mesin dari Supabase', error);
      return null;
    }

    return data.map((row: any) => ({
      id: Number(row.id),
      code: row.kode_jenis || row.code || `TYPE-${row.id}`,
      name: row.nama_jenis || row.name || `Jenis ${row.id}`,
      priority: Number(row.priority) || 1,
      active: row.active ?? true,
    }));
  } catch (err) {
    handleSupabaseError('Supabase fetch jenis_mesin exception', err);
    return null;
  }
}

export async function fetchEquipmentsFromSupabase(): Promise<Equipment[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .order('id', { ascending: true });

    if (error || !data) {
      handleSupabaseError('Gagal fetch equipment dari Supabase', error);
      return null;
    }

    return data.map((row: any) => {
      const eqId = Number(row.id);
      const fallbackInit = INITIAL_EQUIPMENTS.find((ie) => ie.id === eqId);
      let parsedDefaultMeasurements = row.default_measurements;
      if (typeof parsedDefaultMeasurements === 'string') {
        try {
          parsedDefaultMeasurements = JSON.parse(parsedDefaultMeasurements);
        } catch (_) {
          parsedDefaultMeasurements = null;
        }
      }
      if (!Array.isArray(parsedDefaultMeasurements) || parsedDefaultMeasurements.length === 0) {
        parsedDefaultMeasurements = fallbackInit?.default_measurements || [];
      }

      const defaultView = row.default_view || fallbackInit?.default_view || 'single';

      return {
        id: eqId,
        equipment_code: row.equipment_code || fallbackInit?.equipment_code || `EQ-${eqId}`,
        equipment_type_id: Number(row.jenis_equipment_id || row.equipment_type_id || fallbackInit?.equipment_type_id || 1),
        location_id: Number(row.lokasi_id || row.location_id || fallbackInit?.location_id || 1),
        name: row.nama || row.name || fallbackInit?.name || `Equipment #${eqId}`,
        brand: row.merk || row.brand || fallbackInit?.brand || '-',
        type: row.tipe || row.type || fallbackInit?.type || '-',
        model: row.model || fallbackInit?.model || null,
        serial_number: row.serial_number || fallbackInit?.serial_number || '-',
        default_view: defaultView,
        default_view_type: defaultView,
        default_measurements: parsedDefaultMeasurements,
        active: row.active ?? fallbackInit?.active ?? true,
      };
    });
  } catch (err) {
    handleSupabaseError('Supabase fetch equipment exception', err);
    return null;
  }
}

// ============================================================================
// MUTATION OPERATIONS (SYNC TO SUPABASE)
// ============================================================================

export async function syncLocationToSupabase(loc: Location): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('lokasi').upsert(
      {
        id: loc.id,
        kode_lokasi: loc.code,
        nama_lokasi: loc.name,
        active: loc.active,
      },
      { onConflict: 'id' }
    );
    if (error) {
      handleSupabaseError('Supabase save lokasi error', error);
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase save lokasi exception', err);
    return false;
  }
}

export async function deleteLocationFromSupabase(id: number): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('lokasi').delete().eq('id', id);
    if (error) {
      handleSupabaseError('Supabase delete lokasi error', error);
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase delete lokasi exception', err);
    return false;
  }
}

export async function syncEquipmentTypeToSupabase(type: EquipmentType): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('jenis_mesin').upsert(
      {
        id: type.id,
        kode_jenis: type.code,
        nama_jenis: type.name,
        priority: type.priority || 1,
        active: type.active,
      },
      { onConflict: 'id' }
    );
    if (error) {
      handleSupabaseError('Supabase save jenis_mesin error', error);
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase save jenis_mesin exception', err);
    return false;
  }
}

export async function deleteEquipmentTypeFromSupabase(id: number): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('jenis_mesin').delete().eq('id', id);
    if (error) {
      handleSupabaseError('Supabase delete jenis_mesin error', error);
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase delete jenis_mesin exception', err);
    return false;
  }
}

export async function syncEquipmentToSupabase(eq: Equipment): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('equipment').upsert(
      {
        id: eq.id,
        equipment_code: eq.equipment_code || `EQ-${eq.id}`,
        jenis_equipment_id: eq.equipment_type_id,
        lokasi_id: eq.location_id,
        nama: eq.name,
        merk: eq.brand || '-',
        tipe: eq.type || '-',
        model: eq.model || null,
        serial_number: eq.serial_number || '-',
        default_view: eq.default_view || 'single',
        active: eq.active,
      },
      { onConflict: 'id' }
    );
    if (error) {
      handleSupabaseError('Supabase save equipment error', error);
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase save equipment exception', err);
    return false;
  }
}

export async function deleteEquipmentFromSupabase(id: number): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('equipment').delete().eq('id', id);
    if (error) {
      handleSupabaseError('Supabase delete equipment error', error);
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase delete equipment exception', err);
    return false;
  }
}

// ============================================================================
// TECHNICIANS & USER ACCOUNTS (SUPABASE TABLE: technicians)
// ============================================================================

export async function fetchTechniciansFromSupabase(): Promise<Technician[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseClient();
    // Security Hardening: Never select password column on client queries
    const { data, error } = await supabase
      .from('technicians')
      .select('id, code, name, email, role, active')
      .order('id', { ascending: true });

    if (error || !data) {
      handleSupabaseError('Gagal fetch technicians dari Supabase', error);
      return null;
    }

    return data.map((row: any) => ({
      id: Number(row.id),
      code: row.code || `TECH-0${row.id}`,
      name: row.name || `Teknisi ${row.id}`,
      email: row.email || '',
      role: (row.role as Role) || 'technician',
      active: row.active ?? true,
    }));
  } catch (err) {
    handleSupabaseError('Supabase fetch technicians exception', err);
    return null;
  }
}

export async function syncTechnicianToSupabase(tech: Technician): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    // Security Hardening: Never send password column from client to technicians table
    const payload: any = {
      id: tech.id,
      code: tech.code || `TECH-0${tech.id}`,
      name: tech.name,
      email: tech.email || `${tech.name.toLowerCase().replace(/\s+/g, '')}@bandara.id`,
      role: tech.role || 'technician',
      active: tech.active ?? true,
    };
    const { error } = await supabase.from('technicians').upsert(
      payload,
      { onConflict: 'id' }
    );
    if (error) {
      if (error.message?.toLowerCase().includes('row-level security') || error.code === '42501') {
        console.info('[SupabaseTechnicians] Mutasi teknisi dibatasi hanya untuk System Administrator (RLS enforced).');
      } else {
        handleSupabaseError('Supabase save technician error', error);
      }
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase save technician exception', err);
    return false;
  }
}

export async function deleteTechnicianFromSupabase(id: number): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('technicians').delete().eq('id', id);
    if (error) {
      if (error.message?.toLowerCase().includes('row-level security') || error.code === '42501') {
        console.info('[SupabaseTechnicians] Hapus teknisi dibatasi hanya untuk System Administrator (RLS enforced).');
      } else {
        handleSupabaseError('Supabase delete technician error', error);
      }
      return false;
    }
    return true;
  } catch (err) {
    handleSupabaseError('Supabase delete technician exception', err);
    return false;
  }
}

export async function checkTechniciansTableStatus(): Promise<{
  exists: boolean;
  message?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { exists: false, message: 'Koneksi Supabase belum dikonfigurasi.' };
  }
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('technicians').select('id').limit(1);
    if (!error) {
      return { exists: true };
    }
    const msg = error.message || '';
    const isMissing =
      msg.toLowerCase().includes('could not find the table') ||
      msg.toLowerCase().includes('schema cache') ||
      error.code === 'PGRST205' ||
      error.code === '42P01';

    if (isMissing) {
      return {
        exists: false,
        message: "Tabel 'public.technicians' belum dibuat di database Supabase Anda.",
      };
    }
    return { exists: true, message: msg };
  } catch (err: any) {
    return {
      exists: false,
      message: err?.message || 'Gagal memeriksa status tabel technicians di Supabase.',
    };
  }
}

export function getTechniciansTableSql(): string {
  return `-- ============================================================
-- 1. BUAT TABEL TECHNICIANS (TEKNISI & AKUN LOGIN)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.technicians (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(50) DEFAULT 'technician',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BERIKAN HAK AKSES API KE SUPABASE
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.technicians TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.technicians TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 3. AKTIFKAN ROW LEVEL SECURITY (RLS)
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to technicians" ON public.technicians;
DROP POLICY IF EXISTS "Allow read technicians" ON public.technicians;
CREATE POLICY "Allow read technicians" ON public.technicians FOR SELECT TO anon, authenticated USING (true);
`;
}


