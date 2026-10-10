import React, { useState, useEffect } from 'react';
import {
  Send,
  Bot,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  X,
  HelpCircle,
  Key,
  MessageSquare,
  RefreshCw,
  Bell,
  Sparkles,
  Terminal,
  Database,
  UploadCloud,
  DownloadCloud,
  Copy,
  Code,
} from 'lucide-react';
import {
  getStoredTelegramConfig,
  saveTelegramConfig,
  checkTelegramBotStatus,
  testTelegramBotConnection,
  fetchTelegramSubscribers,
  syncTelegramUpdates,
  TelegramConfig,
  parseChatIdsList,
} from '../services/telegramService';
import {
  loadAppSettingsFromSupabase,
  saveAppSettingsToSupabase,
  getAppSettingsSqlScript,
} from '../services/appSettingsService';
import { toast } from './Toast';

interface TelegramBotModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onConfigUpdated?: () => void;
  isFullPage?: boolean;
}

export const TelegramBotModal: React.FC<TelegramBotModalProps> = ({
  isOpen = true,
  onClose = () => {},
  onConfigUpdated,
  isFullPage = false,
}) => {
  const [config, setConfig] = useState<TelegramConfig>(getStoredTelegramConfig());
  const [botStatus, setBotStatus] = useState<{
    configured: boolean;
    bot_name?: string;
    bot_username?: string;
    defaultChatId?: string;
    error?: string;
  } | null>(null);

  const [, setActiveSubscribersCount] = useState<number>(0);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Load status and subscribers count on open
  useEffect(() => {
    if (isOpen || isFullPage) {
      const stored = getStoredTelegramConfig();
      setConfig(stored);
      loadStatus(stored.bot_token);
      loadSubscribersCount();
    }
  }, [isOpen, isFullPage]);

  const loadStatus = async (customToken?: string) => {
    setIsLoadingStatus(true);
    setTestResult(null);
    try {
      const status = await checkTelegramBotStatus(customToken);
      setBotStatus(status);
      if (status.serverConfig) {
        setConfig((prev) => ({
          ...prev,
          chat_id: prev.chat_id || status.serverConfig?.chat_id || '',
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
        setConfig((prev) => ({ ...prev, chat_id: status.defaultChatId || '' }));
      }
    } catch (err: any) {
      setBotStatus({ configured: false, error: err.message });
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const loadSubscribersCount = async () => {
    try {
      const res = await fetchTelegramSubscribers();
      if (res.success) {
        setActiveSubscribersCount(res.activeCount || 0);
      }
    } catch (err) {
      console.warn('Gagal memuat jumlah subscriber:', err);
    }
  };

  const handleSave = async () => {
    saveTelegramConfig(config);

    // Synchronize to Supabase app_settings table
    setIsSavingDb(true);
    try {
      const dbRes = await saveAppSettingsToSupabase({
        telegram_bot_token: config.bot_token || '',
        telegram_chat_ids: config.chat_id || '',
        telegram_enabled: config.enable_bot,
      });

      if (dbRes.success) {
        toast.success('Disimpan di Supabase DB!', {
          message: 'Pengaturan Bot Telegram & multi Target Chat ID tersimpan ke tabel app_settings.',
          badge: 'Supabase DB',
        });
      } else {
        toast.info('Tersimpan Lokal', {
          message: `Pengaturan tersimpan di browser. (Koneksi Supabase DB: ${dbRes.error || 'Tabel app_settings belum dibuat'})`,
          badge: 'Telegram',
        });
      }
    } finally {
      setIsSavingDb(false);
    }

    onConfigUpdated?.();
    onClose();
  };

  const handleLoadFromSupabaseDb = async () => {
    setIsLoadingDb(true);
    try {
      const res = await loadAppSettingsFromSupabase();
      if (res.success && res.settings) {
        const stored = getStoredTelegramConfig();
        setConfig(stored);
        toast.success('Pengaturan Dimuat Dari Supabase!', {
          message: 'Pengaturan Telegram & Chat ID berhasil diperbarui dari database Supabase.',
          badge: 'Supabase DB',
        });
        loadStatus(stored.bot_token);
      } else {
        toast.error('Gagal Memuat Dari Supabase', {
          message: res.error || 'Pastikan tabel app_settings sudah dibuat di Supabase.',
          badge: 'Supabase DB',
        });
      }
    } finally {
      setIsLoadingDb(false);
    }
  };

  const handleCopySqlScript = () => {
    navigator.clipboard.writeText(getAppSettingsSqlScript());
    toast.success('Script SQL Disalin!', {
      message: 'Script DDL app_settings tersalin ke clipboard. Jalankan di SQL Editor Supabase.',
      badge: 'SQL Script',
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testTelegramBotConnection(config.bot_token, config.chat_id);
      if (res.success) {
        setTestResult({
          success: true,
          message: res.message || 'Pesan tes berhasil terkirim ke Telegram!',
        });
        toast.success('Pesan Tes Terkirim', {
          message: `Berhasil mengirim ke target Chat ID (${(res as any).sentCount || 1} penerima).`,
          badge: 'Telegram',
        });
        loadStatus(config.bot_token);
        loadSubscribersCount();
      } else {
        setTestResult({
          success: false,
          message: res.error || 'Gagal mengirim pesan tes.',
        });
        toast.error('Tes Telegram Gagal', {
          message: res.error || 'Periksa token bot atau Chat ID.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Terjadi kesalahan saat menguji bot.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const [isDetecting, setIsDetecting] = useState(false);

  const handleDetectChatId = async () => {
    if (!config.bot_token && !botStatus?.configured) {
      toast.error('Bot Token Kosong', {
        message: 'Masukkan Bot Token Anda terlebih dahulu.',
        badge: 'Telegram',
      });
      return;
    }
    setIsDetecting(true);
    try {
      const res = await syncTelegramUpdates(config.bot_token);
      if (res.success && res.subscribers && res.subscribers.length > 0) {
        const latest = res.subscribers[res.subscribers.length - 1];
        const existingList = parseChatIdsList(config.chat_id);
        if (!existingList.includes(String(latest.chat_id))) {
          existingList.push(String(latest.chat_id));
        }
        const updatedChatIdStr = existingList.join(', ');
        setConfig((prev) => ({ ...prev, chat_id: updatedChatIdStr }));
        setActiveSubscribersCount(res.totalSubscribers || res.subscribers.length);
        toast.success('Chat ID Terdeteksi!', {
          message: `Ditambahkan: ${latest.chat_id} (${latest.name || latest.username || 'Pengguna'}).`,
          badge: 'Telegram',
        });
      } else {
        toast.info('Belum Ada Pesan Masuk', {
          message: `Buka bot @${botStatus?.bot_username || 'Anda'} di Telegram, klik START / kirim pesan, lalu klik Deteksi lagi.`,
          badge: 'Telegram',
        });
      }
    } catch (err: any) {
      toast.error('Gagal Mendeteksi', {
        message: err.message || 'Pastikan Bot Token valid dan Anda sudah menekan /start di bot.',
        badge: 'Telegram',
      });
    } finally {
      setIsDetecting(false);
    }
  };

  const targetIdsArray = parseChatIdsList(config.chat_id);

  if (!isOpen && !isFullPage) return null;

  const cardContent = (
    <div className={`bg-white rounded-2xl w-full ${isFullPage ? 'border border-slate-200 shadow-sm' : 'shadow-2xl border border-slate-200 max-w-xl max-h-[92vh]'} overflow-hidden flex flex-col`}>
      {/* Header */}
      <div className="bg-slate-900 p-5 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
            <Send className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <span>Pengaturan Telegram Bot & Supabase DB</span>
            </h2>
            <p className="text-xs text-slate-400 font-medium">
              Siaran Daily Briefing, notifikasi kerusakan &amp; simpan pengaturan di Supabase
            </p>
          </div>
        </div>
        {onClose && !isFullPage && (
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Supabase DB Sync Actions Header */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
              <Database className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Penyimpanan Database Supabase (`app_settings`)</span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleLoadFromSupabaseDb}
                disabled={isLoadingDb}
                title="Muat nilai terbaru dari tabel app_settings di Supabase"
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
              >
                <DownloadCloud className={`w-3.5 h-3.5 text-blue-600 ${isLoadingDb ? 'animate-bounce' : ''}`} />
                <span>{isLoadingDb ? 'Memuat...' : 'Muat DB'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSqlModal(!showSqlModal)}
                title="Lihat script SQL untuk membuat tabel app_settings"
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1 transition cursor-pointer"
              >
                <Code className="w-3.5 h-3.5 text-amber-600" />
                <span>Script SQL</span>
              </button>
            </div>
          </div>

          {/* DDL SQL Script Accordion Box */}
          {showSqlModal && (
            <div className="p-3.5 bg-slate-900 text-slate-100 rounded-xl space-y-2 text-xs font-mono border border-slate-800">
              <div className="flex items-center justify-between font-sans">
                <span className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4" />
                  <span>Script DDL Tabel `app_settings` Supabase</span>
                </span>
                <button
                  onClick={handleCopySqlScript}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Salin SQL</span>
                </button>
              </div>
              <pre className="text-[10px] leading-relaxed overflow-x-auto text-emerald-400 p-2 bg-slate-950 rounded border border-slate-800">
                {getAppSettingsSqlScript()}
              </pre>
              <p className="text-[10px] text-slate-400 font-sans leading-normal">
                Buka <strong>Supabase Dashboard &gt; SQL Editor</strong>, tempelkan skrip di atas lalu klik <strong>Run</strong> untuk membuat tabel tempat menyimpan token &amp; chat ID.
              </p>
            </div>
          )}

          {/* Bot Connection Banner */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  botStatus?.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                }`}
              >
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {botStatus?.bot_name ? botStatus.bot_name : 'Status Telegram Bot'}
                  </span>
                  {botStatus?.configured ? (
                    <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-bold text-[11px]">
                      <CheckCircle2 className="w-3 h-3" /> Terhubung
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-bold text-[11px]">
                      <AlertTriangle className="w-3 h-3" /> Belum Terhubung
                    </span>
                  )}
                </div>
                {botStatus?.configured && botStatus.bot_username && (
                  <div className="text-[11px] text-slate-600 font-medium mt-0.5 flex items-center gap-1.5">
                    <span>Username:</span>
                    <a
                      href={`https://t.me/${botStatus.bot_username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline font-bold inline-flex items-center gap-1"
                    >
                      @{botStatus.bot_username}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
                {botStatus?.error && !botStatus.configured && (
                  <div className="text-[11px] text-red-600 mt-0.5">{botStatus.error}</div>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                loadStatus(config.bot_token);
                loadSubscribersCount();
              }}
              disabled={isLoadingStatus}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs shrink-0"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingStatus ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Form Credentials */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-blue-600" />
                  <span>Bot Token (Telegram API)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowHelp(!showHelp)}
                  className="text-blue-600 hover:text-blue-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle className="w-3 h-3" />
                  <span>{showHelp ? 'Tutup Panduan' : 'Cara Dapat Token?'}</span>
                </button>
              </div>
              <input
                type="text"
                value={config.bot_token || ''}
                onChange={(e) => setConfig({ ...config, bot_token: e.target.value.trim() })}
                placeholder="cth: 123456789:AAFlmQ9xVvB9..."
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Token bot resmi dari @BotFather. Disimpan di Supabase DB tabel <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">app_settings</code>.
              </p>
            </div>

            {/* Step-by-step Help Accordion */}
            {showHelp && (
              <div className="p-4 bg-sky-50/70 border border-sky-200 rounded-xl space-y-2 text-sky-950 animate-in fade-in duration-150">
                <div className="font-extrabold text-sky-900 flex items-center gap-1.5 text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                  <span>Langkah Cepat Membuat Bot Telegram:</span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-[11px] leading-relaxed text-sky-900/90 pl-1">
                  <li>
                    Buka Telegram dan cari bot resmi <b>@BotFather</b>.
                  </li>
                  <li>
                    Ketik perintah <code>/newbot</code>, tentukan nama tampilan bot lalu buat username berakhiran <code>bot</code>.
                  </li>
                  <li>
                    Salin <b>HTTP API Token</b> yang diberikan lalu tempelkan pada kolom di atas.
                  </li>
                  <li>
                    Selesai! Pengguna atau grup cukup membuka bot Anda dan mengetik <code>/start</code>.
                  </li>
                </ol>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                  <span>Target Chat ID Penerima (Bisa Lebih Dari 1)</span>
                </label>
                <button
                  type="button"
                  onClick={handleDetectChatId}
                  disabled={isDetecting || (!config.bot_token && !botStatus?.configured)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-lg flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                  title="Deteksi Chat ID otomatis dari pengguna yang menekan START di bot"
                >
                  <RefreshCw className={`w-3 h-3 ${isDetecting ? 'animate-spin' : ''}`} />
                  <span>{isDetecting ? 'Mendeteksi...' : 'Deteksi Chat ID Otomatis'}</span>
                </button>
              </div>

              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={config.chat_id}
                  onChange={(e) => setConfig({ ...config, chat_id: e.target.value })}
                  placeholder="Bisa lebih dari 1 chat ID (pisahkan dengan koma atau baris baru), cth: -100123456789, -100987654321, 12345678"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all resize-none"
                />
              </div>

              {/* Multi Chat Target Chips Preview */}
              {targetIdsArray.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-semibold text-slate-500">Penerima Siaran ({targetIdsArray.length} Target):</span>
                  {targetIdsArray.map((id, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-md text-[11px] font-mono font-bold flex items-center gap-1"
                    >
                      <span>🎯 {id}</span>
                    </span>
                  ))}
                </div>
              )}

              <p className="text-[10px] text-slate-500 mt-1">
                Dapat memasukkan <strong>banyak Chat ID sekaligus</strong> (pisahkan dengan koma/spasi). Notifikasi akan disiarkan ke seluruh penerima terdaftar.
              </p>
            </div>

            {/* Automation Toggles */}
            <div className="pt-2 border-t border-slate-200/80 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.enable_bot}
                  onChange={(e) => setConfig({ ...config, enable_bot: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <Bell className="w-3.5 h-3.5 text-blue-600" />
                  <span>Aktifkan Bot Telegram &amp; Notifikasi Otomatis</span>
                </div>
              </label>
            </div>
          </div>

          {/* Test Box Result */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <span className="font-bold">{testResult.success ? 'Berhasil!' : 'Gagal:'}</span>
                <p className="text-[11px] leading-relaxed">{testResult.message}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
            <span>{isTesting ? 'Menguji...' : 'Kirim Pesan Tes'}</span>
          </button>

          <div className="flex items-center gap-2">
            {onClose && !isFullPage && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Batal
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSavingDb}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm flex items-center gap-1.5 disabled:opacity-60"
            >
              <UploadCloud className={`w-3.5 h-3.5 text-emerald-400 ${isSavingDb ? 'animate-bounce' : ''}`} />
              <span>{isSavingDb ? 'Menyimpan...' : 'Simpan Ke Supabase DB'}</span>
            </button>
          </div>
        </div>
      </div>
    );

  if (isFullPage) {
    return <div className="w-full">{cardContent}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      {cardContent}
    </div>
  );
};
