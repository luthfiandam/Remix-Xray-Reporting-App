import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { CorrectiveReport, Equipment, Location } from '../types';
import { CorrectiveReportPdfDocument } from './CorrectivePdfDocument';
import { generatePhotoCollageCanvas } from '../utils/collageService';
import { formatIndonesianDate } from '../utils/timeFormat';
import { fetchAuthenticatedImageBlob, isCollageEvidence } from '../utils/evidenceUtils';

/** @react-pdf/renderer accepts data URLs consistently across browser implementations. */
async function imageRefToDataUrl(reference: string): Promise<string> {
  const resolved = await fetchAuthenticatedImageBlob(reference);
  if (!resolved) return '';
  if (resolved.startsWith('data:image/')) return resolved;
  const response = await fetch(resolved);
  if (!response.ok) return '';
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) return '';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Gagal membaca foto untuk PDF'));
    reader.readAsDataURL(blob);
  });
}

export async function generateCorrectivePdfBlob(
  report: CorrectiveReport,
  equipment?: Equipment,
  location?: Location
): Promise<Blob> {
  let rawCollageUrl: string | undefined =
    (report as any).collage_object_key ||
    (report as any).collage_url ||
    (Array.isArray(report.evidences)
      ? report.evidences.find((e) => typeof e === 'string' && (e.includes('kolase') || e.includes('collage')))
      : undefined);

  let collageDataUrl: string | undefined;

  if (rawCollageUrl) {
    try {
      collageDataUrl = await imageRefToDataUrl(rawCollageUrl);
    } catch (e) {
      console.warn('[Corrective PDF] Failed to fetch authenticated blob for collage:', e);
    }
  }

  // If no collage_url is pre-saved or fetched, synthesize one from evidence photos using collage service
  if (!collageDataUrl && Array.isArray(report.evidences) && report.evidences.length > 0) {
    try {
      const originalEvidences = report.evidences.filter((url) => !isCollageEvidence(url));
      const collageItems = originalEvidences.map((url, idx) => ({
        key: `photo-${idx}`,
        title: `Bukti ${idx + 1}`,
        dataUrl: url,
      }));

      const canvas = await generatePhotoCollageCanvas({
        equipmentName: equipment?.name || 'Equipment',
        locationName: location?.name || '',
        date: formatIndonesianDate(report.corrective_date),
        shift: report.shift,
        technicians: report.technicians,
        photos: collageItems,
      });

      collageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.warn('[Corrective PDF] Could not build collage canvas, using raw evidence:', e);
      // Fail clearly rather than silently producing a PDF with just one
      // arbitrary photo or an empty documentation section.
    }
  }

  if (!collageDataUrl && (rawCollageUrl || (Array.isArray(report.evidences) && report.evidences.some((ev) => !isCollageEvidence(ev))))) {
    throw new Error('PDF corrective dibatalkan: kolase/foto dokumentasi belum dapat dibaca dari S3.');
  }

  const docElement = React.createElement(CorrectiveReportPdfDocument, {
    report,
    equipment,
    location,
    collageUrl: collageDataUrl,
  });

  const pdfInstance = pdf(docElement as any);
  return await pdfInstance.toBlob();
}

export async function downloadCorrectiveReportPdf(
  report: CorrectiveReport,
  equipment?: Equipment,
  location?: Location
): Promise<void> {
  const blob = await generateCorrectivePdfBlob(report, equipment, location);
  const cleanCode = (report.corrective_code || 'CR').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Laporan_Corrective_${cleanCode}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
