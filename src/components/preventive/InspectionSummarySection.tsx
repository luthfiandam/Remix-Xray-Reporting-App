import React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  X,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Equipment } from '../../types';

interface InspectionSummarySectionProps {
  notes: string;
  onNotesChange: (notes: string) => void;
  overallStatus: 'OK' | 'NG' | 'NEEDS_REPAIR';
  onOverallStatusChange: (status: 'OK' | 'NG' | 'NEEDS_REPAIR') => void;
  selectedEquipment: Equipment;
  selectedFrequencyName?: string;
  isXRay: boolean;
  viewType: 'single' | 'dual';
  completenessPercent: number;
  isSubmitting: boolean;
  hasExistingEntry: boolean;
  mobileStep: number;
  isViewerOnly?: boolean;
  onCreateCollage: () => void;
  onPrevStep: () => void;
  onNextStep: () => void;
}

export const InspectionSummarySection: React.FC<InspectionSummarySectionProps> = ({
  notes,
  onNotesChange,
  overallStatus,
  onOverallStatusChange,
  selectedEquipment,
  selectedFrequencyName = 'Harian',
  isXRay,
  viewType,
  completenessPercent,
  isSubmitting,
  hasExistingEntry,
  mobileStep,
  isViewerOnly = false,
  onCreateCollage,
  onPrevStep,
  onNextStep,
}) => {
  return (
    <>
      {/* SECTION 4: SELESAI / KONDISI AKHIR */}
      <div
        className={`bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 ${
          mobileStep !== 4 ? 'hidden lg:block' : ''
        }`}
      >
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
            <span>Selesai / Kondisi Akhir Peralatan</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Isi catatan pekerjaan dan tentukan status kondisi akhir peralatan
          </p>
        </div>

        {/* Notes & Summary Status */}
        <div className="space-y-3 pt-1">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Catatan Pekerjaan / Hasil Inspeksi
            </label>
            <textarea
              rows={3}
              value={notes}
              disabled={isViewerOnly}
              readOnly={isViewerOnly}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Isi catatan pemeriksaan..."
              className={`w-full px-3 py-2 border rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 ${
                isViewerOnly ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed' : 'bg-slate-50 border-slate-200'
              }`}
            ></textarea>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Kondisi Akhir Peralatan
            </label>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <button
                type="button"
                disabled={isViewerOnly}
                onClick={() => onOverallStatusChange('OK')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  isViewerOnly
                    ? overallStatus === 'OK'
                      ? 'bg-emerald-600 text-white border-emerald-600 opacity-90 cursor-not-allowed'
                      : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed'
                    : overallStatus === 'OK'
                    ? 'bg-emerald-500 border-emerald-600 text-white shadow-xs cursor-pointer'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Normal (OK)</span>
              </button>
              <button
                type="button"
                disabled={isViewerOnly}
                onClick={() => onOverallStatusChange('NEEDS_REPAIR')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  isViewerOnly
                    ? overallStatus === 'NEEDS_REPAIR'
                      ? 'bg-amber-600 text-white border-amber-600 opacity-90 cursor-not-allowed'
                      : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed'
                    : overallStatus === 'NEEDS_REPAIR'
                    ? 'bg-amber-500 border-amber-600 text-white shadow-xs cursor-pointer'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer'
                }`}
              >
                <AlertCircle className="w-4 h-4" />
                <span>Perlu Perbaikan</span>
              </button>
              <button
                type="button"
                disabled={isViewerOnly}
                onClick={() => onOverallStatusChange('NG')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  isViewerOnly
                    ? overallStatus === 'NG'
                      ? 'bg-red-600 text-white border-red-600 opacity-90 cursor-not-allowed'
                      : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed'
                    : overallStatus === 'NG'
                    ? 'bg-red-500 border-red-600 text-white shadow-xs cursor-pointer'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer'
                }`}
              >
                <X className="w-4 h-4" />
                <span>Rusak (NG)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

interface InspectionSummaryCardProps {
  selectedEquipment: Equipment;
  selectedFrequencyName?: string;
  isXRay: boolean;
  viewType: 'single' | 'dual';
  completenessPercent: number;
  isSubmitting: boolean;
  hasExistingEntry: boolean;
  mobileStep: number;
  isViewerOnly?: boolean;
  onCreateCollage: () => void;
  entryDate?: string;
  entryShift?: string;
  technicianNames?: string[];
}

const formatIndonesianDate = (dateStr?: string) => {
  if (!dateStr) {
    return new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
  }
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  return dateStr;
};

export const InspectionSummaryCard: React.FC<InspectionSummaryCardProps> = ({
  selectedEquipment,
  selectedFrequencyName = 'Harian',
  isXRay,
  viewType,
  completenessPercent,
  isSubmitting,
  hasExistingEntry,
  mobileStep,
  isViewerOnly = false,
  onCreateCollage,
  entryDate,
  entryShift,
  technicianNames = [],
}) => {
  const techDisplay =
    technicianNames && technicianNames.length > 0
      ? technicianNames.join(', ')
      : 'Teknisi Bertugas';

  const dateDisplay = formatIndonesianDate(entryDate);

  return (
    <div className={`lg:col-span-4 space-y-3.5 ${mobileStep !== 4 ? 'hidden lg:block' : ''}`}>
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs sticky top-4 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2.5">
          Ringkasan Pemeriksaan
        </h3>

        {/* Key Value Details */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-600 pb-1.5 border-b border-slate-100">
            <span className="font-medium">Teknisi</span>
            <span className="font-bold text-slate-900 truncate max-w-[180px] text-right" title={techDisplay}>
              {techDisplay}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-600 pb-1.5 border-b border-slate-100">
            <span className="font-medium">Tanggal</span>
            <span className="font-bold text-slate-900">
              {dateDisplay}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-600 pb-1.5 border-b border-slate-100">
            <span className="font-medium">Frekuensi</span>
            <span className="font-bold text-indigo-700">
              {selectedFrequencyName}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-600 pb-1.5 border-b border-slate-100">
            <span className="font-medium">Mode</span>
            <span className="font-bold text-slate-900">
              {isXRay ? (viewType === 'dual' ? 'Dual View' : 'Single View') : 'Standard'}
            </span>
          </div>
        </div>

        {/* Kelengkapan Data Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-800">
            <span>Kelengkapan Data</span>
            <span className={completenessPercent === 100 ? 'text-emerald-600 font-extrabold' : 'text-indigo-600 font-extrabold'}>
              {completenessPercent}%
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/50">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                completenessPercent === 100 ? 'bg-emerald-500' : 'bg-[#6366f1]'
              }`}
              style={{ width: `${completenessPercent}%` }}
            ></div>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            {completenessPercent < 100 ? 'Lengkapi foto dan checklist items' : 'Siap dikirim!'}
          </p>
        </div>

        {/* View-Only Mode Warning */}
        {isViewerOnly && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 font-medium">
            🔒 <strong>Mode Lihat (Hanya Baca)</strong>: Anda sedang tidak bertugas pada jadwal shift ini sehingga tidak dapat mengubah atau mengirim laporan preventif.
          </div>
        )}

        {/* Submit & Draft Action Buttons */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={onCreateCollage}
            className="w-full py-2 bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-200 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <ImageIcon className="w-4 h-4 text-emerald-700" />
            <span>Buat Kolase Foto WA</span>
          </button>
          <button
            type="submit"
            disabled={isSubmitting || isViewerOnly}
            className={`flex w-full py-2.5 font-bold text-xs sm:text-sm rounded-xl transition-all shadow-md items-center justify-center gap-2 text-white disabled:opacity-60 disabled:cursor-not-allowed ${
              isSubmitting || isViewerOnly
                ? 'bg-slate-500 cursor-not-allowed shadow-none'
                : hasExistingEntry
                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200 cursor-pointer'
                : 'bg-[#6366f1] hover:bg-[#4f46e5] shadow-indigo-200 cursor-pointer'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {isViewerOnly
                ? 'Hanya Baca (Bukan Shift Anda)'
                : isSubmitting
                ? 'Menyimpan...'
                : hasExistingEntry
                ? 'Update Data Laporan'
                : 'Kirim Laporan'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface MobileBottomActionsProps {
  mobileStep: number;
  isSubmitting: boolean;
  hasExistingEntry: boolean;
  isViewerOnly?: boolean;
  onPrevStep: () => void;
  onNextStep: () => void;
  onCreateCollage?: () => void;
}

export const MobileBottomActions: React.FC<MobileBottomActionsProps> = ({
  mobileStep,
  isSubmitting,
  hasExistingEntry,
  isViewerOnly = false,
  onPrevStep,
  onNextStep,
}) => {
  return (
    <div className="block lg:hidden fixed bottom-0 left-0 md:left-64 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-2.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] shadow-lg z-40">
      <div className="flex items-center justify-between gap-2 max-w-3xl mx-auto">
        {mobileStep > 1 ? (
          <button
            type="button"
            onClick={onPrevStep}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Sebelumnya</span>
          </button>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          {mobileStep < 4 ? (
            <button
              type="button"
              onClick={onNextStep}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer shadow-sm shrink-0"
            >
              <span>Berikutnya</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting || isViewerOnly}
              className={`px-3.5 py-2 font-bold text-xs rounded-xl transition-all shadow-md flex items-center gap-1 text-white shrink-0 disabled:opacity-60 disabled:cursor-not-allowed ${
                isSubmitting || isViewerOnly
                  ? 'bg-slate-500 cursor-not-allowed shadow-none'
                  : hasExistingEntry
                  ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200 cursor-pointer'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200 cursor-pointer'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isViewerOnly
                  ? 'Lihat Saja'
                  : isSubmitting
                  ? 'Menyimpan...'
                  : hasExistingEntry
                  ? 'Update Laporan'
                  : 'Kirim Laporan'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
