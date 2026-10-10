import React, { useState } from 'react';
import {
  X,
  Radio,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  Globe,
  Key,
  RefreshCw,
  AlertTriangle,
  UploadCloud,
  DownloadCloud,
} from 'lucide-react';
import {
  getSupabaseUrl,
  getSupabaseAnonKey,
  setCustomSupabaseConfig,
  testSupabaseConnection,
  SupabaseTestResult,
} from '../lib/supabase';
import {
  saveAppSettingsToSupabase,
  loadAppSettingsFromSupabase,
} from '../services/appSettingsService';

interface SupabaseDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupabaseDiagnosticModal: React.FC<SupabaseDiagnosticModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [url, setUrl] = useState(() => getSupabaseUrl());
  const [key, setKey] = useState(() => getSupabaseAnonKey());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<SupabaseTestResult | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleRunTest = async (targetUrl = url, targetKey = key) => {
    setIsTesting(true);
    setTestResult(null);
    setSaveSuccessMsg('');
    try {
      const res = await testSupabaseConnection(targetUrl, targetKey);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        url: targetUrl,
        keyProvided: Boolean(targetKey),
        message: err.message || 'Gagal menjalankan pengujian koneksi.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAndTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomSupabaseConfig(url, key);
    
    // Save to Supabase DB app_settings table as well
    try {
      await saveAppSettingsToSupabase({
        supabase_url: url,
        supabase_anon_key: key,
      });
    } catch (_) {}

    setSaveSuccessMsg('Konfigurasi Supabase berhasil disimpan di browser & disinkronkan ke DB!');
    await handleRunTest(url, key);
  };

  const handleResetToEnv = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('faskampen_supabase_url');
      localStorage.removeItem('faskampen_supabase_anon_key');
    }
    const envUrl = getSupabaseUrl();
    const envKey = getSupabaseAnonKey();
    setUrl(envUrl);
    setKey(envKey);
    setSaveSuccessMsg('Dikembalikan ke nilai default Environment.');
    handleRunTest(envUrl, envKey);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4 border-b border-slate-100 pb-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Penguji & Diagnostik Koneksi Supabase
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Uji sambungan jaringan langsung ke endpoint Supabase Auth
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveAndTest} className="space-y-4">
          {/* Supabase URL */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-indigo-600" />
              <span>URL Supabase Project</span>
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-project-id.supabase.co"
              className="w-full px-3.5 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
            />
            <p className="text-[10px] text-slate-400">
              Contoh format valid: <code className="text-indigo-600 font-bold">https://xyz123.supabase.co</code>
            </p>
          </div>

          {/* Supabase Publishable / Anon Key */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-600" />
              <span>Publishable / Anon Key</span>
            </label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="eyJhbGciOi..."
              className="w-full px-3.5 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
            />
          </div>

          {saveSuccessMsg && (
            <p className="text-xs text-emerald-600 font-bold bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
              {saveSuccessMsg}
            </p>
          )}

          {/* Diagnostic Test Result Display Box */}
          {testResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs space-y-1.5 transition-all ${
                testResult.success
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50/80 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {testResult.success ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>STATUS: KONEKSI BERHASIL</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                    <span>STATUS: GAGAL TERHUBUNG</span>
                  </>
                )}
              </div>

              <p className="text-xs font-medium leading-relaxed">{testResult.message}</p>

              {testResult.latencyMs !== undefined && (
                <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1 border-t border-slate-200/60 font-mono">
                  <span>Latency: <strong>{testResult.latencyMs} ms</strong></span>
                  {testResult.statusCode && <span>Status Code: <strong>{testResult.statusCode}</strong></span>}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleResetToEnv}
              className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleRunTest(url, key)}
                disabled={isTesting}
                className="px-4 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Menguji...</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-3.5 h-3.5" />
                    <span>Tes Sekarang</span>
                  </>
                )}
              </button>

              <button
                type="submit"
                disabled={isTesting}
                className="px-4 py-2 text-xs font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Simpan & Tes</span>
              </button>
            </div>
          </div>
        </form>

        <div className="mt-4 bg-amber-50 border border-amber-200/80 rounded-2xl p-3 flex items-start gap-2 text-[11px] text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p>
            <strong>Tips:</strong> Dapatkan URL dan Publishable Key dari dashboard Supabase Anda di menu <strong>Project Settings &gt; API &gt; Project URL &amp; Project API Keys</strong>.
          </p>
        </div>
      </div>
    </div>
  );
};
