import React, { useState, useMemo } from 'react';
import { HistoricalReportSummary } from '../../services/reportService';
import { ShiftType } from '../../types';
import {
  Calendar,
  Search,
  Filter,
  CheckCircle2,
  Wrench,
  Users,
  FileText,
  Download,
  Send,
  Eye,
  Clock,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  CalendarRange,
  RotateCcw,
  Layers,
  X,
  Copy,
} from 'lucide-react';
import { BatchReportMergeModal } from './BatchReportMergeModal';
import { toast } from '../Toast';

function formatSafeSubmissionTime(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'Invalid Date' || trimmed.includes('1899')) return null;

  if (/^\d{1,2}[:.]\d{2}([:.]\d{2})?$/.test(trimmed)) {
    return trimmed.slice(0, 5).replace(':', '.');
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(':', '.');
  }

  const match = trimmed.match(/(\d{2})[:.](\d{2})/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }

  return null;
}

function sortTechNamesLuthfiFirst(names: string[]): string[] {
  if (!names || !Array.isArray(names)) return ['Teknisi Tidak Tercatat'];
  const copy = [...names];
  return copy.sort((a, b) => {
    const aIsLuthfi = a.toLowerCase().includes('luthfi');
    const bIsLuthfi = b.toLowerCase().includes('luthfi');
    if (aIsLuthfi && !bIsLuthfi) return -1;
    if (!aIsLuthfi && bIsLuthfi) return 1;
    return 0;
  });
}

interface HistoricalReportListSectionProps {
  historicalReports: HistoricalReportSummary[];
  selectedDate?: string;
  selectedShift?: ShiftType;
  onSelectReport: (rawDate: string, shift: ShiftType) => void;
  onDownloadPdfDirect?: (rawDate: string, shift: ShiftType) => void;
  onResetToCurrentSession?: () => void;
  isCurrentSessionSelected?: boolean;
}

export const HistoricalReportListSection: React.FC<HistoricalReportListSectionProps> = ({
  historicalReports,
  selectedDate = '',
  selectedShift = 'Pagi',
  onSelectReport,
  onDownloadPdfDirect,
  onResetToCurrentSession,
  isCurrentSessionSelected = true,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'Pagi' | 'Siang' | 'Malam'>('ALL');
  const [dateRangeFilter, setDateRangeFilter] = useState<'ALL' | '7DAYS' | '30DAYS'>('ALL');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [detailModalReport, setDetailModalReport] = useState<HistoricalReportSummary | null>(null);

  const ITEMS_PER_PAGE = 10;

  // Filter logic - guaranteed newest to oldest (paling baru ke paling lama)
  const filteredReports = useMemo(() => {
    const list = historicalReports.filter((item) => {
      // 1. Search term match
      if (searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase().trim();
        const matchesDate = item.rawDate.toLowerCase().includes(term);
        const matchesFmtDate = item.formattedDate.toLowerCase().includes(term);
        const matchesTech = item.technicianNames.some((t) => t.toLowerCase().includes(term));
        if (!matchesDate && !matchesFmtDate && !matchesTech) {
          return false;
        }
      }

      // 2. Shift Filter
      if (shiftFilter !== 'ALL' && item.shift !== shiftFilter) {
        return false;
      }

      // 3. Custom Date Picker Range Filter
      if (startDateFilter && item.rawDate < startDateFilter) {
        return false;
      }
      if (endDateFilter && item.rawDate > endDateFilter) {
        return false;
      }

      // 4. Date Range Preset Filter
      if (dateRangeFilter !== 'ALL') {
        const reportDate = new Date(item.rawDate);
        const today = new Date();
        const diffTime = Math.abs(today.getTime() - reportDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (dateRangeFilter === '7DAYS' && diffDays > 7) return false;
        if (dateRangeFilter === '30DAYS' && diffDays > 30) return false;
      }

      return true;
    });

    return list.sort((a, b) => {
      const timeA = new Date(a.rawDate).getTime();
      const timeB = new Date(b.rawDate).getTime();
      if (!isNaN(timeA) && !isNaN(timeB) && timeB !== timeA) {
        return timeB - timeA;
      }
      return b.rawDate.localeCompare(a.rawDate);
    });
  }, [historicalReports, searchTerm, shiftFilter, dateRangeFilter, startDateFilter, endDateFilter]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredReports.length / ITEMS_PER_PAGE) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedReports = useMemo(() => {
    const start = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
    return filteredReports.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredReports, safeCurrentPage]);

  return (
    <div className="space-y-4">
      {/* Active Selected Date Notice Bar */}
      {!isCurrentSessionSelected && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 rounded-xl text-amber-800 shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                  Menampilkan Laporan Histori
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200 text-amber-900 border border-amber-300">
                  {selectedShift}
                </span>
              </div>
              <p className="text-xs font-semibold text-amber-800 mt-0.5">
                Tanggal: <strong className="text-amber-950 font-bold">{selectedDate}</strong> (Seluruh tampilan export di tab atas menggunakan data histori tanggal ini)
              </p>
            </div>
          </div>

          {onResetToCurrentSession && (
            <button
              onClick={onResetToCurrentSession}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Kembali ke Sesi Shift Saat Ini</span>
            </button>
          )}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Cari tanggal (contoh: 2026-09-20), atau nama teknisi..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Batch Report Export Button */}
          <button
            onClick={() => setIsMergeModalOpen(true)}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer shrink-0"
            title="Gabungkan beberapa file PDF laporan arsip existing menjadi 1 dokumen tunggal"
          >
            <Layers className="w-4 h-4" />
            <span>Gabungkan Laporan (Batch Export)</span>
          </button>
        </div>

        {/* Date Range Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Filter className="w-3 h-3" /> Preset:
            </span>
            {[
              { id: 'ALL', label: 'Semua Tanggal' },
              { id: '7DAYS', label: '7 Hari Terakhir' },
              { id: '30DAYS', label: '30 Hari Terakhir' },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setDateRangeFilter(preset.id as any);
                  setStartDateFilter('');
                  setEndDateFilter('');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  dateRangeFilter === preset.id && !startDateFilter && !endDateFilter
                    ? 'bg-blue-50 text-blue-700 border border-blue-200 font-bold'
                    : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom Date Range Picker */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-xl w-full sm:w-auto">
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 shrink-0">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Rentang:</span>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0 w-full sm:w-auto">
              <input
                type="date"
                value={startDateFilter}
                onChange={(e) => {
                  setStartDateFilter(e.target.value);
                  setDateRangeFilter('ALL');
                  setCurrentPage(1);
                }}
                className="flex-1 sm:flex-none sm:w-36 min-w-[130px] bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 font-medium cursor-pointer shadow-2xs"
              />
              <span className="text-xs text-slate-400 font-bold shrink-0">s/d</span>
              <input
                type="date"
                value={endDateFilter}
                onChange={(e) => {
                  setEndDateFilter(e.target.value);
                  setDateRangeFilter('ALL');
                  setCurrentPage(1);
                }}
                className="flex-1 sm:flex-none sm:w-36 min-w-[130px] bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 font-medium cursor-pointer shadow-2xs"
              />
            </div>
            {(startDateFilter || endDateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setStartDateFilter('');
                  setEndDateFilter('');
                  setCurrentPage(1);
                }}
                className="text-[10px] font-bold text-rose-600 hover:text-rose-800 px-2 py-1 bg-rose-50 hover:bg-rose-100 rounded-md cursor-pointer shrink-0 transition"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Historical Reports Cards Grid */}
      {filteredReports.length === 0 ? (
        <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2">
          <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto" />
          <h4 className="text-sm font-bold text-slate-700">Tidak Ada Laporan Ditemukan</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Tidak ada arsip laporan yang cocok dengan filter pencarian tanggal atau shift yang ditentukan.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {paginatedReports.map((item) => {
              const isSelected =
                item.rawDate === selectedDate && item.shift === selectedShift;
              const sortedTechs = sortTechNamesLuthfiFirst(item.technicianNames);

              return (
                <div
                  key={item.dateKey}
                  className={`bg-white rounded-2xl border transition-all p-4 flex flex-col justify-between gap-3 shadow-xs ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/20'
                      : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  {/* Header Row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-100 text-blue-800 border border-blue-200">
                          Shift {item.shift}
                        </span>

                        {item.isCurrentSession && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 animate-pulse">
                            ● Sesi Shift Saat Ini
                          </span>
                        )}

                        {isSelected && !item.isCurrentSession && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            Sedang Dipilih
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm font-extrabold text-slate-900 leading-snug break-words">
                        {item.formattedDate}
                      </h3>
                    </div>

                    <button
                      onClick={() => setDetailModalReport(item)}
                      className="p-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 shrink-0"
                      title="Lihat Detail Ringkasan Laporan"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Detail</span>
                    </button>
                  </div>

                  {/* Metrics Breakdown */}
                  {item.isCurrentSession && item.preventiveCount === 0 && item.correctiveCount === 0 ? (
                    <div className="bg-emerald-50/70 border border-emerald-200/80 p-2.5 rounded-xl text-xs flex items-center gap-2.5 text-emerald-800">
                      <Clock className="w-4 h-4 text-emerald-600 shrink-0 animate-pulse" />
                      <div>
                        <p className="font-bold text-emerald-950">Shift Sedang Berjalan</p>
                        <p className="text-[11px] text-emerald-700">Belum ada checklist atau laporan gangguan yang disubmit pada shift ini.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Preventive
                        </span>
                        <p className="font-extrabold text-slate-800">
                          {item.preventiveEquipmentsCount} Unit ({item.preventiveCount} Record)
                        </p>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Wrench className="w-3 h-3 text-amber-600" /> Corrective
                        </span>
                        <p className="font-extrabold text-slate-800">
                          {item.correctiveCount} Laporan ({item.correctiveResolvedCount} Selesai)
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Technicians & Timestamps Footer */}
                  <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100 gap-2">
                    <div
                      className="flex items-center gap-1.5 min-w-0 max-w-[65%]"
                      title={`Teknisi Petugas: ${sortedTechs.join(', ')}`}
                    >
                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-700 truncate">
                        {sortedTechs.length === 1 && sortedTechs[0] === 'Teknisi Tidak Tercatat' ? (
                          <span className="italic text-slate-400 font-normal">Teknisi Tidak Tercatat</span>
                        ) : (
                          sortedTechs.join(', ')
                        )}
                      </span>
                    </div>

                    {(() => {
                      const formattedTime = formatSafeSubmissionTime(item.lastSubmittedAt);
                      if (!formattedTime) {
                        return item.isCurrentSession ? (
                          <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md">
                            Belum submit checklist
                          </span>
                        ) : null;
                      }
                      return (
                        <div
                          className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100/90 px-2 py-0.5 rounded-md shrink-0"
                          title={`Waktu kirim checklist/laporan terakhir pada shift ini: ${formattedTime} WIB`}
                        >
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>Submit: {formattedTime} WIB</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Card Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => setDetailModalReport(item)}
                      className="flex-1 py-1.5 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl text-xs transition-all border border-blue-200/80 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Lihat &amp; Ekspor Laporan</span>
                    </button>

                    {onDownloadPdfDirect && (
                      <button
                        onClick={() => onDownloadPdfDirect(item.rawDate, item.shift)}
                        className="py-1.5 px-3 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        title="Download Dokumen PDF Resmi"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Bar (Max 10 per page) */}
          {totalPages > 1 && (
            <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold">
              <span className="text-slate-500">
                Menampilkan {paginatedReports.length} dari {filteredReports.length} laporan (Halaman {safeCurrentPage} dari {totalPages})
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safeCurrentPage === 1}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Sebelumnya</span>
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center cursor-pointer ${
                        safeCurrentPage === p
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  <span>Selanjutnya</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal Popup (Shows WhatsApp Report Preview without navigating) */}
      {detailModalReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 bg-blue-500 text-white rounded">
                  Shift {detailModalReport.shift}
                </span>
                <h3 className="text-sm font-bold mt-1 text-white">
                  Ringkasan Laporan — {detailModalReport.formattedDate}
                </h3>
              </div>
              <button
                onClick={() => setDetailModalReport(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Teknisi Bertugas:</span>
                  <strong className="text-slate-900">
                    {sortTechNamesLuthfiFirst(detailModalReport.technicianNames).join(', ')}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Total Unit Preventive Checked:</span>
                  <strong className="text-emerald-700">
                    {detailModalReport.preventiveEquipmentsCount} Unit ({detailModalReport.preventiveCount} Record)
                  </strong>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Laporan Corrective:</span>
                  <strong className="text-amber-700">
                    {detailModalReport.correctiveCount} Laporan ({detailModalReport.correctiveResolvedCount} Selesai)
                  </strong>
                </div>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1 text-emerald-950">
                <p className="font-bold flex items-center gap-1.5 text-emerald-800">
                  <Send className="w-4 h-4 text-emerald-600" />
                  <span>Siap Diekspor &amp; Dibagikan</span>
                </p>
                <p className="text-[11px] text-emerald-800">
                  Klik "Buka Tab Laporan" jika ingin melihat preview lengkap WhatsApp, CSV Excel, atau dokumen PDF resmi untuk tanggal ini.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 flex-wrap">
              {onDownloadPdfDirect && (
                <button
                  onClick={() => {
                    onDownloadPdfDirect(detailModalReport.rawDate, detailModalReport.shift);
                    setDetailModalReport(null);
                  }}
                  className="px-3 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
              )}

              <button
                onClick={() => {
                  onSelectReport(detailModalReport.rawDate, detailModalReport.shift);
                  setDetailModalReport(null);
                  toast.success('Laporan Dimuat', `Menampilkan tab laporan tanggal ${detailModalReport.formattedDate}`);
                }}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Buka Tab Laporan Lengkap</span>
              </button>

              <button
                onClick={() => setDetailModalReport(null)}
                className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Report Export / Merge Modal */}
      <BatchReportMergeModal
        isOpen={isMergeModalOpen}
        onClose={() => setIsMergeModalOpen(false)}
      />
    </div>
  );
};
