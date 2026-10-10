import React, { useState, useMemo, useEffect } from 'react';
import {
  getAuditLogs,
  fetchAuditLogsFromSupabase,
  recordAuditLog,
  clearAuditLogs,
  AuditLogEntry,
  AuditActionType,
} from '../services/auditLogService';
import {
  FileText,
  Search,
  Filter,
  Download,
  Shield,
  UserCheck,
  Clock,
  AlertTriangle,
  LogIn,
  CheckCircle2,
  Trash2,
  Wrench,
  RefreshCw,
  Calendar,
  Layers,
  Activity,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { toast } from './Toast';

export const AuditLogView: React.FC<{ isSupervisor?: boolean }> = ({ isSupervisor = true }) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [selectedRole, setSelectedRole] = useState<string>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | number | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  const loadLogs = async () => {
    // Immediate local cache display
    const localData = getAuditLogs();
    setLogs(localData);

    setIsLoading(true);
    try {
      const remoteData = await fetchAuditLogsFromSupabase();
      if (remoteData && remoteData.length > 0) {
        setLogs(remoteData);
      }
    } catch (err) {
      console.warn('Gagal memuat log Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = log.user_name.toLowerCase().includes(q);
        const matchTitle = log.title.toLowerCase().includes(q);
        const matchDetails = log.details.toLowerCase().includes(q);
        if (!matchName && !matchTitle && !matchDetails) return false;
      }

      // 2. Action Type
      if (selectedAction !== 'ALL' && log.action_type !== selectedAction) {
        return false;
      }

      // 3. Role
      if (selectedRole !== 'ALL' && log.role !== selectedRole) {
        return false;
      }

      // 4. Date Range
      const logDate = log.timestamp.slice(0, 10);
      if (startDate && logDate < startDate) return false;
      if (endDate && logDate > endDate) return false;

      return true;
    });
  }, [logs, searchQuery, selectedAction, selectedRole, startDate, endDate]);

  // Export logs to CSV
  const handleExportCsv = () => {
    if (filteredLogs.length === 0) {
      toast.info('Tidak ada data log untuk diekspor');
      return;
    }

    const headers = ['ID', 'Waktu (WIB)', 'Nama User', 'Peran (Role)', 'Tipe Aksi', 'Judul Aktivitas', 'Detail Keterangan'];
    const rows = filteredLogs.map((l) => [
      l.id,
      new Date(l.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      `"${l.user_name.replace(/"/g, '""')}"`,
      l.role.toUpperCase(),
      l.action_type,
      `"${l.title.replace(/"/g, '""')}"`,
      `"${l.details.replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Audit_Log_Aktivitas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('File Log Berhasil Diekspor!', {
      message: `${filteredLogs.length} baris log berhasil diunduh sebagai file CSV/Excel.`,
    });
  };

  const getActionBadge = (action: AuditActionType) => {
    switch (action) {
      case 'LOGIN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20">
            <LogIn className="w-3 h-3" /> Login
          </span>
        );
      case 'PREVENTIVE_INPUT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Preventif
          </span>
        );
      case 'CORRECTIVE_INPUT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
            <Wrench className="w-3 h-3" /> Corrective
          </span>
        );
      case 'CORRECTIVE_UPDATE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20">
            <Wrench className="w-3 h-3" /> Ubah Corrective
          </span>
        );
      case 'CORRECTIVE_DELETE':
      case 'AVSEC_DELETE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
            <Trash2 className="w-3 h-3" /> Hapus Data
          </span>
        );
      case 'AVSEC_REPORT':
      case 'AVSEC_CONVERT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" /> Laporan AVSEC
          </span>
        );
      case 'ATTENDANCE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-500/10 text-purple-600 border border-purple-500/20">
            <UserCheck className="w-3 h-3" /> Presensi
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <Activity className="w-3 h-3" /> Aktivitas
          </span>
        );
    }
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-5 sm:p-7 text-white shadow-xl border border-slate-700/60 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span>Log Aktivitas</span>
            </h1>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto shrink-0 flex-wrap">
            <button
              onClick={loadLogs}
              disabled={isLoading}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-600 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 text-cyan-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Loading...' : 'Load Logs'}</span>
            </button>

            <button
              onClick={handleExportCsv}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md shadow-emerald-900/30 transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Logs (CSV)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metric Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Catatan Log</div>
          <div className="text-xl font-black text-slate-900 mt-1">{logs.length}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Sesi Login User</div>
          <div className="text-xl font-black text-blue-700 mt-1">
            {logs.filter((l) => l.action_type === 'LOGIN').length}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Input Laporan</div>
          <div className="text-xl font-black text-emerald-700 mt-1">
            {logs.filter((l) => l.action_type.includes('INPUT') || l.action_type.includes('PREVENTIVE')).length}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
          <div className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">Penghapusan Data</div>
          <div className="text-xl font-black text-rose-700 mt-1">
            {logs.filter((l) => l.action_type.includes('DELETE')).length}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 space-y-3 shadow-xs">
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Cari nama user / aktivitas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
          </div>

          {/* Mobile Filter Toggle */}
          <button
            type="button"
            onClick={() => setShowMobileFilters(!showMobileFilters)}
            className={`sm:hidden px-3 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
              showMobileFilters || selectedAction !== 'ALL' || selectedRole !== 'ALL' || startDate || endDate
                ? 'bg-amber-50 text-amber-800 border-amber-300'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filter</span>
            {(selectedAction !== 'ALL' || selectedRole !== 'ALL' || startDate || endDate) && (
              <span className="w-2 h-2 rounded-full bg-amber-600"></span>
            )}
          </button>
        </div>

        {/* Multi-column Filter Options (Always visible on sm+, collapsible on mobile) */}
        <div className={`${showMobileFilters ? 'grid' : 'hidden sm:grid'} grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs pt-1 sm:pt-0`}>
          {/* Action Filter */}
          <div>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <option value="ALL">Semua Jenis Aktivitas</option>
              <option value="LOGIN">Sesi Login</option>
              <option value="PREVENTIVE_INPUT">Input Preventif</option>
              <option value="CORRECTIVE_INPUT">Input Corrective</option>
              <option value="CORRECTIVE_DELETE">Hapus Corrective</option>
              <option value="AVSEC_REPORT">Laporan AVSEC</option>
              <option value="ATTENDANCE">Presensi Teknisi</option>
            </select>
          </div>

          {/* Role Filter */}
          <div>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <option value="ALL">Semua Peran User</option>
              <option value="supervisor">Supervisor</option>
              <option value="technician">Teknisi</option>
              <option value="avsec">Petugas AVSEC</option>
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none text-[11px]"
            />
            <span className="text-slate-400 font-bold">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none text-[11px]"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-600" />
            <span className="text-xs font-bold text-slate-800">Daftar Log Aktivitas ({filteredLogs.length})</span>
          </div>
          {(selectedAction !== 'ALL' || selectedRole !== 'ALL' || startDate || endDate || searchQuery) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedAction('ALL');
                setSelectedRole('ALL');
                setStartDate('');
                setEndDate('');
              }}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Search className="w-6 h-6" />
            </div>
            <p className="text-xs text-slate-500 font-medium">Tidak ada data log yang sesuai dengan filter pencarian.</p>
          </div>
        ) : (
          <>
            {/* Simple Card View for Mobile (No Horizontal Scrolling, Clean & Touch Friendly) */}
            <div className="block md:hidden divide-y divide-slate-100">
              {filteredLogs.map((log) => {
                const dateObj = new Date(log.timestamp);
                const timeStr = dateObj.toLocaleTimeString('id-ID', {
                  timeZone: 'Asia/Jakarta',
                  hour: '2-digit',
                  minute: '2-digit',
                }) + ' WIB';
                const dateStr = dateObj.toLocaleDateString('id-ID', {
                  timeZone: 'Asia/Jakarta',
                  day: '2-digit',
                  month: 'short',
                });
                const isExpanded = expandedLogId === log.id;

                return (
                  <div
                    key={log.id}
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-3.5 space-y-2 hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    {/* Top Row: User & Role + Timestamp */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-xs text-slate-900 truncate">
                          {log.user_name}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold uppercase shrink-0 ${
                            log.role === 'supervisor'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : log.role === 'avsec'
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {log.role}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-[10.5px] text-slate-400 font-mono shrink-0">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{timeStr} · {dateStr}</span>
                      </div>
                    </div>

                    {/* Middle Row: Action Badge & Title */}
                    <div className="flex items-start gap-2">
                      <div className="shrink-0 mt-0.5">
                        {getActionBadge(log.action_type)}
                      </div>
                      <div className="font-bold text-xs text-slate-800 leading-snug flex-1">
                        {log.title}
                      </div>
                      {log.details && (
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                      )}
                    </div>

                    {/* Details description (compact / expandable) */}
                    {log.details && (
                      <p className={`text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200/70 leading-relaxed font-medium ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {log.details}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Full Table View for Desktop (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                    <th className="py-2.5 px-3.5">Waktu (WIB)</th>
                    <th className="py-2.5 px-3.5">Pengguna</th>
                    <th className="py-2.5 px-3.5">Peran</th>
                    <th className="py-2.5 px-3.5">Kategori</th>
                    <th className="py-2.5 px-3.5">Aktivitas &amp; Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.map((log) => {
                    const dateFormatted = new Date(log.timestamp).toLocaleString('id-ID', {
                      timeZone: 'Asia/Jakarta',
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }) + ' WIB';

                    return (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{dateFormatted}</span>
                          </div>
                        </td>

                        <td className="py-3 px-3.5 font-bold text-slate-900 whitespace-nowrap">
                          {log.user_name}
                        </td>

                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              log.role === 'supervisor'
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : log.role === 'avsec'
                                ? 'bg-red-100 text-red-800 border border-red-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {log.role}
                          </span>
                        </td>

                        <td className="py-3 px-3.5 whitespace-nowrap">
                          {getActionBadge(log.action_type)}
                        </td>

                        <td className="py-3 px-3.5 max-w-md">
                          <div className="font-bold text-slate-800 leading-tight">{log.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{log.details}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
