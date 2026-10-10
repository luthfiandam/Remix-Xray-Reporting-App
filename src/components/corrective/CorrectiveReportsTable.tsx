import React, { useState, useMemo, useEffect } from 'react';
import { CorrectiveReport, Equipment, EquipmentType, Location, Role } from '../../types';
import { formatIndonesianDate, formatTimeRange } from '../../utils/timeFormat';
import { getProxySafeImageUrl, registerPresignedUrls } from '../../utils/evidenceUtils';
import { resolveBatchPresignedUrls } from '../../services/storageService';
import { S3Image } from '../S3Image';
import { downloadCorrectiveReportPdf } from '../../pdf/correctivePdfService';
import { toast } from '../Toast';
import {
  Search,
  Filter,
  Calendar,
  Wrench,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  ExternalLink,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  SlidersHorizontal,
  ChevronDown,
  Trash2,
  Pencil,
  FileDown,
  X,
} from 'lucide-react';

interface CorrectiveReportsTableProps {
  correctiveReports: CorrectiveReport[];
  equipments: Equipment[];
  equipmentTypes?: EquipmentType[];
  locations: Location[];
  onSelectReportForWa?: (report: CorrectiveReport, formattedWaText: string) => void;
  role?: Role;
  onDeleteCorrective?: (report: CorrectiveReport) => void | Promise<void>;
  onEditCorrective?: (report: CorrectiveReport) => void;
}

export const CorrectiveReportsTable: React.FC<CorrectiveReportsTableProps> = ({
  correctiveReports,
  equipments,
  equipmentTypes = [],
  locations,
  onSelectReportForWa,
  role,
  onDeleteCorrective,
  onEditCorrective,
}) => {
  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEquipmentId, setFilterEquipmentId] = useState<string>('all');
  const [filterLocationId, setFilterLocationId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState<boolean>(false);

  // Pagination States
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [downloadingPdfId, setDownloadingPdfId] = useState<number | null>(null);
  const [deleteConfirmReport, setDeleteConfirmReport] = useState<CorrectiveReport | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; title?: string } | null>(null);

  useEffect(() => {
    if (correctiveReports && correctiveReports.length > 0) {
      const keysToResolve: string[] = [];
      correctiveReports.forEach((r) => {
        if (Array.isArray(r.evidences)) {
          r.evidences.forEach((ev: any) => {
            const raw = typeof ev === 'string' ? ev : ev?.file_path || ev?.url || ev?.drive_url;
            if (raw) keysToResolve.push(raw);
          });
        }
      });
      if (keysToResolve.length > 0) {
        resolveBatchPresignedUrls(keysToResolve).then((urlMap) => {
          registerPresignedUrls(urlMap);
        });
      }
    }
  }, [correctiveReports]);

  const handleDelete = (report: CorrectiveReport) => {
    if (!onDeleteCorrective) return;
    setDeleteConfirmReport(report);
  };

  const handleDownloadPdf = async (report: CorrectiveReport) => {
    const eq = (equipments || []).find((e) => e && e.id === report.equipment_id);
    const loc = (locations || []).find((l) => l && l.id === report.location_id);
    setDownloadingPdfId(report.id);
    try {
      toast.info('Menyiapkan Dokumen PDF', {
        message: `Sedang menyusun file PDF corrective #${report.corrective_code || 'CR'}...`,
        badge: 'PDF Generator',
      });
      await downloadCorrectiveReportPdf(report, eq, loc);
      toast.success('PDF Berhasil Diunduh', {
        message: `Laporan corrective ${report.corrective_code} telah disimpan ke perangkat.`,
        badge: 'Selesai',
      });
    } catch (err: any) {
      console.error('Error downloading corrective PDF:', err);
      toast.error('Gagal Mengunduh PDF', err?.message || 'Terjadi kesalahan saat memproses file PDF.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  // Filtered Data Computation
  const filteredReports = useMemo(() => {
    return (correctiveReports || []).filter((report) => {
      // 1. Search term (code, problem, action, created_by, notes)
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const eq = equipments.find((e) => e.id === report.equipment_id);
        const loc = locations.find((l) => l.id === report.location_id);

        const matchCode = report.corrective_code?.toLowerCase().includes(query);
        const matchProblem = report.problem_description?.toLowerCase().includes(query);
        const matchAction = report.action_taken?.toLowerCase().includes(query);
        const matchTech = (report.created_by || '').toLowerCase().includes(query) ||
          (report.technicians || []).some((t) => t.toLowerCase().includes(query));
        const matchEqName = eq?.name.toLowerCase().includes(query);
        const matchLocName = loc?.name.toLowerCase().includes(query);

        if (!matchCode && !matchProblem && !matchAction && !matchTech && !matchEqName && !matchLocName) {
          return false;
        }
      }

      // 2. Equipment Filter
      if (filterEquipmentId !== 'all') {
        if (report.equipment_id !== Number(filterEquipmentId)) {
          return false;
        }
      }

      // 3. Location Filter
      if (filterLocationId !== 'all') {
        if (report.location_id !== Number(filterLocationId)) {
          return false;
        }
      }

      // 4. Status / Result Filter
      if (filterStatus !== 'all') {
        if (report.result !== filterStatus) {
          return false;
        }
      }

      // 5. Date Range Filter
      const reportDate = report.corrective_date || (report.created_at ? report.created_at.slice(0, 10) : '');
      if (filterStartDate && reportDate) {
        if (reportDate < filterStartDate) return false;
      }
      if (filterEndDate && reportDate) {
        if (reportDate > filterEndDate) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sort newest date & id first
      const dateA = a.corrective_date || a.created_at || '';
      const dateB = b.corrective_date || b.created_at || '';
      if (dateB !== dateA) {
        return dateB.localeCompare(dateA);
      }
      return b.id - a.id;
    });
  }, [
    correctiveReports,
    searchTerm,
    filterEquipmentId,
    filterLocationId,
    filterStatus,
    filterStartDate,
    filterEndDate,
    equipments,
    locations,
  ]);

  // Reset pagination when filter changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterEquipmentId, filterLocationId, filterStatus, filterStartDate, filterEndDate, pageSize]);

  // Pagination calculation
  const totalItems = filteredReports.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedReports = filteredReports.slice(startIndex, endIndex);

  // Active filter count
  const activeFilterCount = [
    filterEquipmentId !== 'all',
    filterLocationId !== 'all',
    filterStatus !== 'all',
    Boolean(filterStartDate),
    Boolean(filterEndDate),
    Boolean(searchTerm.trim()),
  ].filter(Boolean).length;

  const handleResetFilters = () => {
    setSearchTerm('');
    setFilterEquipmentId('all');
    setFilterLocationId('all');
    setFilterStatus('all');
    setFilterStartDate('');
    setFilterEndDate('');
    setCurrentPage(1);
  };

    // Helper to generate WA formatted text
  const buildWaText = (report: CorrectiveReport) => {
    const eq = (equipments || []).find((e) => e && e.id === report.equipment_id);
    const loc = (locations || []).find((l) => l && l.id === report.location_id);
    const dateFormatted = formatIndonesianDate(report.corrective_date, { includeDayName: true });
    const shiftStr = report.shift ? ` Shift ${report.shift}.` : '.';
    const fullDate = `${dateFormatted}${shiftStr}`;

    const techs = report.technicians && report.technicians.length > 0
      ? report.technicians.join(', ')
      : (report.created_by || 'Teknisi');

    const formatWibTime = (t?: string) => {
      if (!t || t.trim() === '-' || t.trim() === '') return '-';
      const clean = t.trim().replace(':', '.');
      return clean.toUpperCase().includes('WIB') ? clean : `${clean} WIB`;
    };

    let locAlat = '-';
    const cleanEqName = (eq?.name || (report as any).equipment_name || '').trim();
    const cleanLocName = (loc?.name || (report as any).location_name || '').trim();
    if (cleanEqName && cleanLocName) {
      if (cleanEqName.toLowerCase() === cleanLocName.toLowerCase()) {
        locAlat = cleanEqName;
      } else if (cleanEqName.toLowerCase().includes(cleanLocName.toLowerCase())) {
        locAlat = cleanEqName;
      } else if (cleanLocName.toLowerCase().includes(cleanEqName.toLowerCase())) {
        locAlat = cleanLocName;
      } else {
        locAlat = `${cleanEqName} ${cleanLocName}`;
      }
    } else {
      locAlat = cleanEqName || cleanLocName || 'Security Equipment';
    }

    // Jenis Alat & Tipe/Model
    const eqType = (equipmentTypes || []).find((t) => t && (t.id === eq?.equipment_type_id || t.code === (report as any).type_code));
    const jenisAlat = eqType?.name || (eq?.name ? eq.name.split(' ')[0] : 'X-Ray System');
    let tipeModel = [eq?.brand, eq?.model].filter(Boolean).join(' - ');
    if (eq?.default_view || eq?.default_view_type) {
      const viewLabel = (eq.default_view_type || eq.default_view) === 'dual' ? 'Dual View' : 'Single View';
      if (!tipeModel.toLowerCase().includes(viewLabel.toLowerCase())) {
        tipeModel = tipeModel ? `${tipeModel} (${viewLabel})` : viewLabel;
      }
    }
    if (!tipeModel.trim()) {
      tipeModel = (eq as any)?.type || '-';
    }

    const rawAction = report.action_taken || '-';
    const actionLines = rawAction.split('\n').map((l) => l.trim()).filter(Boolean);
    const formattedAction = actionLines
      .map((l) => (l.startsWith('-') || l.startsWith('•') ? l : `- ${l}`))
      .join('\n');

    const hasilText = report.result_text || report.result || 'Xray sudah bisa di Gunakan dengan Normal.';

    return `*LAPORAN CORRECTIVE MAINTENANCE*
--------------------------
*Hari / Tanggal* : ${fullDate}
*Teknisi* : ${techs}
*Jam Mulai* : ${formatWibTime(report.start_time)}
*Jam Selesai* : ${formatWibTime(report.end_time)}
*Jenis Alat* : ${jenisAlat}
*Tipe / Model* : ${tipeModel}
*Lokasi Alat* : ${locAlat}
*Uraian Masalah* : 
${report.problem_description || '-'}
*Tindakan* : 
${formattedAction}
*Hasil* : ${hasilText}

*_sent from nararyaapps.net_*`;
  };

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
      {/* Table Section Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold text-slate-900 text-base">
              Daftar Corrective Maintenance
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
              {totalItems} Data
            </span>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {activeFilterCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Reset Semua Filter"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset ({activeFilterCount})</span>
              </button>
            )}

            <div className="hidden sm:flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-semibold">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 font-bold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tabel
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-white text-slate-900 font-bold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kartu
              </button>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="mt-3.5 space-y-2">
          {/* Top filter row: Search input + Mobile Filter Toggle */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari kode, kerusakan, teknisi..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
              />
            </div>

            {/* Mobile filter toggle button (hidden on sm+) */}
            <button
              type="button"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              className={`sm:hidden px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
                showMobileFilters || activeFilterCount > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Opsi Filter Tambahan"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Collapsible / Multi-column Filters (Always visible on sm+, toggleable on mobile) */}
          <div className={`${showMobileFilters ? 'grid' : 'hidden sm:grid'} grid-cols-1 sm:grid-cols-3 gap-2 pt-1 sm:pt-0`}>
            {/* 2. Dropdown Tanggal */}
            <div>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                title="Filter Tanggal"
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
              />
            </div>

            {/* 3. Dropdown Peralatan */}
            <div>
              <select
                value={filterEquipmentId}
                onChange={(e) => setFilterEquipmentId(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition cursor-pointer"
              >
                <option value="all">Peralatan ▾ (Semua)</option>
                {equipments.map((eq) => {
                  const loc = locations.find((l) => l.id === eq.location_id);
                  return (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({loc?.name || 'Area'})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* 4. Dropdown Status */}
            <div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition cursor-pointer"
              >
                <option value="all">Status ▾ (Semua)</option>
                <option value="Resolved">Resolved (Selesai)</option>
                <option value="Temporary Fix">Temporary Fix (Sementara)</option>
                <option value="Pending Sparepart">Pending Sparepart</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Table View (Desktop Only when viewMode is 'table') */}
      {viewMode === 'table' && (
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4 w-12 text-center">No</th>
                <th className="py-3 px-4">Kode &amp; Tanggal</th>
                <th className="py-3 px-4">Peralatan &amp; Lokasi</th>
                <th className="py-3 px-4">Kerusakan (Problem)</th>
                <th className="py-3 px-4">Tindakan Perbaikan</th>
                <th className="py-3 px-4 w-32 text-center">Status</th>
                <th className="py-3 px-4 w-28 text-center">Teknisi</th>
                <th className="py-3 px-4 w-24 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedReports.length > 0 ? (
                paginatedReports.map((report, idx) => {
                  const eq = equipments.find((e) => e.id === report.equipment_id);
                  const loc = locations.find((l) => l.id === report.location_id);
                  const isExpanded = expandedReportId === report.id;
                  const itemIndex = startIndex + idx + 1;

                  return (
                    <React.Fragment key={report.id}>
                      <tr className={`hover:bg-blue-50/40 transition-colors ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                        <td className="py-3 px-4 text-center font-bold text-slate-400">
                          {itemIndex}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono font-bold text-blue-700 text-[11px]">
                            {report.corrective_code}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 font-medium">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <span>{formatIndonesianDate(report.corrective_date, { shortMonth: true })}</span>
                          </div>
                          {(report.start_time || report.end_time) && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              {formatTimeRange(report.start_time || '', report.end_time || '')}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-extrabold text-slate-900 text-xs">
                            {eq?.name || 'Equipment'}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[140px]">{loc?.name || 'Area Bandara'}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-slate-800 font-medium line-clamp-2 max-w-[200px]" title={report.problem_description}>
                            {report.problem_description}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-slate-700 font-normal line-clamp-2 max-w-[220px]" title={report.action_taken}>
                            {report.action_taken}
                          </p>
                          {report.evidences && report.evidences.length > 0 && (
                            <span className="inline-block mt-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                              📷 {report.evidences.length} Foto
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold tracking-tight ${
                              report.result === 'Resolved'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : report.result === 'Temporary Fix'
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-rose-100 text-rose-800 border border-rose-200'
                            }`}
                          >
                            {report.result}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="text-xs font-semibold text-slate-800 block truncate max-w-[100px]" title={report.created_by}>
                            {report.created_by || (report.technicians && report.technicians[0]) || '-'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              disabled={downloadingPdfId === report.id}
                              onClick={() => handleDownloadPdf(report)}
                              title="Unduh Dokumen PDF Laporan Corrective"
                              className="p-1.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-700 rounded-lg border border-indigo-200 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const text = buildWaText(report);
                                if (onSelectReportForWa) {
                                  onSelectReportForWa(report, text);
                                }
                              }}
                              title="Salin / Lihat Format WhatsApp"
                              className="p-1.5 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            {onEditCorrective && (
                              <button
                                type="button"
                                onClick={() => onEditCorrective(report)}
                                title="Edit Laporan Corrective"
                                className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-700 rounded-lg border border-blue-200 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onDeleteCorrective && role === 'supervisor' && (
                              <button
                                type="button"
                                onClick={() => handleDelete(report)}
                                title="Hapus Laporan Corrective (Khusus Supervisor)"
                                className="p-1.5 text-rose-600 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 rounded-lg border border-rose-200 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                              title="Detail Laporan"
                              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                                isExpanded
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'text-slate-600 bg-slate-100 hover:bg-slate-200 border-slate-200'
                              }`}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Detail Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80 border-b border-slate-200">
                          <td colSpan={8} className="p-4 sm:p-5">
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded border border-blue-100">
                                    {report.corrective_code}
                                  </span>
                                  <span className="font-extrabold text-sm text-slate-900">{eq?.name}</span>
                                  <span className="text-xs text-slate-500">({loc?.name})</span>
                                </div>
                                <div className="text-xs text-slate-500 font-medium">
                                  Teknisi Bertugas: <strong className="text-slate-800">{(report.technicians || [report.created_by]).join(', ')}</strong>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
                                  <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                                    Uraian Kerusakan / Gejala:
                                  </span>
                                  <p className="text-slate-800 font-medium whitespace-pre-line leading-relaxed">
                                    {report.problem_description}
                                  </p>
                                </div>

                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
                                  <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                                    Tindakan Perbaikan &amp; Sparepart:
                                  </span>
                                  <p className="text-slate-800 font-medium whitespace-pre-line leading-relaxed">
                                    {report.action_taken}
                                  </p>
                                  {report.result_text && (
                                    <div className="mt-2 pt-2 border-t border-slate-200 text-slate-600">
                                      <strong className="text-slate-700">Hasil: </strong>
                                      <span>{report.result_text}</span>
                                    </div>
                                  )}
                                  {report.notes && report.notes !== '-' && (
                                    <div className="mt-1 text-slate-500 text-[11px]">
                                      <strong>Notes: </strong>
                                      <span>{report.notes}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Evidences Photos */}
                              {report.evidences && report.evidences.length > 0 && (
                                <div className="pt-2">
                                  <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block mb-2">
                                    Dokumentasi Perbaikan ({report.evidences.length} Foto):
                                  </span>
                                  <div className="flex flex-wrap gap-2.5">
                                    {report.evidences.map((url, i) => {
                                      const raw = typeof url === 'string' ? url : (url as any)?.file_path || (url as any)?.url || (url as any)?.drive_url;
                                      const safeUrl = getProxySafeImageUrl(raw);
                                      return (
                                        <button
                                          key={i}
                                          type="button"
                                          onClick={() => setPreviewImage({ url: safeUrl || raw, title: `Dokumentasi Perbaikan ${report.corrective_code} (${i + 1}/${report.evidences.length})` })}
                                          className="w-16 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shadow-2xs relative hover:ring-2 hover:ring-blue-500 transition-all cursor-pointer group"
                                          title="Klik untuk memperbesar foto"
                                        >
                                          <S3Image
                                            src={raw}
                                            alt={`Dokumentasi ${i + 1}`}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                          />
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 text-xs italic">
                    Tidak ditemukan data laporan corrective yang sesuai dengan kriteria filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Cards View (Always visible on mobile screens; on desktop when viewMode === 'cards') */}
      <div className={viewMode === 'table' ? 'block md:hidden p-3 space-y-3' : 'block p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5'}>
        {paginatedReports.length > 0 ? (
          paginatedReports.map((report) => {
              const eq = equipments.find((e) => e.id === report.equipment_id);
              const loc = locations.find((l) => l.id === report.location_id);
              const waText = buildWaText(report);
              const isExpanded = expandedReportId === report.id;
              const isResolved = report.result === 'Resolved';
              const isTemporary = report.result === 'Temporary Fix';

              return (
                <div
                  key={report.id}
                  className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-4 hover:border-blue-300 hover:shadow-xs transition-all space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2.5">
                    {/* Header: Kode, Shift & Status Hasil */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-black text-xs text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200/80">
                          {report.corrective_code}
                        </span>
                        {report.shift && (
                          <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                            Shift {report.shift}
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[10.5px] font-bold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 border shrink-0 ${
                          isResolved
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : isTemporary
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {isResolved ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        ) : isTemporary ? (
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                        ) : (
                          <Clock className="w-3 h-3 text-rose-600" />
                        )}
                        <span>{report.result || 'Pending'}</span>
                      </span>
                    </div>

                    {/* Tipe Alat & Lokasi Alat */}
                    <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Wrench className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {eq?.name || (report as any).type_code || 'Security Equipment'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium shrink-0">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[120px]">{loc?.name || 'Area Terkait'}</span>
                      </div>
                    </div>

                    {/* Tanggal & Waktu */}
                    <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatIndonesianDate(report.corrective_date, { shortMonth: true })}</span>
                      </div>
                      {(report.start_time || report.end_time) && (
                        <div className="flex items-center gap-1 font-mono text-[10.5px] text-slate-500">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{formatTimeRange(report.start_time || '', report.end_time || '')}</span>
                        </div>
                      )}
                    </div>

                    {/* Expanded Detail Information Panel (jika diklik Detail) */}
                    {isExpanded && (
                      <div className="pt-2 border-t border-slate-100 space-y-2 text-xs animate-in fade-in duration-150">
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/70 space-y-1">
                          <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block">Kerusakan:</span>
                          <p className="text-slate-800 font-medium leading-relaxed">{report.problem_description || '-'}</p>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/70 space-y-1">
                          <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block">Tindakan:</span>
                          <p className="text-slate-800 font-medium leading-relaxed">{report.action_taken || '-'}</p>
                        </div>
                        {report.evidences && report.evidences.length > 0 && (
                          <div className="pt-1">
                            <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                              Foto Bukti ({report.evidences.length}):
                            </span>
                            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                              {report.evidences.map((imgUrl, i) => {
                                const raw = typeof imgUrl === 'string' ? imgUrl : (imgUrl as any)?.file_path || (imgUrl as any)?.url || (imgUrl as any)?.drive_url;
                                const safeImg = getProxySafeImageUrl(raw);
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => setPreviewImage({ url: safeImg || raw, title: `Foto Bukti ${report.corrective_code} (${i + 1}/${report.evidences.length})` })}
                                    className="w-12 h-12 rounded-lg overflow-hidden border border-slate-200 shrink-0 block bg-slate-100 hover:ring-2 hover:ring-blue-500 transition-all cursor-pointer group"
                                    title="Klik untuk memperbesar foto"
                                  >
                                    <S3Image
                                      src={raw}
                                      alt={`Evidence ${i + 1}`}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500 pt-1">
                          Teknisi: <strong className="text-slate-800">{(report.technicians || [report.created_by]).join(', ')}</strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons Footer */}
                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectReportForWa) {
                            onSelectReportForWa(report, waText);
                          }
                        }}
                        className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold rounded-xl text-xs transition inline-flex items-center gap-1 border border-emerald-200 cursor-pointer shadow-2xs"
                        title="Format WhatsApp"
                      >
                        <Copy className="w-3.5 h-3.5 text-emerald-600" />
                        <span>WA</span>
                      </button>

                      <button
                        type="button"
                        disabled={downloadingPdfId === report.id}
                        onClick={() => handleDownloadPdf(report)}
                        className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs transition inline-flex items-center gap-1 border border-indigo-200 cursor-pointer disabled:opacity-50 shadow-2xs"
                        title="Unduh PDF"
                      >
                        <FileDown className="w-3.5 h-3.5 text-indigo-600" />
                        <span>PDF</span>
                      </button>

                      {onEditCorrective && (
                        <button
                          type="button"
                          onClick={() => onEditCorrective(report)}
                          className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl text-xs transition inline-flex items-center border border-blue-200 cursor-pointer"
                          title="Edit Laporan"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {onDeleteCorrective && role === 'supervisor' && (
                        <button
                          type="button"
                          onClick={() => handleDelete(report)}
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl text-xs transition inline-flex items-center border border-rose-200 cursor-pointer"
                          title="Hapus Laporan (Khusus Supervisor)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                      className="px-2.5 py-1.5 text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition ml-auto"
                    >
                      <span>{isExpanded ? 'Tutup' : 'Detail'}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
              );
            })
        ) : (
          <div className="col-span-full p-8 text-center text-xs text-slate-400 italic">
            Tidak ditemukan data laporan corrective yang sesuai kriteria filter.
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span>Menampilkan</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value={5}>5 baris</option>
            <option value={10}>10 baris</option>
            <option value={20}>20 baris</option>
            <option value={50}>50 baris</option>
          </select>
          <span>
            dari <strong className="text-slate-900">{totalItems}</strong> laporan
          </span>
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage(1)}
            disabled={validCurrentPage <= 1}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            title="Halaman Pertama"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={validCurrentPage <= 1}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            title="Halaman Sebelumnya"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="px-3 py-1 font-bold text-xs text-slate-800">
            Hal. {validCurrentPage} / {totalPages}
          </span>

          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={validCurrentPage >= totalPages}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            title="Halaman Berikutnya"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage(totalPages)}
            disabled={validCurrentPage >= totalPages}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            title="Halaman Terakhir"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* In-App Deletion Confirmation Modal Dialog (No window.confirm) */}
      {deleteConfirmReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Hapus Laporan Corrective?</h3>
                <p className="text-xs text-slate-500 font-mono">Kode: {deleteConfirmReport.corrective_code}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-5">
              Apakah Anda yakin ingin menghapus data perbaikan <strong>{deleteConfirmReport.corrective_code}</strong>? Tindakan ini akan menghapus riwayat laporan gangguan ini dari database.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmReport(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (!onDeleteCorrective || !deleteConfirmReport) return;
                  setIsDeleting(true);
                  try {
                    await onDeleteCorrective(deleteConfirmReport);
                    setDeleteConfirmReport(null);
                  } catch (err: any) {
                    console.error('Error deleting report:', err);
                    toast.error('Gagal Menghapus', err?.message || 'Terjadi kesalahan saat menghapus data.');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? 'Menghapus...' : 'Ya, Hapus Laporan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Lightbox Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center justify-center p-2 w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between p-3 text-white border-b border-slate-800">
              <span className="font-bold text-xs truncate text-slate-200">{previewImage.title || 'Preview Foto Laporan'}</span>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                title="Tutup Preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 overflow-auto max-h-[80vh] flex items-center justify-center w-full bg-slate-950/60 rounded-b-xl">
              <S3Image
                src={previewImage.url}
                alt="Preview Foto Corrective"
                className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
