import React, { useMemo } from 'react';
import {
  Equipment,
  PreventiveEntry,
  CorrectiveReport,
  ShiftType,
} from '../types';
import { detectRecurringFaults } from '../utils/faultDetection';
import { normalizeShift } from '../utils/contextFilter';
import { getHistoricalReportList } from '../services/reportService';
import {
  Users,
  ClipboardCheck,
  AlertTriangle,
  Flame,
  Clock,
  Copy,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Send,
  Settings,
  History,
} from 'lucide-react';
import { toast } from './Toast';
import {
  formatDailyBriefTelegramHtml,
  sendTelegramMessage,
  convertHtmlToPlainText,
  getTelegramShareUrl,
  getStoredTelegramConfig,
} from '../services/telegramService';

interface SupervisorDailyBriefProps {
  operationalDate: string;
  shift?: ShiftType;
  technicianNames: string[];
  equipments: Equipment[];
  preventiveEntries: PreventiveEntry[];
  correctiveReports: CorrectiveReport[];
  onOpenPreventive?: (equipmentId?: number) => void;
  onOpenCorrective?: () => void;
  onOpenTimeline?: (equipmentId: number) => void;
  onOpenTelegramModal?: () => void;
  onOpenReportsTab?: () => void;
}

export const SupervisorDailyBrief: React.FC<SupervisorDailyBriefProps> = ({
  operationalDate,
  shift = 'Pagi',
  technicianNames,
  equipments,
  preventiveEntries,
  correctiveReports,
  onOpenPreventive,
  onOpenCorrective,
  onOpenTimeline,
  onOpenTelegramModal,
  onOpenReportsTab,
}) => {
  const [isSendingTelegram, setIsSendingTelegram] = React.useState(false);

  const historicalCount = useMemo(() => {
    return getHistoricalReportList(preventiveEntries, correctiveReports, [], undefined).length;
  }, [preventiveEntries, correctiveReports]);

  // 1. Calculate Preventive Metrics for today
  const normShift = normalizeShift(shift);
  const todaysDoneMap = useMemo(() => {
    const map = new Map<number, PreventiveEntry>();
    preventiveEntries.forEach((entry) => {
      const matchDate = !entry.operational_date || entry.operational_date === operationalDate;
      const matchShift = !entry.shift || normalizeShift(entry.shift) === normShift;
      if (matchDate && matchShift) {
        map.set(Number(entry.equipment_id), entry);
      }
    });
    return map;
  }, [preventiveEntries, operationalDate, normShift]);

  const totalScheduled = equipments.length;
  const completedCount = equipments.filter((e) => todaysDoneMap.has(e.id)).length;
  const pendingCount = totalScheduled - completedCount;
  const pendingEquipments = equipments.filter((e) => !todaysDoneMap.has(e.id));

  // 2. Calculate Active Corrective Reports
  const activeCorrectives = useMemo(() => {
    return correctiveReports.filter(
      (r) => r.result !== 'Resolved' && r.result_text !== 'Resolved' && (r as any).status !== 'Selesai'
    );
  }, [correctiveReports]);

  // 3. Detect Recurring Faults across reports
  const recurringFaults = useMemo(() => {
    return detectRecurringFaults(correctiveReports, equipments, 30, 3);
  }, [correctiveReports, equipments]);

  // Format Date for Display (e.g. 7 September 2026)
  const displayDateStr = useMemo(() => {
    if (!operationalDate) return 'Hari Ini';
    const parts = operationalDate.split('-');
    if (parts.length === 3) {
      const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
      ];
      const day = parseInt(parts[2], 10);
      const mIdx = parseInt(parts[1], 10) - 1;
      return `${day} ${months[mIdx] || parts[1]} ${parts[0]}`;
    }
    return operationalDate;
  }, [operationalDate]);

  // Copy WhatsApp Briefing Handler
  const handleCopyWhatsApp = () => {
    const shiftLabel = shift === 'Malam' ? 'Malam (M)' : 'Pagi (PS)';
    const dutyStr = technicianNames.length > 0 ? technicianNames.join(', ') : 'Belum ditentukan';

    const correctiveLines =
      activeCorrectives.length > 0
        ? activeCorrectives
            .slice(0, 3)
            .map((c) => {
              const eq = equipments.find((e) => e.id === Number(c.equipment_id));
              return `  • ${eq?.name || 'Mesin'}: ${c.problem_description.slice(0, 45)} (${c.result})`;
            })
            .join('\n')
        : '  • Tidak ada gangguan aktif (All Clear)';

    const recurringLines =
      recurringFaults.length > 0
        ? recurringFaults
            .map((rf) => `  • ${rf.equipment_name}: ${rf.fault_keyword} (${rf.occurrences_count}x dalam 30 hari)`)
            .join('\n')
        : '  • Nihil recurring fault terdeteksi';

    const text = `*OPERASIONAL BRIEFING HARIAN*
Tanggal: ${displayDateStr}
Shift: ${shiftLabel}

👷 *PERSONEL JAGA:*
${dutyStr}

🔧 *PREVENTIVE MAINTENANCE:*
• Terjadwal: ${totalScheduled} unit
• Selesai: ${completedCount} unit
• Pending: ${pendingCount} unit

⚠️ *CORRECTIVE MAINTENANCE (${activeCorrectives.length} Aktif):*
${correctiveLines}

🚨 *EQUIPMENT RECURRING FAULT (${recurringFaults.length}):*
${recurringLines}

⏰ *STATUS:* ${pendingCount === 0 ? 'Semua inspeksi tuntas' : `${pendingCount} unit dalam proses`}
_Generated via Sistem Monitoring Pemeliharaan_`;

    navigator.clipboard.writeText(text);
    toast.success('Format WhatsApp Disalin', {
      message: 'Briefing harian supervisor berhasil disalin ke clipboard.',
      badge: 'Supervisor Brief',
    });
  };

  // Send Daily Brief to Telegram Group
  const handleSendTelegram = async () => {
    setIsSendingTelegram(true);
    try {
      const htmlMsg = formatDailyBriefTelegramHtml({
        operationalDate,
        shift,
        technicianNames,
        equipments,
        preventiveEntries,
        correctiveReports,
      });

      const res = await sendTelegramMessage({
        message: htmlMsg,
        parseMode: 'HTML',
      });

      if (res.success) {
        toast.success('Disiarkan ke Telegram', {
          message: 'Laporan briefing harian berhasil dikirim ke grup Telegram.',
          badge: 'Telegram Bot',
        });
      } else {
        // Fallback: copy plain text and open telegram share
        const plain = convertHtmlToPlainText(htmlMsg);
        navigator.clipboard.writeText(plain);
        window.open(getTelegramShareUrl(plain), '_blank');
        toast.info('Buka Telegram Web', {
          message: `${res.error || 'Bot belum diatur'}. Membuka tautan berbagi Telegram.`,
          badge: 'Telegram',
        });
      }
    } catch (err: any) {
      toast.error('Gagal Mengirim Telegram', {
        message: err.message || 'Terjadi kesalahan jaringan.',
      });
    } finally {
      setIsSendingTelegram(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner Card */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-800 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Operasional — {displayDateStr}
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap pt-0.5">
              <span className="text-slate-400 font-medium">Petugas On Duty:</span>
              {technicianNames.length > 0 ? (
                <span className="text-white font-semibold">{technicianNames.join(' · ')}</span>
              ) : (
                <span className="text-amber-400 font-medium">Belum diset</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              onClick={handleCopyWhatsApp}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center gap-2 transition cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin WA</span>
            </button>

            <button
              onClick={handleSendTelegram}
              disabled={isSendingTelegram}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-semibold rounded-lg text-xs flex items-center gap-2 transition cursor-pointer disabled:opacity-60"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSendingTelegram ? 'Mengirim...' : 'Kirim ke Telegram'}</span>
            </button>

            {onOpenTelegramModal && (
              <button
                onClick={onOpenTelegramModal}
                title="Pengaturan Bot Telegram"
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs flex items-center justify-center transition cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid Status Cards */}
      <div
        className={`grid grid-cols-1 ${
          recurringFaults.length > 0 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
        } gap-3.5`}
      >
        {/* 1. Preventive Progress */}
        <div
          onClick={() => onOpenPreventive && onOpenPreventive()}
          className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs space-y-2.5 hover:border-blue-500 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <ClipboardCheck className="w-4 h-4 text-emerald-600" />
              <span>Preventive Checklist</span>
            </span>
            <span className="font-mono font-bold text-emerald-700">
              {Math.round((completedCount / (totalScheduled || 1)) * 100)}%
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">{completedCount}</span>
            <span className="text-xs text-slate-500 font-medium">/ {totalScheduled} selesai</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${(completedCount / (totalScheduled || 1)) * 100}%` }}
            />
          </div>
          <div className="text-xs text-slate-500 flex items-center justify-between pt-1 border-t border-slate-100">
            <span>{pendingCount} unit pending</span>
            <span className="text-blue-600 group-hover:translate-x-0.5 transition font-medium flex items-center gap-0.5">
              <span>Detail</span>
              <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* 2. Corrective Status */}
        <div
          onClick={() => onOpenCorrective && onOpenCorrective()}
          className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs space-y-2.5 hover:border-rose-500 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Corrective Action</span>
            </span>
            <span
              className={`font-mono font-bold ${
                activeCorrectives.length > 0 ? 'text-rose-600' : 'text-slate-500'
              }`}
            >
              {activeCorrectives.length} Aktif
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">{activeCorrectives.length}</span>
            <span className="text-xs text-slate-500 font-medium">perlu tindakan</span>
          </div>
          <div className="text-[11px] text-slate-500 flex items-center justify-between">
            <span>{activeCorrectives.length === 0 ? 'Semua teratasi' : 'Butuh follow up'}</span>
            <span className="text-rose-600 group-hover:underline font-semibold flex items-center gap-0.5">
              Buka <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        {/* 3. Arsip Laporan per Tanggal */}
        <div
          onClick={() => onOpenReportsTab && onOpenReportsTab()}
          className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-2.5 hover:border-blue-400 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
              <History className="w-4 h-4 text-blue-600" />
              <span>Arsip Laporan</span>
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
              {historicalCount} Sesi
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-900">{historicalCount}</span>
            <span className="text-xs text-slate-500">laporan tersimpan</span>
          </div>
          <div className="text-[11px] text-slate-500 flex items-center justify-between">
            <span>Histori per tanggal & shift</span>
            <span className="text-blue-600 group-hover:underline font-semibold flex items-center gap-0.5">
              Buka Arsip <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        {/* 4. Recurring Faults (Only shown if > 0) */}
        {recurringFaults.length > 0 && (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-600" />
                <span>Recurring Fault</span>
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                {recurringFaults.length} Mesin
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-slate-900">{recurringFaults.length}</span>
              <span className="text-xs text-slate-500">pola kerusakan berulang</span>
            </div>
            <div className="text-[11px] text-amber-700 font-medium">
              Perlu perhatian khusus teknisi
            </div>
          </div>
        )}
      </div>

      {/* Detailed Alert Section (Only shown if recurring faults exist) */}
      {recurringFaults.length > 0 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-600" />
              <span>Deteksi Kerusakan Berulang (Recurring Faults)</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">Rentang 30 Hari</span>
          </div>

          <div className="space-y-2.5">
            {recurringFaults.map((rf, idx) => (
              <div
                key={idx}
                className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl space-y-2 hover:bg-amber-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-900">{rf.equipment_name}</div>
                    <div className="text-[11px] text-amber-900 font-semibold flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{rf.fault_keyword}</span>
                      <span className="bg-amber-200/80 text-amber-900 px-1.5 py-0.2 rounded text-[10px] font-extrabold">
                        {rf.occurrences_count}x kejadian
                      </span>
                    </div>
                  </div>
                  {onOpenTimeline && (
                    <button
                      onClick={() => onOpenTimeline(rf.equipment_id)}
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-semibold cursor-pointer shrink-0 transition-colors"
                    >
                      Buka Timeline
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 bg-white/70 p-2 rounded-lg border border-amber-100 leading-relaxed">
                  <span className="font-semibold text-slate-700">Rekomendasi Tindakan: </span>
                  {rf.recommendation}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
