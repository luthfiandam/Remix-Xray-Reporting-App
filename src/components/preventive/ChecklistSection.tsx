import React from 'react';
import { CheckSquare, Check } from 'lucide-react';
import { ChecklistItem } from '../../types';

interface ChecklistSectionProps {
  relevantChecklistItems: ChecklistItem[];
  checklistResults: Record<number, 'Baik' | 'Temuan'>;
  onChecklistChange: (itemId: number, res: 'Baik' | 'Temuan') => void;
  onSetAllBaik: () => void;
  selectedFrequencyName?: string;
  mobileStep: number;
  isViewerOnly?: boolean;
}

export const ChecklistSection: React.FC<ChecklistSectionProps> = ({
  relevantChecklistItems,
  checklistResults,
  onChecklistChange,
  onSetAllBaik,
  selectedFrequencyName = 'Harian',
  mobileStep,
  isViewerOnly = false,
}) => {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-xs space-y-3.5 ${
        mobileStep !== 3 ? 'hidden lg:block' : ''
      }`}
    >
      <div className="border-b border-slate-100 pb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-indigo-600" />
            <span>Item Pengecekan ({relevantChecklistItems.length} Item)</span>
          </h3>
          <p className="text-xs text-slate-600 mt-0.5 font-medium">
            Lakukan pengujian fisik dan fungsi sesuai daftar berikut
          </p>
        </div>

        {!isViewerOnly && (
          <button
            type="button"
            onClick={onSetAllBaik}
            className="px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold hover:bg-emerald-200 transition-colors flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Set Semua Baik</span>
          </button>
        )}
      </div>

      {/* Checklist Items Table / Cards */}
      <div className="space-y-1.5 border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
        {relevantChecklistItems && relevantChecklistItems.length > 0 ? (
          relevantChecklistItems.filter(Boolean).map((item, idx) => (
            <div
              key={item.id ?? idx}
              className="p-2.5 sm:p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="text-xs sm:text-sm font-bold text-slate-900 leading-normal">
                  {item.description || 'Pemeriksaan Unit'}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => onChecklistChange(item.id, 'Baik')}
                  disabled={isViewerOnly}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    isViewerOnly
                      ? checklistResults[item.id] === 'Baik'
                        ? 'bg-emerald-600 text-white opacity-90 cursor-not-allowed'
                        : 'bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                      : checklistResults[item.id] === 'Baik'
                      ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-600/30 cursor-pointer'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer'
                  }`}
                >
                  Baik
                </button>
                <button
                  type="button"
                  onClick={() => onChecklistChange(item.id, 'Temuan')}
                  disabled={isViewerOnly}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    isViewerOnly
                      ? checklistResults[item.id] === 'Temuan'
                        ? 'bg-red-600 text-white opacity-90 cursor-not-allowed'
                        : 'bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                      : checklistResults[item.id] === 'Temuan'
                      ? 'bg-red-600 text-white shadow-xs ring-2 ring-red-600/30 cursor-pointer'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer'
                  }`}
                >
                  Temuan
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="p-6 text-center text-xs text-slate-400 italic">
            Belum ada checklist item terdaftar untuk frekuensi {selectedFrequencyName}.
          </div>
        )}
      </div>
    </div>
  );
};
