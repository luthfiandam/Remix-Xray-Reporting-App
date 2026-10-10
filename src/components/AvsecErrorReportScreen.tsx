import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  ShieldAlert,
  X,
  RefreshCw,
  Info,
  ChevronRight,
} from 'lucide-react';
import {
  fetchPublicEquipment,
  createReportSession,
  uploadAvsecIncidentPhoto,
  submitAvsecErrorReport,
  PublicEquipmentInfo,
} from '../services/avsecReportService';
import { sanitizeText, sanitizeMultilineText } from '../utils/sanitizer';

interface AvsecErrorReportScreenProps {
  publicId: string;
  onClose?: () => void;
}

const ISSUE_TYPES = [
  'Mesin tidak menyala',
  'Error pada layar',
  'Conveyor bermasalah',
  'Image/display bermasalah',
  'Lainnya',
];

export const AvsecErrorReportScreen: React.FC<AvsecErrorReportScreenProps> = ({
  publicId,
  onClose,
}) => {
  // State Steps: 1: 'confirm', 2: 'form', 3: 'success', 'error': 'error'
  const [step, setStep] = useState<'loading' | 'confirm' | 'form' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // Equipment info
  const [equipment, setEquipment] = useState<PublicEquipmentInfo | null>(null);

  // Session
  const [sessionId, setSessionId] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [timeLeftStr, setTimeLeftStr] = useState('10:00');

  // Form inputs
  const [reporterName, setReporterName] = useState('');
  const [reporterUnit, setReporterUnit] = useState('AVSEC');
  const [issueType, setIssueType] = useState('Conveyor bermasalah');
  const [description, setDescription] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState('');
  const [submittedReportNumber, setSubmittedReportNumber] = useState('');
  const [submittedAt, setSubmittedAt] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load equipment info on mount
  useEffect(() => {
    let isMounted = true;
    async function loadEq() {
      setStep('loading');
      setErrorMessage('');
      const res = await fetchPublicEquipment(publicId);
      if (!isMounted) return;

      if (res.success && res.equipment) {
        setEquipment(res.equipment);
        setStep('confirm');
      } else {
        setErrorMessage(res.error || 'Peralatan tidak ditemukan atau kode QR tidak valid.');
        setStep('error');
      }
    }
    loadEq();
    return () => {
      isMounted = false;
    };
  }, [publicId]);

  // Session timer countdown
  useEffect(() => {
    if (step !== 'form' || !expiresAt) return;
    const interval = setInterval(() => {
      const diff = Math.max(0, expiresAt - Date.now());
      if (diff <= 0) {
        setTimeLeftStr('00:00');
        clearInterval(interval);
        setErrorMessage('Sesi laporan telah berakhir (kedaluwarsa 10 menit). Silakan muat ulang halaman.');
        setStep('error');
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeLeftStr(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [step, expiresAt]);

  // Handle start reporting (creates 10-min session)
  const handleStartReporting = async () => {
    setIsSubmitting(true);
    const res = await createReportSession(publicId);
    setIsSubmitting(false);

    if (res.success && res.session_id) {
      setSessionId(res.session_id);
      setExpiresAt(res.expires_at);
      setStep('form');
    } else {
      setErrorMessage(res.error || 'Gagal memulai sesi laporan.');
      setStep('error');
    }
  };

  // Helper to overlay timestamp watermark at bottom-left corner of photo before upload
  const addTimestampWatermark = (dataUrl: string, equipmentName: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0);

        // WIB Time Stamp (Asia/Jakarta)
        const now = new Date();
        const timeFormatter = new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        const dateStr = timeFormatter.format(now).replace(/\./g, ':');
        const stampText = `📷 ${dateStr} WIB | ${equipmentName || 'EQUIPMENT'}`;

        const fontSize = Math.max(16, Math.floor(canvas.height / 35));
        ctx.font = `bold ${fontSize}px sans-serif, Arial`;

        const textMetrics = ctx.measureText(stampText);
        const padding = fontSize * 0.6;
        const boxWidth = textMetrics.width + padding * 2;
        const boxHeight = fontSize + padding * 1.5;
        const margin = fontSize * 0.8;

        const x = margin;
        const y = canvas.height - margin - boxHeight;

        // Semi-transparent dark background box
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(x, y, boxWidth, boxHeight, 6);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, boxWidth, boxHeight);
        }

        // Cyan text
        ctx.fillStyle = '#38bdf8';
        ctx.textBaseline = 'middle';
        ctx.fillText(stampText, x + padding, y + boxHeight / 2);

        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Handle photo capture / selection
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Ukuran file foto maksimal 10 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const rawDataUrl = reader.result as string;
      const stampedUrl = await addTimestampWatermark(rawDataUrl, equipment?.name || '');
      setPhotoBase64(stampedUrl);
      setPhotoPreview(stampedUrl);
    };
    reader.readAsDataURL(file);
  };

  // Handle submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reporterName.trim()) {
      alert('Nama pelapor wajib diisi');
      return;
    }
    if (!description.trim()) {
      alert('Keterangan gangguan wajib diisi');
      return;
    }
    if (!photoBase64) {
      alert('Wajib melampirkan minimal 1 foto bukti gangguan / layar error.');
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress('Mengunggah berkas laporan...');

    let photoObjectKey = '';
    let photoUrl = '';

    try {
      // 1. Upload photo (Mandatory)
      setSubmitProgress('Menyimpan foto dokumentasi ke storage aman...');
      const photoRes = await uploadAvsecIncidentPhoto(sessionId, photoBase64);
      if (photoRes.success) {
        photoObjectKey = photoRes.object_key || '';
        photoUrl = photoRes.photo_url || '';
      } else {
        console.warn('[AVSEC Photo Upload Warning]:', photoRes.error);
      }

      // 2. Submit error report
      setSubmitProgress('Meneruskan laporan & mengirim notifikasi ke teknisi on-duty...');
      const subRes = await submitAvsecErrorReport({
        session_id: sanitizeText(sessionId),
        public_id: sanitizeText(publicId),
        reporter_name: sanitizeText(reporterName),
        reporter_unit: sanitizeText(reporterUnit) || 'AVSEC',
        issue_type: sanitizeText(issueType),
        description: sanitizeMultilineText(description),
        photo_object_key: sanitizeText(photoObjectKey),
        photo_url: photoUrl,
        latitude: null,
        longitude: null,
        location_accuracy: null,
      });

      if (subRes.success && subRes.report_number) {
        setSubmittedReportNumber(subRes.report_number);
        const formattedTime = subRes.created_at
          ? new Date(subRes.created_at).toLocaleString('id-ID', {
              timeZone: 'Asia/Jakarta',
              day: '2-digit',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }) + ' WIB'
          : new Date().toLocaleString('id-ID', {
              timeZone: 'Asia/Jakarta',
              day: '2-digit',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }) + ' WIB';
        setSubmittedAt(formattedTime);
        setStep('success');
      } else {
        setErrorMessage(subRes.error || 'Gagal mengirimkan laporan gangguan.');
        setStep('error');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan sistem saat mengirim laporan.');
      setStep('error');
    } finally {
      setIsSubmitting(false);
      setSubmitProgress('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between">
      {/* Header */}
      <header className="bg-slate-800/90 backdrop-blur-md border-b border-slate-700/80 px-4 py-3 sticky top-0 z-20 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-slate-900/60 rounded-xl border border-slate-700/60 flex items-center justify-center">
            <img src="/favicon.png" alt="NTI Logo" className="w-6 h-6 object-contain" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide">Pusat Laporan Gangguan AVSEC</h1>
            <p className="text-[11px] text-cyan-400 font-medium">Nararya Teknologi Indonesia</p>
          </div>
        </div>
      </header>

      {/* Content Container */}
      <main className="flex-1 max-w-lg w-full mx-auto p-4 flex flex-col justify-center">
        {/* 1. LOADING STATE */}
        {step === 'loading' && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center space-y-4 shadow-xl">
            <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
            <h2 className="text-base font-semibold text-white">Memvalidasi Kode QR Mesin...</h2>
            <p className="text-xs text-slate-400">Menghubungkan ke server pusat pemeliharaan...</p>
          </div>
        )}

        {/* 2. ERROR STATE */}
        {step === 'error' && (
          <div className="bg-slate-800 border border-red-500/30 rounded-2xl p-6 text-center space-y-4 shadow-xl">
            <div className="w-14 h-14 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-white">Laporan Tidak Dapat Diproses</h2>
            <p className="text-sm text-red-300 bg-red-950/40 p-3 rounded-xl border border-red-900/50">
              {errorMessage || 'Kode QR tidak dikenali atau sesi telah habis.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Coba Pindai Ulang QR
            </button>
          </div>
        )}

        {/* 3. STEP 1: CONFIRM EQUIPMENT */}
        {step === 'confirm' && equipment && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-6 shadow-2xl">
            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full text-xs font-semibold">
                <Info className="w-3.5 h-3.5" />
                Konfirmasi Peralatan
              </div>
              <h2 className="text-xl font-bold text-white pt-2">Mesin Terdeteksi</h2>
              <p className="text-xs text-slate-400">
                Pastikan nama dan lokasi unit di bawah sesuai dengan mesin yang Anda laporkan.
              </p>
            </div>

            {/* Equipment Card */}
            <div className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-slate-400 uppercase font-medium tracking-wider">Perangkat Fasilitas Keamanan</div>
                  <div className="text-lg font-bold text-cyan-400">{equipment.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold px-2.5 py-1 bg-cyan-950 text-cyan-300 rounded-lg border border-cyan-800">
                    {equipment.type || 'X-Ray'}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleStartReporting}
              disabled={isSubmitting}
              className="w-full py-3.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-600/30 transition flex items-center justify-center gap-2 text-sm tracking-wide disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Membuka Formulir...
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  Laporkan Gangguan Sekarang
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}

        {/* 4. STEP 2: REPORT FORM */}
        {step === 'form' && equipment && (
          <form onSubmit={handleSubmit} className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4 shadow-2xl">
            {/* Header with Timer */}
            <div className="flex items-center justify-between border-b border-slate-700/80 pb-3">
              <div>
                <h2 className="text-base font-bold text-white">Form Laporan Gangguan</h2>
                <p className="text-xs text-cyan-400 font-medium">
                  {equipment.name} • {equipment.location_name}
                </p>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg text-xs font-mono font-bold">
                <Clock className="w-3.5 h-3.5 animate-pulse" />
                {timeLeftStr}
              </div>
            </div>

            {/* Nama Pelapor & Unit */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nama Pelapor <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Budi Santoso"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Unit / Instansi <span className="text-red-400">*</span>
                </label>
                <select
                  value={reporterUnit}
                  onChange={(e) => setReporterUnit(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="AVSEC">AVSEC</option>
                  <option value="LEADER AVSEC">LEADER AVSEC</option>
                </select>
              </div>
            </div>

            {/* Jenis Gangguan */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Jenis Gangguan <span className="text-red-400">*</span>
              </label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                {ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Keterangan */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Keterangan Kerusakan / Gejala <span className="text-red-400">*</span>
              </label>
              <textarea
                required
                rows={3}
                placeholder="Jelaskan detail kendala (misal: conveyor macet saat barang masuk, layar hitam, tombol darurat tidak merespons, dll)..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            {/* Upload Foto Dokumentasi (Mandatory) */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Foto Bukti Kerusakan / Layar Error <span className="text-red-400">* (Wajib Minimal 1 Foto)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoSelect}
              />

              {photoPreview ? (
                <div className="relative rounded-xl overflow-hidden border border-cyan-500/50 max-h-48 bg-black flex items-center justify-center">
                  <img src={photoPreview} alt="Preview Bukti" className="max-h-48 w-auto object-contain" />
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoBase64(null);
                      setPhotoPreview(null);
                    }}
                    className="absolute top-2 right-2 p-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-full backdrop-blur-sm cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3 px-4 border border-dashed border-red-500/40 hover:border-cyan-500 bg-slate-900/60 hover:bg-slate-900 rounded-xl text-xs text-slate-300 flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-cyan-400" />
                  <span>Ambil Foto Bukti Kerusakan (Wajib)</span>
                </button>
              )}
            </div>

            {/* Equipment Location & Type Info */}
            <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/80">
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="font-medium text-slate-200">
                  Lokasi: <strong className="text-white">{equipment.location_name || equipment.name}</strong>
                </span>
              </div>
              <span className="text-[10px] text-cyan-400/80 font-mono font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
                {equipment.type || 'X-Ray'}
              </span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-600/30 transition flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{submitProgress || 'Mengirim Laporan...'}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Kirim Laporan ke Teknisi On-Duty
                </>
              )}
            </button>
          </form>
        )}

        {/* 5. STEP 3: SUCCESS CONFIRMATION */}
        {step === 'success' && equipment && (
          <div className="bg-slate-800 border border-emerald-500/30 rounded-2xl p-6 text-center space-y-5 shadow-2xl">
            <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/30">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-white">Laporan Berhasil Diterima!</h2>
              <p className="text-xs text-slate-400">
                Notifikasi otomatis telah dikirim langsung ke grup Telegram tim teknisi bandara.
              </p>
            </div>

            {/* Receipt Summary Card */}
            <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-4 text-left space-y-2 text-xs">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="text-slate-400">Nomor Laporan:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">{submittedReportNumber}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Equipment:</span>
                <span className="font-semibold text-slate-200">{equipment.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Lokasi:</span>
                <span className="font-semibold text-slate-200">{equipment.location_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Pelapor:</span>
                <span className="text-slate-200">{reporterName} ({reporterUnit})</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Jenis Gangguan:</span>
                <span className="text-amber-300 font-medium">{issueType}</span>
              </div>
              <div className="flex justify-between items-center border-t border-slate-800 pt-2">
                <span className="text-slate-400">Waktu Lapor:</span>
                <span className="text-slate-300">{submittedAt || 'Baru saja'}</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-xs text-emerald-300">
              Teknisi yang sedang bertugas akan segera melakukan pengecekan ke lokasi. Terima kasih atas laporannya.
            </div>

            <button
              onClick={() => {
                setStep('confirm');
                setDescription('');
                setPhotoBase64(null);
                setPhotoPreview(null);
              }}
              className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition text-xs"
            >
              Buat Laporan Gangguan Baru
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-xs text-slate-500 border-t border-slate-800">
        PT. Nararya Teknologi Indonesia • Bandara Halim Perdanakusuma
      </footer>
    </div>
  );
};
