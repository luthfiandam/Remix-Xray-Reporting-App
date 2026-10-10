import React, { useEffect, useRef, useState } from 'react';
import { Cloud, CheckCircle2, ShieldAlert, Terminal, Copy, Check, X } from 'lucide-react';

export interface UploadModalState {
  isOpen: boolean;
  stage: 'idle' | 'collage' | 'uploading' | 'saving' | 'complete' | 'error';
  currentPhotoIndex: number;
  totalPhotos: number;
  currentItemName?: string;
  percent: number;
  equipmentName?: string;
  equipmentCode?: string;
  errorMessage?: string;
  logs?: string[];
}

interface UploadProgressModalProps {
  state: UploadModalState;
  onClose?: () => void;
  onRetry?: () => void;
}

export const UploadProgressModal: React.FC<UploadProgressModalProps> = ({ state, onClose, onRetry }) => {
  const wakeLockRef = useRef<any>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Auto-scroll logs terminal to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [state.logs]);

  // Auto-close modal 1.6 seconds after upload completes (100% success)
  useEffect(() => {
    if (state.isOpen && state.stage === 'complete' && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, 1600);
      return () => clearTimeout(timer);
    }
  }, [state.isOpen, state.stage, onClose]);

  // Handle Copy Log
  const handleCopyLogs = () => {
    if (!state.logs || state.logs.length === 0) return;
    const fullLogText = state.logs.join('\n');
    navigator.clipboard.writeText(fullLogText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => {
      console.warn('Failed to copy logs:', err);
    });
  };

  // Screen WakeLock management: keep screen awake while upload is in progress
  useEffect(() => {
    if (!state.isOpen || state.stage === 'complete' || state.stage === 'error') {
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release();
        } catch (e) {
          // ignore
        }
        wakeLockRef.current = null;
      }
      return;
    }

    let isSubscribed = true;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          const lock = await (navigator as any).wakeLock.request('screen');
          if (isSubscribed) {
            wakeLockRef.current = lock;
            lock.addEventListener('release', () => {
              wakeLockRef.current = null;
            });
          }
        }
      } catch (err) {
        console.info('[WakeLock] Screen wake lock not acquired:', err);
      }
    };

    requestWakeLock();

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Laporan dan foto sedang diunggah. Mohon jangan menutup halaman ini.';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      isSubscribed = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release();
        } catch (e) {
          // ignore
        }
        wakeLockRef.current = null;
      }
    };
  }, [state.isOpen, state.stage]);

  if (!state.isOpen) return null;

  const logs = state.logs || [];

  return (
    <div
      id="upload-progress-overlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden p-4 sm:p-5 text-slate-800 text-center relative flex flex-col max-h-[92vh]">
        {/* Top Header Controls: Manual Close X Button */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3.5 right-3.5 p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors z-10 cursor-pointer"
            title="Tutup Modal"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Status Icon */}
        <div className="relative mx-auto w-12 h-12 mb-2 flex items-center justify-center shrink-0">
          <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
            {state.stage === 'complete' ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            ) : (
              <Cloud className="w-6 h-6 text-blue-600 animate-pulse" />
            )}
          </div>
        </div>

        {/* Equipment & Title Header */}
        <div className="mb-2 shrink-0">
          {state.equipmentName && (
            <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold mb-1">
              {state.equipmentName} {state.equipmentCode ? `(${state.equipmentCode})` : ''}
            </span>
          )}
          <h3 className="text-base font-bold text-slate-900">
            {state.stage === 'collage' && 'Membuat Kolase Foto...'}
            {state.stage === 'uploading' && 'Menyimpan Foto...'}
            {state.stage === 'saving' && 'Menyimpan Laporan...'}
            {state.stage === 'complete' && 'Laporan Berhasil Disimpan!'}
            {state.stage === 'error' && 'Terjadi Kendala Simpan'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            {state.stage === 'collage' && 'Menyiapkan lembar kolase foto WhatsApp...'}
            {state.stage === 'uploading' &&
              `Memproses foto ${state.currentPhotoIndex || 1} dari ${state.totalPhotos || 9}...`}
            {state.stage === 'saving' && 'Memperbarui status peralatan di sistem...'}
            {state.stage === 'complete' && 'Semua data dan foto telah tersimpan rapi.'}
            {state.stage === 'error' && (state.errorMessage || 'Gagal menyimpan data.')}
          </p>
        </div>

        {/* Progress Bar with Percentage */}
        <div className="my-2.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200 shrink-0">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
            <span>Progress Upload</span>
            <span className="text-blue-600 font-mono font-black">{state.percent}%</span>
          </div>

          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.max(5, state.percent)}%` }}
            />
          </div>
        </div>

        {/* LIVE TERMINAL CONSOLE LOG BOX FOR MOBILE DIAGNOSTICS */}
        <div className="mt-1 mb-3 bg-slate-950 rounded-xl border border-slate-800 p-2.5 text-left flex flex-col min-h-0 flex-1 overflow-hidden shadow-inner">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 mb-1.5 shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-300">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Live Console Log (HP Terminal)</span>
            </div>
            {logs.length > 0 && (
              <button
                type="button"
                onClick={handleCopyLogs}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                title="Copy all logs"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Tercopy!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-slate-300" />
                    <span>Copy Log</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div
            ref={logContainerRef}
            className="font-mono text-[11px] text-slate-300 space-y-1 overflow-y-auto max-h-44 sm:max-h-52 pr-1 select-text scrollbar-thin scrollbar-thumb-slate-700"
          >
            {logs.length === 0 ? (
              <p className="text-slate-500 italic text-[10px]">Menunggu respon log sistem...</p>
            ) : (
              logs.map((logLine, idx) => {
                let colorClass = 'text-slate-300';
                if (logLine.includes('[OK]') || logLine.includes('Sukses') || logLine.includes('berhasil')) {
                  colorClass = 'text-emerald-400 font-semibold';
                } else if (logLine.includes('[WARN]') || logLine.includes('Fallback') || logLine.includes('peringatan')) {
                  colorClass = 'text-amber-300 font-medium';
                } else if (logLine.includes('[ERROR]') || logLine.includes('Gagal') || logLine.includes('error')) {
                  colorClass = 'text-red-400 font-bold';
                } else if (logLine.includes('[INFO]')) {
                  colorClass = 'text-sky-300';
                }

                return (
                  <div key={idx} className={`leading-relaxed break-all ${colorClass}`}>
                    {logLine}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Anti-Close Note or Action Controls */}
        {state.stage !== 'complete' && state.stage !== 'error' ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 text-left shrink-0 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-[11px] text-amber-900 font-medium leading-tight">
                Sedang memproses upload. Mohon jangan refresh halaman.
              </p>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 bg-amber-200/80 hover:bg-amber-300 text-amber-900 rounded-lg text-[10px] font-bold transition-colors cursor-pointer shrink-0"
              >
                Tutup Log
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 w-full shrink-0">
            {state.stage === 'error' && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
              >
                Coba Lagi (Retry Upload)
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className={`${state.stage === 'error' && onRetry ? 'flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800' : 'w-full bg-slate-900 hover:bg-slate-800 text-white'} py-2 px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer`}
              >
                Tutup Modal Log
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

