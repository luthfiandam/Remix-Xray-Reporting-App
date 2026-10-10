import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  Database,
  HardDrive,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Bot,
  Zap,
  Server,
} from 'lucide-react';
import { fetchDetailedServerHealth } from '../services/healthService';
import { toast } from './Toast';

interface SupervisorHealthModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  isFullPage?: boolean;
}

export const SupervisorHealthModal: React.FC<SupervisorHealthModalProps> = ({
  isOpen = true,
  onClose,
  isFullPage = false,
}) => {
  const [healthData, setHealthData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen || isFullPage) {
      loadHealth();
    }
  }, [isOpen, isFullPage]);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const res = await fetchDetailedServerHealth();
      if (res.success) {
        setHealthData(res.health);
      } else {
        toast.error(res.error || 'Gagal memuat status kesehatan server');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Terjadi kesalahan sistem');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen && !isFullPage) return null;

  const getStatusBadge = (status: string) => {
    if (status === 'healthy' || status === 'ok') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className="capitalize">{status}</span>
        </span>
      );
    }
    if (status === 'degraded' || status === 'warning') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span className="capitalize">{status}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 text-rose-700 rounded-full text-xs font-bold border border-rose-200">
        <XCircle className="w-3.5 h-3.5 text-rose-500" />
        <span className="capitalize">{status || 'unhealthy'}</span>
      </span>
    );
  };

  const cardContent = (
    <div className={`bg-white rounded-2xl ${isFullPage ? 'border border-slate-200 shadow-sm max-w-4xl mx-auto' : 'shadow-2xl max-w-xl w-full border border-slate-200 animate-in fade-in zoom-in-95 duration-200 my-8'} overflow-hidden`}>
      {/* Header */}
      <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Diagnostic Operational Health Server</h2>
            <p className="text-xs text-slate-400">Monitoring komponen & dependensi server aplikasi</p>
          </div>
        </div>
        {onClose && !isFullPage && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className={`p-6 space-y-5 ${isFullPage ? '' : 'max-h-[75vh] overflow-y-auto'}`}>
          {loading ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
              <p className="text-xs font-medium text-slate-500">Memeriksa kesehatan komponen sistem...</p>
            </div>
          ) : !healthData ? (
            <div className="py-8 text-center text-xs text-slate-400">Tidak ada data kesehatan server.</div>
          ) : (
            <>
              {/* Top Banner Overall Status */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Overall Status</span>
                  <div className="mt-1">{getStatusBadge(healthData.status)}</div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Uptime: <strong>{Math.floor((healthData.uptime_seconds || 0) / 3600)}j {Math.floor(((healthData.uptime_seconds || 0) % 3600) / 60)}m</strong></div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{healthData.timestamp ? new Date(healthData.timestamp).toLocaleTimeString('id-ID') : ''}</div>
                </div>
              </div>

              {/* Service Components */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Layanan & Dependensi</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Database */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Database className="w-4 h-4 text-blue-600 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800 block">Supabase PostgreSQL</span>
                        <span className="text-[10px] text-slate-400">
                          {healthData.services?.database?.latency_ms ? `${healthData.services.database.latency_ms} ms` : '-'}
                        </span>
                      </div>
                    </div>
                    {getStatusBadge(healthData.services?.database?.status)}
                  </div>

                  {/* IDCloudHost S3 */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <HardDrive className="w-4 h-4 text-indigo-600 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800 block">IDCloudHost S3</span>
                        <span className="text-[10px] text-slate-400">
                          {healthData.services?.object_storage?.latency_ms ? `${healthData.services.object_storage.latency_ms} ms` : '-'}
                        </span>
                      </div>
                    </div>
                    {getStatusBadge(healthData.services?.object_storage?.status)}
                  </div>

                  {/* Telegram Bot */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Bot className="w-4 h-4 text-sky-600 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800 block">Telegram Bot Alert</span>
                        <span className="text-[10px] text-slate-400">
                          {healthData.services?.telegram?.configured ? 'Terkonfigurasi' : 'Belum diset'}
                        </span>
                      </div>
                    </div>
                    {getStatusBadge(healthData.services?.telegram?.status)}
                  </div>

                  {/* Biometric Liveness */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Zap className="w-4 h-4 text-purple-600 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800 block">Validasi Biometrik Presensi</span>
                        <span className="text-[10px] text-slate-400">
                          {healthData.services?.gemini?.configured ? 'Sistem Aktif' : 'Mode Standar'}
                        </span>
                      </div>
                    </div>
                    {getStatusBadge(healthData.services?.gemini?.status)}
                  </div>
                </div>
              </div>

              {/* Server Resources */}
              <div className="space-y-3 pt-1 border-t border-slate-100">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Sumber Daya Server VPS</h3>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-500 font-semibold">
                      <Cpu className="w-3.5 h-3.5 text-slate-400" />
                      <span>Memory (RAM) Usage</span>
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      {healthData.server?.memory_usage || '-'}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-500 font-semibold">
                      <Server className="w-3.5 h-3.5 text-slate-400" />
                      <span>Disk Space Free</span>
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      {healthData.server?.disk_free || healthData.server?.disk_usage || '-'}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={loadHealth}
            disabled={loading}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Diagnostics</span>
          </button>

          {onClose && !isFullPage && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 text-xs font-bold transition-all cursor-pointer"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      {cardContent}
    </div>
  );
};
