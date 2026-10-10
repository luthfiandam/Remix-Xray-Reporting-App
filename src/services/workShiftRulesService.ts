import { getJakartaDate, getJakartaDateString } from '../utils/dateTimeUtils';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';

export type ShiftCategory = 'OFFICE' | 'PS' | 'M';

export interface WorkShiftRule {
  id?: number;
  shift_code: 'OFFICE' | 'PS' | 'M';
  shift_name: string;
  start_time: string; // "HH:mm:ss"
  duration_minutes: number;
  check_in_start_offset: number; // minutes from start_time
  check_in_ontime_end_offset: number;
  check_in_late_end_offset: number;
  check_out_start_offset: number;
  check_out_end_offset: number;
  timezone: string;
  is_cross_day: boolean;
  is_active: boolean;
}

export interface StaffWorkPattern {
  id?: number;
  user_id?: string; // profiles.id (UUID)
  technician_id?: number; // technicians.id
  staff_name: string;
  work_pattern: 'OFFICE' | 'ROTATING' | 'MANUAL';
  fixed_shift_code?: 'OFFICE' | 'PS' | 'M';
  anchor_date?: string; // YYYY-MM-DD
  anchor_phase?: 'PS' | 'M' | 'LIBUR1' | 'LIBUR2';
  active_days?: number[]; // [0,1,2,3,4,5,6] (0 = Sunday)
  is_active: boolean;
}

/**
 * Baseline canonical rules hardcoded as infallible fallback if DB is offline or table not yet migrated.
 * Aligned with specification:
 * OFFICE: 08:00:00 - 17:00:00 WIB (Senin - Minggu)
 *   - Masuk: 06:00:00 - 08:15:00 TEPAT WAKTU, >08:15:00 - 10:00:00 TERLAMBAT, >10:00:00 TIDAK ABSEN MASUK
 *   - Pulang: 16:00:00 - 20:00:00 DIIZINKAN, >20:00:00 TIDAK ABSEN PULANG
 * PS: 07:00:00 - 18:59:59 WIB
 *   - Masuk: 06:00:00 - 07:15:00 TEPAT WAKTU, >07:15:00 - 10:00:00 TERLAMBAT, >10:00:00 TIDAK ABSEN MASUK
 *   - Pulang: 18:30:00 - 20:00:00 DIIZINKAN, >20:00:00 TIDAK ABSEN PULANG
 * M: 19:00:00 - 06:59:59 WIB (keesokan harinya)
 *   - Masuk: 18:00:00 - 19:15:00 TEPAT WAKTU, >19:15:00 - 22:00:00 TERLAMBAT, >22:00:00 TIDAK ABSEN MASUK
 *   - Pulang: 06:30:00 - 08:00:00 keesokan harinya DIIZINKAN, >08:00:00 TIDAK ABSEN PULANG
 */
export const DEFAULT_WORK_SHIFT_RULES: Record<ShiftCategory, WorkShiftRule> = {
  OFFICE: {
    shift_code: 'OFFICE',
    shift_name: 'Office Hour',
    start_time: '08:00:00',
    duration_minutes: 9 * 60, // 08:00 to 17:00 (540 mins)
    check_in_start_offset: -120, // 06:00:00
    check_in_ontime_end_offset: 15, // 08:15:00
    check_in_late_end_offset: 120, // 10:00:00
    check_out_start_offset: 8 * 60, // 16:00:00 (480 mins)
    check_out_end_offset: 12 * 60, // 20:00:00 (720 mins)
    timezone: 'Asia/Jakarta',
    is_cross_day: false,
    is_active: true,
  },
  PS: {
    shift_code: 'PS',
    shift_name: 'Shift Pagi',
    start_time: '07:00:00',
    duration_minutes: 12 * 60, // 07:00 to 19:00 (720 mins)
    check_in_start_offset: -60, // 06:00:00
    check_in_ontime_end_offset: 15, // 07:15:00
    check_in_late_end_offset: 180, // 10:00:00
    check_out_start_offset: 11 * 60 + 30, // 18:30:00 (690 mins)
    check_out_end_offset: 13 * 60, // 20:00:00 (780 mins)
    timezone: 'Asia/Jakarta',
    is_cross_day: false,
    is_active: true,
  },
  M: {
    shift_code: 'M',
    shift_name: 'Shift Malam',
    start_time: '19:00:00',
    duration_minutes: 12 * 60, // 19:00 to 07:00 next day (720 mins)
    check_in_start_offset: -60, // 18:00:00
    check_in_ontime_end_offset: 15, // 19:15:00
    check_in_late_end_offset: 180, // 22:00:00
    check_out_start_offset: 11 * 60 + 30, // 06:30:00 next day (690 mins)
    check_out_end_offset: 13 * 60, // 08:00:00 next day (780 mins)
    timezone: 'Asia/Jakarta',
    is_cross_day: true,
    is_active: true,
  },
};

/**
 * Baseline canonical staff patterns:
 * Desi: Administrator (OFFICE, Every Day [0,1,2,3,4,5,6])
 * Luthfi: Technician (OFFICE, Every Day [0,1,2,3,4,5,6])
 * Zaky: ROTATING (Anchor 2026-05-01 PS)
 * Yoan: ROTATING (Anchor 2026-10-01 PS)
 * Fariz: ROTATING (Anchor 2026-10-02 PS -> 1 Okt M)
 * Reza: ROTATING (Anchor 2026-10-03 PS -> 1 Okt LIBUR1)
 */
export const DEFAULT_STAFF_WORK_PATTERNS: StaffWorkPattern[] = [
  {
    staff_name: 'Desi',
    technician_id: 8,
    work_pattern: 'OFFICE',
    fixed_shift_code: 'OFFICE',
    active_days: [0, 1, 2, 3, 4, 5, 6],
    is_active: true,
  },
  {
    staff_name: 'Luthfi',
    technician_id: 1,
    work_pattern: 'OFFICE',
    fixed_shift_code: 'OFFICE',
    active_days: [0, 1, 2, 3, 4, 5, 6],
    is_active: true,
  },
  {
    staff_name: 'Zaky',
    technician_id: 2,
    work_pattern: 'ROTATING',
    anchor_date: '2026-05-01',
    anchor_phase: 'PS',
    is_active: true,
  },
  {
    staff_name: 'Reza',
    technician_id: 3,
    work_pattern: 'ROTATING',
    anchor_date: '2026-10-03',
    anchor_phase: 'PS',
    is_active: true,
  },
  {
    staff_name: 'Yoan',
    technician_id: 4,
    work_pattern: 'ROTATING',
    anchor_date: '2026-10-01',
    anchor_phase: 'PS',
    is_active: true,
  },
  {
    staff_name: 'Fariz',
    technician_id: 5,
    work_pattern: 'ROTATING',
    anchor_date: '2026-10-02',
    anchor_phase: 'PS',
    is_active: true,
  },
  {
    staff_name: 'Kamal',
    technician_id: 9,
    work_pattern: 'ROTATING',
    is_active: false,
  },
];

let cachedRules: Record<ShiftCategory, WorkShiftRule> | null = null;
let cachedRulesExpiry = 0;

let cachedPatterns: StaffWorkPattern[] | null = null;
let cachedPatternsExpiry = 0;

const CACHE_TTL_MS = 60 * 1000; // 1 minute client cache

/**
 * Loads work_shift_rules from Supabase database with instant fallback to defaults.
 */
export async function getWorkShiftRules(): Promise<Record<ShiftCategory, WorkShiftRule>> {
  const now = Date.now();
  if (cachedRules && now < cachedRulesExpiry) {
    return cachedRules;
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('work_shift_rules')
        .select('*')
        .eq('is_active', true);

      if (!error && Array.isArray(data) && data.length > 0) {
        const result: Record<ShiftCategory, WorkShiftRule> = { ...DEFAULT_WORK_SHIFT_RULES };
        data.forEach((r: any) => {
          if (r.shift_code === 'OFFICE' || r.shift_code === 'PS' || r.shift_code === 'M') {
            result[r.shift_code as ShiftCategory] = {
              ...DEFAULT_WORK_SHIFT_RULES[r.shift_code as ShiftCategory],
              ...r,
            };
          }
        });
        cachedRules = result;
        cachedRulesExpiry = now + CACHE_TTL_MS;
        return result;
      }
    } catch (_) {}
  }

  cachedRules = { ...DEFAULT_WORK_SHIFT_RULES };
  cachedRulesExpiry = now + CACHE_TTL_MS;
  return cachedRules;
}

/**
 * Loads staff_work_patterns from Supabase database with fallback to defaults.
 */
export async function getStaffWorkPatterns(): Promise<StaffWorkPattern[]> {
  const now = Date.now();
  if (cachedPatterns && now < cachedPatternsExpiry) {
    return cachedPatterns;
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('staff_work_patterns')
        .select('*')
        .eq('is_active', true);

      if (!error && Array.isArray(data) && data.length > 0) {
        cachedPatterns = data as StaffWorkPattern[];
        cachedPatternsExpiry = now + CACHE_TTL_MS;
        return cachedPatterns;
      }
    } catch (_) {}
  }

  cachedPatterns = [...DEFAULT_STAFF_WORK_PATTERNS];
  cachedPatternsExpiry = now + CACHE_TTL_MS;
  return cachedPatterns;
}
