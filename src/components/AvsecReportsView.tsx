import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Wrench,
  X,
  UserCheck,
  Check,
  FileText,
  Trash2,
  Camera,
} from 'lucide-react';
import { ExternalErrorReport, ExternalReportStatus } from '../types';
import { resolveBatchPresignedUrls } from '../services/storageService';
import { registerPresignedUrls } from '../utils/evidenceUtils';
import { S3Image } from './S3Image';
import {
  fetchAvsecErrorReports,
  acknowledgeAvsecReport,
  convertAvsecReportToCorrective,
  closeAvsecReport,
  deleteAvsecReport,
} from '../services/avsecReportService';
import { sanitizeText, sanitizeMultilineText, sanitizeSearchQuery } from '../utils/sanitizer';

interface AvsecReportsViewProps {
  isSupervisor?: boolean;
  isViewerOnly?: boolean;
  onOpenCorrectiveWithData?: (data: {
    equipment_id: number;
    problem_description: string;
    action_taken?: string;
    photo_url?: string;
    notes?: string;
  }) => void;
}

export const AvsecReportsView: React.FC<AvsecReportsViewProps> = ({
  isSupervisor = false,
  isViewerOnly = false,
  onOpenCorrectiveWithData,
}) => {
  const [reports, setReports] = useState<ExternalErrorReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ExternalReportStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected report for detail modal
  const [selectedReport, setSelectedReport] = useState<ExternalErrorReport | null>(null);

  // Modals for actions
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);

  // Convert to Corrective Form State
  const [actionTaken, setActionTaken] = useState('');
  const [actionResult, setActionResult] = useState<'Resolved' | 'Pending Sparepart' | 'Temporary Fix'>('Resolved');
  const [actionResultText, setActionResultText] = useState('Equipment sudah normal kembali');
  const [actionNotes, setActionNotes] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Close Form State
  const [closeNotes, setCloseNotes] = useState('Pengecekan di lapangan: unit dalam kondisi normal (false alarm).');

  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    const res = await fetchAvsecErrorReports(statusFilter);
    setIsLoading(false);
    if (res.success) {
      setReports(res.reports);
    } else {
      setFetchError(res.error || 'Gagal memuat laporan AVSEC');
      setReports([]);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (reports && reports.length > 0) {
      const keysToResolve: string[] = [];
      reports.forEach((r) => {
        if (r.photo_object_key) keysToResolve.push(r.photo_object_key);
        if (r.photo_url) keysToResolve.push(r.photo_url);
      });
      if (keysToResolve.length > 0) {
        resolveBatchPresignedUrls(keysToResolve).then((urlMap) => {
          registerPresignedUrls(urlMap);
        });
      }
    }
  }, [reports]);

  // Handle Acknowledge
  const handleAcknowledge = async (report: ExternalErrorReport) => {
    const ok = window.confirm(`Konfirmasi penerimaan laporan #${report.report_number}?`);
    if (!ok) return;

    const res = await acknowledgeAvsecReport(report.id);
    if (res.success) {
      await loadReports();
      if (selectedReport?.id === report.id) {
        setSelectedReport((prev) => prev ? { ...prev, status: 'ACKNOWLEDGED' } : null);
      }
    } else {
      alert(res.error || 'Gagal mengonfirmasi laporan');
    }
  };

  // Handle Delete Report (Supervisor only)
  const handleDeleteReport = async (report: ExternalErrorReport) => {
    const ok = window.confirm(
      `Apakah Anda yakin ingin menghapus laporan AVSEC #${report.report_number}? File foto di storage dan data di database akan dihapus permanen.`
    );
    if (!ok) return;

    const res = await deleteAvsecReport(report.id);
    if (res.success) {
      alert(`Laporan #${report.report_number} berhasil dihapus.`);
      if (selectedReport?.id === report.id) {
        setSelectedReport(null);
      }
      await loadReports();
    } else {
      alert(res.error || 'Gagal menghapus laporan');
    }
  };

  // Handle Convert to Corrective Submit
  const handleConvertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReport) return;
    if (isViewerOnly) {
      alert('Akses Ditolak: Teknisi sedang LIBUR (Mode Baca Saja). Konversi ke laporan corrective tidak diizinkan.');
      return;
    }
    if (!actionTaken.trim()) {
      alert('Tindakan perbaikan wajib diisi');
      return;
    }

    setIsSubmittingAction(true);
    const res = await convertAvsecReportToCorrective(selectedReport.id, {
      action_taken: sanitizeMultilineText(actionTaken),
      result: actionResult,
      result_text: sanitizeText(actionResultText),
      notes: sanitizeMultilineText(actionNotes),
    });
    setIsSubmittingAction(false);

    if (res.success) {
      alert(`Berhasil! Laporan telah dikonversi ke Corrective Maintenance (${res.corrective_code || ''}).`);
      setIsConvertModalOpen(false);
      setSelectedReport(null);
      await loadReports();
    } else {
      alert(res.error || 'Gagal mengonversi ke Corrective');
    }
  };

  // Handle Close Report Submit
  const handleCloseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReport) return;
    if (!closeNotes.trim()) {
      alert('Catatan penutupan laporan wajib diisi');
      return;
    }

    setIsSubmittingAction(true);
    const res = await closeAvsecReport(selectedReport.id, sanitizeMultilineText(closeNotes));
    setIsSubmittingAction(false);

    if (res.success) {
      alert(`Laporan #${selectedReport.report_number} telah ditutup.`);
      setIsCloseModalOpen(false);
      setSelectedReport(null);
      await loadReports();
    } else {
      alert(res.error || 'Gagal menutup laporan');
    }
  };

  // Filtered reports
  const filteredReports = reports.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchNum = r.report_number?.toLowerCase().includes(q);
      const matchEq = r.equipment_name?.toLowerCase().includes(q);
      const matchLoc = r.location_name?.toLowerCase().includes(q);
      const matchRep = r.reporter_name?.toLowerCase().includes(q);
      const matchIssue = r.issue_type?.toLowerCase().includes(q);
      return matchNum || matchEq || matchLoc || matchRep || matchIssue;
    }
    return true;
  });

  // KPI Metrics
  const totalCount = reports.length;
  const newCount = reports.filter((r) => r.status === 'NEW').length;
  const ackCount = reports.filter((r) => r.status === 'ACKNOWLEDGED').length;
  const convertedCount = reports.filter((r) => r.status === 'CONVERTED_TO_CORRECTIVE').length;
  const closedCount = reports.filter((r) => r.status === 'CLOSED').length;

  const getStatusBadge = (status: ExternalReportStatus) => {
    switch (status) {
      case 'NEW':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-500 border border-red-500/20 animate-pulse">
            <AlertTriangle className="w-3 h-3" />
            Laporan Baru
          </span>
        );
      case 'ACKNOWLEDGED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Clock className="w-3 h-3" />
            Dikonfirmasi
          </span>
        );
      case 'CONVERTED_TO_CORRECTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <Wrench className="w-3 h-3" />
            Corrective
          </span>
        );
      case 'CLOSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            Ditutup
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-red-50 text-red-600 rounded-xl border border-red-100 shadow-xs">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              Laporan Gangguan AVSEC
              {newCount > 0 && (
                <span className="px-2 py-0.5 bg-red-500 text-white rounded-full text-xs font-bold">
                  {newCount} Baru
                </span>
              )}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadReports}
            disabled={isLoading}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-2 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* 2. KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div
          onClick={() => setStatusFilter('ALL')}
          className={`cursor-pointer p-4 rounded-xl border transition ${
            statusFilter === 'ALL'
              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs font-medium text-slate-400">Total Laporan</div>
          <div className="text-2xl font-bold mt-1">{totalCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter('NEW')}
          className={`cursor-pointer p-4 rounded-xl border transition ${
            statusFilter === 'NEW'
              ? 'bg-red-600 text-white border-red-600 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:border-red-200'
          }`}
        >
          <div className="text-xs font-medium text-red-400 flex items-center justify-between">
            <span>Perlu Ditanggapi</span>
            {newCount > 0 && <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />}
          </div>
          <div className="text-2xl font-bold mt-1 text-red-600 dark:text-inherit">{newCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter('ACKNOWLEDGED')}
          className={`cursor-pointer p-4 rounded-xl border transition ${
            statusFilter === 'ACKNOWLEDGED'
              ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:border-amber-200'
          }`}
        >
          <div className="text-xs font-medium text-slate-400">Dikonfirmasi</div>
          <div className="text-2xl font-bold mt-1 text-amber-600 dark:text-inherit">{ackCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter('CONVERTED_TO_CORRECTIVE')}
          className={`cursor-pointer p-4 rounded-xl border transition ${
            statusFilter === 'CONVERTED_TO_CORRECTIVE'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-200'
          }`}
        >
          <div className="text-xs font-medium text-slate-400">Dibuatkan Corrective</div>
          <div className="text-2xl font-bold mt-1 text-blue-600 dark:text-inherit">{convertedCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter('CLOSED')}
          className={`cursor-pointer p-4 rounded-xl border transition col-span-2 lg:col-span-1 ${
            statusFilter === 'CLOSED'
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-200'
          }`}
        >
          <div className="text-xs font-medium text-slate-400">Ditutup / Normal</div>
          <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-inherit">{closedCount}</div>
        </div>
      </div>

      {/* 3. Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Filter Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">Semua Laporan ({totalCount})</option>
            <option value="NEW">Baru ({newCount})</option>
            <option value="ACKNOWLEDGED">Dikonfirmasi ({ackCount})</option>
            <option value="CONVERTED_TO_CORRECTIVE">Corrective ({convertedCount})</option>
            <option value="CLOSED">Ditutup ({closedCount})</option>
          </select>
        </div>

        <input
          type="text"
          placeholder="Cari nomor laporan, nama mesin, pelapor, lokasi..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-80 px-3.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-500"
        />
      </div>

      {/* 4. Reports List (Mobile Cards & Desktop Table) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {fetchError ? (
          <div className="p-8 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 text-rose-700 border border-rose-200 text-xs font-medium max-w-lg mx-auto">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{fetchError}</span>
            </div>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-xs">
            Belum ada laporan gangguan yang sesuai filter.
          </div>
        ) : (
          <>
            {/* Simple Cards View (Mobile & Grid) */}
            <div className="block md:hidden divide-y divide-slate-100 p-2 sm:p-0">
              {filteredReports.map((report) => (
                <div key={report.id} className="p-3.5 space-y-2.5 hover:bg-slate-50/80 transition bg-white rounded-xl mb-2 border border-slate-200/70 shadow-2xs">
                  {/* Header: Kode Laporan & Status */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/80">
                      {report.report_number}
                    </span>
                    {getStatusBadge(report.status)}
                  </div>

                  {/* Tipe Alat & Lokasi */}
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-200/60 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Wrench className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="font-bold text-slate-900 truncate">
                        {report.equipment_name || 'Equipment'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium shrink-0">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{report.location_name || '-'}</span>
                    </div>
                  </div>

                  {/* Tanggal & Pelapor */}
                  <div className="space-y-1 text-[11px] text-slate-500 px-0.5">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {new Date(report.created_at).toLocaleString('id-ID', {
                          timeZone: 'Asia/Jakarta',
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })} WIB
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-slate-600">
                      <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>Pelapor: <strong className="text-slate-800 font-bold">{report.reporter_name}</strong> ({report.reporter_unit || 'AVSEC'})</span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100 flex-wrap">
                    <button
                      onClick={() => setSelectedReport(report)}
                      className="px-2.5 py-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-600" />
                      <span>Detail</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      {report.status === 'NEW' && (
                        <button
                          onClick={() => handleAcknowledge(report)}
                          className="px-2.5 py-1.5 text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Konfirmasi</span>
                        </button>
                      )}

                      {!isViewerOnly && report.status !== 'CONVERTED_TO_CORRECTIVE' && report.status !== 'CLOSED' && (
                        <button
                          onClick={() => {
                            setSelectedReport(report);
                            setIsConvertModalOpen(true);
                            setActionTaken(`Pemeriksaan dan penanganan kendala ${report.issue_type} pada ${report.equipment_name}.`);
                          }}
                          className="px-2.5 py-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition cursor-pointer border border-blue-200"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          <span>Corrective</span>
                        </button>
                      )}

                      {isSupervisor && (
                        <button
                          onClick={() => handleDeleteReport(report)}
                          className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-xl transition cursor-pointer"
                          title="Hapus"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">No. Laporan &amp; Waktu</th>
                    <th className="py-3 px-4">Equipment &amp; Lokasi</th>
                    <th className="py-3 px-4">Pelapor</th>
                    <th className="py-3 px-4">Jenis Gangguan</th>
                    <th className="py-3 px-4">Keterangan</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReports.map((report) => (
                    <tr key={report.id} className="hover:bg-slate-50/80 transition group">
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-slate-900">{report.report_number}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(report.created_at).toLocaleString('id-ID', {
                            timeZone: 'Asia/Jakarta',
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })} WIB
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800">{report.equipment_name || 'Equipment'}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {report.location_name || '-'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800">{report.reporter_name}</div>
                        <div className="text-[10px] text-slate-400 font-medium">{report.reporter_unit || 'AVSEC'}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-medium">
                          {report.issue_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 max-w-xs truncate text-slate-600">
                        {report.description}
                      </td>
                      <td className="py-3.5 px-4">
                        {getStatusBadge(report.status)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedReport(report)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                            title="Lihat Detail & Foto"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {report.status === 'NEW' && (
                            <button
                              onClick={() => handleAcknowledge(report)}
                              className="p-1.5 text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-lg transition"
                              title="Konfirmasi Laporan"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}

                          {!isViewerOnly && report.status !== 'CONVERTED_TO_CORRECTIVE' && report.status !== 'CLOSED' && (
                            <button
                              onClick={() => {
                                setSelectedReport(report);
                                setIsConvertModalOpen(true);
                                setActionTaken(`Pemeriksaan dan penanganan kendala ${report.issue_type} pada ${report.equipment_name}.`);
                              }}
                              className="p-1.5 text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg transition cursor-pointer"
                              title="Konversi ke Corrective Maintenance"
                            >
                              <Wrench className="w-4 h-4" />
                            </button>
                          )}

                          {isSupervisor && (
                            <button
                              onClick={() => handleDeleteReport(report)}
                              className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-lg transition cursor-pointer"
                              title="Hapus Laporan AVSEC (Supervisor)"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* 5. MODAL: DETAIL REPORT */}
      {selectedReport && !isConvertModalOpen && !isCloseModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs text-slate-400 font-mono">{selectedReport.report_number}</span>
                <h2 className="text-base font-bold text-slate-900">Detail Laporan Gangguan AVSEC</h2>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Status & Timing */}
            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Status:</span>
                {getStatusBadge(selectedReport.status)}
              </div>
              <div className="text-xs text-slate-500 font-medium">
                {new Date(selectedReport.created_at).toLocaleString('id-ID', {
                  timeZone: 'Asia/Jakarta',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })} WIB
              </div>
            </div>

            {/* Equipment Card */}
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Equipment:</span>
                <span className="font-bold text-slate-900">{selectedReport.equipment_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lokasi:</span>
                <span className="font-semibold text-slate-800">{selectedReport.location_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pelapor:</span>
                <span className="font-semibold text-slate-800">{selectedReport.reporter_name} ({selectedReport.reporter_unit})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Jenis Gangguan:</span>
                <span className="font-bold text-amber-700">{selectedReport.issue_type}</span>
              </div>
            </div>

            {/* Description */}
            <div>
              <div className="text-xs font-bold text-slate-700 uppercase mb-1">Keterangan / Gejala:</div>
              <p className="text-xs text-slate-800 bg-slate-50 p-3 rounded-xl border border-slate-200 leading-relaxed whitespace-pre-wrap">
                {selectedReport.description}
              </p>
            </div>

            {/* Photo Preview if available */}
            {(selectedReport.photo_url || selectedReport.photo_object_key) && (
              <div>
                <div className="text-xs font-bold text-slate-700 uppercase mb-1">Foto Bukti Kerusakan:</div>
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-black max-h-60 flex items-center justify-center">
                  <S3Image
                    src={selectedReport.photo_url || selectedReport.photo_object_key}
                    alt="Foto Kerusakan"
                    className="max-h-60 w-auto object-contain"
                  />
                </div>
              </div>
            )}

            {/* GPS coordinates if available */}
            {selectedReport.latitude && selectedReport.longitude && (
              <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  Koordinat: {selectedReport.latitude.toFixed(5)}, {selectedReport.longitude.toFixed(5)}
                </span>
                <a
                  href={`https://www.google.com/maps?q=${selectedReport.latitude},${selectedReport.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-600 hover:underline inline-flex items-center gap-1 font-semibold"
                >
                  Buka Peta <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {/* Action Buttons in Modal */}
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <div>
                {isSupervisor && (
                  <button
                    type="button"
                    onClick={() => handleDeleteReport(selectedReport)}
                    className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-xl text-xs flex items-center gap-1.5 border border-rose-200 transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Hapus Laporan
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedReport.status === 'NEW' && (
                  <button
                    onClick={() => handleAcknowledge(selectedReport)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    Konfirmasi Laporan
                  </button>
                )}

                {selectedReport.status !== 'CONVERTED_TO_CORRECTIVE' && selectedReport.status !== 'CLOSED' && (
                  <>
                    <button
                      onClick={() => {
                        setIsCloseModalOpen(true);
                      }}
                      className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer"
                    >
                      Tutup (False Alarm)
                    </button>
                    <button
                      onClick={() => {
                        setIsConvertModalOpen(true);
                        setActionTaken(`Pemeriksaan dan penanganan kendala ${selectedReport.issue_type} pada ${selectedReport.equipment_name}.`);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Wrench className="w-4 h-4" />
                      Tindak Lanjuti (Corrective)
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL: CONVERT TO CORRECTIVE */}
      {isConvertModalOpen && selectedReport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleConvertSubmit}
            className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Konversi ke Corrective Maintenance</h2>
                  <p className="text-xs text-slate-500">Untuk {selectedReport.equipment_name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConvertModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Photo Reference if available */}
            {selectedReport.photo_url && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3">
                <img
                  src={selectedReport.photo_url}
                  alt="Foto Kerusakan AVSEC"
                  className="w-16 h-16 rounded-lg object-cover border border-slate-300 shrink-0"
                />
                <div className="text-xs text-slate-600 space-y-0.5">
                  <span className="font-bold text-slate-800 block">Foto Referensi Terlampir:</span>
                  <p className="text-[11px] text-slate-500">
                    Foto dari laporan AVSEC ini akan dijadikan acuan dan lampiran dokumentasi pengerjaan corrective.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tindakan Perbaikan / Penanganan <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={actionTaken}
                onChange={(e) => setActionTaken(e.target.value)}
                placeholder="Jelaskan langkah perbaikan teknis yang dilakukan..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Hasil Perbaikan</label>
                <select
                  value={actionResult}
                  onChange={(e) => setActionResult(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value="Resolved">Resolved (Selesai Normal)</option>
                  <option value="Temporary Fix">Temporary Fix</option>
                  <option value="Pending Sparepart">Pending Sparepart</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Keterangan Hasil</label>
                <input
                  type="text"
                  value={actionResultText}
                  onChange={(e) => setActionResultText(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Catatan Tambahan</label>
              <input
                type="text"
                placeholder="Catatan komponen yang disesuaikan atau diganti..."
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <div>
                {onOpenCorrectiveWithData && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenCorrectiveWithData({
                        equipment_id: selectedReport.equipment_id,
                        problem_description: `[Ref Laporan AVSEC #${selectedReport.report_number}] ${selectedReport.issue_type}: ${selectedReport.description}`,
                        action_taken: actionTaken.trim() || `Pemeriksaan dan penanganan kendala ${selectedReport.issue_type} pada ${selectedReport.equipment_name}.`,
                        photo_url: selectedReport.photo_url,
                        notes: `Pelapor: ${selectedReport.reporter_name} (${selectedReport.reporter_unit || 'AVSEC'}) - Ref #${selectedReport.report_number}`,
                      });
                      setIsConvertModalOpen(false);
                      setSelectedReport(null);
                    }}
                    className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1.5 border border-indigo-200 cursor-pointer"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Buka Form Corrective Lengkap</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsConvertModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmittingAction ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Simpan Corrective
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* 7. MODAL: CLOSE REPORT (FALSE ALARM) */}
      {isCloseModalOpen && selectedReport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCloseSubmit}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Tutup Laporan Gangguan</h2>
              <button
                type="button"
                onClick={() => setIsCloseModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Gunakan opsi ini jika laporan bukan merupakan kerusakan (misal: false alarm, kesalahan operasional, atau unit sudah kembali normal saat dicek).
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Catatan Penutupan <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setIsCloseModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSubmittingAction}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5"
              >
                {isSubmittingAction ? 'Menutup...' : 'Tutup Laporan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
