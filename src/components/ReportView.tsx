import React, { useState, useMemo } from 'react';
import { StructuredReportData } from '../types';
import { generateWhatsAppReportText, getHistoricalReportList } from '../services/reportService';
import { generatePhotoCollageFile, buildCollageFileName, CollageItem } from '../utils/collageService';
import { shareReport, triggerFileDownload } from '../utils/webShareUtils';
import { sendTelegramMessage } from '../services/telegramService';
import { downloadReportPdf, shareReportPdf, sendReportPdfToWhatsApp } from '../pdf/pdfService';
import { generateOfficialExcelReport, downloadExcelFile } from '../services/excelReportGenerator';
import { getReportPdfArchivePathAndFilename } from '../utils/pdfArchiveUtils';
import { formatTimeRange } from '../utils/timeFormat';
import { toCanonicalShiftCode } from '../utils/contextFilter';
import { getEvidenceUrl, isCollageEvidence, findCollageEvidence } from '../utils/evidenceUtils';
import { toast } from './Toast';
import {
  ReportViewProps,
  ReportSubTab,
  ReportSubTabNavigation,
  WhatsAppReportSection,
  ExcelExportSection,
  PdfExportSection,
  HistoricalReportListSection,
} from './report';

export { type ReportViewProps };

/**
 * ReportView
 * Orchestrates multi-format reporting: WhatsApp Text & Collages, CSV/Excel Export,
 * Official Print/PDF Export, and Historical Reports archive.
 * References: src/assets/logopt.png
 */
export const ReportView: React.FC<ReportViewProps> = ({
  structuredData,
  preventiveEntries = [],
  correctiveReports = [],
  equipments = [],
  equipmentTypes = [],
  technicians = [],
  locations = [],
  currentSession,
  onSelectHistoricalReport,
  selectedHistoricalDate,
  selectedHistoricalShift,
  isHistoricalActive,
  onResetToCurrentSession,
  activeSubTab: externalSubTab,
  onSubTabChange,
  role = 'technician',
}) => {
  const [internalSubTab, setInternalSubTab] = useState<ReportSubTab>('wa');
  const activeSubTab = externalSubTab || internalSubTab;
  const setActiveSubTab = (tab: ReportSubTab) => {
    setInternalSubTab(tab);
    if (onSubTabChange) onSubTabChange(tab);
  };
  const [copiedFreqId, setCopiedFreqId] = useState<number | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [selectedPdfFreqId, setSelectedPdfFreqId] = useState<number>(1);
  const [sharingFreqId, setSharingFreqId] = useState<number | null>(null);
  const [downloadingCollageFreqId, setDownloadingCollageFreqId] = useState<number | null>(null);

  const getPreventiveEquipmentCollages = (freqId?: number) => {
    const result: {
      equipmentName: string;
      locationName: string;
      typeCode: string;
      photos: CollageItem[];
      existingCollageUrl?: string;
    }[] = [];

    structuredData.entries_by_type.forEach((group) => {
      group.entries.forEach((item) => {
        if (!freqId || item.checklist_frequency_id === freqId) {
          if (item.evidences && item.evidences.length > 0) {
            const collageEv = findCollageEvidence(item.evidences);
            const existingCollageUrl = collageEv
              ? getEvidenceUrl(collageEv)
              : ((item as any).collage_url || undefined);

            const photos: CollageItem[] = [];
            item.evidences.forEach((ev, idx) => {
              if (!isCollageEvidence(ev)) {
                const url = getEvidenceUrl(ev);
                if (url) {
                  photos.push({
                    key: `${item.equipment_name}-${idx}`,
                    title: `${item.equipment_name}${item.evidences && item.evidences.length > 1 ? ` (${idx + 1})` : ''}`,
                    dataUrl: url,
                  });
                }
              }
            });

            if (photos.length > 0 || existingCollageUrl) {
              result.push({
                equipmentName: item.equipment_name,
                locationName: item.location_name || '',
                typeCode: group.type_code,
                photos,
                existingCollageUrl,
              });
            }
          }
        }
      });
    });

    return result;
  };

  const getCorrectiveEquipmentCollages = () => {
    const result: {
      equipmentName: string;
      locationName: string;
      typeCode: string;
      photos: CollageItem[];
      existingCollageUrl?: string;
    }[] = [];

    if (structuredData.corrective_entries && structuredData.corrective_entries.length > 0) {
      structuredData.corrective_entries.forEach((item) => {
        if (item.evidences && item.evidences.length > 0) {
          const collageEv = findCollageEvidence(item.evidences);
          const existingCollageUrl = collageEv
            ? getEvidenceUrl(collageEv)
            : ((item as any).collage_url || undefined);

          const photos: CollageItem[] = [];
          item.evidences.forEach((ev, idx) => {
            if (!isCollageEvidence(ev)) {
              const url = getEvidenceUrl(ev);
              if (url) {
                photos.push({
                  key: `${item.equipment_name}-${idx}`,
                  title: `${item.equipment_name}${item.evidences && item.evidences.length > 1 ? ` (${idx + 1})` : ''}`,
                  dataUrl: url,
                });
              }
            }
          });

          if (photos.length > 0 || existingCollageUrl) {
            result.push({
              equipmentName: item.equipment_name,
              locationName: item.location_name || '',
              typeCode: item.type_code || 'CORRECTIVE',
              photos,
              existingCollageUrl,
            });
          }
        }
      });
    }

    return result;
  };

  const handleDownloadCollageOnly = async (freqId?: number) => {
    const targetFreqId = freqId || 1;
    setDownloadingCollageFreqId(targetFreqId);

    const eqCollages = getPreventiveEquipmentCollages(freqId);

    if (eqCollages.length === 0) {
      toast.error('Tidak Ada Foto', {
        message: 'Belum ada foto bukti yang terlampir pada checklist interval ini.',
        badge: 'Foto Kolase',
      });
      setDownloadingCollageFreqId(null);
      return;
    }

    toast.info('Mengunduh Foto Kolase...', {
      message: `Sedang memproses ${eqCollages.length} foto kolase alat...`,
      duration: 2500,
      badge: 'Foto Kolase',
    });

    try {
      for (let i = 0; i < eqCollages.length; i++) {
        const eq = eqCollages[i];
        const fileName = buildCollageFileName(
          structuredData.operational_date,
          structuredData.shift,
          eq.typeCode,
          eq.equipmentName,
          eq.locationName
        );

        const file = await generatePhotoCollageFile(
          {
            equipmentName: eq.equipmentName,
            locationName: eq.locationName,
            equipmentType: eq.typeCode,
            typeCode: eq.typeCode,
            photos: eq.photos,
            date: structuredData.operational_date,
            shift: structuredData.shift,
            technicians: structuredData.technicians,
          },
          fileName
        );

        triggerFileDownload(file, fileName);

        if (i < eqCollages.length - 1) {
          await new Promise((res) => setTimeout(res, 400));
        }
      }

      toast.success('Foto Kolase Berhasil Diunduh!', {
        message: `${eqCollages.length} foto kolase alat telah berhasil diunduh.`,
        badge: 'Foto Kolase',
      });
    } catch (err: any) {
      console.error('Error generating collages:', err);
      toast.error('Gagal Mengunduh Kolase', {
        message: err?.message || 'Terjadi kesalahan saat membuat foto kolase.',
      });
    } finally {
      setDownloadingCollageFreqId(null);
    }
  };

  const handleDownloadCorrectiveCollageOnly = async () => {
    setDownloadingCollageFreqId(999);

    const eqCollages = getCorrectiveEquipmentCollages();

    if (eqCollages.length === 0) {
      toast.error('Tidak Ada Foto', {
        message: 'Belum ada foto bukti yang terlampir pada laporan corrective ini.',
        badge: 'Kolase Corrective',
      });
      setDownloadingCollageFreqId(null);
      return;
    }

    toast.info('Mengunduh Foto Kolase Corrective...', {
      message: `Sedang memproses ${eqCollages.length} foto kolase alat corrective...`,
      duration: 2500,
      badge: 'Kolase Corrective',
    });

    try {
      for (let i = 0; i < eqCollages.length; i++) {
        const eq = eqCollages[i];
        const fileName = buildCollageFileName(
          structuredData.operational_date,
          structuredData.shift,
          eq.typeCode,
          eq.equipmentName,
          eq.locationName
        );

        const file = await generatePhotoCollageFile(
          {
            equipmentName: eq.equipmentName,
            locationName: eq.locationName,
            equipmentType: eq.typeCode,
            typeCode: eq.typeCode,
            photos: eq.photos,
            date: structuredData.operational_date,
            shift: structuredData.shift,
            technicians: structuredData.technicians,
          },
          fileName
        );

        triggerFileDownload(file, fileName);

        if (i < eqCollages.length - 1) {
          await new Promise((res) => setTimeout(res, 400));
        }
      }

      toast.success('Kolase Corrective Diunduh!', {
        message: `${eqCollages.length} foto kolase alat corrective telah diunduh.`,
        badge: 'Kolase Corrective',
      });
    } catch (err: any) {
      console.error('Error downloading corrective collage:', err);
      toast.error('Gagal Mengunduh Kolase', {
        message: err?.message || 'Terjadi kesalahan saat membuat kolase corrective.',
      });
    } finally {
      setDownloadingCollageFreqId(null);
    }
  };

  const historicalReports = useMemo(() => {
    return getHistoricalReportList(preventiveEntries, correctiveReports, technicians, currentSession);
  }, [preventiveEntries, correctiveReports, technicians, currentSession]);

  const submittedFrequencyIds: number[] = Array.from(
    new Set<number>(
      structuredData.entries_by_type.flatMap((g) =>
        g.entries
          .map((e) => e.checklist_frequency_id)
          .filter((id): id is number => typeof id === 'number')
      )
    )
  ).sort((a: number, b: number) => a - b);

  const handleCopyForInterval = (text: string, freqId: number) => {
    navigator.clipboard.writeText(text);
    setCopiedFreqId(freqId);
    toast.success('Format WhatsApp Disalin', {
      message: 'Format teks laporan rutin shift telah disalin ke clipboard.',
      badge: 'Laporan Rutin',
    });
    setTimeout(() => {
      setCopiedFreqId(null);
    }, 2000);
  };

  const handleShareReportForInterval = async (text: string, freqId?: number) => {
    const targetFreqId = freqId || 1;
    setSharingFreqId(targetFreqId);

    try {
      // 1. Auto-send report to Telegram in background (if configured)
      sendTelegramMessage({ message: text, parseMode: 'HTML' }).catch((tgErr) => {
        console.warn('[Telegram] Auto-send on share warning:', tgErr);
      });

      // 2. Generate all collage files for this frequency interval
      const eqCollages = getPreventiveEquipmentCollages(targetFreqId);
      const collageFiles: File[] = [];

      if (eqCollages.length > 0) {
        for (let i = 0; i < eqCollages.length; i++) {
          const eq = eqCollages[i];
          const fileName = buildCollageFileName(
            structuredData.operational_date,
            structuredData.shift,
            eq.typeCode,
            eq.equipmentName,
            eq.locationName
          );
          try {
            const collageFile = await generatePhotoCollageFile(
              {
                equipmentName: eq.equipmentName,
                locationName: eq.locationName,
                equipmentType: eq.typeCode,
                typeCode: eq.typeCode,
                photos: eq.photos,
                date: structuredData.operational_date,
                shift: structuredData.shift,
                technicians: structuredData.technicians,
              },
              fileName
            );
            if (collageFile) {
              collageFiles.push(collageFile);
            }
          } catch (colErr) {
            console.warn('[ReportView] Collage generation warning:', colErr);
          }
        }
      }

      // 3. Auto-copy report text to clipboard
      try {
        await navigator.clipboard.writeText(text);
        setCopiedFreqId(targetFreqId);
        setTimeout(() => setCopiedFreqId(null), 3000);
      } catch (clipErr) {
        console.warn('[Clipboard] Copy text warning:', clipErr);
      }

      // 4. Trigger Native Web Share API (Android & iPhone Share Sheet) with Files + Text
      const shareRes = await shareReport({
        title: `Laporan Preventive Maintenance (${structuredData.operational_date})`,
        text: text,
        files: collageFiles.length > 0 ? collageFiles : undefined,
      });

      if (shareRes.method === 'web-share-files' || shareRes.method === 'web-share-text') {
        toast.success('Laporan & Telegram Terkirim!', {
          message: 'Laporan terkirim ke Telegram & Layar berbagi HP terbuka.',
          badge: 'Berhasil',
          duration: 3000,
        });
      } else {
        if (collageFiles.length > 0) {
          collageFiles.forEach((file) => triggerFileDownload(file, file.name));
        }
        toast.success('Laporan Tersimpan & Terkirim ke Telegram!', {
          message: 'Laporan terkirim ke Telegram, teks tersalin & foto diunduh ke galeri.',
          badge: 'Berhasil',
          duration: 3500,
        });
      }
    } catch (err: any) {
      console.error('[WebShare] Error sharing report:', err);
      toast.error('Gagal Berbagi Laporan', err?.message || 'Terjadi kesalahan.');
    } finally {
      setSharingFreqId(null);
    }
  };

  const handleShareCorrectiveReport = async (text: string) => {
    setSharingFreqId(999);

    try {
      // 1. Auto-send corrective report to Telegram in background (if configured)
      sendTelegramMessage({ message: text, parseMode: 'HTML' }).catch((tgErr) => {
        console.warn('[Telegram] Auto-send corrective share warning:', tgErr);
      });

      // 2. Generate corrective collage files if evidence photos exist
      const eqCollages = getCorrectiveEquipmentCollages();
      const collageFiles: File[] = [];

      if (eqCollages.length > 0) {
        for (let i = 0; i < eqCollages.length; i++) {
          const eq = eqCollages[i];
          const fileName = buildCollageFileName(
            structuredData.operational_date,
            structuredData.shift,
            eq.typeCode,
            eq.equipmentName,
            eq.locationName
          );
          try {
            const collageFile = await generatePhotoCollageFile(
              {
                equipmentName: eq.equipmentName,
                locationName: eq.locationName,
                equipmentType: eq.typeCode,
                typeCode: eq.typeCode,
                photos: eq.photos,
                date: structuredData.operational_date,
                shift: structuredData.shift,
                technicians: structuredData.technicians,
              },
              fileName
            );
            if (collageFile) {
              collageFiles.push(collageFile);
            }
          } catch (colErr) {
            console.warn('[ReportView] Corrective collage generation warning:', colErr);
          }
        }
      }

      // 3. Auto-copy text to clipboard
      try {
        await navigator.clipboard.writeText(text);
        setCopiedFreqId(999);
        setTimeout(() => setCopiedFreqId(null), 3000);
      } catch (clipErr) {
        console.warn('[Clipboard] Copy corrective text warning:', clipErr);
      }

      // 4. Trigger Native Web Share API (Android & iPhone Share Sheet) with Files + Text
      const shareRes = await shareReport({
        title: `Laporan Corrective Maintenance (${structuredData.operational_date})`,
        text: text,
        files: collageFiles.length > 0 ? collageFiles : undefined,
      });

      if (shareRes.method === 'web-share-files' || shareRes.method === 'web-share-text') {
        toast.success('Laporan Corrective Siap!', {
          message: 'Laporan terkirim ke Telegram & Layar berbagi HP terbuka.',
          badge: 'Berhasil',
          duration: 3000,
        });
      } else {
        if (collageFiles.length > 0) {
          collageFiles.forEach((file) => triggerFileDownload(file, file.name));
        }
        toast.success('Laporan Corrective Tersimpan!', {
          message: 'Laporan terkirim ke Telegram, teks tersalin & foto diunduh ke galeri.',
          badge: 'Berhasil',
          duration: 3500,
        });
      }
    } catch (err: any) {
      console.error('[WebShare] Error sharing corrective report:', err);
      toast.error('Gagal Berbagi Laporan', err?.message || 'Terjadi kesalahan.');
    } finally {
      setSharingFreqId(null);
    }
  };

  const handleDownloadExcel = async () => {
    toast.info('Membuat Dokumen Excel Official...', {
      message: 'Menyusun tabel, kop PT Nararya, dan menyematkan foto kolase ke dalam sel Excel (.xlsx)...',
      duration: 3500,
      badge: 'Excel Official',
    });

    try {
      const blob = await generateOfficialExcelReport(structuredData, {
        freqId: 0,
        includeCorrective: true,
      });

      const dateClean = (structuredData.operational_date || 'terbaru').replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `Laporan_Maintenance_Official_PT_NTI_${dateClean}_Shift_${structuredData.shift || 'Pagi'}.xlsx`;

      downloadExcelFile(blob, filename);

      toast.success('Excel Official Berhasil Diunduh! 📊', {
        message: 'File Excel lengkap dengan foto kolase & format standar PT. Nararya telah diunduh.',
        badge: 'Excel Official',
      });
    } catch (err: any) {
      console.error('Excel Export Error:', err);
      toast.error('Gagal Mengunduh Excel', {
        message: err?.message || 'Terjadi kesalahan saat menggenerasi file Excel.',
      });
    }
  };

  const handleGeneratePDF = async (action: 'download' | 'share' | 'whatsapp', freqId?: number) => {
    const targetFreqId = freqId !== undefined ? freqId : selectedPdfFreqId;
    setActiveSubTab('pdf');
    setIsGeneratingPDF(true);
    toast.info('Memproses Dokumen PDF', {
      message: action === 'whatsapp' ? 'Merender PDF dan mengirim ke grup WhatsApp via WAHA...' : 'Sedang merender lembar kerja pemeliharaan resmi...',
      duration: 3000,
      badge: 'PDF Resmi',
    });
    try {
      if (action === 'share') {
        await shareReportPdf(structuredData, targetFreqId);
        toast.success('PDF Siap Dibagikan', {
          message: 'Dokumen lembar kerja pemeliharaan resmi siap dikirim.',
          badge: 'PDF Resmi',
        });
      } else if (action === 'whatsapp') {
        const res = await sendReportPdfToWhatsApp(structuredData, targetFreqId);
        toast.success('PDF Berhasil Terkirim ke WhatsApp! 🚀', {
          message: `Berkas ${res.fileName} telah dikirim ke grup WhatsApp.`,
          badge: 'WhatsApp Bot',
          duration: 4000,
        });
      } else {
        await downloadReportPdf(structuredData, targetFreqId);
        toast.success('PDF Laporan Terunduh', {
          message: 'Dokumen lembar kerja pemeliharaan resmi berhasil disimpan.',
          badge: 'PDF Resmi',
        });
      }
    } catch (reactPdfErr) {
      console.error('React-PDF vector generation failed:', reactPdfErr);
      const errorMsg = reactPdfErr instanceof Error ? reactPdfErr.message : String(reactPdfErr);
      toast.error(action === 'whatsapp' ? 'Gagal Kirim PDF ke WhatsApp' : 'Gagal Membuat PDF', {
        message: errorMsg,
        badge: 'Gagal Ekspor',
      });
      if (action !== 'whatsapp') {
        alert(`Gagal membuat dokumen PDF: ${errorMsg}. Silakan coba kembali atau gunakan tombol Print jika ingin mencetak halaman langsung.`);
      }
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-Tab Selectors & Actions */}
      <ReportSubTabNavigation
        activeSubTab={activeSubTab}
        setActiveSubTab={setActiveSubTab}
        isGeneratingPDF={isGeneratingPDF}
        onGeneratePdf={handleGeneratePDF}
        historicalCount={historicalReports.length}
        role={role}
      />

      {/* WhatsApp Preview Mode */}
      {activeSubTab === 'wa' && (
        <WhatsAppReportSection
          structuredData={structuredData}
          submittedFrequencyIds={submittedFrequencyIds}
          copiedFreqId={copiedFreqId}
          sharingFreqId={sharingFreqId}
          onCopyInterval={handleCopyForInterval}
          onShareInterval={handleShareReportForInterval}
          onShareCorrective={handleShareCorrectiveReport}
          onDownloadCollage={handleDownloadCollageOnly}
          onDownloadCorrectiveCollage={handleDownloadCorrectiveCollageOnly}
          downloadingCollageFreqId={downloadingCollageFreqId}
        />
      )}

      {/* Excel Table Mode */}
      {activeSubTab === 'excel' && (
        <ExcelExportSection
          structuredData={structuredData}
          submittedFrequencyIds={submittedFrequencyIds}
          onDownloadCsv={handleDownloadExcel}
        />
      )}

      {/* PDF Printable Document View */}
      {activeSubTab === 'pdf' && (
        <PdfExportSection
          structuredData={structuredData}
          submittedFrequencyIds={submittedFrequencyIds}
          selectedPdfFreqId={selectedPdfFreqId}
          setSelectedPdfFreqId={setSelectedPdfFreqId}
          isGeneratingPDF={isGeneratingPDF}
          onGeneratePdf={handleGeneratePDF}
        />
      )}

      {/* Historical Report Archives List (Supervisor & Admin Only) */}
      {activeSubTab === 'history' && (role === 'supervisor' || role === 'operations_admin' || role === 'system_admin' || role === 'admin') && (
        <HistoricalReportListSection
          historicalReports={historicalReports}
          selectedDate={selectedHistoricalDate || structuredData.operational_date}
          selectedShift={selectedHistoricalShift || structuredData.shift}
          onSelectReport={(rawDate, shift) => {
            if (onSelectHistoricalReport) {
              onSelectHistoricalReport(rawDate, shift);
            }
            toast.info('Laporan Histori Dimuat', {
              message: `Menampilkan data laporan untuk tanggal ${rawDate} (${shift}). Seluruh format ekspor WhatsApp, Excel, dan PDF telah diperbarui.`,
              badge: 'Histori Laporan',
            });
            setActiveSubTab('wa');
          }}
          onDownloadPdfDirect={(rawDate, shift) => {
            if (onSelectHistoricalReport) {
              onSelectHistoricalReport(rawDate, shift);
            }
            setActiveSubTab('pdf');
            toast.info('Buka Tab PDF', {
              message: `Memuat lembar kerja pemeliharaan untuk tanggal ${rawDate} (${shift}). Klik tombol Download PDF untuk menyimpan file.`,
              badge: 'PDF Resmi',
            });
          }}
          onResetToCurrentSession={onResetToCurrentSession}
          isCurrentSessionSelected={!isHistoricalActive}
        />
      )}
    </div>
  );
};
