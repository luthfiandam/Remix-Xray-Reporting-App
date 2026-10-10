import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Printer,
  Download,
  Calendar,
  CheckCircle2,
  FileText,
  Clock,
  ChevronLeft,
  ChevronRight,
  Shield,
  Loader2,
  Users,
  PenTool,
  CheckSquare,
  LayoutGrid,
} from 'lucide-react';
import { AttendanceRecord } from '../types';
import { ShiftScheduleV2, fetchMonthlySchedulesDetailed } from '../services/scheduleService';
import logoNararya from '../assets/logopt.png';
import {
  buildRosterDays,
  downloadDaftarHadirPdf,
  downloadScheduleRosterPdf,
  ROSTER_TECHNICIANS_DEFAULT,
} from '../services/daftarHadirPdfService';
import { getAllAttendanceHistory, fetchAttendanceHistoryFromServer } from '../services/attendanceService';
import { toast } from './Toast';

interface RosterScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  year?: number;
  month?: number; // 1-12
  scheduleDocs?: ShiftScheduleV2[];
  attendanceRecords?: AttendanceRecord[];
}

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const RosterScheduleModal: React.FC<RosterScheduleModalProps> = ({
  isOpen,
  onClose,
  year: initialYear = 2026,
  month: initialMonth = 10,
  scheduleDocs: initialScheduleDocs = [],
  attendanceRecords: initialAttendanceRecords = [],
}) => {
  const [currentYear, setCurrentYear] = useState(initialYear);
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [activeScheduleDocs, setActiveScheduleDocs] = useState<ShiftScheduleV2[]>(initialScheduleDocs);
  const [loadedAttendance, setLoadedAttendance] = useState<AttendanceRecord[]>(initialAttendanceRecords);
  const [activeView, setActiveView] = useState<'roster_matrix' | 'daftar_hadir'>('daftar_hadir');
  const [pdfMode, setPdfMode] = useState<'blank' | 'filled'>('blank');
  const [activePage, setActivePage] = useState<1 | 2 | 3 | 'all'>('all');
  const [isExportingBlankDaftarHadir, setIsExportingBlankDaftarHadir] = useState(false);
  const [isExportingDigitalDaftarHadir, setIsExportingDigitalDaftarHadir] = useState(false);
  const [isExportingRoster, setIsExportingRoster] = useState(false);

  // Sync state whenever modal opens or initial month/year changes
  useEffect(() => {
    if (isOpen) {
      setCurrentYear(initialYear);
      setCurrentMonth(initialMonth);
      setActiveScheduleDocs(initialScheduleDocs);
    }
  }, [isOpen, initialYear, initialMonth, initialScheduleDocs]);

  // Load attendance records for digital presence verification
  useEffect(() => {
    if (isOpen) {
      const local = getAllAttendanceHistory();
      if (local.length > 0) {
        setLoadedAttendance(local);
      }
      fetchAttendanceHistoryFromServer().then((records) => {
        if (records && records.length > 0) {
          setLoadedAttendance(records);
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  // If user navigates month inside modal, fetch monthly schedules if not matching
  useEffect(() => {
    if (isOpen) {
      const monthPad = String(currentMonth).padStart(2, '0');
      const targetPrefix = `${currentYear}-${monthPad}`;
      const hasMatchingDocs = initialScheduleDocs.some(
        (d) => (d.schedule_date || '').startsWith(targetPrefix)
      );

      if (hasMatchingDocs) {
        setActiveScheduleDocs(initialScheduleDocs);
      } else {
        fetchMonthlySchedulesDetailed(currentYear, currentMonth).then((res) => {
          if (res.rawV2Docs && res.rawV2Docs.length > 0) {
            setActiveScheduleDocs(res.rawV2Docs);
          } else {
            setActiveScheduleDocs([]);
          }
        }).catch(() => {
          setActiveScheduleDocs([]);
        });
      }
    }
  }, [isOpen, currentYear, currentMonth, initialScheduleDocs]);

  const technicians = ROSTER_TECHNICIANS_DEFAULT;

  const days = useMemo(() => {
    return buildRosterDays(currentYear, currentMonth, activeScheduleDocs, technicians);
  }, [currentYear, currentMonth, activeScheduleDocs, technicians]);

  // Filter days for page viewing
  const filteredPages = useMemo(() => {
    const p1 = days.filter((d) => d.dayNumber >= 1 && d.dayNumber <= 14);
    const p2 = days.filter((d) => d.dayNumber >= 15 && d.dayNumber <= 28);
    const p3 = days.filter((d) => d.dayNumber >= 29);
    return [
      { pageNum: 1, title: 'Halaman 1 (Tgl 1 - 14)', days: p1 },
      { pageNum: 2, title: 'Halaman 2 (Tgl 15 - 28)', days: p2 },
      { pageNum: 3, title: `Halaman 3 (Tgl 29 - ${days.length})`, days: p3 },
    ].filter((p) => p.days.length > 0);
  }, [days]);

  if (!isOpen) return null;

  const monthLabel = MONTH_NAMES_ID[currentMonth - 1];

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const effectiveAttendance = loadedAttendance.length > 0 ? loadedAttendance : initialAttendanceRecords;

  const handleDownloadDaftarHadir = async (mode: 'blank' | 'filled') => {
    const isBlank = mode === 'blank';
    if (isBlank) setIsExportingBlankDaftarHadir(true);
    else setIsExportingDigitalDaftarHadir(true);

    try {
      await downloadDaftarHadirPdf({
        year: currentYear,
        month: currentMonth,
        technicians,
        scheduleDocs: activeScheduleDocs,
        attendanceRecords: effectiveAttendance,
        mode,
      });
      toast.success('Daftar Hadir Berhasil Diunduh', {
        message: `PDF Daftar Hadir ${monthLabel} ${currentYear} (${isBlank ? 'Lembar Tanda Tangan Blank' : 'Rekap Hadir Digital'}) telah diunduh.`,
        badge: 'PDF',
      });
    } catch (err: any) {
      console.error('Gagal membuat PDF daftar hadir:', err);
      toast.error('Gagal Mengunduh PDF', {
        message: err?.message || 'Terjadi kendala saat menyusun berkas PDF.',
      });
    } finally {
      if (isBlank) setIsExportingBlankDaftarHadir(false);
      else setIsExportingDigitalDaftarHadir(false);
    }
  };

  const handleDownloadScheduleRoster = async () => {
    try {
      setIsExportingRoster(true);
      await downloadScheduleRosterPdf({
        year: currentYear,
        month: currentMonth,
        technicians,
        scheduleDocs: activeScheduleDocs,
      });
      toast.success('Schedule Roster Berhasil Diunduh', {
        message: `PDF Schedule Roster ${monthLabel} ${currentYear} telah diunduh.`,
        badge: 'PDF',
      });
    } catch (err: any) {
      console.error('Gagal membuat PDF schedule roster:', err);
      toast.error('Gagal Mengunduh PDF', {
        message: err?.message || 'Terjadi kendala saat menyusun berkas PDF.',
      });
    } finally {
      setIsExportingRoster(false);
    }
  };

  const getShiftBadge = (code: string) => {
    switch (code) {
      case 'P':
        return 'bg-amber-500 text-slate-950 font-bold border border-amber-600/40';
      case 'PS':
        return 'bg-yellow-400 text-slate-950 font-bold border border-yellow-500/40';
      case 'M':
        return 'bg-sky-400 text-slate-950 font-bold border border-sky-500/40';
      default:
        return 'bg-white text-slate-400 font-medium';
    }
  };

  // Helper to check attendance for 3-page Daftar Hadir preview
  const getAttendancePreview = (dateYmd: string, shiftKey: 'PS' | 'M', techName: string) => {
    const cleanTech = techName.trim().toLowerCase();
    const isNight = shiftKey === 'M';
    const match = effectiveAttendance.find((r) => {
      const recTech = (r.technician_name || '').trim().toLowerCase();
      const matchTech = recTech === cleanTech || recTech.includes(cleanTech) || cleanTech.includes(recTech);
      const matchDate = r.attendance_date === dateYmd;
      const isRecordNight = String(r.shift || '').toLowerCase().includes('malam') || (r.shift as string) === 'M';
      return matchTech && matchDate && (isNight ? isRecordNight : !isRecordNight);
    });

    if (match) {
      return {
        present: true,
        text: match.attendance_time ? match.attendance_time.replace(/WIB/i, '').trim() : 'HADIR',
        fullRecord: match,
      };
    }
    return { present: false, text: '' };
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-7xl max-h-[95vh] flex flex-col shadow-2xl border border-slate-300 overflow-hidden">
        {/* Modal Topbar */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center gap-2">
                <span>Roster & Daftar Hadir OM NTI Halim Perdanakusuma</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-400/30">
                  {monthLabel} {currentYear}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Dokumen resmi operasional: Matriks Jadwal Roster & Daftar Hadir 3-Halaman
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Tutup"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Controls & Navigation Bar */}
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {/* Main Document View Selector Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-200/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveView('daftar_hadir')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeView === 'daftar_hadir'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Daftar Hadir (3 Halaman)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('roster_matrix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeView === 'roster_matrix'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Matriks Roster (Landscape)</span>
            </button>
          </div>

          {/* Month Navigator */}
          <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-slate-300 shadow-xs">
            <button
              onClick={handlePrevMonth}
              className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
              title="Bulan Sebelumnya"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs sm:text-sm font-bold text-slate-800 min-w-32 text-center uppercase">
              {monthLabel} {currentYear}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
              title="Bulan Berikutnya"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Quick PDF Export Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleDownloadDaftarHadir('blank')}
              disabled={isExportingBlankDaftarHadir}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              title="Unduh PDF 3 halaman dengan kotak tanda tangan basah kosong"
            >
              {isExportingBlankDaftarHadir ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PenTool className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>Cetak Lembar TTD (Blank PDF)</span>
            </button>

            <button
              onClick={() => handleDownloadDaftarHadir('filled')}
              disabled={isExportingDigitalDaftarHadir}
              className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 active:bg-cyan-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              title="Unduh PDF 3 halaman berisi rekap jam presensi digital teknisi"
            >
              {isExportingDigitalDaftarHadir ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckSquare className="w-3.5 h-3.5 text-cyan-300" />
              )}
              <span>Cetak Rekap Hadir Digital (PDF)</span>
            </button>

            <button
              onClick={handleDownloadScheduleRoster}
              disabled={isExportingRoster}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              title="Unduh PDF Matriks Landscape sesuai template resmi"
            >
              {isExportingRoster ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Printer className="w-3.5 h-3.5" />
              )}
              <span>Cetak Matriks Roster (PDF)</span>
            </button>
          </div>
        </div>

        {/* Sub-Header Bar (When viewing Daftar Hadir mode) */}
        {activeView === 'daftar_hadir' && (
          <div className="px-5 py-2.5 bg-cyan-950/10 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">Tampilan Mode:</span>
              <div className="inline-flex rounded-lg bg-white p-0.5 border border-slate-300 shadow-xs">
                <button
                  type="button"
                  onClick={() => setPdfMode('blank')}
                  className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    pdfMode === 'blank'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span>Lembar Tanda Tangan (Blank / Fisik)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPdfMode('filled')}
                  className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    pdfMode === 'filled'
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>Rekap Hadir Digital (Hasil Absensi)</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-500 font-semibold mr-1">Filter Halaman:</span>
              <button
                type="button"
                onClick={() => setActivePage('all')}
                className={`px-2 py-1 rounded font-semibold cursor-pointer ${
                  activePage === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                Semua Halaman (1-3)
              </button>
              <button
                type="button"
                onClick={() => setActivePage(1)}
                className={`px-2 py-1 rounded font-semibold cursor-pointer ${
                  activePage === 1 ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                Hal 1 (1-14)
              </button>
              <button
                type="button"
                onClick={() => setActivePage(2)}
                className={`px-2 py-1 rounded font-semibold cursor-pointer ${
                  activePage === 2 ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                Hal 2 (15-28)
              </button>
              <button
                type="button"
                onClick={() => setActivePage(3)}
                className={`px-2 py-1 rounded font-semibold cursor-pointer ${
                  activePage === 3 ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                Hal 3 (29-31)
              </button>
            </div>
          </div>
        )}

        {/* Document Content View Area */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-100">
          {/* ========================================================================= */}
          {/* VIEW 1: DAFTAR HADIR 3-HALAMAN (BLANK / REKAP DIGITAL) */}
          {/* ========================================================================= */}
          {activeView === 'daftar_hadir' && (
            <div className="space-y-8 max-w-5xl mx-auto">
              {filteredPages
                .filter((p) => activePage === 'all' || activePage === p.pageNum)
                .map((pageInfo) => {
                  const isLastPage = pageInfo.pageNum === filteredPages[filteredPages.length - 1].pageNum;
                  const firstDayNum = pageInfo.days[0]?.dayNumber || 1;
                  const lastDayNum = pageInfo.days[pageInfo.days.length - 1]?.dayNumber || 30;

                  return (
                    <div
                      key={`page-${pageInfo.pageNum}`}
                      className="bg-white border-2 border-slate-900 rounded-xl p-6 shadow-md"
                    >
                      {/* Page Tag */}
                      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                          {pageInfo.title}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          Mode:{' '}
                          <strong className="text-slate-900">
                            {pdfMode === 'blank' ? 'Lembar TTD Fisik (Blank)' : 'Rekap Hadir Digital'}
                          </strong>
                        </span>
                      </div>

                      {/* Header Box */}
                      <div className="border border-slate-900 p-3 text-center mb-0 bg-white">
                        <h3 className="text-sm sm:text-base font-extrabold uppercase tracking-wide text-slate-950">
                          DAFTAR HADIR OM NTI HALIM PERDANA KUSUMA
                        </h3>
                        <p className="text-xs font-bold text-slate-800 mt-0.5">
                          {String(firstDayNum).padStart(2, '0')} {monthLabel} {currentYear} s.d{' '}
                          {String(lastDayNum).padStart(2, '0')} {monthLabel} {currentYear}
                        </p>
                      </div>

                      {/* Table Structure (Exact replicate of PDF layout) */}
                      <div className="border-x border-b border-slate-900 overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            {/* Top Header Row */}
                            <tr className="bg-cyan-400 text-slate-950 font-extrabold border-b border-slate-900 h-7 text-center">
                              <th className="border-r border-slate-900 w-10 px-1 py-1">No</th>
                              <th className="border-r border-slate-900 w-44 px-2 py-1">Hari / Tanggal</th>
                              <th className="border-r border-slate-900 w-12 px-1 py-1">Shift</th>
                              <th colSpan={technicians.length} className="px-2 py-1 tracking-wider uppercase">
                                NAMA TEKNISI
                              </th>
                            </tr>
                            {/* Subheader: Technician Names */}
                            <tr className="bg-cyan-300 text-slate-950 font-bold border-b border-slate-900 h-6 text-center text-[11px]">
                              <th className="border-r border-slate-900" />
                              <th className="border-r border-slate-900" />
                              <th className="border-r border-slate-900" />
                              {technicians.map((tName, tIdx) => (
                                <th
                                  key={`head-${tName}`}
                                  className={`px-1 py-1 min-w-24 ${
                                    tIdx < technicians.length - 1 ? 'border-r border-slate-900' : ''
                                  }`}
                                >
                                  {tName.toUpperCase()}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pageInfo.days.map((day) => {
                              return (
                                <React.Fragment key={`daftar-day-${day.dayNumber}`}>
                                  {/* Shift PS Row */}
                                  <tr className="border-b border-slate-900 h-8 text-slate-900">
                                    <td className="border-r border-slate-900 text-center font-bold bg-white">
                                      {day.dayNumber}
                                    </td>
                                    <td className="border-r border-slate-900 px-2 font-medium bg-white text-[11px]">
                                      {day.fullDateStr}
                                    </td>
                                    <td className="border-r border-slate-900 text-center font-extrabold bg-white text-slate-900">
                                      PS
                                    </td>
                                    {technicians.map((tName, tIdx) => {
                                      const isOnDuty = Boolean(day.shifts.PS[tName]);
                                      const isLast = tIdx === technicians.length - 1;
                                      const att = isOnDuty ? getAttendancePreview(day.dateYmd, 'PS', tName) : null;

                                      if (!isOnDuty) {
                                        return (
                                          <td
                                            key={`cell-ps-${tName}-${day.dayNumber}`}
                                            className={`bg-slate-900 ${
                                              !isLast ? 'border-r border-slate-900' : ''
                                            }`}
                                          />
                                        );
                                      }

                                      return (
                                        <td
                                          key={`cell-ps-${tName}-${day.dayNumber}`}
                                          className={`bg-white text-center px-1 py-1 ${
                                            !isLast ? 'border-r border-slate-900' : ''
                                          }`}
                                        >
                                          {pdfMode === 'blank' ? (
                                            <div className="h-6 w-full flex items-center justify-center text-[9px] text-slate-300 select-none">
                                              <span className="opacity-40 italic">ttd basah</span>
                                            </div>
                                          ) : (
                                            <div className="flex items-center justify-center gap-1 font-bold text-cyan-800 text-[11px]">
                                              {att?.present ? (
                                                <>
                                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline" />
                                                  <span>{att.text}</span>
                                                </>
                                              ) : (
                                                <span className="text-slate-400 font-normal text-[10px]">
                                                  -
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>

                                  {/* Shift M Row */}
                                  <tr className="border-b border-slate-900 h-8 text-slate-900">
                                    <td className="border-r border-slate-900 bg-white" />
                                    <td className="border-r border-slate-900 bg-white" />
                                    <td className="border-r border-slate-900 text-center font-extrabold bg-white text-slate-900">
                                      M
                                    </td>
                                    {technicians.map((tName, tIdx) => {
                                      const isOnDuty = Boolean(day.shifts.M[tName]);
                                      const isLast = tIdx === technicians.length - 1;
                                      const att = isOnDuty ? getAttendancePreview(day.dateYmd, 'M', tName) : null;

                                      if (!isOnDuty) {
                                        return (
                                          <td
                                            key={`cell-m-${tName}-${day.dayNumber}`}
                                            className={`bg-slate-900 ${
                                              !isLast ? 'border-r border-slate-900' : ''
                                            }`}
                                          />
                                        );
                                      }

                                      return (
                                        <td
                                          key={`cell-m-${tName}-${day.dayNumber}`}
                                          className={`bg-white text-center px-1 py-1 ${
                                            !isLast ? 'border-r border-slate-900' : ''
                                          }`}
                                        >
                                          {pdfMode === 'blank' ? (
                                            <div className="h-6 w-full flex items-center justify-center text-[9px] text-slate-300 select-none">
                                              <span className="opacity-40 italic">ttd basah</span>
                                            </div>
                                          ) : (
                                            <div className="flex items-center justify-center gap-1 font-bold text-cyan-800 text-[11px]">
                                              {att?.present ? (
                                                <>
                                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline" />
                                                  <span>{att.text}</span>
                                                </>
                                              ) : (
                                                <span className="text-slate-400 font-normal text-[10px]">
                                                  -
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Footer Info on Last Page */}
                      {isLastPage && (
                        <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 px-2 text-xs">
                          <div className="space-y-1 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <div className="font-bold text-slate-900">Keterangan Shift:</div>
                            <div>P : 08.00 s/d 17.00 WIB (Office / Standar)</div>
                            <div>PS : 07.00 s/d 19.00 WIB (Pagi - Siang)</div>
                            <div>M : 19.00 s/d 07.00 WIB (Malam - Pagi)</div>
                          </div>

                          <div className="text-center sm:text-right pr-6 space-y-1">
                            <p className="text-xs text-slate-700">Pengawas Pekerjaan</p>
                            <p className="text-xs font-bold text-slate-950">
                              FACILITY MAINTENANCE - ELEKTRONIKA
                            </p>
                            <div className="h-12" />
                            <p className="text-xs font-extrabold text-slate-950">( RIZKO ENDRA NUGRAHA )</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* ========================================================================= */}
          {/* VIEW 2: MATRIKS SCHEDULE ROSTER (LANDSCAPE) */}
          {/* ========================================================================= */}
          {activeView === 'roster_matrix' && (
            <div className="bg-white border-2 border-slate-900 rounded-xl p-5 shadow-sm max-w-full overflow-x-auto min-w-[900px]">
              {/* Header Box with PT Nararya Logo & Title */}
              <div className="border-2 border-slate-900 flex items-center mb-0">
                <div className="w-48 border-r-2 border-slate-900 p-3 flex items-center justify-center bg-white">
                  <img
                    src={logoNararya}
                    alt="PT. NARARYA TEKNOLOGI INDONESIA"
                    className="max-h-14 w-auto object-contain"
                  />
                </div>
                <div className="flex-1 text-center py-3 bg-white">
                  <h1 className="text-base sm:text-lg font-black tracking-wide text-slate-950 uppercase underline decoration-2 underline-offset-4">
                    SCHEDULE OM NTI HALIM PERDANA KUSUMA
                  </h1>
                  <p className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 uppercase tracking-wider">
                    {monthLabel} {currentYear}
                  </p>
                </div>
              </div>

              {/* Matrix Table */}
              <div className="border-x-2 border-b-2 border-slate-900">
                {/* Row 1: Day Name Abbr (SL, RB, KM, JM, SB, MG...) */}
                <div className="flex border-b border-slate-900 text-[11px] font-bold">
                  <div className="w-10 border-r border-slate-900 flex items-center justify-center py-1.5 bg-slate-100 text-slate-900">
                    No
                  </div>
                  <div className="w-28 border-r border-slate-900 flex items-center justify-center py-1.5 bg-slate-100 text-slate-900">
                    Nama
                  </div>
                  {days.map((day) => {
                    const isWk = day.isWeekend;
                    return (
                      <div
                        key={`preview-day-name-${day.dayNumber}`}
                        className={`flex-1 border-r border-slate-900 flex items-center justify-center py-1.5 text-center min-w-7 ${
                          isWk ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-900'
                        }`}
                      >
                        {day.dayAbbrId}
                      </div>
                    );
                  })}
                </div>

                {/* Row 2: Date Number (1, 2, 3, 4...) */}
                <div className="flex border-b border-slate-900 text-[11px] font-bold">
                  <div className="w-10 border-r border-slate-900 py-1 bg-white" />
                  <div className="w-28 border-r border-slate-900 py-1 bg-white" />
                  {days.map((day) => (
                    <div
                      key={`preview-day-num-${day.dayNumber}`}
                      className="flex-1 border-r border-slate-900 flex items-center justify-center py-1 text-center bg-white min-w-7 text-slate-900"
                    >
                      {day.dayNumber}
                    </div>
                  ))}
                </div>

                {/* Technician Rows */}
                {technicians.map((techName, idx) => {
                  return (
                    <div
                      key={`tech-row-${techName}`}
                      className="flex border-b border-slate-900 text-xs font-bold"
                    >
                      <div className="w-10 border-r border-slate-900 flex items-center justify-center py-2 text-center bg-white text-slate-900">
                        {idx + 1}
                      </div>
                      <div className="w-28 border-r border-slate-900 flex items-center px-2 py-2 bg-white text-slate-900 tracking-wide">
                        {techName.toUpperCase()}
                      </div>
                      {days.map((day) => {
                        const shiftCode = day.technicianShiftMap[techName] || '-';
                        const badgeStyle = getShiftBadge(shiftCode);
                        return (
                          <div
                            key={`cell-${techName}-${day.dayNumber}`}
                            className={`flex-1 border-r border-slate-900 flex items-center justify-center text-center min-w-7 py-1.5 transition-colors ${badgeStyle}`}
                          >
                            <span>{shiftCode}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Bottom Footer Section: Legend & Signatory */}
              <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 px-4">
                {/* Legend Box */}
                <div className="text-xs space-y-1 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="font-bold text-slate-900 mb-1">Keterangan Shift:</div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-center py-0.5 rounded text-[11px] font-bold bg-amber-500 text-slate-950">
                      P
                    </span>
                    <span>: 08.00 s/d 17.00 WIB (Office / Standar)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-center py-0.5 rounded text-[11px] font-bold bg-yellow-400 text-slate-950">
                      PS
                    </span>
                    <span>: 07.00 s/d 19.00 WIB (Pagi - Siang)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-center py-0.5 rounded text-[11px] font-bold bg-sky-400 text-slate-950">
                      M
                    </span>
                    <span>: 19.00 s/d 07.00 WIB (Malam - Pagi)</span>
                  </div>
                </div>

                {/* Official Signatory Box */}
                <div className="text-center sm:text-right pr-6 space-y-1">
                  <p className="text-xs text-slate-700">Pengawas Pekerjaan</p>
                  <p className="text-xs font-bold text-slate-950">FACILITY MAINTENANCE - ELEKTRONIKA</p>
                  <div className="h-14" />
                  <p className="text-xs font-extrabold text-slate-950">( RIZKO ENDRA NUGRAHA )</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
