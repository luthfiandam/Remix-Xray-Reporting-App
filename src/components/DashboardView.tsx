import React, { useState, useMemo, useCallback } from 'react';
import {
  Equipment,
  EquipmentType,
  Location,
  PreventiveEntry,
  PreventiveSession,
  CorrectiveReport,
  Role,
} from '../types';
import { formatTimeShort } from '../utils/timeFormat';
import { normalizeShift } from '../utils/contextFilter';
import { SupervisorDailyBrief } from './SupervisorDailyBrief';
import {
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  QrCode,
  Camera,
  LayoutDashboard,
  FileSpreadsheet,
  Trash2,
  AlertCircle,
  X,
  History,
} from 'lucide-react';

interface DashboardViewProps {
  equipments: Equipment[];
  equipmentTypes: EquipmentType[];
  locations?: Location[];
  preventiveEntries: PreventiveEntry[];
  correctiveReports?: CorrectiveReport[];
  currentSession: PreventiveSession;
  role?: Role;
  onStartPreventive: (equipmentId?: number) => void;
  technicianNames: string[];
  onOpenShiftModal: () => void;
  onOpenCorrective?: () => void;
  onViewTimeline?: (equipmentId: number) => void;
  onOpenQrScanner?: () => void;
  onOpenQrPrint?: (equipment?: Equipment) => void;
  onOpenTelegramModal?: () => void;
  onOpenReportsTab?: () => void;
  onDeletePreventiveEntry?: (entry: PreventiveEntry) => void | Promise<void>;
}

// Acronyms preserved in uppercase
const KNOWN_ACRONYMS = new Set([
  'BHS', 'CIP', 'HBSCP', 'MSCP', 'VVIP', 'SMP', 'SETNEG', 'LAUD', 'LINE', 'SCP', 'WTMD', 'HHMD', 'ETD', 'XRAY'
]);

function formatLocationName(str: string): string {
  if (!str) return '';
  if (str.toUpperCase() === 'BACK UP AREA') return 'Backup Area';
  // If already mixed-case (e.g. "BHS Line Batik"), retain original formatting
  if (/[a-z]/.test(str)) return str;

  return str
    .split(' ')
    .map((w) => {
      const upper = w.toUpperCase();
      if (KNOWN_ACRONYMS.has(upper)) return upper;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  equipments,
  equipmentTypes,
  locations = [],
  preventiveEntries,
  correctiveReports = [],
  currentSession,
  role,
  onStartPreventive,
  technicianNames,
  onOpenShiftModal,
  onOpenCorrective,
  onViewTimeline,
  onOpenQrScanner,
  onOpenQrPrint,
  onOpenTelegramModal,
  onOpenReportsTab,
  onDeletePreventiveEntry,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'pending' | 'done'>('pending');
  const [viewMode, setViewMode] = useState<'brief' | 'monitoring'>('brief');
  const [entryToDelete, setEntryToDelete] = useState<{ entry: PreventiveEntry; equipmentName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!entryToDelete || !onDeletePreventiveEntry) return;
    setIsDeleting(true);
    try {
      await onDeletePreventiveEntry(entryToDelete.entry);
      setEntryToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Helper to determine equipment type label (e.g. Xray, WTMD, HHMD, ETD)
  const getTypePrefix = useCallback((typeId?: number): string => {
    const t = equipmentTypes.find((item) => item.id === typeId);
    if (!t) return '';
    const code = (t.code || '').toUpperCase();
    const name = (t.name || '').toLowerCase();

    if (code === 'XRAY' || name.includes('x-ray') || name.includes('xray')) return 'Xray';
    if (code === 'WTMD' || name.includes('walk through')) return 'WTMD';
    if (code === 'HHMD' || name.includes('hand held') || name.includes('handheld')) return 'HHMD';
    if (code === 'ETD' || name.includes('explosive')) return 'ETD';
    return t.code || t.name;
  }, [equipmentTypes]);

  // Generates combined name (Jenis + Lokasi/Nama), e.g. "Xray Backup Area", "WTMD CIP Karyawan"
  const getEquipmentDisplayName = useCallback((eq: Equipment): string => {
    const typePrefix = getTypePrefix(eq.equipment_type_id);
    const loc = locations.find((l) => l.id === eq.location_id);
    const rawTargetName = loc?.name || eq.name || 'Unit';
    const cleanName = formatLocationName(rawTargetName);

    if (!typePrefix) return cleanName;

    // Avoid duplicate prefix
    if (cleanName.toLowerCase().startsWith(typePrefix.toLowerCase())) {
      return cleanName;
    }
    if (cleanName.toLowerCase().startsWith('x-ray')) {
      return cleanName.replace(/^x-ray\s+/i, 'Xray ');
    }

    return `${typePrefix} ${cleanName}`;
  }, [getTypePrefix, locations]);

  // Total Equipment Calculation
  const totalEquipmentCount = equipments.length;

  const countByType = useMemo(() => {
    return equipmentTypes.map((type) => {
      const count = equipments.filter((e) => e.equipment_type_id === type.id).length;
      return { type, count };
    });
  }, [equipments, equipmentTypes]);

  // X-Ray Equipment Progress
  const xrayType = useMemo(
    () => equipmentTypes.find((t) => t.code === 'XRAY'),
    [equipmentTypes]
  );
  const xrayEquipments = useMemo(
    () => equipments.filter((e) => e.equipment_type_id === xrayType?.id),
    [equipments, xrayType]
  );

  const entriesMap = useMemo(() => {
    const map = new Map<number, PreventiveEntry>();
    const currentNormShift = normalizeShift(currentSession.shift);
    preventiveEntries.forEach((entry) => {
      if (
        (!entry.shift || normalizeShift(entry.shift) === currentNormShift) &&
        (!entry.operational_date || entry.operational_date === currentSession.operational_date)
      ) {
        map.set(Number(entry.equipment_id), entry);
      }
    });
    return map;
  }, [preventiveEntries, currentSession.shift, currentSession.operational_date]);

  const completedXrayCount = useMemo(
    () => xrayEquipments.filter((eq) => entriesMap.has(eq.id)).length,
    [xrayEquipments, entriesMap]
  );

  // Reminders and completion calculations
  const pendingDaily = useMemo(
    () => equipments.filter((e) => !entriesMap.has(e.id)),
    [equipments, entriesMap]
  );
  const totalCompletedCount = equipments.length - pendingDaily.length;
  const totalCompletionPct =
    equipments.length > 0 ? Math.round((totalCompletedCount / equipments.length) * 100) : 0;

  // Active corrective count
  const activeCorrectiveCount = useMemo(
    () => correctiveReports.filter((r) => r.result !== 'Resolved').length,
    [correctiveReports]
  );

  // Filtered Equipment List for Display ('pending' or 'done')
  const filteredEquipments = useMemo(() => {
    return equipments.filter((eq) => {
      if (selectedFilter === 'done') return entriesMap.has(eq.id);
      return !entriesMap.has(eq.id);
    });
  }, [equipments, selectedFilter, entriesMap]);

  return (
    <div className="space-y-3.5 text-slate-900 font-sans">
      {/* Mode Switcher & Quick QR Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex w-full sm:w-auto bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
          <button
            onClick={() => setViewMode('brief')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 text-center ${
              viewMode === 'brief'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="truncate">Daily Brief</span>
          </button>
          <button
            onClick={() => setViewMode('monitoring')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 text-center ${
              viewMode === 'monitoring'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span className="truncate">Monitoring</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onOpenQrScanner && (
            <button
              onClick={onOpenQrScanner}
              className="flex-1 sm:flex-initial px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan QR Mesin</span>
            </button>
          )}
          {onOpenQrPrint && (
            <button
              onClick={() => onOpenQrPrint()}
              className="flex-1 sm:flex-initial px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200 shadow-2xs"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Cetak QR</span>
            </button>
          )}
        </div>
      </div>

      {/* View Mode 1: Daily Operational Brief */}
      {viewMode === 'brief' ? (
        <SupervisorDailyBrief
          operationalDate={currentSession.operational_date}
          shift={currentSession.shift}
          technicianNames={technicianNames}
          equipments={equipments}
          preventiveEntries={preventiveEntries}
          correctiveReports={correctiveReports}
          onOpenPreventive={onStartPreventive}
          onOpenCorrective={onOpenCorrective}
          onOpenTimeline={onViewTimeline}
          onOpenTelegramModal={onOpenTelegramModal}
          onOpenReportsTab={onOpenReportsTab}
        />
      ) : (
        <>
          {/* 2. KPI Summary Cards (Clean Professional Metric Grid) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* KPI 1: Inspection Completion */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Realisasi Cek Shift Berjalan
              </span>
              <span className="text-[10px] font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {totalCompletionPct}% Selesai
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-black text-blue-600 tracking-tight">
                {totalCompletedCount}
                <span className="text-slate-400 text-base font-bold">/{totalEquipmentCount}</span>
              </span>
              <span className="text-xs text-slate-600 font-medium">Unit Selesai Diinspeksi</span>
            </div>
          </div>

          <div className="mt-3">
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
              <div
                className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                style={{ width: `${totalCompletionPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-600 mt-2 font-medium">
              <span>
                Menunggu: <strong className="text-amber-700 font-bold">{pendingDaily.length} unit</strong>
              </span>
              <span>
                X-Ray Selesai: <strong className="text-blue-700 font-bold">{completedXrayCount}/{xrayEquipments.length}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Equipment Operational Health */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Kondisi Kesiapan Alat
              </span>
              {activeCorrectiveCount > 0 ? (
                <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
                  {activeCorrectiveCount} Perbaikan
                </span>
              ) : (
                <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                  Siap Operasi
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              {activeCorrectiveCount > 0 ? (
                <span className="text-2xl font-black text-amber-700 tracking-tight">Ada Gangguan</span>
              ) : (
                <span className="text-2xl font-black text-emerald-600 tracking-tight">100% Siap Operasi</span>
              )}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 font-medium">Status Kerusakan:</span>
            {activeCorrectiveCount > 0 ? (
              <span className="font-bold text-amber-800 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> {activeCorrectiveCount} Dalam Penanganan
              </span>
            ) : (
              <span className="font-bold text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Tidak Ada Laporan Kerusakan
              </span>
            )}
          </div>
        </div>

        {/* KPI 3: Total Equipment Summary */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Inventaris Peralatan
              </span>
              <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {equipmentTypes.length} Kategori
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-black text-slate-900 tracking-tight">
                {totalEquipmentCount}
              </span>
              <span className="text-xs text-slate-600 font-medium">Unit Terdaftar di Master</span>
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-3 text-xs text-slate-600 flex-wrap">
            {countByType.map((item, idx) => (
              <React.Fragment key={item.type.id}>
                {idx > 0 && <span className="text-slate-300 font-mono">·</span>}
                <span className="font-medium">
                  {item.type.code}: <strong className="text-slate-900 font-mono tabular-nums">{item.count}</strong>
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 3. List Status Equipment hari ini */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Status Peralatan Shift Hari Ini
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Klik pada unit alat untuk langsung membuka form lembar kerja inspeksi
            </p>
          </div>

          {/* Segmented Control Filter Tabs: Sudah dan Belum */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setSelectedFilter('pending')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                selectedFilter === 'pending'
                  ? 'bg-white text-slate-900 font-bold shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Belum Dicek ({pendingDaily.length})
            </button>
            <button
              onClick={() => setSelectedFilter('done')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                selectedFilter === 'done'
                  ? 'bg-white text-emerald-800 font-bold shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sudah Dicek ({totalCompletedCount})
            </button>
          </div>
        </div>

        {/* Compact Equipment Rows in a Scrollable Container */}
        <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1 sm:pr-2 focus:outline-none">
          {filteredEquipments.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs bg-slate-50 rounded-lg border border-dashed border-slate-200">
              {selectedFilter === 'done'
                ? 'Belum ada unit yang selesai diperiksa shift ini.'
                : 'Semua unit peralatan telah selesai diperiksa!'}
            </div>
          ) : (
            filteredEquipments.map((eq, index) => {
              const entry = entriesMap.get(eq.id);
              const isDone = !!entry;
              const displayName = getEquipmentDisplayName(eq);

              return (
                <div
                  key={eq.id}
                  onClick={() => onStartPreventive(eq.id)}
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors cursor-pointer ${
                    isDone
                      ? 'bg-slate-50/80 border-slate-200 hover:bg-slate-100'
                      : 'bg-white border-slate-200 hover:border-blue-400 hover:bg-blue-50/30'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 font-bold text-xs ${
                        isDone
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600 border border-slate-300'
                      }`}
                    >
                      {isDone ? <CheckCircle2 className="w-4 h-4" /> : index + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                        {displayName}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {isDone ? (
                          <span>
                            Diperiksa pkl <strong className="text-slate-800 font-semibold">{formatTimeShort(entry.submitted_at)}</strong> &bull; {entry.view_type === 'dual' ? 'Dual View' : 'Single View'}
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium">Belum diinspeksi pada shift ini</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {/* Quick Timeline / History Button */}
                    {onViewTimeline && (
                      <button
                        type="button"
                        title="Buka Profil & Riwayat Mesin"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewTimeline(eq.id);
                        }}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors border border-slate-200 hover:border-blue-300 flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5 text-blue-600" />
                        <span className="hidden sm:inline">Riwayat</span>
                      </button>
                    )}

                    {/* Quick QR Sticker Print Button */}
                    {onOpenQrPrint && (
                      <button
                        type="button"
                        title="Cetak Stiker QR Mesin Ini"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenQrPrint(eq);
                        }}
                        className="p-1.5 text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors border border-slate-200 hover:border-indigo-300 flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="hidden sm:inline">QR</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      {isDone ? (
                        <>
                          <span className="text-emerald-700 font-semibold text-xs flex items-center gap-1 px-1.5 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Selesai
                          </span>
                          {role === 'supervisor' && onDeletePreventiveEntry && (
                            <button
                              type="button"
                              title="Hapus Data Preventif (Khusus Supervisor / Admin)"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEntryToDelete({ entry, equipmentName: displayName });
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-white bg-slate-900 hover:bg-slate-800 flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs">
                          Inspeksi <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
        </>
      )}

      {/* Admin Delete Preventive Confirmation Modal */}
      {entryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Hapus Data Preventif?</h3>
                  <p className="text-[10px] text-slate-500 font-medium">Khusus Akses Supervisor & Admin</p>
                </div>
              </div>
              <button
                onClick={() => !isDeleting && setEntryToDelete(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white/60 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Apakah Anda yakin ingin menghapus catatan preventif untuk{' '}
                <strong className="text-slate-900 font-bold">{entryToDelete.equipmentName}</strong> pada shift ini?
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-800">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Dampak Penghapusan:</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-amber-800/90 text-[10.5px]">
                  <li>Status mesin akan kembali menjadi <strong>"Belum Dicek"</strong> pada shift berjalan.</li>
                  <li>Data inspeksi dan parameter kV/mA akan dihapus dari Supabase & riwayat lokal.</li>
                  <li>Folder foto bukti inspeksi & kolase di <strong>Google Drive</strong> akan otomatis dibersihkan.</li>
                  <li>Teknisi dapat menginput ulang checklist jika sebelumnya terdapat kesalahan data.</li>
                </ul>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEntryToDelete(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs shadow-rose-600/20"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Ya, Hapus Data</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
