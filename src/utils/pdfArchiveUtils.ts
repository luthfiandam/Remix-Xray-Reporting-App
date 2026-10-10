import { getPeriodKey } from './periodUtils';
import { getReportFolderPathAndFileName } from './storagePathUtils';
import { normalizeOperationalDate } from './dateTimeUtils';

export interface PdfArchivePathAndFilename {
  folderPath: string;
  fileName: string;
  periodKey: string;
  intervalName: string;
}

/**
 * Returns standardized folder path and file name for Object Storage Cloud Archive (1. Laporan/...)
 * Ensures standard naming format: `${day} ${monthName} ${year} (${shiftCode}).pdf`
 */
export function getReportPdfArchivePathAndFilename(
  dateStr: string,
  shiftStr: string,
  targetFrequencyId: number = 1
): PdfArchivePathAndFilename {
  const isoDateStr = normalizeOperationalDate(dateStr);
  const periodKey = getPeriodKey(targetFrequencyId, isoDateStr);
  const { folderPath, fileName } = getReportFolderPathAndFileName({
    reportType: targetFrequencyId,
    dateStr: isoDateStr,
    shift: shiftStr,
  });

  const intervalNames: Record<number, string> = {
    1: 'Harian',
    2: 'Mingguan',
    3: 'Bulanan',
    4: 'Triwulan',
    5: 'Semester',
    6: 'Tahunan',
    7: 'Corrective',
  };

  return {
    folderPath,
    fileName,
    periodKey,
    intervalName: intervalNames[targetFrequencyId] || 'Harian',
  };
}
