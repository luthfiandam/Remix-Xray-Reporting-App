import React, { useState } from 'react';
import {
  Copy,
  Check,
  Loader2,
  Download,
  RefreshCw,
  CheckCircle2,
  MessageSquare,
  AlertCircle,
  Share2,
  Sparkles,
} from 'lucide-react';
import { StructuredReportData } from '../../types';
import {
  generateWhatsAppReportText,
  generateCorrectiveWhatsAppReportText,
} from '../../services/reportService';
import { formatTimeRange } from '../../utils/timeFormat';
import { INTERVAL_NAMES } from './types';
import {
  sendWhatsAppDirectText,
  sendWhatsAppDirectPhoto,
  getWhatsAppStatus,
} from '../../services/whatsappService';
import {
  generatePhotoCollageFile,
  CollageItem,
} from '../../utils/collageService';
import { getEvidenceUrl, isCollageEvidence, findCollageEvidence } from '../../utils/evidenceUtils';
import { extractS3ObjectKey } from '../../utils/s3ObjectKey';
import { toast } from '../Toast';

interface WhatsAppReportSectionProps {
  structuredData: StructuredReportData;
  submittedFrequencyIds: number[];
  copiedFreqId: number | null;
  sharingFreqId: number | null;
  onCopyInterval: (text: string, freqId: number) => void;
  onShareInterval: (text: string, freqId?: number) => void;
  onShareCorrective: (text: string) => void;
  onDownloadCollage?: (freqId?: number) => void;
  onDownloadCorrectiveCollage?: () => void;
  downloadingCollageFreqId?: number | null;
}

export const WhatsAppReportSection: React.FC<WhatsAppReportSectionProps> = ({
  structuredData,
  submittedFrequencyIds,
  copiedFreqId,
  sharingFreqId,
  onCopyInterval,
  onShareInterval,
  onShareCorrective,
  onDownloadCollage,
  onDownloadCorrectiveCollage,
  downloadingCollageFreqId,
}) => {
  // Track which intervals have been explicitly generated
  const [generatedIntervals, setGeneratedIntervals] = useState<Record<number, boolean>>({});
  const [generatingFreqId, setGeneratingFreqId] = useState<number | null>(null);

  // Status pengiriman pesan & foto WhatsApp
  const [sendingStatus, setSendingStatus] = useState<
    Record<
      number,
      {
        isSending: boolean;
        step: string;
        current: number;
        total: number;
        error?: string;
        done?: boolean;
      }
    >
  >({});

  // Ambil daftar kolase alat per interval preventif
  const getEquipmentCollagesForFreq = (freqId: number) => {
    const list: Array<{
      equipmentName: string;
      locationName: string;
      typeCode?: string;
      equipmentType?: string;
      status: string;
      photos: CollageItem[];
      existingCollageUrl?: string;
    }> = [];

    structuredData.entries_by_type.forEach((group) => {
      group.entries.forEach((item) => {
        if (item.checklist_frequency_id === freqId) {
          if (item.evidences && item.evidences.length > 0) {
            // Cek apakah sudah ada foto kolase dari folder kolase
            const collageEv = item.evidences.find(isCollageEvidence);
            const existingCollageUrl = collageEv
              ? getEvidenceUrl(collageEv)
              : ((item as any).collage_url || undefined);

            const photos: CollageItem[] = [];
            item.evidences.forEach((ev, idx) => {
              const url = getEvidenceUrl(ev);
              if (url && !isCollageEvidence(ev)) {
                photos.push({
                  key: `${item.equipment_name}-${idx}`,
                  title: `${item.equipment_name}${item.evidences && item.evidences.length > 1 ? ` (${idx + 1})` : ''}`,
                  dataUrl: url,
                });
              }
            });

            if (existingCollageUrl || photos.length > 0) {
              list.push({
                equipmentName: item.equipment_name,
                locationName: item.location_name || '',
                typeCode: group.type_code,
                equipmentType: group.type_name || group.type_code,
                status: (item as any).status || 'Normal',
                photos,
                existingCollageUrl,
              });
            }
          }
        }
      });
    });

    return list;
  };

  // Siapkan foto payload: jika S3 key/URL, kembalikan key/URL langsung agar server membaca S3 direct.
  const resolvePhotoToDataUrl = async (
    eq: {
      equipmentName: string;
      locationName: string;
      typeCode?: string;
      equipmentType?: string;
      photos: CollageItem[];
      existingCollageUrl?: string;
    }
  ): Promise<string> => {
    // 1. Jika ada foto kolase dari folder kolase / database
    if (eq.existingCollageUrl) {
      if (eq.existingCollageUrl.startsWith('data:image')) {
        return eq.existingCollageUrl;
      }
      const extractedKey = extractS3ObjectKey(eq.existingCollageUrl);
      if (extractedKey) {
        return extractedKey;
      }
      return eq.existingCollageUrl;
    }

    // 2. Jika belum ada di folder kolase, buat kolase dari kumpulan foto individu
    if (eq.photos && eq.photos.length > 0) {
      try {
        const collageFile = await generatePhotoCollageFile({
          photos: eq.photos,
          equipmentName: eq.equipmentName,
          locationName: eq.locationName,
          typeCode: eq.typeCode,
          equipmentType: eq.equipmentType || eq.typeCode,
          date: structuredData.operational_date,
          shift: structuredData.shift,
          technicians: structuredData.technicians,
        });
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(collageFile);
        });
      } catch (colErr) {
        console.warn('[resolvePhotoToDataUrl] Gagal membuat kolase:', colErr);
        return '';
      }
    }

    return '';
  };

  // Kirim Teks Rekap + HANYA Foto Kolase (TANPA TEXT/CAPTION) dengan jeda 1 detik antar foto
  const handleSendToWhatsAppWithCollages = async (freqId: number, waText: string) => {
    const eqList = getEquipmentCollagesForFreq(freqId);
    setSendingStatus((prev) => ({
      ...prev,
      [freqId]: {
        isSending: true,
        step: 'Mengirim teks rekapitulasi dinas ke WhatsApp...',
        current: 0,
        total: eqList.length,
      },
    }));

    try {
      // 0. Cek apakah opsi "Laporan WhatsApp + Kolase Foto per Interval" aktif di pengaturan WhatsApp
      const waStatus = await getWhatsAppStatus().catch(() => null);
      if (waStatus && waStatus.config && waStatus.config.auto_notify_preventive === false) {
        throw new Error(
          'Fitur "Laporan WhatsApp + Kolase Foto per Interval" sedang dinonaktifkan di Pengaturan Bot WhatsApp. Aktifkan opsi centang tersebut terlebih dahulu.'
        );
      }

      // 1. Kirim pesan teks rekap dinas terlebih dahulu
      const textRes = await sendWhatsAppDirectText({ message: waText });
      if (!textRes.success) {
        throw new Error(
          textRes.error ||
            'Bot WhatsApp belum terhubung. Silakan hubungkan WhatsApp di menu Pengaturan Bot WA.'
        );
      }

      // 2. Jeda 1 detik sebelum mulai kirim foto kolase
      await new Promise((r) => setTimeout(r, 1000));

      // 3. Kirim HANYA FOTO KOLASE per alat TANPA TEXT/CAPTION dengan jeda 1 detik
      let sentPhotosCount = 0;
      let failedPhotosCount = 0;
      for (let i = 0; i < eqList.length; i++) {
        const eq = eqList[i];
        setSendingStatus((prev) => ({
          ...prev,
          [freqId]: {
            isSending: true,
            step: `Mengirim foto kolase ${eq.equipmentName} (${i + 1}/${eqList.length})...`,
            current: i + 1,
            total: eqList.length,
          },
        }));

        const photoPayload = await resolvePhotoToDataUrl(eq);
        if (photoPayload) {
          // TANPA TEXT / CAPTION: caption dikosongkan sesuai permintaan pengguna
          const photoRes = await sendWhatsAppDirectPhoto({
            photo: photoPayload,
            caption: '',
          });
          if (photoRes && photoRes.success) {
            sentPhotosCount++;
          } else {
            failedPhotosCount++;
            console.warn(`[WAHA Photo Failed] ${eq.equipmentName}:`, photoRes?.error);
          }
        } else {
          failedPhotosCount++;
          console.warn(`[WAHA Photo Failed] ${eq.equipmentName}: tidak tersedia foto kolase yang valid`);
        }

        // Jeda 1 detik antar foto
        if (i < eqList.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      setSendingStatus((prev) => ({
        ...prev,
        [freqId]: {
          isSending: false,
          step: failedPhotosCount === 0
            ? `Berhasil! Teks laporan dan ${sentPhotosCount} foto kolase peralatan telah terkirim ke WhatsApp.`
            : `Selesai Parsial: Teks terkirim. ${sentPhotosCount} foto berhasil, ${failedPhotosCount} foto gagal.`,
          current: sentPhotosCount,
          total: eqList.length,
          done: failedPhotosCount === 0,
        },
      }));

      if (failedPhotosCount === 0) {
        toast.success('Laporan WhatsApp Terkirim', {
          message: `Teks rekap dan ${sentPhotosCount} foto kolase berhasil disiarkan ke WhatsApp.`,
        });
      } else {
        toast.warning('Pengiriman Parsial', {
          message: `${sentPhotosCount} foto terkirim, ${failedPhotosCount} foto gagal terkirim ke WhatsApp.`,
        });
      }
    } catch (err: any) {
      setSendingStatus((prev) => ({
        ...prev,
        [freqId]: {
          isSending: false,
          step: `Gagal: ${err.message || 'Kendala saat mengirim ke WhatsApp'}`,
          current: 0,
          total: eqList.length,
          error: err.message,
        },
      }));
      toast.error('Gagal Kirim WhatsApp', err.message || 'Terjadi kesalahan pengiriman.');
    }
  };

  // Kirim Laporan Corrective + HANYA Foto Kolase TANPA TEXT/CAPTION dengan jeda 1 detik
  const handleSendCorrectiveToWhatsAppWithCollages = async (waText: string) => {
    const correctiveList: Array<{
      equipmentName: string;
      locationName: string;
      photos: CollageItem[];
      existingCollageUrl?: string;
    }> = [];

    (structuredData.corrective_entries || []).forEach((item) => {
      if ((item.evidences && item.evidences.length > 0) || item.collage_object_key || (item as any).collage_url) {
        const collageEv = findCollageEvidence(item.evidences || []);
        const existingCollageUrl =
          item.collage_object_key ||
          (item as any).collage_object_key ||
          (collageEv ? getEvidenceUrl(collageEv) : undefined) ||
          item.collage_url ||
          (item as any).collage_url ||
          undefined;

        const photos: CollageItem[] = [];
        (item.evidences || []).forEach((ev, idx) => {
          if (!isCollageEvidence(ev)) {
            const url = getEvidenceUrl(ev);
            if (url) {
              photos.push({
                key: `corr-${item.equipment_name}-${idx}`,
                title: `${item.equipment_name || 'Corrective'}${item.evidences && item.evidences.length > 1 ? ` (${idx + 1})` : ''}`,
                dataUrl: url,
              });
            }
          }
        });

        if (existingCollageUrl || photos.length > 0) {
          correctiveList.push({
            equipmentName: item.equipment_name || 'Corrective Equipment',
            locationName: item.location_name || '',
            photos,
            existingCollageUrl,
          });
        }
      }
    });

    setSendingStatus((prev) => ({
      ...prev,
      [999]: {
        isSending: true,
        step: 'Mengirim teks laporan corrective ke WhatsApp...',
        current: 0,
        total: correctiveList.length,
      },
    }));

    try {
      // 0. Cek apakah opsi laporan WhatsApp aktif di pengaturan WhatsApp
      const waStatus = await getWhatsAppStatus().catch(() => null);
      if (waStatus && waStatus.config && waStatus.config.auto_notify_preventive === false) {
        throw new Error(
          'Fitur "Laporan WhatsApp + Kolase Foto per Interval" sedang dinonaktifkan di Pengaturan Bot WhatsApp. Aktifkan opsi centang tersebut terlebih dahulu.'
        );
      }

      // 1. Kirim teks laporan corrective
      const textRes = await sendWhatsAppDirectText({ message: waText });
      if (!textRes.success) {
        throw new Error(
          textRes.error ||
            'Bot WhatsApp belum terhubung. Silakan hubungkan WhatsApp di menu Pengaturan Bot WA.'
        );
      }

      // 2. Jeda 1 detik
      await new Promise((r) => setTimeout(r, 1000));

      // 3. Kirim HANYA FOTO KOLASE corrective TANPA TEXT/CAPTION dengan jeda 1 detik
      let sentPhotosCount = 0;
      let failedPhotosCount = 0;
      for (let i = 0; i < correctiveList.length; i++) {
        const item = correctiveList[i];
        setSendingStatus((prev) => ({
          ...prev,
          [999]: {
            isSending: true,
            step: `Mengirim foto kolase corrective ${item.equipmentName} (${i + 1}/${correctiveList.length})...`,
            current: i + 1,
            total: correctiveList.length,
          },
        }));

        const photoPayload = await resolvePhotoToDataUrl(item);
        if (photoPayload) {
          // TANPA TEXT / CAPTION
          const photoRes = await sendWhatsAppDirectPhoto({
            photo: photoPayload,
            caption: '',
          });
          if (photoRes && photoRes.success) {
            sentPhotosCount++;
          } else {
            failedPhotosCount++;
            console.warn(`[WAHA Corrective Photo Failed] ${item.equipmentName}:`, photoRes?.error);
          }
        } else {
          failedPhotosCount++;
          console.warn(`[WAHA Corrective Photo Failed] ${item.equipmentName}: photo payload empty`);
        }

        if (i < correctiveList.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      setSendingStatus((prev) => ({
        ...prev,
        [999]: {
          isSending: false,
          step: failedPhotosCount === 0
            ? `Berhasil! Laporan corrective dan ${sentPhotosCount} foto kolase telah terkirim ke WhatsApp.`
            : `Selesai Parsial: Teks terkirim. ${sentPhotosCount} foto berhasil, ${failedPhotosCount} foto gagal.`,
          current: sentPhotosCount,
          total: correctiveList.length,
          done: failedPhotosCount === 0,
        },
      }));

      if (failedPhotosCount === 0) {
        toast.success('Laporan Corrective Terkirim', {
          message: `Teks laporan dan ${sentPhotosCount} foto kolase berhasil disiarkan ke WhatsApp.`,
        });
      } else {
        toast.warning('Pengiriman Parsial', {
          message: `${sentPhotosCount} foto terkirim, ${failedPhotosCount} foto gagal terkirim ke WhatsApp.`,
        });
      }
    } catch (err: any) {
      setSendingStatus((prev) => ({
        ...prev,
        [999]: {
          isSending: false,
          step: `Gagal: ${err.message || 'Kendala saat mengirim ke WhatsApp'}`,
          current: 0,
          total: correctiveList.length,
          error: err.message,
        },
      }));
      toast.error('Gagal Kirim WhatsApp', err.message || 'Terjadi kesalahan pengiriman.');
    }
  };

  // Handler Generate / Perbarui Laporan
  const handleTriggerGenerate = (freqId: number) => {
    setGeneratingFreqId(freqId);
    setTimeout(() => {
      setGeneratedIntervals((prev) => ({ ...prev, [freqId]: true }));
      setGeneratingFreqId(null);
      toast.success('Laporan Siap', {
        message: `Format teks WhatsApp untuk ${INTERVAL_NAMES[freqId] || 'laporan'} berhasil di-generate.`,
      });
    }, 350);
  };

  // Handler Copy Text
  const handleCopyText = (freqId: number, text: string) => {
    onCopyInterval(text, freqId);
  };

  // Handler Kirim ke WhatsApp
  const handleSendToWhatsApp = (freqId: number, text: string) => {
    if (freqId === 999) {
      handleSendCorrectiveToWhatsAppWithCollages(text);
    } else {
      handleSendToWhatsAppWithCollages(freqId, text);
    }
  };

  // Handler Share
  const handleShare = (freqId: number, text: string) => {
    if (freqId === 999) {
      onShareCorrective(text);
    } else {
      onShareInterval(text, freqId);
    }
  };

  // Handler Unduh Foto Kolase
  const handleDownloadCollage = (freqId: number) => {
    if (freqId === 999) {
      if (onDownloadCorrectiveCollage) {
        onDownloadCorrectiveCollage();
      } else {
        toast.info('Foto Kolase', 'Fitur unduh kolase corrective tidak tersedia.');
      }
    } else {
      if (onDownloadCollage) {
        onDownloadCollage(freqId);
      } else {
        toast.info('Foto Kolase', 'Fitur unduh kolase tidak tersedia.');
      }
    }
  };

  const hasNoData =
    submittedFrequencyIds.length === 0 &&
    (!structuredData.corrective_entries || structuredData.corrective_entries.length === 0);

  // Render tombol yang 100% DISEJAJARIN di mobile (Grid 2 Kolom presisi)
  const renderAlignedActionButtons = (freqId: number, waText: string) => {
    const isGenerating = generatingFreqId === freqId;
    const isCopied = copiedFreqId === freqId;
    const isSending = sendingStatus[freqId]?.isSending;
    const isSharing = sharingFreqId === freqId;
    const isDownloading = downloadingCollageFreqId === freqId;

    return (
      <div className="w-full grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:w-auto">
        {/* 1. Perbarui (Row 1, Col 1) */}
        <button
          type="button"
          onClick={() => handleTriggerGenerate(freqId)}
          disabled={isGenerating}
          title="Generate ulang dan sinkronkan dengan data terbaru"
          className="w-full sm:w-auto h-9 px-3 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-2xs cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
          <span>Perbarui</span>
        </button>

        {/* 2. copy text (Row 1, Col 2) */}
        <button
          type="button"
          onClick={() => handleCopyText(freqId, waText)}
          title="Salin teks laporan ke clipboard"
          className="w-full sm:w-auto h-9 px-3 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-2xs cursor-pointer"
        >
          {isCopied ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span>{isCopied ? 'Tercopy!' : 'copy text'}</span>
        </button>

        {/* 3. Kirim ke whatsapp (Row 2, Col 1) */}
        <button
          type="button"
          onClick={() => handleSendToWhatsApp(freqId, waText)}
          disabled={isSending}
          title="Kirim teks laporan dan foto kolase (tanpa teks) dengan jeda 1 detik ke WhatsApp"
          className="w-full sm:w-auto h-9 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-60"
        >
          {isSending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5" />
          )}
          <span>
            {isSending
              ? `Mengirim (${sendingStatus[freqId]?.current || 0}/${sendingStatus[freqId]?.total || 0})...`
              : 'Kirim ke whatsapp'}
          </span>
        </button>

        {/* 4. Share (Row 2, Col 2) */}
        <button
          type="button"
          onClick={() => handleShare(freqId, waText)}
          disabled={isSharing}
          title="Buka menu berbagi HP / WhatsApp Web"
          className="w-full sm:w-auto h-9 px-3 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer disabled:opacity-60"
        >
          {isSharing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Share2 className="w-3.5 h-3.5" />
          )}
          <span>{isSharing ? 'Membuka...' : 'Share'}</span>
        </button>

        {/* 5. Unduh foto kolase (Row 3, Col 1 & 2 full-width di mobile) */}
        <button
          type="button"
          onClick={() => handleDownloadCollage(freqId)}
          disabled={isDownloading}
          title="Unduh foto kolase peralatan interval ini"
          className="w-full sm:w-auto h-9 px-3 col-span-2 sm:col-span-1 bg-blue-50 hover:bg-blue-100 active:scale-[0.98] text-blue-700 border border-blue-200/90 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer disabled:opacity-60"
        >
          {isDownloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
          ) : (
            <Download className="w-3.5 h-3.5 text-blue-600" />
          )}
          <span>{isDownloading ? 'Mengunduh...' : 'Unduh foto kolase'}</span>
        </button>
      </div>
    );
  };

  return (
    <div className="w-full space-y-4">
      {hasNoData ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs text-center text-slate-500 text-xs">
          Belum ada data preventive atau corrective yang disubmit pada shift ini.
        </div>
      ) : (
        <>
          {/* Preventive Maintenance Intervals */}
          {submittedFrequencyIds.map((freqId) => {
            const freqName = INTERVAL_NAMES[freqId] || 'PENGUJIAN';
            const isGenerated = Boolean(generatedIntervals[freqId]);
            const isGenerating = generatingFreqId === freqId;
            const waTextForInterval = isGenerated ? generateWhatsAppReportText(structuredData, freqId) : '';

            return (
              <div
                key={freqId}
                className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-3">
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    <h3 className="text-sm font-bold text-slate-800 whitespace-nowrap">
                      Preventive Maintenance {freqName}
                    </h3>
                    {isGenerated ? (
                      <span className="whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        Generated
                      </span>
                    ) : (
                      <span className="whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                        Siap Kirim
                      </span>
                    )}
                  </div>

                  {/* Tombol Generate Utama (jika belum di-generate) */}
                  {!isGenerated ? (
                    <button
                      type="button"
                      onClick={() => handleTriggerGenerate(freqId)}
                      disabled={isGenerating}
                      className="w-full sm:w-auto h-10 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      {isGenerating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      <span>{isGenerating ? 'Memproses Laporan...' : `⚡ Generate Laporan ${freqName}`}</span>
                    </button>
                  ) : (
                    /* Tombol-tombol Aksi yang 100% DISEJAJARIN di mobile */
                    renderAlignedActionButtons(freqId, waTextForInterval)
                  )}
                </div>

                {/* Delivery Status Banner */}
                {sendingStatus[freqId] && (
                  <div
                    className={`p-3 rounded-xl text-xs border flex items-center gap-2.5 transition-all ${
                      sendingStatus[freqId].isSending
                        ? 'bg-blue-50 border-blue-200 text-blue-800'
                        : sendingStatus[freqId].error
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    }`}
                  >
                    {sendingStatus[freqId].isSending && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                    )}
                    {sendingStatus[freqId].done && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    )}
                    {sendingStatus[freqId].error && (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span className="font-semibold">{sendingStatus[freqId].step}</span>
                  </div>
                )}

                {/* WhatsApp Text Preview Block */}
                {isGenerated ? (
                  <div className="bg-slate-900 text-emerald-400 font-mono text-xs p-4 sm:p-5 rounded-2xl whitespace-pre-wrap leading-relaxed shadow-inner overflow-x-auto selection:bg-emerald-800 selection:text-white max-h-[350px] overflow-y-auto">
                    {waTextForInterval}
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-5 text-center">
                    <p className="text-xs text-slate-600">
                      Klik tombol <b>"⚡ Generate Laporan {freqName}"</b> di atas untuk menghasilkan teks rekap dinas dan mengaktifkan tombol pengiriman WhatsApp beserta foto kolase.
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Corrective Maintenance Section */}
          {structuredData.corrective_entries &&
            structuredData.corrective_entries.length > 0 &&
            (() => {
              const isCorrectiveGenerated = Boolean(generatedIntervals[999]);
              const isGeneratingCorrective = generatingFreqId === 999;
              const correctiveWaText = isCorrectiveGenerated
                ? generateCorrectiveWhatsAppReportText(structuredData)
                : '';

              return (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-3">
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <h3 className="text-sm font-bold text-slate-800 whitespace-nowrap">
                        Corrective Maintenance
                      </h3>
                      {isCorrectiveGenerated ? (
                        <span className="whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          Generated
                        </span>
                      ) : (
                        <span className="whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                          Siap Kirim
                        </span>
                      )}
                    </div>

                    {/* Tombol Generate Utama Corrective */}
                    {!isCorrectiveGenerated ? (
                      <button
                        type="button"
                        onClick={() => handleTriggerGenerate(999)}
                        disabled={isGeneratingCorrective}
                        className="w-full sm:w-auto h-10 px-4 bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                      >
                        {isGeneratingCorrective ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        <span>
                          {isGeneratingCorrective ? 'Memproses...' : '⚡ Generate Laporan Corrective'}
                        </span>
                      </button>
                    ) : (
                      /* Tombol-tombol Aksi yang 100% DISEJAJARIN di mobile */
                      renderAlignedActionButtons(999, correctiveWaText)
                    )}
                  </div>

                  {/* Delivery Status Banner */}
                  {sendingStatus[999] && (
                    <div
                      className={`p-3 rounded-xl text-xs border flex items-center gap-2.5 transition-all ${
                        sendingStatus[999].isSending
                          ? 'bg-blue-50 border-blue-200 text-blue-800'
                          : sendingStatus[999].error
                          ? 'bg-rose-50 border-rose-200 text-rose-700'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                    >
                      {sendingStatus[999].isSending && (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                      )}
                      {sendingStatus[999].done && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      )}
                      {sendingStatus[999].error && (
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <span className="font-semibold">{sendingStatus[999].step}</span>
                    </div>
                  )}

                  {/* WhatsApp Text Preview Block */}
                  {isCorrectiveGenerated ? (
                    <div className="bg-slate-900 text-emerald-400 font-mono text-xs p-4 sm:p-5 rounded-2xl whitespace-pre-wrap leading-relaxed shadow-inner overflow-x-auto selection:bg-emerald-800 selection:text-white max-h-[350px] overflow-y-auto">
                      {correctiveWaText}
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-5 text-center">
                      <p className="text-xs text-slate-600">
                        Klik tombol <b>"⚡ Generate Laporan Corrective"</b> di atas untuk menghasilkan teks laporan dan mengaktifkan pengiriman WhatsApp beserta foto bukti kolase.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
        </>
      )}
    </div>
  );
};
