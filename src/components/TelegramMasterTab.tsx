import React, { useState, useEffect } from 'react';
import {
  Send,
  Bot,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Key,
  MessageSquare,
  RefreshCw,
  Bell,
  Users,
  Radio,
  Check,
  Eye,
  EyeOff,
  Save,
  HelpCircle,
  ShieldCheck,
  Activity,
  Trash2,
  Sliders,
  SendHorizontal,
  Zap,
} from 'lucide-react';
import {
  getStoredTelegramConfig,
  saveTelegramConfig,
  checkTelegramBotStatus,
  testTelegramBotConnection,
  fetchTelegramSubscribers,
  syncTelegramUpdates,
  deleteTelegramSubscriber,
  TelegramConfig,
  TelegramSubscriber,
} from '../services/telegramService';
import { Toast, toast } from './Toast';

export const TelegramMasterTab: React.FC = () => {
  const [config, setConfig] = useState<TelegramConfig>(getStoredTelegramConfig());
  const [showToken, setShowToken] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(false);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(false);

  const [botStatus, setBotStatus] = useState<{
    configured: boolean;
    bot_name?: string;
    bot_username?: string;
    defaultChatId?: string;
    error?: string;
    serverConfig?: any;
  } | null>(null);

  const [subscribers, setSubscribers] = useState<TelegramSubscriber[]>([]);
  const [isLoadingSubscribers, setIsLoadingSubscribers] = useState<boolean>(false);

  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    timestamp?: string;
  } | null>(null);

  // In-app Toast local state
  const [toastMessage, setToastMessage] = useState<string>('');
  const [showLocalToast, setShowLocalToast] = useState<boolean>(false);

  const triggerLocalToast = (msg: string) => {
    setToastMessage(msg);
    setShowLocalToast(true);
  };

  useEffect(() => {
    const stored = getStoredTelegramConfig();
    // Enforce default chat_id if not present
    if (!stored.chat_id) {
      stored.chat_id = '-5531204015';
    }
    setConfig(stored);
    loadStatus(stored.bot_token);
    loadSubscribers();
  }, []);

  const loadStatus = async (customToken?: string) => {
    setIsLoadingStatus(true);
    setTestResult(null);
    try {
      const status = await checkTelegramBotStatus(customToken);
      setBotStatus(status);
      if (status.serverConfig) {
        setConfig((prev) => ({
          ...prev,
          chat_id: prev.chat_id || status.serverConfig?.chat_id || '-5531204015',
          broadcast_to_all_subscribers:
            status.serverConfig?.broadcast_to_all_subscribers !== undefined
              ? status.serverConfig.broadcast_to_all_subscribers
              : prev.broadcast_to_all_subscribers,
          auto_notify_corrective:
            status.serverConfig?.auto_notify_corrective !== undefined
              ? status.serverConfig.auto_notify_corrective
              : prev.auto_notify_corrective,
          auto_notify_recurring_fault:
            status.serverConfig?.auto_notify_recurring_fault !== undefined
              ? status.serverConfig.auto_notify_recurring_fault
              : prev.auto_notify_recurring_fault,
        }));
      } else if (!config.chat_id && status.defaultChatId) {
        setConfig((prev) => ({ ...prev, chat_id: status.defaultChatId || '-5531204015' }));
      }
    } catch (err: any) {
      setBotStatus({ configured: false, error: err.message });
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const loadSubscribers = async () => {
    setIsLoadingSubscribers(true);
    try {
      const res = await fetchTelegramSubscribers();
      if (res.success && res.subscribers) {
        setSubscribers(res.subscribers);
      }
    } catch (err) {
      console.warn('Gagal memuat data subscriber:', err);
    } finally {
      setIsLoadingSubscribers(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      saveTelegramConfig(config);
      triggerLocalToast('Pengaturan Telegram berhasil disimpan dan disinkronkan ke server!');
      toast.success('Pengaturan Disimpan', {
        message: 'Token bot, Target Chat ID, dan pengaturan siaran berhasil diperbarui.',
        badge: 'Telegram',
      });
      await loadStatus(config.bot_token);
    } catch (err: any) {
      triggerLocalToast('Gagal menyimpan pengaturan: ' + (err.message || 'Error'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config.bot_token && !botStatus?.configured) {
      triggerLocalToast('Masukkan Bot Token terlebih dahulu!');
      return;
    }
    const targetChat = config.chat_id || '-5531204015';
    if (!targetChat) {
      triggerLocalToast('Masukkan Target Chat ID terlebih dahulu!');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testTelegramBotConnection(config.bot_token, targetChat);
      const timestamp = new Date().toLocaleTimeString('id-ID');
      if (res.success) {
        setTestResult({
          success: true,
          message: res.message || `Pesan tes berhasil terkirim ke target Chat ID ${targetChat}!`,
          timestamp,
        });
        triggerLocalToast('Pesan tes berhasil dikirim ke Telegram!');
        toast.success('Tes Telegram Berhasil', {
          message: `Pesan tes telah terkirim ke target Chat ID ${targetChat}.`,
          badge: 'Telegram',
        });
        loadStatus(config.bot_token);
        loadSubscribers();
      } else {
        setTestResult({
          success: false,
          message: res.error || 'Gagal mengirim pesan tes ke Telegram.',
          timestamp,
        });
        triggerLocalToast('Gagal mengirim pesan tes: ' + (res.error || 'Periksa token/chat ID'));
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Terjadi kesalahan jaringan saat menguji koneksi.',
        timestamp: new Date().toLocaleTimeString('id-ID'),
      });
      triggerLocalToast('Kesalahan pengujian bot: ' + err.message);
    } finally {
      setIsTesting(false);
    }
  };

  const handleDetectChatId = async () => {
    if (!config.bot_token && !botStatus?.configured) {
      triggerLocalToast('Masukkan Bot Token Anda terlebih dahulu!');
      return;
    }
    setIsDetecting(true);
    try {
      const res = await syncTelegramUpdates(config.bot_token);
      if (res.success && res.subscribers && res.subscribers.length > 0) {
        const latest = res.subscribers[res.subscribers.length - 1];
        setConfig((prev) => ({ ...prev, chat_id: String(latest.chat_id) }));
        setSubscribers(res.subscribers);
        triggerLocalToast(`Chat ID terdeteksi: ${latest.chat_id} (${latest.name || 'Pengguna'})`);
      } else {
        triggerLocalToast('Belum ada pesan masuk di bot. Kirim /start ke bot di Telegram lalu coba lagi.');
      }
    } catch (err: any) {
      triggerLocalToast('Gagal mendeteksi: ' + (err.message || 'Error'));
    } finally {
      setIsDetecting(false);
    }
  };

  const handleDeleteSubscriber = async (chatId: string) => {
    if (!confirm(`Hapus subscriber dengan Chat ID ${chatId}?`)) return;
    try {
      const res = await deleteTelegramSubscriber(chatId);
      if (res.success) {
        setSubscribers(res.subscribers || []);
        triggerLocalToast(`Subscriber ${chatId} berhasil dihapus.`);
      }
    } catch (err: any) {
      triggerLocalToast('Gagal menghapus subscriber: ' + err.message);
    }
  };

  const isConfigured = Boolean(botStatus?.configured);

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <Toast
        show={showLocalToast}
        message={toastMessage}
        onClose={() => setShowLocalToast(false)}
      />

      {/* Top Banner / Status Overview Card */}
      <div className="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-700 rounded-2xl p-5 text-white shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/25 shadow-xs shrink-0">
              <Send className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-white">
                  Pengaturan Telegram Bot &amp; Notifikasi
                </h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/20 border border-white/30 text-white">
                  FASKAMPEN SEC-OPS
                </span>
                {isConfigured ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-400/25 border border-emerald-300/40 text-emerald-100">
                    <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                    Aktif &amp; Terhubung
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-400/25 border border-amber-300/40 text-amber-100">
                    <AlertTriangle className="w-3 h-3 text-amber-300" />
                    Belum Dikonfigurasi
                  </span>
                )}
              </div>
              <p className="text-xs text-sky-100/90 mt-1 font-medium leading-relaxed max-w-2xl">
                Kelola kredensial Bot Token, Target Chat ID penerima laporan (<code className="font-mono bg-white/20 px-1 py-0.2 rounded text-white font-bold">-5531204015</code>), dan pengaturan otomatisasi siaran status operasional.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-center shrink-0">
            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/15 hover:bg-white/25 text-white text-xs font-bold rounded-xl border border-white/20 transition cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{showGuide ? 'Tutup Panduan' : 'Panduan Bot'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                loadStatus(config.bot_token);
                loadSubscribers();
              }}
              disabled={isLoadingStatus}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/15 hover:bg-white/25 text-white text-xs font-bold rounded-xl border border-white/20 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
              <span>Cek Status</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-100 text-blue-700 text-xs font-black rounded-xl shadow-xs transition cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Guide Panel (Collapsible) */}
      {showGuide && (
        <div className="bg-sky-50 border border-sky-200/90 rounded-2xl p-4 sm:p-5 text-slate-800 text-xs shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-sky-950 flex items-center gap-2">
              <Bot className="w-4 h-4 text-sky-600" />
              Panduan Menghubungkan Bot Telegram ke Sistem FASKAMPEN
            </h3>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="text-slate-400 hover:text-slate-700 font-bold"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs leading-relaxed text-slate-700">
            <div className="bg-white p-3 rounded-xl border border-sky-100 space-y-1">
              <span className="font-extrabold text-sky-800 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[10px] font-black">1</span>
                Buat Bot via @BotFather
              </span>
              <p className="text-[11px] text-slate-600">
                Buka Telegram, cari <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-600 font-bold underline">@BotFather</a>, kirim <code className="bg-slate-100 px-1 rounded">/newbot</code>. Ikuti instruksi hingga mendapatkan <b>HTTP API Token</b>.
              </p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-sky-100 space-y-1">
              <span className="font-extrabold text-sky-800 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[10px] font-black">2</span>
                Masukkan Token &amp; Chat ID
              </span>
              <p className="text-[11px] text-slate-600">
                Salin token ke kolom <b>Bot Token</b>. Target Chat ID telah diset otomatis ke <code className="bg-slate-100 px-1 rounded font-bold text-sky-800">-5531204015</code>.
              </p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-sky-100 space-y-1">
              <span className="font-extrabold text-sky-800 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[10px] font-black">3</span>
                Undang Bot ke Grup
              </span>
              <p className="text-[11px] text-slate-600">
                Masukkan bot ke grup Telegram tujuan, jadikan admin, lalu tekan tombol <b>Kirim Pesan Tes</b> di bawah untuk memastikan pesan terkirim.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Form Settings & Info Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Form Settings (8 Cols) */}
        <div className="lg:col-span-8 space-y-5">
          {/* Card 1: Kredensial Bot & Target Chat ID */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Key className="w-4 h-4 text-blue-600" />
                <span>Kredensial Bot &amp; Target Penerima</span>
              </h3>
              <span className="text-[11px] font-semibold text-slate-500">
                Wajib diisi untuk aktivasi bot
              </span>
            </div>

            {/* Bot Token Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <span>Telegram Bot Token (HTTP API Code)</span>
                  <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                >
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showToken ? 'Sembunyikan Token' : 'Lihat Token'}</span>
                </button>
              </div>

              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={config.bot_token || ''}
                  onChange={(e) => setConfig({ ...config, bot_token: e.target.value.trim() })}
                  placeholder="Contoh: 7891234567:AAHxyz_AbC12345DefGhIjkLmNoPqRsTuVw"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Token resmi yang diberikan oleh <span className="font-semibold text-slate-700">@BotFather</span> saat pendaftaran bot baru.
              </p>

              {/* Bot Profile Status Card if connected */}
              {isConfigured && botStatus && (
                <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200/90 rounded-xl flex items-center justify-between text-xs text-emerald-900">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-200 text-emerald-800 flex items-center justify-center font-black shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-extrabold text-emerald-950 flex items-center gap-1.5">
                        <span>{botStatus.bot_name || 'Bot Terhubung'}</span>
                        {botStatus.bot_username && (
                          <a
                            href={`https://t.me/${botStatus.bot_username}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 hover:underline font-bold inline-flex items-center gap-0.5"
                          >
                            (@{botStatus.bot_username})
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      <p className="text-[11px] text-emerald-700 font-medium">
                        Bot siap menerima perintah (/alat, /brief, /history) dan mengirimkan notifikasi.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Target Chat ID Field */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                  <span>Target Chat ID Penerima Laporan</span>
                  <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, chat_id: '-5531204015' })}
                    className="text-[11px] text-blue-600 hover:text-blue-800 font-bold cursor-pointer"
                  >
                    Reset ke -5531204015
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={handleDetectChatId}
                    disabled={isDetecting}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isDetecting ? 'animate-spin' : ''}`} />
                    <span>{isDetecting ? 'Mendeteksi...' : 'Deteksi Otomatis'}</span>
                  </button>
                </div>
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={config.chat_id || ''}
                  onChange={(e) => setConfig({ ...config, chat_id: e.target.value.trim() })}
                  placeholder="-5531204015"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-[11px] text-slate-500">
                  Target Chat ID yang dikonfigurasikan: <span className="font-bold text-slate-800">-5531204015</span> (Chat ID grup/channel Telegram diawali tanda minus <code className="font-mono bg-slate-100 px-1 rounded">-</code>).
                </p>
                {config.chat_id === '-5531204015' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                    <Check className="w-3 h-3" /> Target Chat ID Utama Aktif
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Pengaturan Notifikasi & Otomasi */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <span>Pengaturan Notifikasi &amp; Fitur Bot</span>
              </h3>
              <span className="text-[11px] font-semibold text-slate-500">
                Otomasi siaran real-time
              </span>
            </div>

            <div className="space-y-3">
              {/* Master Bot Toggle */}
              <div className="p-3.5 bg-slate-50/80 hover:bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 transition">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-slate-900">
                      Aktifkan Integrasi Bot Telegram
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800">
                      Master Switch
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Mengaktifkan layanan listener webhook / background polling dan respon perintah otomatis.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.enable_bot ?? true}
                    onChange={(e) => setConfig({ ...config, enable_bot: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Mode Siaran (Broadcast) */}
              <div className="p-3.5 bg-slate-50/80 hover:bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 transition">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Mode Siaran ke Semua Subscriber Terdaftar
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-sky-100 text-sky-800">
                      Multi-Broadcast
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Jika aktif, setiap briefing &amp; alert dikirim ke Target Chat ID utama (<code className="font-mono text-slate-700">{config.chat_id || '-5531204015'}</code>) serta seluruh akun/grup yang pernah menekan tombol /daftar.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.broadcast_to_all_subscribers ?? true}
                    onChange={(e) => setConfig({ ...config, broadcast_to_all_subscribers: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Auto Alert Corrective */}
              <div className="p-3.5 bg-slate-50/80 hover:bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 transition">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Notifikasi Otomatis Tiket Kerusakan (Corrective)
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800">
                      Real-time Alert
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Kirim pesan seketika ke Telegram saat teknisi membuat tiket kerusakan baru atau menyelesaikan perbaikan unit.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.auto_notify_corrective ?? true}
                    onChange={(e) => setConfig({ ...config, auto_notify_corrective: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Auto Alert Recurring Faults */}
              <div className="p-3.5 bg-slate-50/80 hover:bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 transition">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Peringatan Kerusakan Berulang (Recurring Faults)
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                      High Priority
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Kirim notifikasi peringatan khusus jika satu unit mesin mengalami kerusakan lebih dari 2 kali dalam 30 hari terakhir.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.auto_notify_recurring_fault ?? true}
                    onChange={(e) => setConfig({ ...config, auto_notify_recurring_fault: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Auto Alert Preventive & Daily Briefing */}
              <div className="p-3.5 bg-slate-50/80 hover:bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 transition">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Notifikasi Daily Briefing &amp; Pergantian Shift
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Siarkan ringkasan kesiapan operasional seluruh alat dan daftar personel jaga saat pergantian shift dimulai.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.auto_notify_preventive ?? true}
                    onChange={(e) => setConfig({ ...config, auto_notify_preventive: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Auto Alert Attendance with Photo */}
              <div className="p-3.5 bg-slate-50/80 hover:bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 transition">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Notifikasi Presensi &amp; Foto Absen (Masuk / Pulang)
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                      Selfie &amp; Jam
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Kirim pesan notifikasi real-time beserta foto selfie verifikasi dan jam presensi saat teknisi melakukan absen masuk atau pulang.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.auto_notify_attendance ?? true}
                    onChange={(e) => setConfig({ ...config, auto_notify_attendance: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Konfigurasi tersimpan otomatis ke penyimpanan lokal dan file konfigurasi server.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                <SendHorizontal className={`w-3.5 h-3.5 ${isTesting ? 'animate-bounce' : ''}`} />
                <span>{isTesting ? 'Mengirim Tes...' : 'Kirim Pesan Tes'}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-xs transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Menyimpan...' : 'Simpan Semua Pengaturan'}</span>
              </button>
            </div>
          </div>

          {/* Test Result Alert Banner */}
          {testResult && (
            <div
              className={`p-4 rounded-2xl border text-xs leading-relaxed flex items-start gap-3 shadow-xs ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between font-bold">
                  <span>{testResult.success ? 'Koneksi Telegram Berhasil' : 'Uji Coba Gagal'}</span>
                  {testResult.timestamp && (
                    <span className="text-[10px] font-mono text-slate-500">{testResult.timestamp}</span>
                  )}
                </div>
                <p className="text-[11px]">{testResult.message}</p>
                {!testResult.success && (
                  <p className="text-[10px] text-rose-700 font-medium pt-1">
                    Saran: Pastikan Bot Token valid dari @BotFather, bot sudah diundang ke grup target <code className="font-bold">-5531204015</code>, dan bot memiliki izin mengirim pesan.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Subscribers & Quick Info (4 Cols) */}
        <div className="lg:col-span-4 space-y-5">
          {/* Card: Subscriber & Target Overview */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" />
                <span>Penerima &amp; Subscriber ({subscribers.length})</span>
              </h3>
              <button
                type="button"
                onClick={loadSubscribers}
                disabled={isLoadingSubscribers}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingSubscribers ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {/* Target Utama Card */}
            <div className="p-3 bg-blue-50/80 border border-blue-200/80 rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800">
                  Target Chat ID Utama
                </span>
                <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-blue-200 text-blue-900">
                  Default Target
                </span>
              </div>
              <div className="text-sm font-mono font-black text-blue-950">
                {config.chat_id || '-5531204015'}
              </div>
              <p className="text-[10px] text-blue-700">
                Target utama pengiriman laporan shift, form corrective, dan alarm recurring.
              </p>
            </div>

            {/* List of Registered Subscribers */}
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {isLoadingSubscribers ? (
                <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Memuat daftar subscriber...</span>
                </div>
              ) : subscribers.length === 0 ? (
                <div className="p-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-500 text-xs">
                  <p className="font-medium">Belum ada subscriber terdaftar.</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Pengguna atau grup yang mengirim <code className="font-bold">/daftar</code> ke bot akan muncul di sini otomatis.
                  </p>
                </div>
              ) : (
                subscribers.map((sub) => {
                  const isPrimaryTarget = sub.chat_id === (config.chat_id || '-5531204015');
                  return (
                    <div
                      key={sub.chat_id}
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 transition ${
                        isPrimaryTarget
                          ? 'bg-blue-50/50 border-blue-200 text-blue-950'
                          : 'bg-slate-50/80 hover:bg-slate-50 border-slate-200/80 text-slate-800'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold truncate text-slate-900">{sub.name || 'Pengguna'}</span>
                          {isPrimaryTarget && (
                            <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-blue-600 text-white shrink-0">
                              UTAMA
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                          <span>ID: {sub.chat_id}</span>
                          <span>•</span>
                          <span className="capitalize">{sub.type}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSubscriber(sub.chat_id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                        title="Hapus subscriber"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Commands Reference Card */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Perintah Bot Telegram</span>
            </h4>
            <div className="space-y-1.5 text-xs">
              <div className="p-2 rounded-lg bg-slate-50 font-mono text-[11px] text-slate-700 flex items-center justify-between">
                <span className="font-bold text-blue-600">/alat</span>
                <span className="text-[10px] text-slate-500 font-sans">Cek kesiapan alat realtime</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 font-mono text-[11px] text-slate-700 flex items-center justify-between">
                <span className="font-bold text-blue-600">/brief</span>
                <span className="text-[10px] text-slate-500 font-sans">Ringkasan shift &amp; teknisi</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 font-mono text-[11px] text-slate-700 flex items-center justify-between">
                <span className="font-bold text-blue-600">/history</span>
                <span className="text-[10px] text-slate-500 font-sans">Daftar riwayat kerusakan</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 font-mono text-[11px] text-slate-700 flex items-center justify-between">
                <span className="font-bold text-blue-600">/jadwal</span>
                <span className="text-[10px] text-slate-500 font-sans">Jadwal harian / mingguan</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 font-mono text-[11px] text-slate-700 flex items-center justify-between">
                <span className="font-bold text-blue-600">/daftar</span>
                <span className="text-[10px] text-slate-500 font-sans">Registrasi otomatis ID</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
