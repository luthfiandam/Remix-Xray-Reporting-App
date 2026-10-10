import React, { useState, useEffect } from 'react';
import {
  Folder,
  FileText,
  Image as ImageIcon,
  File,
  Download,
  Eye,
  RefreshCw,
  ChevronRight,
  Home,
  X,
  Loader2,
  HardDrive,
  Search,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { getAuthHeaders } from '../services/authService';
import { toast } from './Toast';

interface StorageFile {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  type: string;
}

interface StorageManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StorageFileManagerModal: React.FC<StorageManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [currentPrefix, setCurrentPrefix] = useState<string>('!Kantor/');
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(currentPrefix);
    }
  }, [isOpen, currentPrefix]);

  const loadDirectory = async (prefix: string) => {
    setIsLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `/api/storage-manager/list?prefix=${encodeURIComponent(prefix)}&limit=100`,
        {
          headers: { ...authHeaders, Accept: 'application/json' },
        }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setFolders(data.folders || []);
          setFiles(data.files || []);
        } else {
          toast.error('Gagal Membaca Direktori', data.error || 'Terjadi kesalahan.');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error('Gagal Memuat File', err.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      toast.error('Gagal Koneksi Storage', e?.message || 'Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenFolder = (folderPrefix: string) => {
    setCurrentPrefix(folderPrefix);
    setSearchQuery('');
  };

  const handleNavigateBreadcrumb = (index: number, breadcrumbs: string[]) => {
    if (index === 0) {
      setCurrentPrefix('!Kantor/');
    } else {
      const target = breadcrumbs.slice(0, index + 1).join('/') + '/';
      setCurrentPrefix(target);
    }
    setSearchQuery('');
  };

  const handlePreviewFile = async (file: StorageFile) => {
    setIsPreviewLoading(true);
    setPreviewFileName(file.name);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `/api/storage-manager/preview?key=${encodeURIComponent(file.key)}`,
        {
          headers: { ...authHeaders, Accept: 'application/json' },
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.url) {
          setPreviewUrl(data.url);
        } else {
          toast.error('Gagal Memuat Preview', data.error || 'URL tidak tersedia');
        }
      } else {
        toast.error('Gagal Preview', 'Tidak dapat mengambil link akses');
      }
    } catch (err: any) {
      toast.error('Gagal Preview', err?.message);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleDownloadFile = async (file: StorageFile) => {
    toast.info('Mengunduh File', {
      message: `Mengunduh ${file.name}...`,
      duration: 2000,
    });
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `/api/storage-manager/download?key=${encodeURIComponent(file.key)}`,
        { headers: authHeaders }
      );
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast.success('Download Berhasil', { message: file.name });
      } else {
        toast.error('Gagal Mengunduh', 'Server menolak permintaan');
      }
    } catch (e: any) {
      toast.error('Gagal Download', e?.message);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const breadcrumbs = currentPrefix.split('/').filter(Boolean);

  const filteredFolders = folders.filter((f) => {
    if (!searchQuery) return true;
    const folderName = f.replace(currentPrefix, '').replace(/\/$/, '');
    return folderName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const filteredFiles = files.filter((f) => {
    if (!searchQuery) return true;
    return f.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[88vh] max-h-[800px]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/20 flex items-center justify-center border border-blue-400/30">
              <HardDrive className="w-4 h-4 text-blue-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
                  File Manager Storage S3
                </h2>
                <span className="text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-200 border border-blue-400/30 rounded-full font-semibold">
                  !Kantor/
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Jelajahi berkas foto dokumentasi &amp; arsip laporan di IDCloudHost
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => loadDirectory(currentPrefix)}
              disabled={isLoading}
              title="Refresh / Muat Ulang"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              title="Tutup File Manager"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar: Breadcrumb + Search */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-1 text-xs overflow-x-auto py-1 scrollbar-none">
            <button
              onClick={() => handleNavigateBreadcrumb(0, breadcrumbs)}
              className="flex items-center gap-1 text-slate-600 hover:text-blue-700 font-bold px-1.5 py-0.5 rounded hover:bg-slate-200 transition cursor-pointer shrink-0"
            >
              <Home className="w-3.5 h-3.5 text-blue-600" />
              <span>Root</span>
            </button>

            {breadcrumbs.map((segment, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                <button
                  onClick={() => handleNavigateBreadcrumb(idx, breadcrumbs)}
                  className={`px-1.5 py-0.5 rounded transition cursor-pointer shrink-0 font-medium ${
                    idx === breadcrumbs.length - 1
                      ? 'bg-blue-100 text-blue-900 font-bold'
                      : 'text-slate-600 hover:text-blue-700 hover:bg-slate-200'
                  }`}
                >
                  {segment}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative w-full sm:w-64 shrink-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari folder / berkas..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-100/50">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <p className="text-xs font-semibold">Membaca berkas di IDCloudHost S3...</p>
            </div>
          ) : filteredFolders.length === 0 && filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
              <Folder className="w-12 h-12 stroke-[1.2] text-slate-300" />
              <p className="text-xs font-bold text-slate-600">Direktori Kosong</p>
              <p className="text-[11px] text-slate-400">Tidak ada folder atau berkas di lokasi ini.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Folders Section */}
              {filteredFolders.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-amber-500" />
                    <span>Folder ({filteredFolders.length})</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {filteredFolders.map((f) => {
                      const folderName = f.replace(currentPrefix, '').replace(/\/$/, '');
                      return (
                        <button
                          key={f}
                          onClick={() => handleOpenFolder(f)}
                          className="flex items-center gap-2 p-2.5 bg-white hover:bg-blue-50/70 border border-slate-200 hover:border-blue-300 rounded-xl transition text-left cursor-pointer group shadow-2xs"
                        >
                          <Folder className="w-5 h-5 text-amber-500 fill-amber-100 group-hover:scale-110 transition-transform shrink-0" />
                          <span className="text-xs font-bold text-slate-700 group-hover:text-blue-900 truncate">
                            {folderName}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Files Section */}
              {filteredFiles.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                    <span>Berkas ({filteredFiles.length})</span>
                  </h3>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs divide-y divide-slate-100">
                    {filteredFiles.map((file) => {
                      const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(file.type);
                      const isPdf = file.type === 'pdf';
                      const isExcel = ['xlsx', 'xls', 'csv'].includes(file.type);

                      return (
                        <div
                          key={file.key}
                          className="p-2.5 sm:px-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-100">
                              {isImage ? (
                                <ImageIcon className="w-4 h-4 text-emerald-600" />
                              ) : isPdf ? (
                                <FileText className="w-4 h-4 text-rose-600" />
                              ) : isExcel ? (
                                <FileText className="w-4 h-4 text-teal-600" />
                              ) : (
                                <File className="w-4 h-4 text-slate-500" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-800 truncate" title={file.name}>
                                {file.name}
                              </p>
                              <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-0.5">
                                <span>{formatFileSize(file.size)}</span>
                                <span>•</span>
                                <span>
                                  {file.lastModified ? new Date(file.lastModified).toLocaleString('id-ID') : '-'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isImage && (
                              <button
                                onClick={() => handlePreviewFile(file)}
                                title="Lihat Foto"
                                className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDownloadFile(file)}
                              title="Unduh Berkas"
                              className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span className="text-[11px] font-medium text-slate-600">
              Akses Aman Supervisor: Terisolasi dalam root <b>!Kantor/</b>
            </span>
          </div>
          <span className="text-[11px] font-semibold text-slate-700">
            Total {folders.length} folder, {files.length} berkas
          </span>
        </div>
      </div>

      {/* Image Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="relative max-w-3xl max-h-[85vh] bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 shadow-2xl flex flex-col">
            <div className="px-4 py-2.5 bg-slate-800 text-white flex items-center justify-between text-xs font-bold border-b border-slate-700">
              <span className="truncate max-w-md">{previewFileName}</span>
              <button
                onClick={() => setPreviewUrl(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 flex items-center justify-center bg-black/40 overflow-auto">
              <img
                src={previewUrl}
                alt={previewFileName}
                className="max-h-[75vh] w-auto object-contain rounded-lg shadow-md"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
