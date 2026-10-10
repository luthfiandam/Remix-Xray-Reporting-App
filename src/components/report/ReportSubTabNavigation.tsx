import React from 'react';
import { Send, FileSpreadsheet, FileText, Download, Share2, Loader2, History } from 'lucide-react';
import { ReportSubTab } from './types';
import { Role } from '../../types';

interface ReportSubTabNavigationProps {
  activeSubTab: ReportSubTab;
  setActiveSubTab: (tab: ReportSubTab) => void;
  isGeneratingPDF: boolean;
  onGeneratePdf: (action: 'download' | 'share' | 'whatsapp') => void;
  historicalCount?: number;
  role?: Role;
}

export const ReportSubTabNavigation: React.FC<ReportSubTabNavigationProps> = ({
  activeSubTab,
  setActiveSubTab,
  isGeneratingPDF,
  onGeneratePdf,
  historicalCount,
  role = 'technician',
}) => {
  return (
    <div className="space-y-2.5">
      {/* Sleek Segmented Navigation Tab Bar */}
      <div className="bg-white p-1.5 border border-slate-200 rounded-xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('wa')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'wa'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-700 bg-slate-50 sm:bg-transparent hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Send className="w-3.5 h-3.5 shrink-0" />
            <span>Laporan WhatsApp</span>
          </button>

          {role === 'supervisor' && (
            <button
              type="button"
              onClick={() => setActiveSubTab('excel')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer whitespace-nowrap ${
                activeSubTab === 'excel'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-700 bg-slate-50 sm:bg-transparent hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>Export Excel</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveSubTab('pdf')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'pdf'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-700 bg-slate-50 sm:bg-transparent hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span>Export PDF</span>
          </button>

          {(role === 'supervisor' || role === 'operations_admin' || role === 'system_admin' || role === 'admin') && (
            <button
              type="button"
              onClick={() => setActiveSubTab('history')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer whitespace-nowrap ${
                activeSubTab === 'history'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 bg-slate-50 sm:bg-transparent hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>Arsip Laporan</span>
              {historicalCount !== undefined && historicalCount > 0 && (
                <span
                  className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                    activeSubTab === 'history' ? 'bg-white/25 text-white' : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {historicalCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
