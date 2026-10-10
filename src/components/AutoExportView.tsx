import React, { useState, useEffect } from 'react';
import {
  Clock,
  Send,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Cloud,
  Smartphone,
  ShieldCheck,
  Calendar,
  Layers,
  ArrowRight,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { toast } from './Toast';
import { getWhatsAppStatus, WhatsAppStatus } from '../services/whatsappService';
import { getJakartaISOString } from '../utils/dateTimeUtils';

interface AutoExportViewProps {
  currentUserProfile?: any;
}

interface TriggerResult {
  success: boolean;
  fileName?: string;
  objectKey?: string;
  size?: number;
  message?: string;
  error?: string;
  executedAt?: string;
  date?: string;
  shift?: string;
  waSent?: boolean;
}

export const AutoExportView: React.FC<AutoExportViewProps> = ({ currentUserProfile }) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    try {
      return getJakartaISOString().split('T')[0];
    } catch (_) {
      return new Date().toISOString().split('T')[0];
    }
  });
  const [selectedShift, setSelectedShift] = useState<'Pagi' | 'Malam'>('Pagi');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<TriggerResult | null>(null);

  // Status Integrasi
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');

  // Update live Jakarta clock
  useEffect(() => {
    const updateClock = () => {
      try {
        const now = new Date();
        const timeStr = new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(now);
        setCurrentTimeStr(`${timeStr} WIB`);
      } catch (_) {
        setCurrentTimeStr('');
      }
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch status
  const loadStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const data = await getWhatsAppStatus().catch(() => null);
      if (data) {
        setWaStatus(data);
      }
    } catch (err) {
      console.warn('Gagal memuat status WhatsApp:', err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  // Trigger Manual Auto-Export
  const handleTriggerExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    setLastResult(null);

    toast.info('Menjalankan Auto-Export...', {
      message: `Sedang memproses laporan ${selectedDate} Shift ${selectedShift}...`,
      duration: 3500,
      badge: 'Auto-Export Scheduler',
    });

    try {
      const res = await fetch('/api/reports/auto-export-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operational_date: selectedDate,
          shift: selectedShift,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const result: TriggerResult = {
          success: true,
          fileName: data.fileName,
          objectKey: data.objectKey,
          size: data.size,
          waSent: data.waSent,
          date: selectedDate,
          shift: selectedShift,
          executedAt: new Date().toLocaleTimeString('id-ID'),
        };
        setLastResult(result);
        toast.success('Auto-Export Selesai & Terkirim! 🚀', {
          message: `Berkas ${data.fileName || 'PDF'} berhasil digenerate, diarsipkan ke ${data.objectKey || 'S3'}, dan dikirim ke grup WhatsApp.`,
          badge: 'Berhasil',
          duration: 5000,
        });
      } else {
        const result: TriggerResult = {
          success: false,
          error: data.error || data.message || 'Gagal mengekspor laporan shift.',
          date: selectedDate,
          shift: selectedShift,
          executedAt: new Date().toLocaleTimeString('id-ID'),
        };
        setLastResult(result);
        toast.error('Gagal Auto-Export', {
          message: result.error,
          badge: 'Gagal',
          duration: 4000,
        });
      }
    } catch (err: any) {
      const result: TriggerResult = {
        success: false,
        error: err.message || 'Terjadi kesalahan jaringan.',
        date: selectedDate,
        shift: selectedShift,
        executedAt: new Date().toLocaleTimeString('id-ID'),
      };
      setLastResult(result);
      toast.error('Gagal Menghubungi Server', {
        message: err.message,
      });
    } finally {
      setIsRunning(false);
    }
  };

  const isWaConnected = waStatus?.status === 'connected';
  const isAutoNotifyActive = waStatus?.config?.auto_notify_export !== false;
  const targetGroupJid = waStatus?.config?.target_jid || '';
  const targetGroupName = waStatus?.config?.recipient_name || 'Grup WhatsApp Dinas';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-700/60 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Clock className="w-64 h-64 text-white" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Background Scheduler Aktif (Asia/Jakarta)</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight">
              Auto-Export PDF Scheduler
            </h1>
            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
              Sistem scheduler otomatis yang mengekspor dan mengirimkan berkas PDF laporan resmi ke grup WhatsApp dinas tepat 1 jam sebelum pergantian shift.
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
            <div className="bg-slate-950/60 backdrop-blur border border-slate-700/80 px-4 py-2.5 rounded-xl text-right">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                Waktu Server Saat Ini:
              </span>
              <span className="text-base md:text-lg font-black font-mono text-emerald-400">
                {currentTimeStr || 'Memuat...'}
              </span>
            </div>

            <button
              onClick={loadStatus}
              disabled={isLoadingStatus}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-600 rounded-lg text-xs font-bold text-slate-200 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
              <span>Refresh Status Bot</span>
            </button>
          </div>
        </div>
      </div>

      {/* Info 3-Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Shift Pagi */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                Shift Pagi (07:00 - 19:00 WIB)
              </span>
              <span className="text-xs font-black font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                18:00 WIB
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">
              Jadwal Trigger Shift Pagi
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Otomatis dipicu setiap hari pukul <b>18:00 WIB</b> (1 jam sebelum shift malam). Mengenerate seluruh checklist preventif &amp; tiket corrective hari itu.
            </p>
          </div>

          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Target: Tanggal Operasional Hari Ini</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Arsip: S3 !Kantor/1. Laporan/1. Laporan Harian/[Tahun]/[Bulan]</span>
            </div>
          </div>
        </div>

        {/* Card 2: Shift Malam */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
                Shift Malam (19:00 - 07:00 WIB)
              </span>
              <span className="text-xs font-black font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                06:00 WIB
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">
              Jadwal Trigger Shift Malam
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Otomatis dipicu setiap hari pukul <b>06:00 WIB</b> (1 jam sebelum shift pagi). Mengenerate laporan dinas shift malam (tanggal kemarin).
            </p>
          </div>

          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Target: Tanggal Operasional Shift Kemarin</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Arsip: S3 !Kantor/1. Laporan/1. Laporan Harian/[Tahun]/[Bulan]</span>
            </div>
          </div>
        </div>

        {/* Card 3: Status Integrasi WhatsApp */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
                Target Pengiriman Bot
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isWaConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}
              >
                {isWaConnected ? 'WhatsApp Terhubung' : 'WhatsApp Terputus'}
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              <span>{targetGroupName}</span>
            </h3>
            <code className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2 py-1 rounded block truncate">
              {targetGroupJid || '(Belum ada JID grup yang dipilih)'}
            </code>
          </div>

          <div className="pt-2 border-t border-slate-100 text-[11px] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Auto-Export WhatsApp:</span>
              <span className={`font-bold ${isAutoNotifyActive ? 'text-emerald-600' : 'text-rose-600'}`}>
                {isAutoNotifyActive ? 'Aktif (Centang ON)' : 'Nonaktif (Centang OFF)'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Testing & Trigger Interactive Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <span>Uji Coba &amp; Eksekusi Manual Auto-Export</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Gunakan panel ini untuk menguji secara langsung proses pembuatan PDF, pengarsipan S3, serta pengiriman ke grup WhatsApp tanpa harus menunggu jam 06:00 atau 18:00 WIB.
            </p>
          </div>
        </div>

        <form onSubmit={handleTriggerExport} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs font-bold text-slate-800 block mb-1.5">
              Tanggal Operasional:
            </label>
            <div className="relative">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-800 block mb-1.5">
              Pilih Shift Kerja:
            </label>
            <select
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value as 'Pagi' | 'Malam')}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 cursor-pointer"
            >
              <option value="Pagi">Shift Pagi (07:00 - 19:00 WIB)</option>
              <option value="Malam">Shift Malam (19:00 - 07:00 WIB)</option>
            </select>
          </div>

          <div>
            <button
              type="submit"
              disabled={isRunning}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sedang Mengekspor &amp; Mengirim...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Jalankan Auto-Export Sekarang</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Execution Result Box */}
        {lastResult && (
          <div
            className={`p-5 rounded-2xl border transition-all ${
              lastResult.success
                ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                : 'bg-rose-50/80 border-rose-300 text-rose-950'
            }`}
          >
            <div className="flex items-start gap-3">
              {lastResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}

              <div className="space-y-2 flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <h4 className="font-bold text-sm">
                    {lastResult.success
                      ? 'Auto-Export Shift Berhasil Dijalankan!'
                      : 'Auto-Export Gagal Diproses'}
                  </h4>
                  <span className="text-[11px] font-mono text-slate-500">
                    Eksekusi pada: {lastResult.executedAt} WIB
                  </span>
                </div>

                {lastResult.success ? (
                  <div className="text-xs space-y-1.5 pt-1">
                    <p>
                      Berkas <b>{lastResult.fileName}</b> ({((lastResult.size || 0) / 1024).toFixed(1)} KB) untuk{' '}
                      <b>{lastResult.date}</b> Shift <b>{lastResult.shift}</b> telah selesai diproses.
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-emerald-900/90 font-medium">
                      <li>Render PDF via Puppeteer Server Engine: <b>Sukses</b></li>
                      <li>
                        Arsip Berkas ke S3 Cloud Storage: <b className="font-mono text-[11px]">{lastResult.objectKey || 'Sukses'}</b>
                      </li>
                      <li>Katalog Database Supabase (report_files): <b>Tersimpan</b></li>
                      <li>
                        Pengiriman Dokumen ke Grup WhatsApp:{' '}
                        <b>
                          {lastResult.waSent
                            ? 'Terkirim ke Grup WhatsApp'
                            : isAutoNotifyActive && isWaConnected
                            ? 'Terkirim via WhatsApp Bot'
                            : 'Dilewati (Cek Koneksi Bot / JID)'}
                        </b>
                      </li>
                    </ul>
                  </div>
                ) : (
                  <div className="text-xs pt-1 text-rose-900 font-medium">
                    <p>Penyebab error: {lastResult.error}</p>
                    <p className="text-[11px] text-rose-700 mt-1">
                      Pastikan sudah ada data inspeksi preventif atau tiket corrective pada tanggal dan shift yang dipilih.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
