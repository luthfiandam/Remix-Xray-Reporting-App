import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Smartphone,
  QrCode,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Send,
  Save,
  MessageSquare,
  ShieldCheck,
  KeyRound,
  FileText,
  Clock,
  ExternalLink,
  Users,
} from 'lucide-react';
import {
  getWhatsAppStatus,
  connectWhatsApp,
  requestPairingCode,
  disconnectWhatsApp,
  saveWhatsAppConfig,
  sendWhatsAppTest,
  fetchWhatsAppGroups,
  WhatsAppStatusResponse,
  WhatsAppGroupItem,
} from '../services/whatsappService';
import { toast } from './Toast';

interface WhatsAppModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  isFullPage?: boolean;
}

export function WhatsAppModal({ isOpen = true, onClose = () => {}, isFullPage = false }: WhatsAppModalProps) {
  const [statusData, setStatusData] = useState<WhatsAppStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'connection' | 'settings' | 'test' | 'logs'>('connection');

  // Pairing code form (persisted in localStorage so it never disappears on re-render)
  const [phoneNumberInput, setPhoneNumberInput] = useState<string>(() => {
    try {
      return localStorage.getItem('whatsapp_phone_number_input') || '';
    } catch (_) {
      return '';
    }
  });
  const [isRequestingCode, setIsRequestingCode] = useState<boolean>(false);
  const [generatedPairingCode, setGeneratedPairingCode] = useState<string | null>(null);

  // Settings form (persisted in localStorage so it never disappears on re-render)
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

  // Group list states
  const [groups, setGroups] = useState<WhatsAppGroupItem[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState<boolean>(false);

  // Flag to ensure form inputs are only initialized once from backend config and NOT wiped out on 4s polling
  const hasInitializedFormRef = useRef<boolean>(false);

  // Test form
  const [testMessage, setTestMessage] = useState<string>(
    '🟢 *Tes Notifikasi Bot WhatsApp Faskampen Halim Perdanakusuma*\n\nSistem otomatisasi Baileys berhasil terhubung dan siap beroperasi.'
  );
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);

  // Logs
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch status helper
  const loadStatus = async (showLoadingSpinner: boolean = false, forceUpdateForm: boolean = false) => {
    if (showLoadingSpinner) setIsRefreshing(true);
    try {
      const data = await getWhatsAppStatus();
      setStatusData(data);

      // ONLY populate form inputs on initial open or forced reload, never on background polling!
      if (data.config && (!hasInitializedFormRef.current || forceUpdateForm)) {
        hasInitializedFormRef.current = true;
        if (data.config.target_jid) {
          setTargetJid(data.config.target_jid);
          try {
            localStorage.setItem('whatsapp_target_jid', data.config.target_jid);
          } catch (_) {}
        }
        if (data.config.recipient_name) {
          setRecipientName(data.config.recipient_name);
        }
        setAutoPreventive(data.config.auto_notify_preventive !== false);
        setAutoAttendance(data.config.auto_notify_attendance !== false);
        setAutoExport(data.config.auto_notify_export !== false);
      }

      if (data.pairingCode && !generatedPairingCode) {
        setGeneratedPairingCode(data.pairingCode);
      }
    } catch (err: any) {
      console.warn('Gagal load status WhatsApp:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isOpen && !isFullPage) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      hasInitializedFormRef.current = false;
      return;
    }

    loadStatus(true, true);

    // Poll status every 4 seconds while modal is open (checks connection/QR status ONLY without touching user input fields)
    pollIntervalRef.current = setInterval(() => {
      loadStatus(false, false);
    }, 4000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, isFullPage]);

  // Request connection / QR
  const handleConnect = async () => {
    setIsRefreshing(true);
    try {
      const res = await connectWhatsApp();
      setStatusData(res);
      toast.info('Menyiapkan Sesi WhatsApp...', {
        message: 'Silakan scan QR Code yang muncul atau gunakan pairing code.',
      });
    } catch (err: any) {
      toast.error('Gagal menghubungkan WhatsApp: ' + err.message);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Request Pairing Code
  const handleRequestPairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cleanPhone = phoneNumberInput.trim();
    if (!cleanPhone) {
      toast.error('Masukkan nomor WhatsApp terlebih dahulu.');
      return;
    }

    setIsRequestingCode(true);
    try {
      const res = await requestPairingCode(cleanPhone);
      setGeneratedPairingCode(res.code);
      toast.success('Kode Pairing Berhasil Dibuat!', {
        message: `Masukkan kode ${res.code} di aplikasi WhatsApp HP Anda.`,
      });
    } catch (err: any) {
      toast.error('Gagal membuat pairing code: ' + err.message);
    } finally {
      setIsRequestingCode(false);
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    if (!confirm('Apakah Anda yakin ingin memutuskan koneksi WhatsApp ini? Anda perlu scan ulang untuk menghubungkan kembali.')) {
      return;
    }

    setIsRefreshing(true);
    try {
      await disconnectWhatsApp();
      setGeneratedPairingCode(null);
      await loadStatus(false, false);
      toast.success('WhatsApp Berhasil Diputus');
    } catch (err: any) {
      toast.error('Gagal memutus WhatsApp: ' + err.message);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
      await loadStatus(false, false);
      toast.success('Pengaturan WhatsApp Tersimpan');
    } catch (err: any) {
      toast.error('Gagal menyimpan pengaturan: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Fetch groups
  const handleLoadGroups = async () => {
    setIsLoadingGroups(true);
    try {
      const list = await fetchWhatsAppGroups();
      setGroups(list);
      if (list.length > 0) {
        toast.success(`Ditemukan ${list.length} grup WhatsApp`, {
          message: 'Silakan pilih grup dari dropdown untuk mengisi JID secara otomatis.',
        });
      } else {
        toast.info('Tidak ada grup ditemukan', {
          message: 'Pastikan nomor WhatsApp Anda sudah terhubung dan telah bergabung dalam grup dinas.',
        });
      }
    } catch (err: any) {
      toast.error('Gagal memuat grup: ' + err.message);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'settings' && statusData?.status === 'connected' && groups.length === 0 && !isLoadingGroups) {
      handleLoadGroups();
    }
  }, [activeTab, statusData?.status]);

  // Send Test
  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetJid.trim()) {
      toast.error('Tentukan nomor HP atau Group JID tujuan di tab Pengaturan terlebih dahulu.');
      return;
    }

    setIsSendingTest(true);
    try {
      const res = await sendWhatsAppTest(targetJid.trim(), testMessage.trim());
      toast.success('Pesan Uji Coba Terkirim!', {
        message: res.message || `Berhasil dikirim ke ${targetJid}`,
      });
    } catch (err: any) {
      toast.error('Gagal kirim pesan tes: ' + err.message);
    } finally {
      setIsSendingTest(false);
    }
  };

  // Load Error Logs
  const handleLoadLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch('/api/logs/error/tail');
      const data = await res.json();
      if (data.lines) {
        setLogLines(data.lines);
      }
    } catch (err: any) {
      toast.error('Gagal memuat log: ' + err.message);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  if (!isOpen && !isFullPage) return null;

  const isConnected = statusData?.status === 'connected';
  const isQrReady = statusData?.status === 'qr_ready';
  const isConnecting = statusData?.status === 'connecting';

  const cardContent = (
    <div className={`bg-slate-900 border border-slate-700/80 rounded-2xl w-full ${isFullPage ? 'shadow-sm' : 'max-w-2xl shadow-2xl max-h-[92vh]'} overflow-hidden flex flex-col`}>
      {/* Modal Header */}
      <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white tracking-wide">WhatsApp Bot Gateway</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                Baileys Multi-Device
              </span>
            </div>
            <p className="text-xs text-slate-400">Koneksi langsung tanpa Docker (hemat RAM & anti-logout)</p>
          </div>
        </div>
        {onClose && !isFullPage && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

        {/* Status Bar */}
        <div className="px-5 py-3 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Status Koneksi:</span>
            {isConnected ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Terhubung ({statusData?.phoneNumber || 'Aktif'})
              </span>
            ) : isQrReady ? (
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                Menunggu Scan QR
              </span>
            ) : isConnecting ? (
              <span className="inline-flex items-center gap-1.5 text-blue-400 font-semibold px-2 py-0.5 rounded bg-blue-950/60 border border-blue-800">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Menghubungkan...
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800">
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                Terputus / Belum Login
              </span>
            )}
          </div>

          <button
            onClick={() => loadStatus(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/50 px-5 gap-2 pt-2">
          <button
            onClick={() => setActiveTab('connection')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'connection'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-4 h-4" />
            1. Sambungan (Scan/Pair)
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Save className="w-4 h-4" />
            2. Pengaturan Grup
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'test'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Send className="w-4 h-4" />
            3. Uji Coba Chat
          </button>
          <button
            onClick={() => {
              setActiveTab('logs');
              handleLoadLogs();
            }}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'logs'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            Log Error (WIB)
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: CONNECTION (SCAN / PAIRING) */}
          {activeTab === 'connection' && (
            <div className="space-y-6">
              {isConnected ? (
                <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-2xl p-6 text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/40">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">WhatsApp Bot Aktif & Terhubung!</h4>
                    <p className="text-sm text-slate-300 mt-1">
                      Nomor HP: <span className="font-mono text-emerald-300 font-semibold">{statusData?.phoneNumber}</span>
                      {statusData?.pushName ? ` (${statusData.pushName})` : ''}
                    </p>
                    {statusData?.lastConnected && (
                      <p className="text-xs text-slate-400 mt-1">Terhubung sejak: {statusData.lastConnected}</p>
                    )}
                  </div>

                  <div className="pt-2 flex justify-center gap-3">
                    <button
                      onClick={handleDisconnect}
                      className="px-4 py-2 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Putuskan Sesi (Logout)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  {/* Option A: Scan QR Code */}
                  <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5 flex flex-col items-center text-center space-y-3">
                    <div className="flex items-center gap-2 text-white font-semibold text-sm">
                      <QrCode className="w-4 h-4 text-emerald-400" />
                      <span>Cara 1: Scan QR Code</span>
                    </div>

                    <div className="w-48 h-48 bg-white p-2 rounded-xl flex items-center justify-center shadow-lg border border-slate-300">
                      {statusData?.qrDataUrl ? (
                        <img
                          src={statusData.qrDataUrl}
                          alt="WhatsApp QR Code"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="text-center p-4">
                          <RefreshCw className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-2" />
                          <p className="text-xs text-slate-600 font-medium">Memuat QR Code...</p>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 text-left leading-relaxed">
                      1. Buka <b>WhatsApp</b> di HP Anda<br />
                      2. Titik 3 (kanan atas) &gt; <b>Perangkat Tertaut</b><br />
                      3. Klik <b>Tautkan Perangkat</b> lalu arahkan kamera ke QR ini.
                    </p>

                    <button
                      onClick={handleConnect}
                      disabled={isRefreshing}
                      className="w-full mt-2 py-2 px-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      Buat / Refresh QR Code
                    </button>
                  </div>

                  {/* Option B: Pairing Code 8 Digit */}
                  <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 text-white font-semibold text-sm">
                      <KeyRound className="w-4 h-4 text-emerald-400" />
                      <span>Cara 2: Kode 8 Digit (Tanpa Kamera)</span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      Tautkan dengan nomor HP Anda. Masukkan nomor, dapatkan kode 8 digit, lalu ketik kode tersebut di WhatsApp HP.
                    </p>

                    <form onSubmit={handleRequestPairingCode} className="space-y-3">
                      <div>
                        <label className="text-xs text-slate-300 block mb-1 font-medium">Nomor WhatsApp HP:</label>
                        <input
                          type="text"
                          value={phoneNumberInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPhoneNumberInput(val);
                            try {
                              localStorage.setItem('whatsapp_phone_number_input', val);
                            } catch (_) {}
                          }}
                          placeholder="Contoh: 08123456789 atau 628..."
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isRequestingCode}
                        className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                      >
                        {isRequestingCode ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Meminta Kode...
                          </>
                        ) : (
                          <>
                            <KeyRound className="w-3.5 h-3.5" />
                            Dapatkan Kode 8 Digit
                          </>
                        )}
                      </button>
                    </form>

                    {generatedPairingCode && (
                      <div className="bg-emerald-950/50 border border-emerald-700 p-4 rounded-xl text-center space-y-2">
                        <span className="text-xs text-emerald-400 block font-medium">KODE TAUTAN ANDA:</span>
                        <div className="text-2xl font-mono font-bold tracking-widest text-white py-1">
                          {generatedPairingCode}
                        </div>
                        <p className="text-[11px] text-slate-300">
                          Buka WA di HP &gt; <b>Perangkat Tertaut</b> &gt; <b>Tautkan dengan nomor telepon saja</b> &gt; Masukkan kode di atas.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Informative Tips */}
              <div className="bg-blue-950/20 border border-blue-800/40 rounded-xl p-4 flex gap-3 text-xs text-slate-300">
                <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-blue-300">Keamanan & Sesi Multi-Device</p>
                  <p className="text-slate-400 leading-relaxed">
                    Sesi login tersimpan aman di server lokal. Sekali berhasil ditautkan, sistem akan otomatis terhubung kembali jika server restart. Anda dapat me-logout sesi ini kapan saja dari menu WhatsApp di HP.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SETTINGS */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="space-y-5">
              {/* Quick Select WhatsApp Group via Auto-Detect */}
              <div className="bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-4 space-y-3 shadow-inner">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Pilih dari Daftar Grup Saya (Auto-Detect JID)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadGroups}
                    disabled={isLoadingGroups || statusData?.status !== 'connected'}
                    className="px-3 py-1.5 bg-emerald-800/80 hover:bg-emerald-700 border border-emerald-600/70 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGroups ? 'animate-spin' : ''}`} />
                    <span>{isLoadingGroups ? 'Memuat Grup...' : 'Muat Daftar Grup'}</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Sistem membaca grup WhatsApp yang akun Anda ikuti. Pilih salah satu grup di bawah untuk mengisi JID secara instan tanpa perlu mencari ID manual.
                </p>

                {statusData?.status !== 'connected' ? (
                  <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Hubungkan WhatsApp terlebih dahulu di tab <b>Koneksi</b> agar dapat membaca daftar grup.</span>
                  </div>
                ) : groups.length > 0 ? (
                  <div className="space-y-2">
                    <label className="text-xs text-slate-300 font-medium block">
                      Daftar Grup ({groups.length} grup ditemukan):
                    </label>
                    <select
                      value={groups.some((g) => g.id === targetJid) ? targetJid : ''}
                      onChange={async (e) => {
                        const selected = groups.find((g) => g.id === e.target.value);
                        if (selected) {
                          setTargetJid(selected.id);
                          setRecipientName(selected.subject);
                          try {
                            localStorage.setItem('whatsapp_target_jid', selected.id);
                          } catch (_) {}

                          try {
                            await saveWhatsAppConfig({
                              enabled: true,
                              target_jid: selected.id,
                              recipient_name: selected.subject,
                              auto_notify_preventive: autoPreventive,
                              auto_notify_attendance: autoAttendance,
                              auto_notify_export: autoExport,
                            });
                            toast.success(`Grup "${selected.subject}" dipilih & disimpan!`, {
                              message: `Target JID server disetel ke: ${selected.id}`,
                              badge: 'WhatsApp Bot',
                            });
                          } catch (saveErr: any) {
                            toast.error('Gagal menyimpan ke server: ' + saveErr.message);
                          }
                        }
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-emerald-600/60 text-emerald-300 text-xs font-semibold focus:outline-none focus:border-emerald-400"
                    >
                      <option value="">-- Klik untuk memilih grup WhatsApp --</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id} className="bg-slate-900 text-white">
                          👥 {g.subject} ({g.participantsCount} anggota)
                        </option>
                      ))}
                    </select>

                    {targetJid.endsWith('@g.us') && (
                      <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-600/70 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-300">
                          <span className="flex items-center gap-1.5 font-medium truncate">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="truncate">Grup Terpilih: <b>{recipientName || 'Grup WhatsApp'}</b></span>
                          </span>
                          <code className="text-[10px] text-emerald-400/80 font-mono shrink-0">{targetJid}</code>
                        </div>
                        
                        <div className="flex items-center justify-end pt-1">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                toast.info('Mengirim pesan tes ke ' + (recipientName || targetJid) + '...');
                                const res = await sendWhatsAppTest(targetJid, testMessage);
                                toast.success('Pesan Tes Berhasil Masuk ke Grup!', {
                                  message: res.message || 'Cek aplikasi WhatsApp di HP Anda sekarang.',
                                  badge: 'WhatsApp Bot',
                                });
                              } catch (err: any) {
                                toast.error('Gagal kirim pesan tes: ' + err.message);
                              }
                            }}
                            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>⚡ Uji Coba Kirim Pesan ke Grup Ini Sekarang</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-400">
                    {isLoadingGroups ? 'Sedang meminta daftar grup dari WhatsApp...' : 'Klik "Muat Daftar Grup" di atas untuk mendeteksi grup akun Anda.'}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                    Nomor WhatsApp / ID Grup Penerima (JID):
                  </label>
                  <input
                    type="text"
                    value={targetJid}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTargetJid(val);
                      try {
                        localStorage.setItem('whatsapp_target_jid', val);
                      } catch (_) {}
                    }}
                    placeholder="Contoh: 08123456789 atau 120363xxxxxx@g.us"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Bisa nomor HP pribadi teknisi (contoh: <code>08123456789</code>) atau Group JID (contoh: <code>120363xxxxxx@g.us</code>).
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                    Label Nama Tujuan:
                  </label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Contoh: Grup WhatsApp Dinas Faskampen Halim"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Pilihan Notifikasi WhatsApp (Centang) */}
                <div className="pt-2 space-y-3">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Pilihan Notifikasi WhatsApp:
                  </label>

                  {/* 1. Laporan WhatsApp + Kolase Foto per Interval */}
                  <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 cursor-pointer hover:bg-slate-800/70 transition-colors">
                    <input
                      type="checkbox"
                      checked={autoPreventive}
                      onChange={(e) => setAutoPreventive(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 bg-slate-900 border-slate-600 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-semibold text-white block">
                        Laporan WhatsApp + Kolase Foto per Interval
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Izinkan pengiriman rekapitulasi laporan preventif berserta foto kolase per interval ke WhatsApp
                      </span>
                    </div>
                  </label>

                  {/* 2. Otomatis Kirim Laporan PDF */}
                  <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 cursor-pointer hover:bg-slate-800/70 transition-colors">
                    <input
                      type="checkbox"
                      checked={autoExport}
                      onChange={(e) => setAutoExport(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 bg-slate-900 border-slate-600 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-semibold text-white block">
                        Otomatis Kirim Laporan PDF (Auto-Export Shift)
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Kirim file PDF resmi shift pagi (18:00 WIB) &amp; malam (06:00 WIB) ke WhatsApp 1 jam sebelum serah terima
                      </span>
                    </div>
                  </label>

                  {/* 3. Absen Masuk dan Pulang */}
                  <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 cursor-pointer hover:bg-slate-800/70 transition-colors">
                    <input
                      type="checkbox"
                      checked={autoAttendance}
                      onChange={(e) => setAutoAttendance(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 bg-slate-900 border-slate-600 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-semibold text-white block">
                        Presensi Absen Masuk &amp; Pulang
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Kirim selfie dan catatan kehadiran teknisi ber-watermark lengkap dengan jam kerja shift ke WhatsApp
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: TEST MESSAGE */}
          {activeTab === 'test' && (
            <form onSubmit={handleSendTest} className="space-y-4">
              <div className="bg-slate-800/40 border border-slate-700/60 p-4 rounded-xl space-y-2 text-xs">
                <p className="font-semibold text-white">Target Penerima Saat Ini:</p>
                <div className="font-mono text-emerald-300 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800">
                  {targetJid || '(Belum disetel - atur di Tab 2 terlebih dahulu)'}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Isi Pesan Uji Coba:
                </label>
                <textarea
                  rows={4}
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500 leading-relaxed"
                />
              </div>

              <button
                type="submit"
                disabled={isSendingTest || !isConnected || !targetJid}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {isSendingTest ? 'Mengirim Pesan...' : 'Kirim Pesan Uji Coba Sekarang'}
              </button>

              {!isConnected && (
                <p className="text-xs text-rose-400 text-center">
                  ⚠️ Bot WhatsApp belum terhubung. Hubungkan di Tab 1 terlebih dahulu.
                </p>
              )}
            </form>
          )}

          {/* TAB 4: ERROR LOGS (JAKARTA TIME) */}
          {activeTab === 'logs' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Log Error Sistem (Waktu Indonesia Barat / Jakarta)
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    File: <code>logs/error.log</code> berformat standar <code>[YYYY-MM-DD HH:mm:ss WIB]</code>
                  </p>
                </div>
                <button
                  onClick={handleLoadLogs}
                  disabled={isLoadingLogs}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                  Muat Ulang
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-[11px] text-slate-300 max-h-72 overflow-y-auto leading-relaxed select-text">
                {logLines.length === 0 ? (
                  <p className="text-slate-500 italic text-center py-4">Belum ada catatan error tercatat. Sistem beroperasi normal.</p>
                ) : (
                  logLines.map((line, idx) => (
                    <div key={idx} className="border-b border-slate-900/60 pb-1 mb-1 last:border-0">
                      {line.includes('[ERROR]') ? (
                        <span className="text-rose-400">{line}</span>
                      ) : line.includes('[WARN]') ? (
                        <span className="text-amber-400">{line}</span>
                      ) : (
                        <span>{line}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Gateway Faskampen Halim Perdanakusuma</span>
          </div>
          {onClose && !isFullPage && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
            >
              Tutup
            </button>
          )}
        </div>
      </div>
    );

  if (isFullPage) {
    return <div className="w-full">{cardContent}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      {cardContent}
    </div>
  );
}
