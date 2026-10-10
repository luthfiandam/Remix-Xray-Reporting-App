import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Users,
  RefreshCw,
  Send,
  CheckCircle2,
  AlertCircle,
  Save,
  ShieldCheck,
  Clock,
  MessageSquare,
  Info,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import {
  getWhatsAppStatus,
  saveWhatsAppConfig,
  sendWhatsAppTest,
  fetchWhatsAppGroups,
  WhatsAppStatusResponse,
  WhatsAppGroupItem,
} from '../services/whatsappService';
import { toast } from './Toast';

export const WhatsAppMasterTab: React.FC = () => {
  const [statusData, setStatusData] = useState<WhatsAppStatusResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);

  // Group selection & configuration
  const [groups, setGroups] = useState<WhatsAppGroupItem[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState<boolean>(false);
  const [targetJid, setTargetJid] = useState<string>(() => {
    try {
      return localStorage.getItem('whatsapp_target_jid') || '';
    } catch (_) {
      return '';
    }
  });
  const [recipientName, setRecipientName] = useState<string>('');
  const [autoPreventive, setAutoPreventive] = useState<boolean>(true);
  const [autoAttendance, setAutoAttendance] = useState<boolean>(true);
  const [autoExport, setAutoExport] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Test Message
  const [testMessage, setTestMessage] = useState<string>(
    '🟢 *Tes Notifikasi Bot WhatsApp Faskampen Halim Perdanakusuma*\n\nSistem otomatisasi Baileys berhasil terhubung ke grup ini dan siap bertugas mengirimkan laporan harian dinas teknisi faskampen.'
  );
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [lastTestResult, setLastTestResult] = useState<{
    success: boolean;
    message: string;
    time: string;
  } | null>(null);

  // Load Status
  const loadStatus = async (showLoading: boolean = false) => {
    if (showLoading) setIsLoadingStatus(true);
    try {
      const data = await getWhatsAppStatus();
      setStatusData(data);
      if (data.config) {
        if (data.config.target_jid) {
          setTargetJid(data.config.target_jid);
          try {
            localStorage.setItem('whatsapp_target_jid', data.config.target_jid);
          } catch (_) {}
        }
        if (data.config.recipient_name) {
          setRecipientName(data.config.recipient_name);
        }
        setAutoPreventive(data.config.auto_notify_preventive ?? true);
        setAutoAttendance(data.config.auto_notify_attendance ?? true);
        setAutoExport(data.config.auto_notify_export ?? true);
      }
    } catch (err: any) {
      console.warn('Gagal memuat status WhatsApp:', err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  // Load Groups via official Baileys API
  const handleLoadGroups = async () => {
    setIsLoadingGroups(true);
    try {
      const list = await fetchWhatsAppGroups();
      setGroups(list);
      if (list.length > 0) {
        toast.success(`Ditemukan ${list.length} grup WhatsApp`, {
          message: 'Pilih nama grup dari menu dropdown di bawah.',
          badge: 'Baileys Multi-Device',
        });
      } else {
        toast.info('Belum ada grup ditemukan', {
          message: 'Pastikan nomor WhatsApp Anda sudah terhubung dan bergabung dalam grup.',
        });
      }
    } catch (err: any) {
      toast.error('Gagal mengambil daftar grup: ' + err.message);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  useEffect(() => {
    loadStatus(true);
    handleLoadGroups();
  }, []);

  // Save Settings
  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      await saveWhatsAppConfig({
        enabled: true,
        target_jid: targetJid.trim(),
        recipient_name: recipientName.trim(),
        auto_notify_preventive: autoPreventive,
        auto_notify_attendance: autoAttendance,
        auto_notify_export: autoExport,
      });

      try {
        localStorage.setItem('whatsapp_target_jid', targetJid.trim());
      } catch (_) {}

      toast.success('Pengaturan Grup WhatsApp Disimpan!', {
        message: `Target pesan disetel ke: ${recipientName || targetJid}`,
        badge: 'Pengaturan WhatsApp',
      });
      loadStatus(false);
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Send Live Test Message
  const handleSendTestMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const dest = targetJid.trim();
    if (!dest) {
      toast.error('Pilih atau masukkan JID grup tujuan terlebih dahulu.');
      return;
    }

    setIsSendingTest(true);
    try {
      const nowStr = new Date().toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' WIB';

      const res = await sendWhatsAppTest(dest, testMessage.trim());
      const successMsg = res.message || `Pesan tes berhasil dikirim ke ${recipientName || dest}`;
      
      setLastTestResult({
        success: true,
        message: successMsg,
        time: nowStr,
      });

      toast.success('Pesan Uji Coba Berhasil Dikirim!', {
        message: successMsg,
        badge: 'Uji Coba WhatsApp',
      });
    } catch (err: any) {
      const errorMsg = err.message || 'Gagal mengirim pesan uji coba.';
      setLastTestResult({
        success: false,
        message: errorMsg,
        time: new Date().toLocaleTimeString('id-ID') + ' WIB',
      });
      toast.error('Gagal kirim pesan tes: ' + errorMsg);
    } finally {
      setIsSendingTest(false);
    }
  };

  const isConnected = statusData?.status === 'connected';

  return (
    <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-xs space-y-6">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                Pengaturan Grup & Notifikasi WhatsApp Bot
                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full uppercase tracking-wider">
                  Baileys API
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Pilih grup dinas WhatsApp tujuan dan uji coba pengiriman pesan otomatis secara langsung.
              </p>
            </div>
          </div>
        </div>

        {/* Live Status Badge */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold ${
              isConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span>
              {isLoadingStatus
                ? 'Memeriksa status...'
                : isConnected
                ? `Terhubung: +${statusData?.phoneNumber || ''} (${statusData?.pushName || 'Bot'})`
                : 'Belum Terhubung'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              loadStatus(true);
              handleLoadGroups();
            }}
            disabled={isLoadingStatus || isLoadingGroups}
            className="p-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-xl transition cursor-pointer"
            title="Muat Ulang Status & Grup"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingStatus || isLoadingGroups ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Grid: 2 Columns (Left: Group Settings, Right: Live Testing Box) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Configuration */}
        <div className="lg:col-span-7 space-y-5">
          {/* Quick Select Group Box */}
          <div className="bg-gradient-to-br from-emerald-950/20 via-slate-900 to-slate-950 text-white rounded-2xl p-5 border border-emerald-500/30 space-y-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                  Pilih Grup WhatsApp (Auto-Detect Legal)
                </h4>
              </div>

              <button
                type="button"
                onClick={handleLoadGroups}
                disabled={isLoadingGroups || !isConnected}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGroups ? 'animate-spin' : ''}`} />
                <span>{isLoadingGroups ? 'Mendeteksi...' : 'Deteksi Ulang Grup'}</span>
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Sistem Baileys membaca daftar grup WhatsApp yang diikuti oleh nomor HP Anda. Pilih grup dinas di bawah untuk mengisi JID secara otomatis:
            </p>

            {/* Dropdown Groups */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-emerald-300 block">
                Daftar Grup yang Ditemukan ({groups.length} grup):
              </label>
              <select
                value={groups.some((g) => g.id === targetJid) ? targetJid : ''}
                onChange={async (e) => {
                  const sel = groups.find((g) => g.id === e.target.value);
                  if (sel) {
                    setTargetJid(sel.id);
                    setRecipientName(sel.subject);
                    try {
                      localStorage.setItem('whatsapp_target_jid', sel.id);
                    } catch (_) {}

                    try {
                      await saveWhatsAppConfig({
                        enabled: true,
                        target_jid: sel.id,
                        recipient_name: sel.subject,
                        auto_notify_preventive: autoPreventive,
                        auto_notify_attendance: autoAttendance,
                        auto_notify_export: autoExport,
                      });
                      toast.success(`Grup "${sel.subject}" dipilih & disimpan!`, {
                        message: `Target JID server disetel ke: ${sel.id}`,
                        badge: 'WhatsApp Bot',
                      });
                    } catch (saveErr: any) {
                      toast.error('Gagal menyimpan ke server: ' + saveErr.message);
                    }
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-emerald-500 text-emerald-300 font-semibold text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400 cursor-pointer"
              >
                <option value="">-- Klik untuk memilih salah satu grup dinas --</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id} className="bg-slate-900 text-white">
                    👥 {g.subject} ({g.participantsCount} anggota) — {g.id}
                  </option>
                ))}
              </select>

              {targetJid && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <span className="text-slate-400">Grup Aktif: </span>
                      <b className="text-white">{recipientName || 'Grup Terpilih'}</b>
                    </div>
                  </div>
                  <code className="text-[11px] font-mono text-emerald-300 bg-slate-950 px-2 py-1 rounded">
                    {targetJid}
                  </code>
                </div>
              )}
            </div>
          </div>

          {/* Form Settings Detail */}
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-800 block mb-1">
                Group JID / Nomor Tujuan:
              </label>
              <input
                type="text"
                value={targetJid}
                onChange={(e) => {
                  setTargetJid(e.target.value);
                  try {
                    localStorage.setItem('whatsapp_target_jid', e.target.value);
                  } catch (_) {}
                }}
                placeholder="Contoh: 120363xxxxxx@g.us atau 08123456789"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Format JID grup WhatsApp berakhiran <code className="font-mono bg-slate-100 px-1 rounded">@g.us</code>.
              </p>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-800 block mb-1">
                Label Nama Tujuan (Tampilan):
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Contoh: OM X-RAY HLP-NTI"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Pilihan Notifikasi WhatsApp (Centang) */}
            <div className="space-y-2.5 pt-1">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                Pilihan Notifikasi WhatsApp:
              </label>

              {/* 1. Laporan WhatsApp + Kolase Foto per Interval */}
              <label className="flex items-start gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={autoPreventive}
                  onChange={(e) => setAutoPreventive(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    Laporan WhatsApp + Kolase Foto per Interval
                  </span>
                  <span className="text-[11px] text-slate-500 leading-tight block mt-0.5">
                    Izinkan pengiriman rekapitulasi laporan preventif berserta foto kolase per interval ke grup WhatsApp.
                  </span>
                </div>
              </label>

              {/* 2. Otomatis Kirim Laporan PDF */}
              <label className="flex items-start gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={autoExport}
                  onChange={(e) => setAutoExport(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    Otomatis Kirim Laporan PDF (Auto-Export Shift)
                  </span>
                  <span className="text-[11px] text-slate-500 leading-tight block mt-0.5">
                    Kirim berkas PDF resmi shift pagi &amp; malam tepat 1 jam sebelum serah terima shift (06:00 &amp; 18:00 WIB).
                  </span>
                </div>
              </label>

              {/* 3. Absen Masuk dan Pulang */}
              <label className="flex items-start gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={autoAttendance}
                  onChange={(e) => setAutoAttendance(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    Presensi Absen Masuk dan Pulang
                  </span>
                  <span className="text-[11px] text-slate-500 leading-tight block mt-0.5">
                    Kirim foto selfie absensi ber-watermark resmi serta jam durasi kerja shift teknisi ke grup WhatsApp.
                  </span>
                </div>
              </label>
            </div>

            <div className="pt-3">
              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Menyimpan Pengaturan...' : 'Simpan Pengaturan Grup WhatsApp'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column (5 cols): Live Testing Panel */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 text-slate-900 border-b border-slate-200/80 pb-3">
              <Send className="w-4 h-4 text-emerald-600" />
              <h4 className="text-sm font-bold uppercase tracking-wider">
                Uji Coba Kirim Pesan ke Grup
              </h4>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Ketik pesan di bawah lalu tekan tombol kirim untuk langsung mengetes apakah bot WhatsApp berhasil mengirim pesan ke grup tujuan lu secara nyata.
            </p>

            <div className="space-y-3">
              <div className="p-3 bg-white border border-slate-200 rounded-xl text-xs space-y-1">
                <span className="text-slate-500 block font-medium">Target Pengiriman:</span>
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span className="truncate">{recipientName || 'Grup Belum Dipilih'}</span>
                  <span className="text-[11px] text-emerald-700 font-mono font-normal">
                    ({targetJid || 'JID kosong'})
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Isi Pesan Uji Coba:
                </label>
                <textarea
                  rows={4}
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="w-full p-3 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 leading-relaxed"
                />
              </div>

              <button
                type="button"
                onClick={handleSendTestMessage}
                disabled={isSendingTest || !targetJid.trim() || !isConnected}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition cursor-pointer disabled:opacity-40"
              >
                <Send className={`w-4 h-4 ${isSendingTest ? 'animate-bounce' : ''}`} />
                <span>
                  {isSendingTest
                    ? 'Sedang Mengirim ke WhatsApp...'
                    : '🚀 Kirim Pesan Uji Coba ke Grup Ini'}
                </span>
              </button>

              {/* Status Hasil Tes */}
              {lastTestResult && (
                <div
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    lastTestResult.success
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-red-50 border-red-300 text-red-900'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className="flex items-center gap-1.5">
                      {lastTestResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      )}
                      {lastTestResult.success ? 'Berhasil Terkirim ke WhatsApp' : 'Gagal Mengirim'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {lastTestResult.time}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed pl-5.5">
                    {lastTestResult.message}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Guide Card */}
          <div className="bg-blue-50/60 border border-blue-200/80 rounded-2xl p-4 text-xs text-blue-900 space-y-2">
            <div className="flex items-center gap-2 font-bold text-blue-950">
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Tips Penggunaan Grup WhatsApp:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-blue-800 leading-relaxed">
              <li>Pastikan nomor WhatsApp yang ditautkan di bot sudah masuk menjadi anggota di grup tujuan.</li>
              <li>Pilih grup dari dropdown, lalu tekan <b>"Simpan Pengaturan"</b>.</li>
              <li>Klik tombol hijau <b>"Kirim Pesan Uji Coba"</b> untuk memastikan pesan masuk ke grup di HP lu.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
