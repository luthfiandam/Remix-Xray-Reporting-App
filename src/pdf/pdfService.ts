import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { StructuredReportData } from '../types';
import { ShiftReportPdfDocument } from './PdfDocument';
import { getReportPdfArchivePathAndFilename } from '../utils/pdfArchiveUtils';
import { uploadBlobDirectToStorage, isIdCloudHostStorageActive, registerReportArchiveFile } from '../services/storageService';
import { REPORT_SIGNATORIES } from '../config/reportSignatories';
import { normalizeOperationalDate, formatIndonesianDate } from '../utils/dateTimeUtils';
import { sendWhatsAppWahaFile } from '../services/whatsappService';

/**
 * Determines report type from frequency ID
 */
function resolveReportTypeFromFreq(freqId?: number): 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semester' | 'yearly' | 'corrective' {
  switch (freqId) {
    case 2:
      return 'weekly';
    case 3:
      return 'monthly';
    case 4:
      return 'quarterly';
    case 5:
      return 'semester';
    case 6:
      return 'yearly';
    case 7:
    case 999:
      return 'corrective';
    case 1:
    default:
      return 'daily';
  }
}

/**
 * Generates a vector PDF Blob using backend Puppeteer engine (VPS Headless Chrome)
 * with automatic fallback to client-side @react-pdf/renderer.
 */
export async function generateReportPdfBlob(
  structuredData: StructuredReportData,
  targetFrequencyId?: number
): Promise<Blob> {
  // 1. Try Backend Puppeteer HTML/CSS Engine First
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const response = await fetch('/api/reports/generate-pdf-puppeteer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredData,
        targetFrequencyId,
        signatories: REPORT_SIGNATORIES,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 1000) {
        return new Blob([arrayBuffer], { type: 'application/pdf' });
      }
    }
  } catch (backendErr) {
    console.warn('[PDF Generation] Puppeteer backend request error/timeout, falling back to React-PDF:', backendErr);
  }

  // 2. Client-Side Fallback Engine (@react-pdf/renderer)
  const docElement = React.createElement(ShiftReportPdfDocument, { structuredData, targetFrequencyId });
  const pdfInstance = pdf(docElement as any);
  const blob = await pdfInstance.toBlob();
  return blob;
}

/**
 * Downloads the generated PDF directly in browser
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Converts a Blob to Base64 string
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      resolve(res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Client-side vector PDF download + non-blocking IDCloudHost S3 Archive + Catalog Registration
 */
export async function downloadReportPdf(
  structuredData: StructuredReportData,
  targetFrequencyId?: number
): Promise<{ s3Url?: string; fileName: string; objectKey?: string }> {
  const archiveInfo = getReportPdfArchivePathAndFilename(
    structuredData.operational_date,
    structuredData.shift,
    targetFrequencyId || 1
  );

  const blob = await generateReportPdfBlob(structuredData, targetFrequencyId);

  // Trigger local browser download immediately
  downloadBlob(blob, archiveInfo.fileName);

  // Trigger non-blocking IDCloudHost S3 cloud archive & Supabase report_files registration
  let s3Url: string | undefined;
  let objectKey: string | undefined;
  try {
    const isS3Active = await isIdCloudHostStorageActive();
    if (isS3Active) {
      const repType = resolveReportTypeFromFreq(targetFrequencyId);
      const res = await uploadBlobDirectToStorage(
        blob,
        archiveInfo.folderPath,
        archiveInfo.fileName,
        'application/pdf',
        {
          entityType: `report_${repType}`,
          dateStr: structuredData.operational_date,
          shift: structuredData.shift,
        }
      );
      if (res.success && res.url) {
        s3Url = res.url;
        objectKey = res.key;
        // Register in report_files catalog table
        if (res.key) {
          const validFreq = repType === 'corrective' || (targetFrequencyId && targetFrequencyId > 6) ? undefined : (targetFrequencyId || 1);
          await registerReportArchiveFile({
            report_type: repType,
            operational_date: normalizeOperationalDate(structuredData.operational_date),
            shift: structuredData.shift,
            frequency_id: validFreq,
            object_key: res.key,
            file_name: res.file_name || archiveInfo.fileName,
            file_size: res.file_size || blob.size,
            content_type: 'application/pdf',
            bucket: res.bucket,
          }).catch((regErr) => console.warn('[ReportArchive] Catalog registration warning:', regErr));
        }
      }
    }
  } catch (err) {
    console.warn('IDCloudHost S3 PDF archive warning:', err);
  }

  return { s3Url, fileName: archiveInfo.fileName, objectKey };
}

/**
 * Shares PDF via Web Share API or falls back to direct download + IDCloudHost S3 Archive + Catalog Registration
 */
export async function shareReportPdf(
  structuredData: StructuredReportData,
  targetFrequencyId?: number
): Promise<{ shared: boolean; method: 'web-share' | 'download'; s3Url?: string; objectKey?: string }> {
  const archiveInfo = getReportPdfArchivePathAndFilename(
    structuredData.operational_date,
    structuredData.shift,
    targetFrequencyId || 1
  );

  const blob = await generateReportPdfBlob(structuredData, targetFrequencyId);
  const file = new File([blob], archiveInfo.fileName, { type: 'application/pdf' });

  let shared = false;
  let method: 'web-share' | 'download' = 'download';

  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: 'Laporan Maintenance',
        text: `Laporan Maintenance ${structuredData.operational_date}`,
      });
      shared = true;
      method = 'web-share';
    } catch {
      downloadBlob(blob, archiveInfo.fileName);
      method = 'download';
    }
  } else {
    downloadBlob(blob, archiveInfo.fileName);
    method = 'download';
  }

  // Trigger non-blocking IDCloudHost S3 cloud archive & Supabase report_files registration
  let s3Url: string | undefined;
  let objectKey: string | undefined;
  try {
    const isS3Active = await isIdCloudHostStorageActive();
    if (isS3Active) {
      const repType = resolveReportTypeFromFreq(targetFrequencyId);
      const res = await uploadBlobDirectToStorage(
        blob,
        archiveInfo.folderPath,
        archiveInfo.fileName,
        'application/pdf',
        {
          entityType: `report_${repType}`,
          dateStr: structuredData.operational_date,
          shift: structuredData.shift,
        }
      );
      if (res.success && res.url) {
        s3Url = res.url;
        objectKey = res.key;
        if (res.key) {
          const validFreq = repType === 'corrective' || (targetFrequencyId && targetFrequencyId > 6) ? undefined : (targetFrequencyId || 1);
          await registerReportArchiveFile({
            report_type: repType,
            operational_date: normalizeOperationalDate(structuredData.operational_date),
            shift: structuredData.shift,
            frequency_id: validFreq,
            object_key: res.key,
            file_name: res.file_name || archiveInfo.fileName,
            file_size: res.file_size || blob.size,
            content_type: 'application/pdf',
            bucket: res.bucket,
          }).catch((regErr) => console.warn('[ReportArchive] Catalog registration warning:', regErr));
        }
      }
    }
  } catch (err) {
    console.warn('IDCloudHost S3 PDF archive warning:', err);
  }

  return { shared, method, s3Url, objectKey };
}

/**
 * Generates and sends official report PDF directly to WhatsApp target group using WAHA endpoint
 */
export async function sendReportPdfToWhatsApp(
  structuredData: StructuredReportData,
  targetFrequencyId?: number
): Promise<{ success: boolean; fileName: string; error?: string; s3Url?: string }> {
  const archiveInfo = getReportPdfArchivePathAndFilename(
    structuredData.operational_date,
    structuredData.shift,
    targetFrequencyId || 1
  );

  const repType = resolveReportTypeFromFreq(targetFrequencyId);
  const formattedDate = structuredData.operational_date
    ? formatIndonesianDate(structuredData.operational_date, { includeDayName: true })
    : 'Hari ini';
  const shiftName = structuredData.shift || 'Pagi';

  // 1. Generate real PDF Blob
  const blob = await generateReportPdfBlob(structuredData, targetFrequencyId);

  // 2. Convert Blob to Base64 Data URL
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // 3. Construct official caption with requested template & footer
  let caption = '';
  if (repType === 'corrective') {
    caption = `Assalamualaikum, izin mengirimkan Laporan Corrective Maintenance ${formattedDate} Shift ${shiftName}\n\n*_sent from nararyaapps.net_*`;
  } else {
    const intervalMap: Record<number, string> = {
      1: 'Harian',
      2: 'Mingguan',
      3: 'Bulanan',
      4: 'Triwulan',
      5: 'Semester',
      6: 'Tahunan',
    };
    const intervalName = (targetFrequencyId && intervalMap[targetFrequencyId]) || 'Harian';
    caption = `Assalamualaikum, izin mengirimkan Laporan Preventif ${intervalName} ${formattedDate} Shift ${shiftName}\n\n*_sent from nararyaapps.net_*`;
  }

  // 4. Send via WAHA endpoint
  const sendRes = await sendWhatsAppWahaFile({
    file: base64Data,
    filename: archiveInfo.fileName,
    caption: caption,
  });

  if (!sendRes.success) {
    throw new Error(sendRes.error || 'Gagal mengirim file PDF ke WhatsApp.');
  }

  // 5. Trigger non-blocking S3 cloud archive & Supabase report_files registration
  let s3Url: string | undefined;
  try {
    const isS3Active = await isIdCloudHostStorageActive();
    if (isS3Active) {
      const res = await uploadBlobDirectToStorage(
        blob,
        archiveInfo.folderPath,
        archiveInfo.fileName,
        'application/pdf',
        {
          entityType: `report_${repType}`,
          dateStr: structuredData.operational_date,
          shift: structuredData.shift,
        }
      );
      if (res.success && res.url) {
        s3Url = res.url;
        if (res.key) {
          const validFreq = repType === 'corrective' || (targetFrequencyId && targetFrequencyId > 6) ? undefined : (targetFrequencyId || 1);
          await registerReportArchiveFile({
            report_type: repType,
            operational_date: normalizeOperationalDate(structuredData.operational_date),
            shift: structuredData.shift,
            frequency_id: validFreq,
            object_key: res.key,
            file_name: res.file_name || archiveInfo.fileName,
            file_size: res.file_size || blob.size,
            content_type: 'application/pdf',
            bucket: res.bucket,
          }).catch((regErr) => console.warn('[ReportArchive] Catalog registration warning:', regErr));
        }
      }
    }
  } catch (err) {
    console.warn('IDCloudHost S3 PDF archive warning:', err);
  }

  return { success: true, fileName: archiveInfo.fileName, s3Url };
}
