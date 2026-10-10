import React, { useState, useEffect } from 'react';
import {
  Server,
  Database,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  RefreshCw,
  HardDrive,
  Plus,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import {
  getStorageConfig,
  saveStorageConfig,
  testStorageConnection,
  listStorageBuckets,
  createStorageBucket,
  StorageConfig,
} from '../services/storageService';
import { toast } from './Toast';

interface StorageConfigModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  isFullPage?: boolean;
}

export const StorageConfigModal: React.FC<StorageConfigModalProps> = ({
  isOpen = true,
  onClose = () => {},
  isFullPage = false,
}) => {
  const [config, setConfig] = useState<StorageConfig>({
    provider: 'idcloudhost',
    endpoint: 'https://is3.cloudhost.id',
    bucketName: '',
    region: 'us-east-1',
    publicUrlBase: '',
    enabled: true,
    isConfigured: false,
    lastCheck: '',
  });

  const [availableBuckets, setAvailableBuckets] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isCreatingBucket, setIsCreatingBucket] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [showCreateBucketInput, setShowCreateBucketInput] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });

  // Load configuration on open
  useEffect(() => {
    if (isOpen || isFullPage) {
      loadConfig();
    }
  }, [isOpen, isFullPage]);

  const loadConfig = async () => {
    setIsLoading(true);
    setTestResult({ status: 'idle', message: '' });
    try {
      const data = await getStorageConfig();
      setConfig(data);

      if (data.isConfigured) {
        fetchBuckets();
      }
    } catch (e: any) {
      toast.error('Gagal membaca status storage: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBuckets = async () => {
    const res = await listStorageBuckets();
    if (res.success && res.buckets) {
      setAvailableBuckets(res.buckets);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult({ status: 'idle', message: 'Menguji koneksi server ke IDCloudHost S3...' });
    try {
      const res = await testStorageConnection();
      if (res.success) {
        setTestResult({ status: 'success', message: res.message });
        if (res.buckets) {
          setAvailableBuckets(res.buckets);
        }
        setConfig((prev) => ({
          ...prev,
          isConfigured: true,
          lastCheck: new Date().toLocaleTimeString('id-ID'),
        }));
        toast.success('Koneksi IDCloudHost Berhasil', {
          message: res.message,
          badge: 'S3 Storage',
        });
      } else {
        setTestResult({ status: 'error', message: res.message });
        toast.error('Koneksi IDCloudHost Gagal', res.message);
      }
    } catch (err: any) {
      setTestResult({ status: 'error', message: err?.message || 'Gagal terhubung' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCreateBucket = async () => {
    const name = newBucketName.trim().toLowerCase();
    if (!name) {
      toast.warning('Nama Bucket Wajib', 'Masukkan nama bucket baru (hanya huruf kecil dan angka/strip).');
      return;
    }

    setIsCreatingBucket(true);
    try {
      const res = await createStorageBucket(name);
      if (res.success) {
        toast.success('Bucket Dibuat', {
          message: `Bucket '${name}' berhasil dibuat di IDCloudHost.`,
          badge: 'IDCloudHost',
        });
        setConfig((prev) => ({ ...prev, bucketName: name }));
        setNewBucketName('');
        setShowCreateBucketInput(false);
        fetchBuckets();
      } else {
        toast.error('Gagal Membuat Bucket', res.message || 'Terjadi kesalahan.');
      }
    } catch (e: any) {
      toast.error('Gagal: ' + e.message);
    } finally {
      setIsCreatingBucket(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await saveStorageConfig({
        bucketName: config.bucketName,
        endpoint: config.endpoint,
        region: config.region,
        enabled: config.enabled,
      });
      if (res.success) {
        toast.success('Pengaturan Storage Disimpan', {
          message: 'Konfigurasi storage backend berhasil diperbarui.',
          badge: 'Tersimpan',
        });
        onClose();
      } else {
        toast.error('Gagal Menyimpan', res.message || 'Error');
      }
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen && !isFullPage) return null;

  const cardContent = (
    <div className={`w-full ${isFullPage ? 'max-w-4xl mx-auto border border-slate-200 shadow-sm' : 'max-w-lg shadow-2xl border border-slate-200'} bg-white rounded-2xl overflow-hidden flex flex-col`}>
      {/* Modal Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center border border-white/20">
            <Server className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight">Status IDCloudHost Object Storage S3</h3>
            <p className="text-[11px] text-blue-100/90 font-medium">Penyimpanan Bukti Foto & Laporan (Server-Side S3)</p>
          </div>
        </div>
        {onClose && !isFullPage && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Modal Body */}
      <form onSubmit={handleSave} className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Security Banner */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <span>Security Hardening Aktif</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 font-semibold rounded-md">
                  Private Objects
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Kredensial S3 (Access &amp; Secret Key) tersimpan aman di server environment backend. Bukti foto diamankan sebagai objek privat dengan URL presigned sementara.
              </p>
            </div>
          </div>

          {/* Status Card Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Status Koneksi
              </span>
              <div className="flex items-center gap-1.5 font-bold text-xs">
                {config.isConfigured ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">Terhubung</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="text-amber-700">Belum Terhubung</span>
                  </>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Pemeriksaan Terakhir
              </span>
              <div className="text-xs font-semibold text-slate-800">
                {config.lastCheck || 'Belum diperiksa'}
              </div>
            </div>
          </div>

          {/* Connection Test Result Banner */}
          {testResult.status !== 'idle' && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                testResult.status === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              {testResult.status === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="font-medium leading-relaxed">{testResult.message}</div>
            </div>
          )}

          {/* Configuration Details */}
          <div className="space-y-3">
            {/* Endpoint */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Endpoint S3 Server
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={config.endpoint}
                  onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
                  placeholder="https://is3.cloudhost.id"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
                <Server className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Bucket Selection / Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">
                  Nama Bucket IDCloudHost
                </label>
                <button
                  type="button"
                  onClick={() => setShowCreateBucketInput(!showCreateBucketInput)}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>{showCreateBucketInput ? 'Pilih yang Ada' : '+ Buat Bucket Baru'}</span>
                </button>
              </div>

              {showCreateBucketInput ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(e.target.value)}
                    placeholder="nama-bucket-baru..."
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCreateBucket}
                    disabled={isCreatingBucket || !newBucketName.trim()}
                    className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {isCreatingBucket ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Buat'}
                  </button>
                </div>
              ) : availableBuckets.length > 0 ? (
                <div className="relative">
                  <select
                    value={config.bucketName}
                    onChange={(e) => setConfig({ ...config, bucketName: e.target.value })}
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer appearance-none"
                  >
                    <option value="">-- Pilih Bucket S3 --</option>
                    {availableBuckets.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <Database className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={config.bucketName}
                    onChange={(e) => setConfig({ ...config, bucketName: e.target.value })}
                    placeholder="Contoh: faskampen-reports"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <Database className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isLoading}
              className="flex-1 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  <span>Menguji Koneksi...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Uji Koneksi Server</span>
                </>
              )}
            </button>

            <button
              type="submit"
              disabled={isLoading || isTesting}
              className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <span>Simpan Pengaturan</span>
              )}
            </button>
          </div>
        </form>
      </div>
    );

  if (isFullPage) {
    return <div className="p-4 md:p-6 w-full">{cardContent}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
      {cardContent}
    </div>
  );
};
