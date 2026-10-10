import React from 'react';
import { ArrowLeft, Calendar, ChevronRight } from 'lucide-react';
import { Equipment } from '../../types';
import { normalizeOperationalDate } from '../../utils/dateTimeUtils';

interface PreventiveFormHeaderProps {
  selectedEquipment: Equipment;
  onBackToList: () => void;
  activeSteps: number[];
  mobileStep: number;
  onSelectMobileStep: (step: number) => void;
  entryDate?: string;
  entryShift?: string;
  onEntryDateChange?: (date: string) => void;
  onEntryShiftChange?: (shift: string) => void;
  role?: string;
}

export const PreventiveFormHeader: React.FC<PreventiveFormHeaderProps> = ({
  selectedEquipment,
  onBackToList,
  activeSteps,
  mobileStep,
  onSelectMobileStep,
  entryDate,
  entryShift,
  onEntryDateChange,
  onEntryShiftChange,
  role,
}) => {
  const todayStr = normalizeOperationalDate(new Date());
  const activeDate = entryDate || todayStr;
  const activeShift = entryShift || 'Shift 1';

  const isPastDate = activeDate < todayStr;
  const isSupervisorOrAdmin = role === 'supervisor' || role === 'SUPERVISOR' || role === 'admin' || role === 'ADMIN';

  const STEP_LABELS: Record<number, string> = {
    1: 'Foto',
    2: 'Tegangan',
    3: 'Checklist',
    4: 'Selesai',
  };

  return (
    <div className="space-y-3">
      {/* Banner Card for Selected Equipment Info */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl p-3.5 sm:p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
            {selectedEquipment.name}
          </h2>
          <p className="text-xs font-mono font-bold text-blue-100 mt-0.5">
            {selectedEquipment.equipment_code} • SN: {selectedEquipment.serial_number || 'N/A'}
          </p>
        </div>

        <button
          type="button"
          onClick={onBackToList}
          className="bg-white hover:bg-slate-100 text-blue-950 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer text-nowrap self-stretch sm:self-auto justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-blue-700" />
          <span>Ganti Mesin</span>
        </button>
      </div>

      {/* Date & Shift Context - ONLY VISIBLE FOR SUPERVISOR / ADMIN */}
      {isSupervisorOrAdmin && onEntryDateChange && (
        <div className="bg-white border border-slate-200 rounded-xl p-2.5 sm:p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isPastDate ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
              <Calendar className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">Tanggal & Shift Pemeriksaan</span>
                {isPastDate && (
                  <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold rounded-full">
                    Catatan Tanggal Lampau
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onEntryDateChange(todayStr)}
              className={`px-2 py-1 text-[11px] font-bold rounded-lg border transition-all cursor-pointer ${
                activeDate === todayStr
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              Hari Ini
            </button>

            <input
              type="date"
              value={activeDate}
              onChange={(e) => onEntryDateChange(e.target.value)}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1] cursor-pointer"
            />

            {onEntryShiftChange && (
              <select
                value={activeShift}
                onChange={(e) => onEntryShiftChange(e.target.value)}
                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1] cursor-pointer"
              >
                <option value="Shift 1">Shift 1 (Pagi)</option>
                <option value="Shift 2">Shift 2 (Malam)</option>
              </select>
            )}
          </div>
        </div>
      )}

      {/* Clean Breadcrumb Navigation: Foto > Tegangan > Checklist > Selesai */}
      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 shadow-2xs overflow-x-auto">
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-semibold whitespace-nowrap min-w-max">
          {activeSteps.map((stepNum, idx) => {
            const label = STEP_LABELS[stepNum] || `Tahap ${stepNum}`;
            const isActive = mobileStep === stepNum;
            const isPassed = mobileStep > stepNum;

            return (
              <React.Fragment key={stepNum}>
                <button
                  type="button"
                  onClick={() => onSelectMobileStep(stepNum)}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-blue-600 text-white font-bold shadow-xs'
                      : isPassed
                      ? 'text-slate-800 hover:bg-slate-100 hover:text-blue-600 font-medium'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                    isActive ? 'bg-white text-blue-600' : isPassed ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {idx + 1}
                  </span>
                  <span>{label}</span>
                </button>
                {idx < activeSteps.length - 1 && (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mx-0.5" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
