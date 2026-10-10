import React, { useState, useEffect, useMemo } from 'react';
import { AttendanceRecord, Technician } from '../types';
import { getProxySafeImageUrl, registerPresignedUrls } from '../utils/evidenceUtils';
import { resolveBatchPresignedUrls } from '../services/storageService';
import { S3Image } from './S3Image';
import {
  fetchAttendanceHistoryFromServer,
  getAllAttendanceHistory,
  getJakartaDateString,
  getJakartaDate,
} from '../services/attendanceService';
import {
  UserCheck,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Search,
  RefreshCw,
  MapPin,
  Coffee,
  LogOut,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  Sun,
  Moon,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { RosterScheduleModal } from './RosterScheduleModal';

interface SupervisorAttendanceViewProps {
  technicians?: Technician[];
}

export interface GroupedAttendanceRecord {
  key: string;
  attendance_date: string;
  technician_name: string;
  technician_id?: number;
  technician_code?: string;
  shift: string;
  checkInRecord?: AttendanceRecord;
  checkOutRecord?: AttendanceRecord;
  offDutyRecord?: AttendanceRecord;
  bypassRecord?: AttendanceRecord;
  rawStatus?: 'Tepat Waktu' | 'Telat' | 'Terlambat' | 'Sangat Terlambat' | 'Off Duty' | 'Bypass';
}

/**
 * Converts any casing to Proper Case (e.g. "FARIZ PRATAMA" -> "Fariz Pratama")
 */
function toProperCase(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Computes detailed late time (e.g., "Terlambat · 37 menit" or "Terlambat · 1 jam 15 mnt")
 */
function getLateCalculation(shift: string, attendanceTime?: string): { isLate: boolean; label: string; diffMinutes: number } {
  if (!attendanceTime) return { isLate: false, label: '', diffMinutes: 0 };

  const clean = attendanceTime.replace(/WIB/i, '').trim().replace(/\./g, ':');
  const match = clean.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { isLate: false, label: '', diffMinutes: 0 };

  const hour = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const totalMin = hour * 60 + min;

  const isNight = shift.toLowerCase().includes('malam') || shift === 'M';

  if (!isNight) {
    // Shift Pagi standard: 07:00 WIB (Tolerance 07:15)
    const startMin = 7 * 60;
    const tolMin = 7 * 60 + 15;
    if (totalMin > tolMin) {
      const diff = totalMin - startMin;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const timeStr = h > 0 ? `${h} jam ${m > 0 ? `${m} mnt` : ''}`.trim() : `${m} menit`;
      return { isLate: true, label: `Terlambat · ${timeStr}`, diffMinutes: diff };
    }
  } else {
    // Shift Malam standard: 19:00 WIB (Tolerance 19:15)
    const startMin = 19 * 60;
    const tolMin = 19 * 60 + 15;
    if (totalMin > tolMin && totalMin < 24 * 60) {
      const diff = totalMin - startMin;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const timeStr = h > 0 ? `${h} jam ${m > 0 ? `${m} mnt` : ''}`.trim() : `${m} menit`;
      return { isLate: true, label: `Terlambat · ${timeStr}`, diffMinutes: diff };
    } else if (totalMin < 12 * 60) {
      // Checked in past midnight
      const diff = (24 * 60 - startMin) + totalMin;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const timeStr = h > 0 ? `${h} jam ${m > 0 ? `${m} mnt` : ''}`.trim() : `${m} menit`;
      return { isLate: true, label: `Terlambat · ${timeStr}`, diffMinutes: diff };
    }
  }

  return { isLate: false, label: '', diffMinutes: 0 };
}

/**
 * Resolves automatic (Tidak Absen Masuk) and (Tidak Absen Pulang) rules:
 * - Masuk: If 3+ hours passed since shift start and technician has not clocked in -> "(Tidak Absen Masuk)"
 * - Pulang: If 4-5 hours passed since shift end and technician has not clocked out -> "(Tidak Absen Pulang)"
 */
function resolveAttendanceDisplay(item: GroupedAttendanceRecord) {
  const jkt = getJakartaDate();
  const currentCalendarDate = getJakartaDateString();
  const currentTotalMinutes = jkt.getHours() * 60 + jkt.getMinutes();

  const recordDate = item.attendance_date;
  const isNight = item.shift.toLowerCase().includes('malam') || item.shift === 'M';

  // 1. Resolve Jam Masuk
  let jamMasukDisplay = '-';
  let isTidakAbsenMasuk = false;

  if (item.offDutyRecord) {
    jamMasukDisplay = 'Off Duty';
  } else if (item.bypassRecord) {
    jamMasukDisplay = 'Bypass';
  } else if (item.checkInRecord) {
    jamMasukDisplay = item.checkInRecord.attendance_time || 'Masuk';
  } else {
    // Check if 3 hours elapsed since shift start
    if (!isNight) {
      // Shift Pagi start: 07:00 WIB. Threshold (+3 hours) = 10:00 WIB (600 mins)
      const passedLimit =
        currentCalendarDate > recordDate ||
        (currentCalendarDate === recordDate && currentTotalMinutes >= 10 * 60);

      if (passedLimit) {
        jamMasukDisplay = '(Tidak Absen Masuk)';
        isTidakAbsenMasuk = true;
      } else {
        jamMasukDisplay = 'Belum Masuk';
      }
    } else {
      // Shift Malam start: 19:00 WIB. Threshold (+3 hours) = 22:00 WIB (1320 mins)
      const passedLimit =
        currentCalendarDate > recordDate ||
        (currentCalendarDate === recordDate && currentTotalMinutes >= 22 * 60);

      if (passedLimit) {
        jamMasukDisplay = '(Tidak Absen Masuk)';
        isTidakAbsenMasuk = true;
      } else {
        jamMasukDisplay = 'Belum Masuk';
      }
    }
  }

  // 2. Resolve Jam Pulang
  let jamPulangDisplay = '-';
  let isTidakAbsenPulang = false;

  if (item.checkOutRecord) {
    jamPulangDisplay = item.checkOutRecord.attendance_time || 'Pulang';
  } else if (item.checkInRecord || item.bypassRecord) {
    // Has clocked in but no checkout record yet.
    // Check if 4.5 hours elapsed after shift ended
    if (!isNight) {
      // Shift Pagi end: 19:00 WIB. Threshold (+4.5 hours) = 23:30 WIB (1410 mins)
      const passedLimit =
        currentCalendarDate > recordDate ||
        (currentCalendarDate === recordDate && currentTotalMinutes >= 23 * 60 + 30);

      if (passedLimit) {
        jamPulangDisplay = '(Tidak Absen Pulang)';
        isTidakAbsenPulang = true;
      } else {
        jamPulangDisplay = 'Belum Pulang';
      }
    } else {
      // Shift Malam end: 07:00 WIB next day (D+1). Threshold (+4.5 hours) = 11:30 WIB next day
      const [y, m, d] = recordDate.split('-').map(Number);
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
      const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;

      const passedLimit =
        currentCalendarDate > nextDayStr ||
        (currentCalendarDate === nextDayStr && currentTotalMinutes >= 11 * 60 + 30);

      if (passedLimit) {
        jamPulangDisplay = '(Tidak Absen Pulang)';
        isTidakAbsenPulang = true;
      } else {
        jamPulangDisplay = 'Belum Pulang';
      }
    }
  }

  // 3. Resolve Overall Status Badge & Type
  let statusBadge = {
    label: 'Tepat Waktu',
    variant: 'emerald' as 'emerald' | 'rose' | 'amber' | 'slate' | 'purple' | 'red' | 'orange',
    icon: CheckCircle2,
  };

  const lateInfo = getLateCalculation(item.shift, item.checkInRecord?.attendance_time);

  if (item.offDutyRecord) {
    statusBadge = {
      label: 'Off Duty',
      variant: 'slate',
      icon: Coffee,
    };
  } else if (item.bypassRecord) {
    statusBadge = {
      label: 'Bypass Supervisor',
      variant: 'purple',
      icon: ShieldCheck,
    };
  } else if (isTidakAbsenMasuk) {
    statusBadge = {
      label: '(Tidak Absen Masuk)',
      variant: 'red',
      icon: AlertCircle,
    };
  } else if (jamMasukDisplay === 'Belum Masuk') {
    statusBadge = {
      label: 'Belum Masuk',
      variant: 'slate',
      icon: Clock,
    };
  } else if (isTidakAbsenPulang) {
    statusBadge = {
      label: lateInfo.isLate ? `${lateInfo.label} · (Tidak Absen Pulang)` : '(Tidak Absen Pulang)',
      variant: 'orange',
      icon: AlertTriangle,
    };
  } else if (lateInfo.isLate) {
    statusBadge = {
      label: lateInfo.label,
      variant: 'rose',
      icon: AlertTriangle,
    };
  } else if (jamPulangDisplay === 'Belum Pulang') {
    statusBadge = {
      label: 'Belum Pulang',
      variant: 'amber',
      icon: Clock,
    };
  } else {
    statusBadge = {
      label: 'Tepat Waktu',
      variant: 'emerald',
      icon: CheckCircle2,
    };
  }

  return {
    jamMasukDisplay,
    jamPulangDisplay,
    isTidakAbsenMasuk,
    isTidakAbsenPulang,
    isLate: lateInfo.isLate,
    lateLabel: lateInfo.label,
    statusBadge,
  };
}

export const SupervisorAttendanceView: React.FC<SupervisorAttendanceViewProps> = ({
  technicians = [],
}) => {
  const [records, setRecords] = useState<AttendanceRecord[]>(() => getAllAttendanceHistory());
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(getJakartaDateString());
  const [filterShift, setFilterShift] = useState<'ALL' | 'Pagi' | 'Malam'>('ALL');
  const [filterStatus, setFilterStatus] = useState<
    'ALL' | 'Tepat Waktu' | 'Terlambat' | 'Belum Masuk' | 'Belum Pulang' | 'Tidak Absen' | 'Off Duty'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewGroupRecord, setPreviewGroupRecord] = useState<GroupedAttendanceRecord | null>(null);
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  const loadAttendance = async (date?: string) => {
    setIsLoading(true);
    try {
      const liveRecords = await fetchAttendanceHistoryFromServer(date);
      setRecords(liveRecords);
    } catch (err) {
      console.warn('Error loading attendance records:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (records && records.length > 0) {
      const keysToResolve: string[] = [];
      records.forEach((r) => {
        if (r.photo_url) keysToResolve.push(r.photo_url);
        if (r.photo_object_key) keysToResolve.push(r.photo_object_key);
      });
      if (keysToResolve.length > 0) {
        resolveBatchPresignedUrls(keysToResolve).then((urlMap) => {
          registerPresignedUrls(urlMap);
        });
      }
    }
  }, [records]);

  useEffect(() => {
    if (previewGroupRecord) {
      const keys: string[] = [];
      if (previewGroupRecord.checkInRecord?.photo_url) keys.push(previewGroupRecord.checkInRecord.photo_url);
      if (previewGroupRecord.checkInRecord?.photo_object_key) keys.push(previewGroupRecord.checkInRecord.photo_object_key);
      if (previewGroupRecord.checkOutRecord?.photo_url) keys.push(previewGroupRecord.checkOutRecord.photo_url);
      if (previewGroupRecord.checkOutRecord?.photo_object_key) keys.push(previewGroupRecord.checkOutRecord.photo_object_key);
      if (keys.length > 0) {
        resolveBatchPresignedUrls(keys).then((urlMap) => {
          registerPresignedUrls(urlMap);
        });
      }
    }
  }, [previewGroupRecord]);

  // Group records by Date + Technician Name
  const groupedRecords = useMemo(() => {
    const map = new Map<string, GroupedAttendanceRecord>();

    // Sort raw records chronologically (newest first)
    const sortedRaw = [...records].sort((a, b) => {
      const dateCmp = (b.attendance_date || '').localeCompare(a.attendance_date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.attendance_time || '').localeCompare(a.attendance_time || '');
    });

    for (const r of sortedRaw) {
      if (!r || !r.technician_name) continue;

      // Date filter
      if (selectedDate && r.attendance_date !== selectedDate) continue;

      const groupKey = `${r.attendance_date}_${r.technician_name.trim().toLowerCase()}`;
      if (!map.has(groupKey)) {
        // Find matching technician from master list for code/ID
        const matchedTech = technicians.find(
          (t) =>
            t.name.trim().toLowerCase() === r.technician_name.trim().toLowerCase() ||
            (r.technician_id && t.id === r.technician_id)
        );

        map.set(groupKey, {
          key: groupKey,
          attendance_date: r.attendance_date,
          technician_name: r.technician_name,
          technician_id: r.technician_id || matchedTech?.id,
          technician_code: matchedTech?.code,
          shift: r.shift || 'Pagi',
          rawStatus: r.status,
        });
      }

      const item = map.get(groupKey)!;
      const type = r.attendance_type || (r.is_bypassed ? 'bypass' : r.is_off_duty ? 'off_duty' : 'masuk');

      if (r.shift) item.shift = r.shift;
      if (r.technician_id && !item.technician_id) item.technician_id = r.technician_id;

      if (type === 'masuk') {
        item.checkInRecord = r;
      } else if (type === 'pulang') {
        item.checkOutRecord = r;
      } else if (type === 'off_duty' || r.is_off_duty) {
        item.offDutyRecord = r;
      } else if (type === 'bypass' || r.is_bypassed) {
        item.bypassRecord = r;
      }
    }

    // Convert map to array
    let result = Array.from(map.values());

    // Apply Shift Filter
    if (filterShift !== 'ALL') {
      result = result.filter((g) => {
        const clean = (g.shift || '').toLowerCase();
        return clean.includes(filterShift.toLowerCase());
      });
    }

    // Apply Status Filter
    if (filterStatus !== 'ALL') {
      result = result.filter((g) => {
        const resolved = resolveAttendanceDisplay(g);
        if (filterStatus === 'Tepat Waktu') {
          return !resolved.isLate && !resolved.isTidakAbsenMasuk && !resolved.isTidakAbsenPulang && !g.offDutyRecord && resolved.jamMasukDisplay !== 'Belum Masuk';
        }
        if (filterStatus === 'Terlambat') {
          return resolved.isLate;
        }
        if (filterStatus === 'Belum Masuk') {
          return resolved.jamMasukDisplay === 'Belum Masuk';
        }
        if (filterStatus === 'Belum Pulang') {
          return resolved.jamPulangDisplay === 'Belum Pulang';
        }
        if (filterStatus === 'Tidak Absen') {
          return resolved.isTidakAbsenMasuk || resolved.isTidakAbsenPulang;
        }
        if (filterStatus === 'Off Duty') {
          return !!g.offDutyRecord;
        }
        return true;
      });
    }

    // Apply Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((g) =>
        g.technician_name.toLowerCase().includes(q) ||
        (g.technician_code || '').toLowerCase().includes(q) ||
        (g.checkInRecord?.notes || '').toLowerCase().includes(q) ||
        (g.checkOutRecord?.notes || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [records, selectedDate, filterShift, filterStatus, searchQuery, technicians]);

  // Compute Summary Statistics (based on full dataset matching selected date/shift)
  const summaryStats = useMemo(() => {
    let total = groupedRecords.length;
    let sudahMasuk = 0;
    let terlambat = 0;
    let belumPulang = 0;

    for (const g of groupedRecords) {
      const resolved = resolveAttendanceDisplay(g);
      if (g.checkInRecord || g.bypassRecord) {
        sudahMasuk++;
      }
      if (resolved.isLate) {
        terlambat++;
      }
      if (resolved.jamPulangDisplay === 'Belum Pulang') {
        belumPulang++;
      }
    }

    return { total, sudahMasuk, terlambat, belumPulang };
  }, [groupedRecords]);

  // Reset pagination on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, filterShift, filterStatus, searchQuery]);

  // Pagination calculation
  const totalItems = groupedRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedRecords = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return groupedRecords.slice(start, start + pageSize);
  }, [groupedRecords, safePage, pageSize]);

  return (
    <div className="space-y-4">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
              Rekapitulasi Presensi Teknisi
            </h2>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/70 px-2 py-0.5 rounded-full">
              SaaS Admin Panel
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Monitoring kehadiran, jam masuk &amp; pulang, validasi GPS Bandara Halim, dan verifikasi foto selfie.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsRosterModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs"
            title="Buka Template Roster & Cetak Dokumen PDF Resmi OM NTI (3 Halaman)"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Daftar Hadir &amp; Roster PDF</span>
          </button>

          <button
            type="button"
            onClick={() => loadAttendance(selectedDate)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
            <span>{isLoading ? 'Memuat...' : 'Segarkan Data'}</span>
          </button>
        </div>
      </div>

      {/* 4 Compact Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Teknisi */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Teknisi</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 mt-1">{summaryStats.total}</p>
            <span className="text-[10px] text-slate-400 font-medium">Terdaftar pada filter aktif</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Sudah Masuk */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Sudah Masuk</p>
            <p className="text-xl sm:text-2xl font-black text-emerald-600 mt-1">{summaryStats.sudahMasuk}</p>
            <span className="text-[10px] text-slate-400 font-medium">Telah absen masuk</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-600 flex items-center justify-center shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        {/* Terlambat */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Terlambat</p>
            <p className="text-xl sm:text-2xl font-black text-rose-600 mt-1">{summaryStats.terlambat}</p>
            <span className="text-[10px] text-slate-400 font-medium">Masuk lewat batas toleransi</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200/70 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* Belum Pulang */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Belum Pulang</p>
            <p className="text-xl sm:text-2xl font-black text-amber-600 mt-1">{summaryStats.belumPulang}</p>
            <span className="text-[10px] text-slate-400 font-medium">Aktif bertugas di bandara</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        {/* Filter Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Date Picker */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
              />
              {selectedDate !== getJakartaDateString() && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(getJakartaDateString())}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold ml-1 px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 rounded cursor-pointer"
                  title="Kembali ke hari ini"
                >
                  Hari Ini
                </button>
              )}
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate('')}
                  className="text-[10px] text-slate-400 hover:text-slate-600 font-medium ml-1 px-1.5 py-0.5 bg-slate-200/60 hover:bg-slate-200 rounded cursor-pointer"
                  title="Lihat semua tanggal"
                >
                  Semua
                </button>
              )}
            </div>

            {/* Shift Filter */}
            <select
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer shadow-2xs"
            >
              <option value="ALL">Semua Shift</option>
              <option value="Pagi">Shift Pagi</option>
              <option value="Malam">Shift Malam</option>
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer shadow-2xs"
            >
              <option value="ALL">Semua Status</option>
              <option value="Tepat Waktu">Tepat Waktu</option>
              <option value="Terlambat">Terlambat</option>
              <option value="Belum Masuk">Belum Masuk</option>
              <option value="Belum Pulang">Belum Pulang</option>
              <option value="Tidak Absen">Tidak Absen (Masuk/Pulang)</option>
              <option value="Off Duty">Off Duty</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari teknisi / kode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-2xs"
            />
          </div>
        </div>

        {/* Redesigned Clean SaaS Table */}
        {totalItems === 0 ? (
          <div className="text-center py-12 px-4 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200">
            <UserCheck className="w-9 h-9 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-700">Tidak ada riwayat presensi yang sesuai</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Coba ubah tanggal, filter shift, atau kata kunci pencarian teknisi.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Mobile Cards View (No Horizontal Overflow) */}
            <div className="block md:hidden space-y-2.5">
              {paginatedRecords.map((item) => {
                const properName = toProperCase(item.technician_name);
                const initials = properName
                  .split(' ')
                  .filter(Boolean)
                  .map((n) => n.charAt(0))
                  .join('')
                  .toUpperCase()
                  .slice(0, 2);

                const resolved = resolveAttendanceDisplay(item);
                const isNight = item.shift.toLowerCase().includes('malam') || item.shift === 'M';

                const dateParts = item.attendance_date ? item.attendance_date.split('-') : [];
                const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : item.attendance_date;

                return (
                  <div key={item.key} className="bg-white border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                    {/* Top row: Date, Shift, and Status Badge */}
                    <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{formattedDate}</span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            isNight
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200/80'
                              : 'bg-amber-50 text-amber-800 border-amber-200/80'
                          }`}
                        >
                          {isNight ? <Moon className="w-2.5 h-2.5" /> : <Sun className="w-2.5 h-2.5" />}
                          <span>Shift {isNight ? 'Malam' : 'Pagi'}</span>
                        </span>
                      </div>

                      {/* Status Badge */}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border inline-flex items-center gap-1">
                        {React.createElement(resolved.statusBadge.icon, { className: 'w-3 h-3' })}
                        <span>{resolved.statusBadge.label}</span>
                      </span>
                    </div>

                    {/* Middle: Technician Name */}
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-900 truncate">{properName}</div>
                        {item.technician_id && (
                          <span className="text-[9.5px] text-slate-400 font-mono">ID #{item.technician_id}</span>
                        )}
                      </div>
                    </div>

                    {/* Bottom: In / Out time & Action button */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="text-[9.5px] text-slate-400 uppercase font-bold block">Masuk</span>
                          <span className="font-mono font-bold text-slate-800 text-xs">{resolved.jamMasukDisplay}</span>
                        </div>
                        <div>
                          <span className="text-[9.5px] text-slate-400 uppercase font-bold block">Pulang</span>
                          <span className="font-mono font-bold text-slate-800 text-xs">{resolved.jamPulangDisplay}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setPreviewGroupRecord(item)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition cursor-pointer border border-indigo-200 shadow-2xs"
                      >
                        <Eye className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Detail</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto border border-slate-200/80 rounded-xl bg-white">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 font-bold text-slate-600 border-b border-slate-200 text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-3.5">Tanggal</th>
                    <th className="py-3 px-3.5">Teknisi</th>
                    <th className="py-3 px-3.5 text-center">Shift</th>
                    <th className="py-3 px-3.5 text-center">Jam Masuk</th>
                    <th className="py-3 px-3.5 text-center">Jam Pulang</th>
                    <th className="py-3 px-3.5 text-center">Status</th>
                    <th className="py-3 px-3.5 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedRecords.map((item) => {
                    const properName = toProperCase(item.technician_name);
                    const initials = properName
                      .split(' ')
                      .filter(Boolean)
                      .map((n) => n.charAt(0))
                      .join('')
                      .toUpperCase()
                      .slice(0, 2);

                    const resolved = resolveAttendanceDisplay(item);
                    const isNight = item.shift.toLowerCase().includes('malam') || item.shift === 'M';

                    // Parse Date representation
                    const dateParts = item.attendance_date ? item.attendance_date.split('-') : [];
                    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : item.attendance_date;

                    return (
                      <tr key={item.key} className="hover:bg-slate-50/80 transition-colors">
                        {/* 1. Kolom Tanggal */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{formattedDate}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                            {item.attendance_date}
                          </span>
                        </td>

                        {/* 2. Kolom Teknisi (Proper Case + ID Kecil) */}
                        <td className="py-3 px-3.5 min-w-[160px]">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200/80 text-indigo-700 font-bold text-[11px] flex items-center justify-center shrink-0">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <span className="font-bold text-slate-900 block truncate" title={properName}>
                                {properName}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {item.technician_code ? (
                                  <span className="text-[9px] font-bold font-mono px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded border border-slate-200">
                                    {item.technician_code}
                                  </span>
                                ) : item.technician_id ? (
                                  <span className="text-[9px] font-mono text-slate-400">
                                    ID #{item.technician_id}
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-slate-400">Teknisi</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 3. Kolom Shift */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                              isNight
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200/80'
                                : 'bg-amber-50 text-amber-800 border-amber-200/80'
                            }`}
                          >
                            {isNight ? <Moon className="w-2.5 h-2.5" /> : <Sun className="w-2.5 h-2.5" />}
                            <span>Shift {isNight ? 'Malam' : 'Pagi'}</span>
                          </span>
                        </td>

                        {/* 4. Kolom Jam Masuk */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          {resolved.isTidakAbsenMasuk ? (
                            <div className="font-mono font-bold text-[11px] text-rose-600">
                              (Tidak Absen Masuk)
                            </div>
                          ) : resolved.jamMasukDisplay === 'Belum Masuk' ? (
                            <div className="font-mono text-xs text-slate-400">
                              Belum Masuk
                            </div>
                          ) : resolved.jamMasukDisplay === 'Off Duty' || resolved.jamMasukDisplay === 'Bypass' ? (
                            <div className="font-mono font-bold text-xs text-slate-600">
                              {resolved.jamMasukDisplay}
                            </div>
                          ) : (
                            <div>
                              <div className="font-mono font-bold text-slate-900 text-xs">
                                {resolved.jamMasukDisplay}
                              </div>
                              <span className="text-[9px] text-emerald-600 font-semibold block">
                                Terverifikasi
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 5. Kolom Jam Pulang */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          {resolved.isTidakAbsenPulang ? (
                            <div className="font-mono font-bold text-[11px] text-orange-600">
                              (Tidak Absen Pulang)
                            </div>
                          ) : resolved.jamPulangDisplay === 'Belum Pulang' ? (
                            <div className="font-mono text-xs font-semibold text-amber-600">
                              Belum Pulang
                            </div>
                          ) : resolved.jamPulangDisplay === '-' ? (
                            <div className="font-mono text-xs text-slate-300">-</div>
                          ) : (
                            <div>
                              <div className="font-mono font-bold text-slate-900 text-xs">
                                {resolved.jamPulangDisplay}
                              </div>
                              <span className="text-[9px] text-orange-600 font-semibold block">
                                Selesai Shift
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 6. Kolom Status (Subtle Badges) */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          {resolved.statusBadge.variant === 'emerald' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/80">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>{resolved.statusBadge.label}</span>
                            </span>
                          )}

                          {resolved.statusBadge.variant === 'rose' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200/80">
                              <AlertTriangle className="w-3 h-3 text-rose-600" />
                              <span>{resolved.statusBadge.label}</span>
                            </span>
                          )}

                          {resolved.statusBadge.variant === 'amber' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/80">
                              <Clock className="w-3 h-3 text-amber-600" />
                              <span>{resolved.statusBadge.label}</span>
                            </span>
                          )}

                          {resolved.statusBadge.variant === 'orange' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-800 bg-orange-50 px-2 py-0.5 rounded-md border border-orange-200/80">
                              <AlertTriangle className="w-3 h-3 text-orange-600" />
                              <span>{resolved.statusBadge.label}</span>
                            </span>
                          )}

                          {resolved.statusBadge.variant === 'red' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-md border border-red-200/80">
                              <AlertCircle className="w-3 h-3 text-red-600" />
                              <span>{resolved.statusBadge.label}</span>
                            </span>
                          )}

                          {resolved.statusBadge.variant === 'purple' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200/80">
                              <ShieldCheck className="w-3 h-3 text-purple-600" />
                              <span>{resolved.statusBadge.label}</span>
                            </span>
                          )}

                          {resolved.statusBadge.variant === 'slate' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              <Coffee className="w-3 h-3 text-slate-500" />
                              <span>{resolved.statusBadge.label}</span>
                            </span>
                          )}
                        </td>

                        {/* 7. Kolom Aksi ("Lihat Detail") */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setPreviewGroupRecord(item)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50/90 hover:bg-indigo-100 active:bg-indigo-200 px-2.5 py-1 rounded-lg transition cursor-pointer border border-indigo-200/80 shadow-2xs"
                            title="Lihat Detail &amp; Foto Presensi"
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Lihat Detail</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Clean Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 px-1">
              <div className="text-xs text-slate-500 font-medium">
                Menampilkan <span className="font-bold text-slate-800">{(safePage - 1) * pageSize + 1}</span> -{' '}
                <span className="font-bold text-slate-800">{Math.min(safePage * pageSize, totalItems)}</span> dari{' '}
                <span className="font-bold text-slate-800">{totalItems}</span> presensi
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 disabled:opacity-40 disabled:hover:bg-slate-100 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>

                <div className="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg">
                  {safePage} / {totalPages}
                </div>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 disabled:opacity-40 disabled:hover:bg-slate-100 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Detail Presensi Teknisi (Foto Selfie & Validasi GPS) */}
      {previewGroupRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-4 sm:p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  Detail Presensi: {toProperCase(previewGroupRecord.technician_name)}
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Tanggal {previewGroupRecord.attendance_date} &bull; Shift {previewGroupRecord.shift}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewGroupRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Check-in & Check-out Side-by-Side Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Absen Masuk */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Absen Masuk</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {previewGroupRecord.checkInRecord?.attendance_time ||
                      (previewGroupRecord.offDutyRecord ? 'Off Duty' : previewGroupRecord.bypassRecord ? 'Bypass' : '-')}
                  </span>
                </div>

                {previewGroupRecord.checkInRecord?.photo_url ? (
                  <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-950 flex items-center justify-center min-h-[140px]">
                    <S3Image
                      src={previewGroupRecord.checkInRecord.photo_url}
                      alt="Foto Masuk"
                      className="max-h-[160px] w-auto object-contain rounded-md"
                    />
                  </div>
                ) : (
                  <div className="text-center py-6 bg-slate-100/70 rounded-lg text-slate-400 text-xs font-medium">
                    Tidak Ada Foto Masuk
                  </div>
                )}

                {previewGroupRecord.checkInRecord?.location?.area_name && (
                  <div className="text-[11px] text-slate-600 flex items-center gap-1 mt-1">
                    <MapPin className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="truncate">{previewGroupRecord.checkInRecord.location.area_name}</span>
                  </div>
                )}

                {previewGroupRecord.checkInRecord?.notes && (
                  <p className="text-[10px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-200">
                    "{previewGroupRecord.checkInRecord.notes}"
                  </p>
                )}
              </div>

              {/* Absen Pulang */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-xs font-bold text-orange-800 flex items-center gap-1">
                    <LogOut className="w-3.5 h-3.5 text-orange-600" />
                    <span>Absen Pulang</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {previewGroupRecord.checkOutRecord?.attendance_time ||
                      (previewGroupRecord.checkInRecord ? 'Belum Pulang' : '-')}
                  </span>
                </div>

                {previewGroupRecord.checkOutRecord?.photo_url ? (
                  <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-950 flex items-center justify-center min-h-[140px]">
                    <S3Image
                      src={previewGroupRecord.checkOutRecord.photo_url}
                      alt="Foto Pulang"
                      className="max-h-[160px] w-auto object-contain rounded-md"
                    />
                  </div>
                ) : (
                  <div className="text-center py-6 bg-slate-100/70 rounded-lg text-slate-400 text-xs font-medium">
                    Tidak Ada Foto Pulang
                  </div>
                )}

                {previewGroupRecord.checkOutRecord?.location?.area_name && (
                  <div className="text-[11px] text-slate-600 flex items-center gap-1 mt-1">
                    <MapPin className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="truncate">{previewGroupRecord.checkOutRecord.location.area_name}</span>
                  </div>
                )}

                {previewGroupRecord.checkOutRecord?.notes && (
                  <p className="text-[10px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-200">
                    "{previewGroupRecord.checkOutRecord.notes}"
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPreviewGroupRecord(null)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition cursor-pointer"
            >
              Tutup Detail
            </button>
          </div>
        </div>
      )}

      {/* Official OM NTI Roster & Daftar Hadir PDF Modal */}
      <RosterScheduleModal
        isOpen={isRosterModalOpen}
        onClose={() => setIsRosterModalOpen(false)}
        year={parseInt((selectedDate || '2026-10-01').split('-')[0] || '2026', 10)}
        month={parseInt((selectedDate || '2026-10-01').split('-')[1] || '10', 10)}
        attendanceRecords={records}
      />
    </div>
  );
};
