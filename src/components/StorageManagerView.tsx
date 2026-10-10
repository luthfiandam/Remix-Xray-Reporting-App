import React, { useState, useEffect, useMemo } from 'react';
import {
  HardDrive,
  Folder,
  FileText,
  Image as ImageIcon,
  File,
  Search,
  ChevronRight,
  Download,
  Eye,
  RefreshCw,
  X,
  AlertTriangle,
  Lock,
  Filter,
  ArrowLeft,
  Calendar,
  Layers,
} from 'lucide-react';
import { toast } from './Toast';
import { getAuthHeaders } from '../services/authService';

interface StorageFile {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  type: string;
}

interface StorageManagerListResponse {
  success: boolean;
  prefix: string;
  folders: string[];
  files: StorageFile[];
  nextContinuationToken: string | null;
  isTruncated: boolean;
  error?: string;
}

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export const StorageManagerView: React.FC<{ isSupervisor?: boolean }> = ({ isSupervisor = false }) => {
  const [currentPrefix, setCurrentPrefix] = useState<string>('!Kantor/');
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [nextContinuationToken, setNextContinuationToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fileTypeFilter, setFileTypeFilter] = useState<'ALL' | 'pdf' | 'image'>('ALL');

  // Preview Modal
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  useEffect(() => {
    fetchDirectory(currentPrefix, null);
  }, [currentPrefix]);

  const fetchDirectory = async (prefix: string, token: string | null) => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      params.append('prefix', prefix);
      if (token) params.append('continuationToken', token);
      params.append('limit', '100');

      const res = await fetch(`/api/storage-manager/list?${params.toString()}`, { headers });
      if (res.ok) {
        const data: StorageManagerListResponse = await res.json();
        if (data.success) {
          setCurrentPrefix(data.prefix);
          setFolders(data.folders || []);
          setFiles(data.files || []);
          setNextContinuationToken(data.nextContinuationToken || null);
          setContinuationToken(token);
        } else {
          toast.error(data.error || 'Gagal memuat daftar berkas S3');
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || `Error ${res.status}: Akses ditolak atau server error`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  };

  // Breadcrumbs parsing
  const breadcrumbSegments = useMemo(() => {
    // Prefix starts with !Kantor/
    const clean = currentPrefix.replace(/^\/+|\/+$/g, '');
    if (!clean) return ['!Kantor'];
    return clean.split('/');
  }, [currentPrefix]);

  const navigateToBreadcrumb = (index: number) => {
    if (index === 0) {
      setCurrentPrefix('!Kantor/');
      return;
    }
    const sliced = breadcrumbSegments.slice(0, index + 1);
    setCurrentPrefix(`${sliced.join('/')}/`);
  };

  // Folder navigation
  const openFolder = (folderPrefix: string) => {
    setCurrentPrefix(folderPrefix);
    setSearchQuery('');
  };

  // Filtered Files
  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!f.name.toLowerCase().includes(q)) return false;
      }
      // Type Filter
      if (fileTypeFilter === 'pdf' && f.type !== 'pdf') return false;
      if (
        fileTypeFilter === 'image' &&
        !['jpg', 'jpeg', 'png', 'webp'].includes(f.type.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [files, searchQuery, fileTypeFilter]);

  // Aggregate Info
  const totalVisibleSize = useMemo(() => {
    return filteredFiles.reduce((acc, file) => acc + file.size, 0);
  }, [filteredFiles]);

  // Handle Preview
  const handleOpenPreview = async (file: StorageFile) => {
    setPreviewFile(file);
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/storage-manager/preview?key=${encodeURIComponent(file.key)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.url) {
          setPreviewUrl(data.url);
        } else {
          toast.error(data.error || 'Gagal memuat URL preview');
        }
      } else {
        toast.error('Gagal mendapatkan izin preview file');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error saat membuat link preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Handle Single File Download
  const handleDownload = async (file: StorageFile) => {
    try {
      const headers = await getAuthHeaders();
      toast.info(`Mengunduh berkas ${file.name}...`);
      const res = await fetch(`/api/storage-manager/download?key=${encodeURIComponent(file.key)}`, { headers });
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } else {
        toast.error('Gagal mengunduh berkas');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error saat mengunduh berkas');
    }
  };

  // Multi-select & Batch Download State
  const [selectedFileKeys, setSelectedFileKeys] = useState<string[]>([]);
  const [batchDownloading, setBatchDownloading] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);

  const toggleSelectFile = (key: string) => {
    setSelectedFileKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const toggleSelectAll = () => {
    if (selectedFileKeys.length === filteredFiles.length) {
      setSelectedFileKeys([]);
    } else {
      setSelectedFileKeys(filteredFiles.map((f) => f.key));
    }
  };

  // Handle Batch Download with 1-second delay & progress notification
  const handleBatchDownload = async () => {
    const targetFiles = files.filter((f) => selectedFileKeys.includes(f.key));
    if (targetFiles.length === 0) return;

    setBatchDownloading(true);
    toast.info(`Memulai Unduhan Batch...`, {
      message: `Sedang memproses ${targetFiles.length} berkas secara bertahap...`,
      duration: 3000,
    });

    try {
      const headers = await getAuthHeaders();

      for (let i = 0; i < targetFiles.length; i++) {
        const file = targetFiles[i];
        setBatchProgress({
          current: i + 1,
          total: targetFiles.length,
          fileName: file.name,
        });

        try {
          const res = await fetch(`/api/storage-manager/download?key=${encodeURIComponent(file.key)}`, { headers });
          if (res.ok) {
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
          }
        } catch (singleErr) {
          console.warn(`Error downloading ${file.name}:`, singleErr);
        }

        if (i < targetFiles.length - 1) {
          await new Promise((res) => setTimeout(res, 1000));
        }
      }

      toast.success('Unduhan Batch Selesai!', {
        message: `${targetFiles.length} berkas berhasil diunduh.`,
      });
      setSelectedFileKeys([]);
    } catch (err: any) {
      toast.error('Gagal Unduh Batch', {
        message: err?.message || 'Terjadi kesalahan saat mengunduh berkas batch.',
      });
    } finally {
      setBatchDownloading(false);
      setBatchProgress(null);
    }
  };

  if (!isSupervisor) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 max-w-md mx-auto my-12 shadow-sm">
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900">Akses Terbatas — Khusus Supervisor</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          Storage Manager hanya dapat diakses oleh akun Supervisor untuk mengelola arsip IDCloudHost Object Storage S3.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-5 sm:p-7 text-white shadow-xl relative overflow-hidden border border-indigo-900/40">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <HardDrive className="w-6 h-6 text-indigo-400" />
              <span>Storage Manager</span>
            </h1>
          </div>

          <button
            onClick={() => fetchDirectory(currentPrefix, null)}
            disabled={loading}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md shrink-0 self-start md:self-auto disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Muat Ulang Folder</span>
          </button>
        </div>
      </div>

      {/* Info & Breadcrumb Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-medium text-slate-600 pb-1 border-b border-slate-100 no-scrollbar">
          <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] shrink-0 mr-1">
            Lokasi:
          </span>
          {breadcrumbSegments.map((seg, idx) => {
            const isLast = idx === breadcrumbSegments.length - 1;
            return (
              <React.Fragment key={idx}>
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                <button
                  onClick={() => navigateToBreadcrumb(idx)}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer shrink-0 ${
                    isLast
                      ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200'
                      : 'hover:bg-slate-100 text-slate-700 font-medium'
                  }`}
                >
                  {seg}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Info Counters & Filters */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-slate-500 font-medium">
            <span>Subfolder: <strong className="text-slate-800">{folders.length}</strong></span>
            <span>Berkas: <strong className="text-slate-800">{filteredFiles.length}</strong></span>
            <span>Ukuran Tampil: <strong className="text-slate-800">{formatBytes(totalVisibleSize)}</strong></span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 sm:w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari berkas..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              />
            </div>

            {/* Type Filter */}
            <select
              value={fileTypeFilter}
              onChange={(e) => setFileTypeFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition cursor-pointer"
            >
              <option value="ALL">Semua Tipe</option>
              <option value="pdf">Dokumen PDF</option>
              <option value="image">Gambar (JPG/PNG)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main File Manager List Area */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <RefreshCw className="w-7 h-7 text-indigo-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">Memuat berkas dari IDCloudHost S3...</p>
          </div>
        ) : folders.length === 0 && filteredFiles.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Folder className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">Folder Kosong</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Tidak ada folder atau berkas yang ditemukan pada direktori virtual ini.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {/* Subfolders Grid / Rows */}
            {folders.length > 0 && (
              <div className="p-4 bg-slate-50/50 space-y-2 border-b border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  Folder Virtual ({folders.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {folders.map((folderPrefix) => {
                    const cleanName = folderPrefix
                      .replace(currentPrefix, '')
                      .replace(/\/$/, '');
                    return (
                      <button
                        key={folderPrefix}
                        onClick={() => openFolder(folderPrefix)}
                        className="p-3 bg-white hover:bg-indigo-50/60 active:bg-indigo-100/70 border border-slate-200 hover:border-indigo-300 rounded-xl flex items-center gap-3 transition-all cursor-pointer text-left shadow-2xs group"
                      >
                        <div className="p-2 bg-amber-50 text-amber-600 rounded-lg group-hover:bg-amber-100 transition-colors shrink-0">
                          <Folder className="w-4 h-4 fill-amber-500/20" />
                        </div>
                        <span className="font-bold text-xs text-slate-800 group-hover:text-indigo-900 truncate">
                          {cleanName || folderPrefix}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Files List Table */}
            {filteredFiles.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                      <th className="py-3 px-4">Nama Berkas</th>
                      <th className="py-3 px-3">Tipe</th>
                      <th className="py-3 px-3">Ukuran</th>
                      <th className="py-3 px-4">Tanggal Modifikasi</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {filteredFiles.map((file) => {
                      const isPdf = file.type === 'pdf';
                      const isImg = ['jpg', 'jpeg', 'png', 'webp'].includes(file.type.toLowerCase());

                      return (
                        <tr key={file.key} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5 min-w-[200px]">
                              {isPdf ? (
                                <FileText className="w-4 h-4 text-rose-500 shrink-0" />
                              ) : isImg ? (
                                <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                              ) : (
                                <File className="w-4 h-4 text-slate-400 shrink-0" />
                              )}
                              <span className="font-semibold text-slate-900 truncate max-w-xs sm:max-w-md" title={file.name}>
                                {file.name}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-3 uppercase font-mono text-[10px] font-bold text-slate-500">
                            {file.type || 'RAW'}
                          </td>

                          <td className="py-3 px-3 text-slate-600 font-mono text-xs">
                            {formatBytes(file.size)}
                          </td>

                          <td className="py-3 px-4 text-slate-500 text-xs whitespace-nowrap">
                            {new Date(file.lastModified).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {(isPdf || isImg) && (
                                <button
                                  onClick={() => handleOpenPreview(file)}
                                  className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                                  title="Tinjau Berkas (Temporary Signed GET)"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Preview</span>
                                </button>
                              )}

                              <button
                                onClick={() => handleDownload(file)}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                                title="Unduh Berkas Aman"
                              >
                                <Download className="w-3.5 h-3.5 text-slate-600" />
                                <span>Unduh</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Pagination Controls */}
        {(nextContinuationToken || continuationToken) && (
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              Halaman {continuationToken ? 'Lanjutan' : 'Awal'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchDirectory(currentPrefix, null)}
                disabled={!continuationToken || loading}
                className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-100 disabled:opacity-50 transition cursor-pointer"
              >
                Kembali ke Awal
              </button>
              <button
                onClick={() => fetchDirectory(currentPrefix, nextContinuationToken)}
                disabled={!nextContinuationToken || loading}
                className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer shadow-xs"
              >
                Halaman Berikutnya
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden border border-slate-200 my-8">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0 pr-4">
                {previewFile.type === 'pdf' ? (
                  <FileText className="w-5 h-5 text-rose-400 shrink-0" />
                ) : (
                  <ImageIcon className="w-5 h-5 text-emerald-400 shrink-0" />
                )}
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate" title={previewFile.name}>
                    {previewFile.name}
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {formatBytes(previewFile.size)} • Temporary Signed URL (15 Mins)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(previewFile)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh</span>
                </button>
                <button
                  onClick={() => {
                    setPreviewFile(null);
                    setPreviewUrl(null);
                  }}
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 bg-slate-100 min-h-[400px] flex items-center justify-center">
              {previewLoading ? (
                <div className="py-12 text-center space-y-2">
                  <RefreshCw className="w-7 h-7 text-indigo-600 animate-spin mx-auto" />
                  <p className="text-xs font-semibold text-slate-600">Menyiapkan presigned URL...</p>
                </div>
              ) : !previewUrl ? (
                <div className="text-center py-12 text-rose-600 text-xs font-bold">
                  Gagal membuat link preview. Silakan coba lagi.
                </div>
              ) : previewFile.type === 'pdf' ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-[70vh] rounded-xl border border-slate-200 bg-white"
                  title="PDF Preview"
                />
              ) : (
                <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center">
                  <img
                    src={previewUrl}
                    alt={previewFile.name}
                    className="max-h-[65vh] w-auto object-contain rounded-lg"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
