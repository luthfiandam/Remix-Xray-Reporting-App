import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FileText,
  Filter,
  CheckCircle2,
  Calendar,
  Layers,
  Download,
  RefreshCw,
  AlertTriangle,
  FileCheck,
  CheckSquare,
  Square,
} from 'lucide-react';
import { toast } from '../Toast';
import { ReportFileMetadata } from '../../types';
import { getAuthHeaders } from '../../services/authService';

interface BatchReportMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BatchReportMergeModal: React.FC<BatchReportMergeModalProps> = ({ isOpen, onClose }) => {
  const [reportType, setReportType] = useState<string>('daily');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [shiftFilter, setShiftFilter] = useState<'Semua' | 'Pagi' | 'Siang' | 'Malam'>('Semua');

  // Search Results & Selection
  const [searching, setSearching] = useState<boolean>(false);
  const [matchedReports, setMatchedReports] = useState<ReportFileMetadata[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Merge Processing State
  const [merging, setMerging] = useState<boolean>(false);
  const [mergeProgressMessage, setMergeProgressMessage] = useState<string>('');

  const isShiftApplicable = reportType === 'daily';

  useEffect(() => {
    if (isOpen) {
      handleSearchReports();
    }
  }, [isOpen]);

  const handleSearchReports = async () => {
    setSearching(true);
    try {
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders };

      const params = new URLSearchParams();
      params.append('type', reportType);

      const res = await fetch(`/api/reports/archive?${params.toString()}`, { headers });
      if (res.ok) {
        const data = await res.json();
        let list: ReportFileMetadata[] = data.files || [];

        // Filter by Date Range
        if (startDate) {
          list = list.filter((r) => r.operational_date >= startDate);
        }
        if (endDate) {
          list = list.filter((r) => r.operational_date <= endDate);
        }

        // Filter by Shift if applicable
        if (isShiftApplicable && shiftFilter !== 'Semua') {
          list = list.filter((r) => r.shift === shiftFilter);
        }

        // Sort: operational_date ASC, shift (Pagi, Siang, Malam), generated_at ASC
        const shiftOrder: Record<string, number> = { Pagi: 1, Siang: 2, Malam: 3 };
        list.sort((a, b) => {
          if (a.operational_date !== b.operational_date) {
            return a.operational_date.localeCompare(b.operational_date);
          }
          const orderA = shiftOrder[a.shift || 'Pagi'] || 9;
          const orderB = shiftOrder[b.shift || 'Pagi'] || 9;
          if (orderA !== orderB) return orderA - orderB;
          return (a.generated_at || '').localeCompare(b.generated_at || '');
        });

        setMatchedReports(list);
        setSelectedIds(new Set(list.map((r) => r.id)));
      } else {
        toast.error('Gagal mengambil arsip laporan');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error saat mencari laporan');
    } finally {
      setSearching(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === matchedReports.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(matchedReports.map((r) => r.id)));
    }
  };

  const toggleSelectId = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleMergeAndDownload = async () => {
    const idsArray = Array.from(selectedIds);
    if (idsArray.length === 0) {
      toast.error('Pilih minimal 1 laporan untuk digabungkan.');
      return;
    }
    if (idsArray.length > 100) {
      toast.error('Maksimal 100 laporan dapat digabungkan sekaligus.');
      return;
    }

    setMerging(true);
    setMergeProgressMessage(`Menyiapkan ${idsArray.length} laporan...`);

    try {
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...authHeaders,
      };

      setMergeProgressMessage(`Menggabungkan ${idsArray.length} file PDF dari Object Storage IDCloudHost...`);

      const res = await fetch('/api/reports/merge', {
        method: 'POST',
        headers,
        body: JSON.stringify({ report_file_ids: idsArray }),
      });

      if (res.ok) {
        setMergeProgressMessage('PDF berhasil digabungkan! Menyiapkan unduhan...');
        const blob = await res.blob();
        const contentDisposition = res.headers.get('Content-Disposition');
        let filename = `Merged_Laporan_${reportType}_${startDate}_sampai_${endDate}.pdf`;
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="?([^";]+)"?/);
          if (match && match[1]) {
            filename = decodeURIComponent(match[1]);
          }
        }

        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

        toast.success(`PDF Gabungan berhasil dibuat dan diunduh! (${idsArray.length} Laporan)`);
        onClose();
      } else {
        const errJson = await res.json().catch(() => ({}));
        toast.error(errJson.error || 'Gagal menggabungkan laporan PDF');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Terjadi kesalahan sistem saat proses merge PDF');
    } finally {
      setMerging(false);
      setMergeProgressMessage('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200 my-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Gabungkan Laporan PDF (Batch Export)</h2>
              <p className="text-xs text-slate-300">
                Pilih rentang tanggal &amp; gabungkan beberapa file PDF laporan arsip existing menjadi 1 dokumen tunggal.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={merging}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Filter Section */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Filter className="w-3.5 h-3.5 text-blue-600" />
              <span>Filter Kriteria Laporan</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {/* Report Type */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Jenis Laporan</label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  disabled={merging}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
                >
                  <option value="daily">Laporan Harian</option>
                  <option value="weekly">Laporan Mingguan</option>
                  <option value="monthly">Laporan Bulanan</option>
                  <option value="quarterly">Laporan Triwulan</option>
                  <option value="semester">Laporan Semester</option>
                  <option value="yearly">Laporan Tahunan</option>
                  <option value="corrective">Laporan Corrective</option>
                </select>
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Tanggal Mulai</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={merging}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Tanggal Selesai</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={merging}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>

            {/* Shift Filter (Daily Only) */}
            {isShiftApplicable && (
              <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs">
                <span className="text-slate-600 font-bold">Filter Shift Operasional:</span>
                <div className="flex items-center gap-1.5">
                  {(['Semua', 'Pagi', 'Siang', 'Malam'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={merging}
                      onClick={() => setShiftFilter(s)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        shiftFilter === s
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSearchReports}
              disabled={searching || merging}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 active:bg-black text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${searching ? 'animate-spin' : ''}`} />
              <span>Terapkan Filter &amp; Cari Laporan</span>
            </button>
          </div>

          {/* Results Selection List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700">
                Daftar Laporan Terpilih ({selectedIds.size} dari {matchedReports.length})
              </span>
              {matchedReports.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  disabled={merging}
                  className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer text-xs"
                >
                  {selectedIds.size === matchedReports.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                </button>
              )}
            </div>

            {searching ? (
              <div className="py-8 text-center space-y-2">
                <RefreshCw className="w-5 h-5 text-blue-600 animate-spin mx-auto" />
                <p className="text-xs text-slate-500 font-medium">Mencari laporan dari arsip database...</p>
              </div>
            ) : matchedReports.length === 0 ? (
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-1">
                <FileCheck className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-700">Laporan Tidak Ditemukan</p>
                <p className="text-[11px] text-slate-400">
                  Tidak ada laporan arsip yang sesuai dengan kriteria jenis laporan, rentang tanggal, dan shift di atas.
                </p>
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-2xl border border-slate-200 divide-y divide-slate-100 bg-white">
                {matchedReports.map((report) => {
                  const isChecked = selectedIds.has(report.id);
                  return (
                    <div
                      key={report.id}
                      onClick={() => !merging && toggleSelectId(report.id)}
                      className={`p-3 flex items-center justify-between text-xs transition cursor-pointer select-none ${
                        isChecked ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-3">
                        <button
                          type="button"
                          className={`text-blue-600 focus:outline-none ${merging ? 'opacity-50' : ''}`}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-600 fill-blue-50" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 truncate">
                              {report.operational_date}
                            </span>
                            {report.shift && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">
                                Shift {report.shift}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono truncate" title={report.object_key}>
                            {report.file_name || report.object_key}
                          </p>
                        </div>
                      </div>

                      <div className="text-right text-[10px] text-slate-500 font-medium shrink-0">
                        {report.generated_at ? new Date(report.generated_at).toLocaleDateString('id-ID') : '-'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Merge Progress Status Notice */}
          {merging && (
            <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl flex items-center gap-3 text-blue-900 text-xs shadow-xs animate-pulse">
              <RefreshCw className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
              <div>
                <p className="font-bold">Proses Penggabungan PDF Berjalan</p>
                <p className="text-[11px] text-blue-700">{mergeProgressMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-medium">
            Urutan: <strong className="text-slate-800">Tanggal ASC &rarr; Shift (Pagi → Siang → Malam)</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={merging}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              Batal
            </button>

            <button
              onClick={handleMergeAndDownload}
              disabled={selectedIds.size === 0 || merging}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>Gabungkan ({selectedIds.size}) &amp; Unduh PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
