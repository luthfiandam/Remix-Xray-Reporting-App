import React from 'react';
import {
  Equipment,
  EquipmentType,
  Location,
  ChecklistFrequency,
  PreventiveEntry,
} from '../../types';
import {
  Clock,
  Calendar,
  FileText,
  Zap,
  ShieldCheck,
  RefreshCw,
  ArrowLeft,
  Check,
  ChevronRight,
  History,
  CheckCircle2,
} from 'lucide-react';
import { normalizeOperationalDate } from '../../utils/dateTimeUtils';
import { formatIndonesianDate } from '../../utils/timeFormat';

interface EquipmentSelectionSectionProps {
  preventiveFlowStep: 'interval' | 'category' | 'equipment';
  onFlowStepChange: (step: 'interval' | 'category' | 'equipment') => void;
  selectedEquipmentId?: number | null;
  selectedFrequencyId: number;
  onSelectFrequencyId: (freqId: number) => void;
  selectedTypeFilter: number | 'ALL';
  onSelectTypeFilter: (typeId: number | 'ALL') => void;
  equipmentTypes: EquipmentType[];
  locations?: Location[];
  frequencies: ChecklistFrequency[];
  equipments: Equipment[];
  filteredEquipments: Equipment[];
  baseCategoryEquipments: Equipment[];
  preventiveEntries: PreventiveEntry[];
  currentPeriodKey: string;
  harianCount: number;
  mingguanCount: number;
  bulananCount: number;
  triwulanCount: number;
  semesteranCount: number;
  tahunanCount: number;
  getMachineIntervalStatusBadge: (eqId: number) => { label: string; className: string };
  isMatchingContextEntry: (pe: PreventiveEntry, eqId: number, freqId: number, targetPeriodKey: string, targetShift?: string) => boolean;
  onSelectEquipment: (eqId: number) => void;
  onConfirmSelectEquipmentAndInterval?: (eqId: number, freqId: number) => void;
  operationalDate?: string;
  shift?: string;
  technicianNames?: string[];
  activeDatasetId?: string;
  entryDate?: string;
  entryShift?: string;
  onEntryDateChange?: (date: string) => void;
  onEntryShiftChange?: (shift: string) => void;
  role?: string;
  isViewerOnly?: boolean;
}

export const EquipmentSelectionSection: React.FC<EquipmentSelectionSectionProps> = ({
  preventiveFlowStep,
  onFlowStepChange,
  selectedEquipmentId,
  selectedFrequencyId,
  onSelectFrequencyId,
  selectedTypeFilter,
  onSelectTypeFilter,
  equipmentTypes,
  locations = [],
  frequencies,
  equipments,
  filteredEquipments,
  preventiveEntries,
  currentPeriodKey,
  harianCount,
  mingguanCount,
  bulananCount,
  triwulanCount,
  semesteranCount,
  tahunanCount,
  getMachineIntervalStatusBadge,
  isMatchingContextEntry,
  onSelectEquipment,
  onConfirmSelectEquipmentAndInterval,
  operationalDate,
  shift,
  entryDate,
  entryShift,
  onEntryDateChange,
  onEntryShiftChange,
  role,
  isViewerOnly = false,
}) => {
  const scrollToTop = () => {
    if (typeof window !== 'undefined') {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch {
        window.scrollTo(0, 0);
      }
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      const mainEl = document.querySelector('main');
      if (mainEl) mainEl.scrollTop = 0;
    }
  };

  const handleStepChange = (step: 'interval' | 'category' | 'equipment') => {
    scrollToTop();
    onFlowStepChange(step);
  };

  const handleEquipmentSelect = (eqId: number) => {
    scrollToTop();
    onSelectEquipment(eqId);
  };

  const handleConfirmSelectEquipmentAndInterval = (eqId: number, freqId: number) => {
    scrollToTop();
    if (onConfirmSelectEquipmentAndInterval) {
      onConfirmSelectEquipmentAndInterval(eqId, freqId);
    }
  };
  const todayStr = normalizeOperationalDate(new Date());
  const activeDate = entryDate || operationalDate || todayStr;
  const activeShift = entryShift || shift || 'Shift 1';

  const isPastDate = activeDate < todayStr;
  const isSupervisorOrAdmin = role === 'supervisor' || role === 'SUPERVISOR' || role === 'admin' || role === 'ADMIN';

  const INTERVAL_OPTIONS = [
    { id: 1, name: 'Harian', desc: 'Pemeriksaan setiap shift', count: harianCount, icon: Clock },
    { id: 2, name: 'Mingguan', desc: 'Pemeriksaan 1 minggu sekali', count: mingguanCount, icon: Calendar },
    { id: 3, name: 'Bulanan', desc: 'Pemeriksaan 1 bulan sekali', count: bulananCount, icon: FileText },
    { id: 4, name: 'Triwulan', desc: 'Pemeriksaan 3 bulan sekali', count: triwulanCount, icon: Zap },
    { id: 5, name: 'Semesteran', desc: 'Pemeriksaan 6 bulan sekali', count: semesteranCount, icon: ShieldCheck },
    { id: 6, name: 'Tahunan', desc: 'Pemeriksaan 1 tahun sekali', count: tahunanCount, icon: RefreshCw },
  ];

  return (
    <div className="space-y-4 w-full">
      {/* Date & Shift Context - ONLY VISIBLE FOR SUPERVISOR / ADMIN */}
      {isSupervisorOrAdmin && onEntryDateChange && (
        <div className="bg-white border border-slate-200/90 rounded-xl p-3 sm:p-3.5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isPastDate ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
              <History className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">Tanggal & Shift Inspeksi</span>
                {isPastDate && (
                  <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold rounded-full">
                    Entri Data Lampau
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Pilih tanggal untuk melihat atau menginput data preventif yang sudah lewat
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onEntryDateChange(todayStr)}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                activeDate === todayStr
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              Hari Ini
            </button>

            {/* Custom Date Input */}
            <input
              type="date"
              value={activeDate}
              onChange={(e) => onEntryDateChange(e.target.value)}
              className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1] cursor-pointer"
            />

            {/* Shift Select */}
            {onEntryShiftChange && (
              <select
                value={activeShift}
                onChange={(e) => onEntryShiftChange(e.target.value)}
                className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1] cursor-pointer"
              >
                <option value="Shift 1">Shift 1 (Pagi)</option>
                <option value="Shift 2">Shift 2 (Malam)</option>
              </select>
            )}
          </div>
        </div>
      )}

      {/* Unified Step Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
            {preventiveFlowStep === 'category'
              ? '1. Pilih Tipe Peralatan'
              : preventiveFlowStep === 'equipment'
              ? '2. Pilih Lokasi Alat'
              : '3. Interval'}
          </h2>
        </div>

        {/* Step Navigation Bar - Hidden on mobile, visible on desktop (sm+) */}
        <div className="hidden sm:flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0 self-stretch sm:self-auto justify-between sm:justify-start">
          <button
            onClick={() => handleStepChange('category')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              preventiveFlowStep === 'category'
                ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-500/25'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            1. Tipe Alat
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <button
            onClick={() => handleStepChange('equipment')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              preventiveFlowStep === 'equipment'
                ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-500/25'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            2. Lokasi
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <button
            onClick={() => handleStepChange('interval')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              preventiveFlowStep === 'interval'
                ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-500/25'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            3. Interval
          </button>
        </div>
      </div>

      {/* STEP 1: Selectable Equipment Types (X-Ray, WTMD, HHMD, ETD) */}
      {preventiveFlowStep === 'category' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {equipmentTypes.filter((t) => t.active).map((type) => {
              const typeDisplayName = (type.name || '').replace('X-Ray Inspection System', 'X-Ray System');
              const typeEquipments = equipments.filter((eq) => eq.active && eq.equipment_type_id === type.id);
              const completedCount = typeEquipments.filter((eq) => {
                const badge = getMachineIntervalStatusBadge(eq.id);
                const entry = preventiveEntries.find((pe) =>
                  isMatchingContextEntry(pe, eq.id, selectedFrequencyId, currentPeriodKey, activeShift)
                );
                return badge.label === 'Selesai' || !!entry;
              }).length;
              const isTypeDone = completedCount >= typeEquipments.length && typeEquipments.length > 0;

              return (
                <div
                  key={type.id}
                  onClick={() => {
                    onSelectTypeFilter(type.id);
                    handleStepChange('equipment');
                  }}
                  className={`bg-white border rounded-xl p-4 shadow-2xs hover:shadow-xs cursor-pointer transition-all flex items-center justify-between ${
                    isTypeDone
                      ? 'border-emerald-300 bg-emerald-50/15 hover:border-emerald-400'
                      : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/20'
                  }`}
                >
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {typeDisplayName} ({type.code})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {typeEquipments.length} Unit Terdaftar
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap shrink-0 inline-flex items-center justify-center ${
                        isTypeDone
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {completedCount} / {typeEquipments.length} Selesai
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 2: Equipment Grid (Sorted: Unsubmitted first, Completed at bottom) */}
      {preventiveFlowStep === 'equipment' && (() => {
        const selectedTypeObj = equipmentTypes.find((t) => t.id === selectedTypeFilter);
        const selectedTypeName = selectedTypeObj
          ? selectedTypeObj.name.replace('X-Ray Inspection System', 'X-Ray System')
          : 'Semua Tipe';
        const currentCategoryTotal = selectedTypeFilter !== 'ALL'
          ? equipments.filter((e) => e.active && e.equipment_type_id === selectedTypeFilter).length
          : equipments.filter((e) => e.active).length;

        return (
          <div className="space-y-3">
            {/* Header Action Bar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 shadow-2xs flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleStepChange('category')}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Ganti Tipe Peralatan</span>
              </button>

              <div className="text-xs font-bold text-slate-700 flex items-center gap-2 bg-blue-50/80 px-3 py-1 rounded-xl border border-blue-200">
                <span>
                  Kategori Selected:{' '}
                  <strong className="text-blue-900 font-black">
                    {selectedTypeName} ({selectedTypeObj?.code || 'ALL'})
                  </strong>
                </span>
              </div>
            </div>

            {/* Equipment Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredEquipments.map((eq) => {
                const badge = getMachineIntervalStatusBadge(eq.id);
                const entry = preventiveEntries.find((pe) =>
                  isMatchingContextEntry(pe, eq.id, selectedFrequencyId, currentPeriodKey, activeShift)
                );
                const isCompleted = badge.label === 'Selesai' || !!entry;
                const locationObj = locations.find((l) => l.id === eq.location_id);
                const locationName = locationObj?.name || 'Backup Area';

                return (
                  <div
                    key={eq.id}
                    onClick={() => handleEquipmentSelect(eq.id)}
                    className={`bg-white border rounded-xl p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between cursor-pointer transition-all hover:shadow-xs ${
                      isCompleted
                        ? 'border-emerald-300 bg-emerald-50/15 hover:border-emerald-400'
                        : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50/40'
                    }`}
                  >
                    <div>
                      {/* Top Row: Location Name (Left) & Status Badge (Right) */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 tracking-tight truncate">
                          {locationName}
                        </span>
                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap ${
                            isCompleted
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {isCompleted ? 'Selesai' : 'belum diperiksa'}
                        </span>
                      </div>

                      {/* Middle Row: Equipment Name / Code */}
                      <div className="mt-1.5">
                        <p className="text-xs font-mono font-bold text-slate-700">
                          {eq.equipment_code || eq.name}
                        </p>
                      </div>
                    </div>

                    {/* Action Button without divider line */}
                    <div className="mt-3 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEquipmentSelect(eq.id);
                        }}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          isViewerOnly
                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                            : isCompleted
                            ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300'
                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-xs shadow-blue-500/20'
                        }`}
                      >
                        {isViewerOnly ? 'Lihat Form' : isCompleted ? 'Edit Form' : 'Pilih Alat'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* STEP 3: Selectable Interval Tiles for Selected Equipment */}
      {preventiveFlowStep === 'interval' && (() => {
        const selectedEq = equipments.find((e) => e.id === Number(selectedEquipmentId));
        const locationObj = selectedEq ? locations.find((l) => l.id === selectedEq.location_id) : null;
        const locationName = locationObj?.name || '';

        if (!selectedEq) {
          return (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs text-center space-y-3">
              <p className="text-xs font-bold text-slate-600">
                Silakan pilih unit lokasi peralatan terlebih dahulu di Langkah 2.
              </p>
              <button
                type="button"
                onClick={() => handleStepChange('equipment')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Ke Langkah 2: Pilih Lokasi Alat</span>
              </button>
            </div>
          );
        }

        return (
          <div className="space-y-3.5">
            {/* Selected Equipment Banner */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Peralatan Terpilih:</span>
                  <span className="px-2.5 py-0.5 bg-blue-100 text-blue-900 text-xs font-mono font-bold rounded-lg border border-blue-300">
                    {selectedEq.equipment_code || selectedEq.name}
                  </span>
                </div>
                <h3 className="text-sm font-black text-slate-900 mt-1">
                  {selectedEq.name} {locationName ? `(${locationName})` : ''}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => handleStepChange('equipment')}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Ganti Lokasi Alat</span>
              </button>
            </div>

            {/* Interval Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {INTERVAL_OPTIONS.map((interval) => {
                const hasCurrentEntry = preventiveEntries.some((pe) =>
                  isMatchingContextEntry(pe, selectedEq.id, interval.id, currentPeriodKey, activeShift)
                );

                // Find the latest entry submitted overall for this equipment and interval from database
                const matchingEntries = preventiveEntries
                  .filter((pe) => pe.equipment_id === selectedEq.id && (pe.checklist_frequency_id === interval.id || (pe as any).frequency_id === interval.id))
                  .sort((a, b) => {
                    const dateCmp = (b.operational_date || '').localeCompare(a.operational_date || '');
                    if (dateCmp !== 0) return dateCmp;
                    return (b.created_at || '').localeCompare(a.created_at || '');
                  });

                const lastEntry = matchingEntries[0] || null;
                const lastDateFormatted = lastEntry?.operational_date
                  ? formatIndonesianDate(lastEntry.operational_date, { includeDayName: true, shortMonth: true })
                  : null;
                const lastShiftFormatted = lastEntry?.shift
                  ? `Shift ${lastEntry.shift.charAt(0).toUpperCase() + lastEntry.shift.slice(1).toLowerCase()}`
                  : '';

                return (
                  <div
                    key={interval.id}
                    onClick={() => {
                      onSelectFrequencyId(interval.id);
                      handleConfirmSelectEquipmentAndInterval(selectedEq.id, interval.id);
                    }}
                    className={`p-4 rounded-2xl border flex flex-col justify-between transition-all cursor-pointer min-h-[125px] shadow-2xs hover:shadow-xs active:scale-[0.98] ${
                      hasCurrentEntry
                        ? 'bg-emerald-50/40 border-2 border-emerald-500 hover:border-emerald-600 ring-2 ring-emerald-500/10'
                        : lastEntry
                        ? 'bg-blue-50/15 border border-blue-200/90 hover:border-blue-400'
                        : 'bg-white border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/30'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`p-2 rounded-xl shrink-0 ${
                              hasCurrentEntry
                                ? 'bg-emerald-100 text-emerald-700'
                                : lastEntry
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {React.createElement(interval.icon, { className: 'w-5 h-5' })}
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-slate-900">{interval.name}</h4>
                            <p className="text-xs text-slate-500 font-medium mt-0.5">{interval.desc}</p>
                          </div>
                        </div>

                        {hasCurrentEntry && (
                          <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Sudah dikerjakan</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom Status & Action Row */}
                    <div className="mt-3 pt-2.5 border-t border-slate-200/60 flex items-center justify-between gap-2">
                      {/* Last Submit Date Indicator */}
                      <div className="min-w-0 flex items-center gap-1.5 text-xs">
                        {hasCurrentEntry ? (
                          <div className="flex items-center gap-1 text-emerald-700 font-semibold truncate">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">
                              Terakhir submit : <span className="font-bold underline decoration-emerald-400">{lastDateFormatted}</span> {lastShiftFormatted}
                            </span>
                          </div>
                        ) : lastEntry ? (
                          <div className="flex items-center gap-1 text-slate-600 font-medium truncate">
                            <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">
                              Terakhir submit : <span className="font-semibold text-slate-800">{lastDateFormatted}</span> {lastShiftFormatted}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-slate-400 truncate">
                            <Clock className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                            <span className="truncate">Belum ada riwayat submit</span>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectFrequencyId(interval.id);
                          handleConfirmSelectEquipmentAndInterval(selectedEq.id, interval.id);
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                          isViewerOnly
                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                            : hasCurrentEntry
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs shadow-emerald-600/20'
                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-xs shadow-blue-500/20'
                        }`}
                      >
                        {isViewerOnly
                          ? 'Lihat'
                          : hasCurrentEntry
                          ? `Edit ${interval.name}`
                          : `Isi ${interval.name}`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
