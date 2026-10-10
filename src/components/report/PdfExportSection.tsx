import React, { useState, useEffect, useRef } from 'react';
import { Download, Share2, FileText, ExternalLink, Loader2, Eye, Send } from 'lucide-react';
import { StructuredReportData } from '../../types';
import { INTERVAL_NAMES } from './types';
import { generateReportPdfBlob } from '../../pdf/pdfService';

interface PdfExportSectionProps {
  structuredData: StructuredReportData;
  submittedFrequencyIds: number[];
  selectedPdfFreqId: number;
  setSelectedPdfFreqId: (freqId: number) => void;
  isGeneratingPDF: boolean;
  onGeneratePdf: (action: 'download' | 'share' | 'whatsapp', freqId?: number) => void;
}

export const PdfExportSection: React.FC<PdfExportSectionProps> = ({
  structuredData,
  submittedFrequencyIds,
  selectedPdfFreqId,
  setSelectedPdfFreqId,
  isGeneratingPDF,
  onGeneratePdf,
}) => {
  const [realPdfUrl, setRealPdfUrl] = useState<string | null>(null);
  const [isLoadingRealPdf, setIsLoadingRealPdf] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [hasRequestedPreview, setHasRequestedPreview] = useState<boolean>(false);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Generate the real PDF Blob on-demand (saving server/VPS resources)
  const loadRealPdfPreview = async (freqId: number) => {
    setIsLoadingRealPdf(true);
    setRenderError(null);
    setHasRequestedPreview(true);

    try {
      const blob = await generateReportPdfBlob(structuredData, freqId);
      const newUrl = URL.createObjectURL(blob);

      // Clean up previous blob URL
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      activeBlobUrlRef.current = newUrl;
      setRealPdfUrl(newUrl);
    } catch (err) {
      console.error('Failed to generate real PDF preview:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setRenderError(`Gagal membuat preview PDF asli: ${msg}`);
    } finally {
      setIsLoadingRealPdf(false);
    }
  };

  // Only refresh if preview was already requested by user
  useEffect(() => {
    if (hasRequestedPreview) {
      loadRealPdfPreview(selectedPdfFreqId);
    }

    return () => {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, [selectedPdfFreqId]);

  const currentFreqName = INTERVAL_NAMES[selectedPdfFreqId] || 'Harian';

  return (
    <>
      {/* Cards to trigger specific Interval PDF exports */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs mb-6 print:hidden space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Export Laporan PDF
            </h3>
          </div>

          {realPdfUrl && (
            <div className="flex items-center gap-2">
              <a
                href={realPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                title="Buka PDF di Tab Baru"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Buka Tab Baru</span>
              </a>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {submittedFrequencyIds.map((freqId) => {
            const freqName = INTERVAL_NAMES[freqId] || 'PENGUJIAN';
            const isSelected = selectedPdfFreqId === freqId;
            return (
              <div
                key={freqId}
                className={`p-4 border rounded-2xl transition-all space-y-3 flex flex-col justify-between ${
                  isSelected
                    ? 'border-slate-800 bg-slate-50/50 ring-1 ring-slate-800'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="font-bold text-slate-800 text-sm block">
                      Preventive {freqName}
                    </span>
                    {freqId === 1 && (
                      <span className="text-[10px] text-emerald-600 font-bold block">
                        + Corrective Maintenance
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <button
                    onClick={() => {
                      setSelectedPdfFreqId(freqId);
                      onGeneratePdf('download', freqId);
                    }}
                    disabled={isGeneratingPDF}
                    title="Export & Download Dokumen PDF"
                    className="flex items-center justify-center gap-1 px-2.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Download</span>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedPdfFreqId(freqId);
                      onGeneratePdf('whatsapp', freqId);
                    }}
                    disabled={isGeneratingPDF}
                    title="Kirim File PDF ke Grup WhatsApp via WAHA"
                    className="flex items-center justify-center gap-1 px-2.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-[11px] font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>Kirim WA</span>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedPdfFreqId(freqId);
                      onGeneratePdf('share', freqId);
                    }}
                    disabled={isGeneratingPDF}
                    title="Share Dokumen PDF"
                    className="flex items-center justify-center gap-1 px-2.5 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Share2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Share</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* Card: Corrective Maintenance PDF */}
          {structuredData.corrective_entries && structuredData.corrective_entries.length > 0 && (() => {
            const isSelected = selectedPdfFreqId === 7;
            return (
              <div
                key="corrective-pdf"
                className={`p-4 border rounded-2xl transition-all space-y-3 flex flex-col justify-between ${
                  isSelected
                    ? 'border-slate-800 bg-slate-50/50 ring-1 ring-slate-800'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="font-bold text-slate-800 text-sm block">
                      Corrective Maintenance
                    </span>
                    <span className="text-[10px] text-amber-700 font-bold block">
                      {structuredData.corrective_entries.length} Temuan / Tindakan Perbaikan
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <button
                    onClick={() => {
                      setSelectedPdfFreqId(7);
                      onGeneratePdf('download', 7);
                    }}
                    disabled={isGeneratingPDF}
                    title="Export & Download Dokumen PDF Corrective"
                    className="flex items-center justify-center gap-1 px-2.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Download</span>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedPdfFreqId(7);
                      onGeneratePdf('whatsapp', 7);
                    }}
                    disabled={isGeneratingPDF}
                    title="Kirim File PDF Corrective ke Grup WhatsApp via WAHA"
                    className="flex items-center justify-center gap-1 px-2.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-[11px] font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>Kirim WA</span>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedPdfFreqId(7);
                      onGeneratePdf('share', 7);
                    }}
                    disabled={isGeneratingPDF}
                    title="Share Dokumen PDF Corrective"
                    className="flex items-center justify-center gap-1 px-2.5 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Share2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Share</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Real PDF Preview Container (Desktop/Tablet Only) */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden print:border-none print:shadow-none">
        {/* Preview Toolbar */}
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 px-2.5 py-1 rounded-lg">
              <FileText className="w-3.5 h-3.5 text-rose-600" />
              Preview Dokumen PDF Resmi — {currentFreqName}
            </span>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              (Lembar cetak asli A4 Portrait)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onGeneratePdf('whatsapp', selectedPdfFreqId)}
              disabled={isGeneratingPDF}
              title="Kirim Dokumen PDF ini ke Grup WhatsApp via WAHA"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Kirim ke WhatsApp</span>
            </button>

            <button
              onClick={() => onGeneratePdf('download', selectedPdfFreqId)}
              disabled={isGeneratingPDF}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download PDF Ini</span>
            </button>
          </div>
        </div>

        {/* Real PDF Viewer Area */}
        <div className="relative w-full bg-slate-100 min-h-[720px] flex items-center justify-center p-2 sm:p-4">
          {isLoadingRealPdf ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-700">
                Merender Dokumen PDF Asli...
              </p>
              <p className="text-xs text-slate-500 max-w-xs text-center">
                Menyusun halaman A4, rotasi waktu, bingkai foto kolase, dan tanda tangan resmi.
              </p>
            </div>
          ) : renderError ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center max-w-md space-y-3">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold text-lg">
                !
              </div>
              <h4 className="text-sm font-bold text-slate-800">Gagal Memuat Preview</h4>
              <p className="text-xs text-slate-600">{renderError}</p>
              <button
                onClick={() => loadRealPdfPreview(selectedPdfFreqId)}
                className="mt-2 px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-900 transition"
              >
                Coba Lagi
              </button>
            </div>
          ) : realPdfUrl ? (
            <div className="w-full max-w-[850px] shadow-lg rounded-lg overflow-hidden bg-white border border-slate-300">
              <iframe
                src={`${realPdfUrl}#view=FitH&toolbar=1&navpanes=0`}
                title="Preview PDF Laporan Resmi"
                className="w-full h-[850px] border-none block"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center max-w-sm space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Eye className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                Preview Dokumen PDF Resmi
              </h4>
              <p className="text-xs text-slate-500">
                Klik tombol di bawah untuk merender preview PDF asli interval {currentFreqName}.
              </p>
              <button
                onClick={() => loadRealPdfPreview(selectedPdfFreqId)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Lihat Preview Dokumen Asli</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
