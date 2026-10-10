import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Cloud,
  Clock,
  Download,
  Trash2,
  RotateCcw,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
  FileJson,
  Upload,
  HardDrive,
  ShieldCheck,
  Zap,
  LogIn,
  LogOut,
  Copy,
  Check,
} from 'lucide-react';
import {
  fetchBackupList,
  triggerManualBackup,
  getBackupDownloadUrl,
  deleteBackupFile,
  restoreBackupData,
  BackupItem,
} from '../services/backupService';
import {
  getGDriveState,
  connectGoogleDriveAccount,
  disconnectGoogleDriveAccount,
  saveManualGDriveToken,
  saveGasWebhookUrl,
  GDriveConnectionState,
} from '../services/googleDriveService';
import { toast } from './Toast';

interface BackupManagerModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  currentUserProfile?: any;
  isFullPage?: boolean;
}

export const BackupManagerModal: React.FC<BackupManagerModalProps> = ({
  isOpen = true,
  onClose = () => {},
  currentUserProfile,
  isFullPage = false,
}) => {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [gdriveState, setGdriveState] = useState<GDriveConnectionState>(() => getGDriveState());
  const [showManualToken, setShowManualToken] = useState<boolean>(false);
  const [showGasSetup, setShowGasSetup] = useState<boolean>(false);
  const [hasCopiedGas, setHasCopiedGas] = useState<boolean>(false);
  const [manualTokenInput, setManualTokenInput] = useState<string>('');
  const [gasUrlInput, setGasUrlInput] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      const list = await fetchBackupList();
      setBackups(list);
    } catch (err: any) {
      toast.error('Gagal memuat daftar backup: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen || isFullPage) {
      loadBackups();
    }
  }, [isOpen, isFullPage]);

  if (!isOpen && !isFullPage) return null;

  const handleRunManualBackup = async () => {
    setIsProcessing(true);
    try {
      const user = currentUserProfile?.display_name || currentUserProfile?.name || 'Supervisor';
      const res = await triggerManualBackup(user);
      if (res.success) {
        toast.success('Backup Berhasil Dibuat', {
          message: res.message,
          badge: 'Sistem Backup',
        });
        await loadBackups();
      } else {
        toast.error('Backup Gagal: ' + res.message);
      }
    } catch (err: any) {
      toast.error('Error saat membuat backup: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`Apakah Anda yakin ingin menghapus file backup "${filename}"?`)) {
      return;
    }
    try {
      const ok = await deleteBackupFile(filename);
      if (ok) {
        toast.success('File backup berhasil dihapus');
        setBackups((prev) => prev.filter((b) => b.filename !== filename));
      } else {
        toast.error('Gagal menghapus file backup');
      }
    } catch (err: any) {
      toast.error('Error saat menghapus backup: ' + err.message);
    }
  };

  const handleFileRestoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(reader.result as string);
        if (!json.data) {
          toast.error('File JSON tidak mengandung struktur backup valid');
          return;
        }

        if (!window.confirm('PERINGATAN: Memulihkan backup akan memperbarui data di database dengan isi file backup ini. Lanjutkan?')) {
          return;
        }

        setIsProcessing(true);
        const res = await restoreBackupData(json);
        if (res.success) {
          toast.success('Restorasi Sukses', {
            message: res.message,
            badge: 'Restore Data',
          });
          await loadBackups();
        } else {
          toast.error('Gagal Restore: ' + res.message);
        }
      } catch (err: any) {
        toast.error('Format JSON file tidak valid: ' + err.message);
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const cardContent = (
    <div className={`bg-slate-800 border border-slate-700/80 rounded-2xl w-full ${isFullPage ? 'max-w-4xl mx-auto shadow-sm' : 'max-w-3xl shadow-2xl max-h-[90vh] my-auto'} overflow-hidden flex flex-col`}>
      {/* Header */}
      <div className="px-5 py-4 bg-slate-900/90 border-b border-slate-700/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Pusat Backup & Restore System
            </h2>
            <p className="text-xs text-slate-400">
              Sistem Jadwal Backup Otomatis Database & Cloud Storage (Setiap 00:05 WIB)
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

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-slate-200">
          {/* Midnight Scheduler Banner */}
          <div className="bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-900/80 border border-blue-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400 animate-pulse" />
                <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">
                  Backup Otomatis Tengah Malam (00:05 WIB)
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Sistem secara otomatis membuat snapshot penuh seluruh database (Teknisi, Peralatan, Presensi, Preventif, Corrective, AVSEC) dan Manifest Cloud Storage IDCloudHost setiap tengah malam pukul 00:05 WIB ke folder <code className="text-sky-300 font-mono">/backups</code> dan S3 Bucket / Google Drive.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                onClick={handleRunManualBackup}
                disabled={isProcessing}
                className="flex-1 sm:flex-none py-2 px-3.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-md disabled:opacity-50"
              >
                {isProcessing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                <span>Backup Sekarang</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="flex-1 sm:flex-none py-2 px-3.5 bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-200 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer border border-slate-600 disabled:opacity-50"
              >
                <Upload className="w-4 h-4 text-emerald-400" />
                <span>Restore .JSON</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileRestoreUpload}
                className="hidden"
              />
            </div>
          </div>

          {/* Google Drive Account Banner (luthfiandammm@gmail.com) */}
          <div className="bg-slate-900/90 border border-slate-700/90 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Cloud className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Google Drive Backup Cloud</span>
                  {gdriveState.isConnected ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      Terhubung
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Belum Terhubung
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  {gdriveState.isConnected
                    ? `Otomatis upload ke Google Drive (${gdriveState.userEmail}) di folder FASKAMPEN_XRAY_BACKUP`
                    : 'Hubungkan ke akun luthfiandammm@gmail.com untuk penyimpanan otomatis di Google Drive'}
                </p>
              </div>
            </div>

            {gdriveState.isConnected ? (
              <button
                onClick={() => {
                  disconnectGoogleDriveAccount();
                  setGdriveState(getGDriveState());
                }}
                className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-rose-300 font-bold rounded-lg text-xs flex items-center gap-1.5 transition border border-rose-500/30 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span>Putuskan Drive</span>
              </button>
            ) : (
              <div className="flex items-center flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowGasSetup(!showGasSetup)}
                  className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Pakai GAS (Bebas Error)</span>
                </button>
                <button
                  onClick={async () => {
                    try {
                      const newState = await connectGoogleDriveAccount('luthfiandammm@gmail.com');
                      setGdriveState(newState);
                    } catch {}
                  }}
                  className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Google OAuth</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualToken(!showManualToken)}
                  className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold border border-slate-700 cursor-pointer"
                  title="Opsi alternatif Token Manual"
                >
                  Key
                </button>
              </div>
            )}
          </div>

          {/* GAS Web App Setup Box */}
          {showGasSetup && !gdriveState.isConnected && (
            <div className="bg-slate-900/95 border border-blue-500/40 rounded-xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-sky-400" />
                  Koneksi Google Apps Script (GAS) Web App
                </span>
                <span className="text-[11px] text-emerald-400 font-semibold">100% Bebas Error OAuth & Selamanya Gratis</span>
              </div>

              <div className="text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                <p>1. Buka <b>script.google.com</b> dengan akun <code className="text-sky-300">luthfiandammm@gmail.com</code> &gt; Buat New Project.</p>
                <div className="flex items-center justify-between">
                  <p>2. Paste kode di bawah ini lalu klik <b>Deploy &gt; New Deployment &gt; Web app</b> (Who has access: <i>Anyone</i>):</p>
                  <button
                    type="button"
                    onClick={() => {
                      const code = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var folderName = data.folderName || "FASKAMPEN_XRAY_BACKUP";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var file = folder.createFile(data.filename, data.content, MimeType.PLAIN_TEXT);
    return ContentService.createTextOutput(JSON.stringify({status:"success", fileId: file.getId()})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error", message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}`;
                      navigator.clipboard.writeText(code);
                      setHasCopiedGas(true);
                      toast.success('Kode GAS berhasil disalin!');
                      setTimeout(() => setHasCopiedGas(false), 2000);
                    }}
                    className="py-1 px-2.5 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 rounded-md text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                  >
                    {hasCopiedGas ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{hasCopiedGas ? 'Tersalin' : 'Salin Kode'}</span>
                  </button>
                </div>
              </div>

              <pre className="p-2.5 bg-slate-950 rounded-lg text-[10px] text-emerald-400 font-mono overflow-x-auto border border-slate-800 select-all">
{`function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var folderName = data.folderName || "FASKAMPEN_XRAY_BACKUP";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var file = folder.createFile(data.filename, data.content, MimeType.PLAIN_TEXT);
    return ContentService.createTextOutput(JSON.stringify({status:"success", fileId: file.getId()})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error", message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}`}
              </pre>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://script.google.com/macros/s/.../exec"
                  value={gasUrlInput}
                  onChange={(e) => setGasUrlInput(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                />
                <button
                  onClick={async () => {
                    try {
                      const newState = await saveGasWebhookUrl(gasUrlInput);
                      setGdriveState(newState);
                      setShowGasSetup(false);
                      setGasUrlInput('');
                    } catch {}
                  }}
                  className="py-1.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-lg cursor-pointer transition shadow-md"
                >
                  Hubungkan GAS
                </button>
              </div>
            </div>
          )}

          {showManualToken && !gdriveState.isConnected && (
            <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-3 space-y-2">
              <span className="text-xs font-bold text-slate-300 block">Tempel Google OAuth Access Token Manual:</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="ya29.a0A..."
                  value={manualTokenInput}
                  onChange={(e) => setManualTokenInput(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={async () => {
                    try {
                      const newState = await saveManualGDriveToken(manualTokenInput, 'luthfiandammm@gmail.com');
                      setGdriveState(newState);
                      setShowManualToken(false);
                      setManualTokenInput('');
                    } catch {}
                  }}
                  className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg cursor-pointer"
                >
                  Simpan Token
                </button>
              </div>
            </div>
          )}

          {/* Backup Archives Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-blue-400" />
                <span>Arsip File Backup ({backups.length})</span>
              </h3>
              <button
                onClick={loadBackups}
                disabled={isLoading}
                className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                title="Refresh Daftar"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {isLoading ? (
              <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
                <span>Memuat arsip file backup...</span>
              </div>
            ) : backups.length === 0 ? (
              <div className="p-6 bg-slate-900/60 rounded-xl border border-slate-700/60 text-center space-y-2">
                <FileJson className="w-8 h-8 text-slate-500 mx-auto" />
                <p className="text-xs font-bold text-slate-300">Belum ada file backup tersimpan</p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Klik "Backup Sekarang" di atas untuk membuat snapshot cadangan data pertama Anda.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {backups.map((item) => (
                  <div
                    key={item.filename}
                    className="p-3 bg-slate-900/80 border border-slate-700/80 rounded-xl flex items-center justify-between gap-3 hover:border-slate-600 transition"
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                        <FileJson className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-mono font-bold text-white truncate">
                          {item.filename}
                        </p>
                        <div className="flex items-center gap-2 text-[10.5px] text-slate-400 mt-0.5 flex-wrap">
                          <span className="font-semibold text-emerald-400">{item.type}</span>
                          <span>•</span>
                          <span>{item.size_kb} KB</span>
                          <span>•</span>
                          <span>{new Date(item.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={getBackupDownloadUrl(item.filename)}
                        download={item.filename}
                        className="p-2 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg transition text-xs font-bold flex items-center gap-1 cursor-pointer"
                        title="Unduh File JSON"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Unduh</span>
                      </a>
                      <button
                        onClick={() => handleDelete(item.filename)}
                        className="p-2 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-lg transition cursor-pointer border border-slate-700 hover:border-rose-800/50"
                        title="Hapus Backup"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-900/90 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Sistem Enkripsi & Pemulihan Database Siap</span>
          </div>
          {onClose && !isFullPage && (
            <button
              onClick={onClose}
              className="py-1.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold rounded-lg cursor-pointer transition"
            >
              Tutup
            </button>
          )}
        </div>
      </div>
    );

  if (isFullPage) {
    return <div className="p-4 md:p-6 w-full">{cardContent}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150 overflow-y-auto">
      {cardContent}
    </div>
  );
};
