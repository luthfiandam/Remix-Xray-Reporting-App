import ExcelJS from 'exceljs';
import { StructuredReportData } from '../types';
import { formatTimeRange } from '../utils/timeFormat';
import { extractValidPhotoUrls, extractBoundedEvidences } from '../utils/evidenceUtils';
import { INTERVAL_NAMES } from '../components/report/types';
import { formatIndonesianDate } from '../utils/dateTimeUtils';

export interface ExcelExportOptions {
  freqId?: number; // 0 or undefined for All
  includeCorrective?: boolean;
  logoUrl?: string;
  logoBase64?: string;
}

/**
 * Formats operational date with Indonesian day name (Asia/Jakarta context)
 */
const formatDayDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  return formatIndonesianDate(dateStr, { includeDayName: true });
};

/**
 * Fetches company logo asset as base64 string for ExcelJS embed
 */
async function fetchLogoBase64(options?: ExcelExportOptions): Promise<string | null> {
  if (options?.logoBase64) {
    return options.logoBase64;
  }

  try {
    if (typeof window !== 'undefined') {
      const url = options?.logoUrl || '/src/assets/logopt.png';
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          if (result && result.includes(',')) {
            resolve(result.split(',')[1]);
          } else {
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } else {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const logoPath = path.join(process.cwd(), 'src', 'assets', 'logopt.png');
        if (fs.existsSync(logoPath)) {
          return fs.readFileSync(logoPath).toString('base64');
        }
      } catch {
        return null;
      }
    }
  } catch (err) {
    console.warn('[ExcelReport] Could not load logo for Excel embed:', err);
    return null;
  }
  return null;
}

/**
 * Fetches image binary from S3 / web / dataUrl and returns base64 and extension for ExcelJS embed.
 */
async function fetchImageForEmbed(
  urlOrPath: string
): Promise<{ base64: string; extension: 'jpeg' | 'png' } | null> {
  if (!urlOrPath) return null;

  // 1. Direct Base64 data URL
  if (urlOrPath.startsWith('data:image/')) {
    const parts = urlOrPath.split(',');
    const ext = urlOrPath.includes('png') ? 'png' : 'jpeg';
    return { base64: parts[1], extension: ext };
  }

  try {
    let fetchUrl = urlOrPath;

    // 2. Private S3 / Object Storage path (e.g. starts with !Kantor/ or doesn't have http)
    if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
      fetchUrl = `/api/storage/image-buffer?key=${encodeURIComponent(urlOrPath)}`;
    }

    const headers: Record<string, string> = {};
    if (typeof window !== 'undefined') {
      try {
        const auth = await import('./authService');
        const authHeaders = await auth.getAuthHeaders();
        Object.assign(headers, authHeaders);
      } catch (_) {}
    }

    const res = await fetch(fetchUrl, { headers });
    if (!res.ok) return null;

    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const ext = blob.type.includes('png') ? 'png' : 'jpeg';
    return { base64, extension: ext };
  } catch (err) {
    console.warn('[ExcelReport] Could not fetch image for embed:', urlOrPath, err);
    return null;
  }
}

function getUraianKegiatanForExcel(freqId: number, typeCode: string): string {
  const code = (typeCode || '').toUpperCase();
  if (freqId === 3) { // Bulanan
    if (code.includes('XRAY') || code.includes('X-RAY')) {
      return 'Pengecekan fungsi zoom in / out, kapasitas harddisk, image density / high resolution, black and white image, TIP, image archive / image recall, dan UPS';
    }
    if (code.includes('WTMD')) {
      return 'Melakukan pengecekan sensitivitas, UPS Backup Time dan UPS Automatic change over facility';
    }
    if (code.includes('HHMD')) {
      return 'Melakukan Pengecekan Sensitivitas dan kerusakan fisik alat';
    }
    return 'Melakukan Pembersihan dan Pengecekan Operasional Bulanan';
  }

  if (freqId === 2) { // Mingguan
    if (code.includes('XRAY') || code.includes('X-RAY')) {
      return 'Melakukan Pemeriksaan Light Barriers, Pemeriksaan PE (Protective Earth) Wiring, dan Pemeriksaan Emergency Stop Switches.';
    }
    if (code.includes('WTMD')) {
      return 'Melakukan pengecekan alert system audible yang bisa terdengar dan visible yang bisa terlihat oleh mata (indikator led)';
    }
    if (code.includes('HHMD')) {
      return 'Melakukan pengecekan tombol On Off dan pengecekan alert system audible yang bisa terdengar dan visible yang bisa terlihat oleh mata';
    }
    return 'Melakukan Pembersihan dan Pengecekan Mingguan';
  }

  if (freqId === 4 || freqId === 5 || freqId === 6) { // Triwulan, Semesteran, Tahunan
    if (code.includes('XRAY') || code.includes('X-RAY')) {
      return 'Melakukan pengecekan komponen interlock dan membersihkan bagian dalam mesin xray';
    }
    if (code.includes('WTMD')) {
      return 'Melakukan Pembersihan dan Pengecekan Control Unit.';
    }
    if (code.includes('HHMD')) {
      return 'Melakukan Pembersihan dan Pengecekan Control Unit / Komponen.';
    }
    return 'Melakukan Pembersihan dan Pengecekan Komponen';
  }

  // Harian (1) or default
  return 'Melakukan Pembersihan dan Check List';
}

/**
 * Builds a single worksheet according to official Nararya report specifications (A:R layout).
 */
async function buildWorksheetForInterval(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  structuredData: StructuredReportData,
  freqId: number,
  options: ExcelExportOptions,
  logoBase64: string | null
): Promise<boolean> {
  // Collect records for this interval
  const isCorrectiveOnly = freqId === 999; // custom marker for corrective
  let preventiveRows: any[] = [];

  if (!isCorrectiveOnly) {
    preventiveRows = structuredData.entries_by_type.flatMap((group) =>
      group.entries
        .filter((e) => !freqId || e.checklist_frequency_id === freqId)
        .map((e) => ({
          kind: 'preventive' as const,
          equipment_name: e.equipment_name,
          type_code: group.type_code,
          notes: e.notes,
          evidences: e.evidences || [],
          checklist_frequency_id: e.checklist_frequency_id,
          time_range: formatTimeRange(structuredData.start_time, structuredData.end_time),
        }))
    );
  }

  const includeCorrective =
    isCorrectiveOnly || (options.includeCorrective ?? (!freqId || freqId === 1));

  const correctiveRows = includeCorrective
    ? (structuredData.corrective_entries || []).map((c) => ({
        kind: 'corrective' as const,
        equipment_name: c.equipment_name,
        type_code: c.type_code,
        notes: c.notes,
        evidences: c.evidences || [],
        problem_description: c.problem_description,
        action_taken: c.action_taken,
        result: c.result,
        result_text: c.result_text,
        time_range: c.time_range ? `${c.time_range} WIB` : formatTimeRange(structuredData.start_time, structuredData.end_time),
        checklist_frequency_id: 1,
      }))
    : [];

  const allTableRows = [...preventiveRows, ...correctiveRows];

  // If no data and this is an individual interval in multi-sheet export, skip sheet
  if (allTableRows.length === 0 && freqId !== 0) {
    return false;
  }

  const cleanSheetName = sheetName.substring(0, 31).replace(/[\\/*?[\]]/g, '');
  const worksheet = workbook.addWorksheet(cleanSheetName, {
    views: [{ showGridLines: true }],
  });

  // Setup exact columns A:R (18 columns)
  worksheet.columns = [
    { key: 'colA', width: 5 },  // No
    { key: 'colB', width: 11 }, // Tipe Alat (part 1)
    { key: 'colC', width: 11 }, // Tipe Alat (part 2)
    { key: 'colD', width: 17 }, // Jenis Kegiatan
    { key: 'colE', width: 12 }, // Waktu
    { key: 'colF', width: 8 },  // Uraian Kegiatan (F:L)
    { key: 'colG', width: 8 },
    { key: 'colH', width: 8 },
    { key: 'colI', width: 8 },
    { key: 'colJ', width: 8 },
    { key: 'colK', width: 8 },
    { key: 'colL', width: 8 },
    { key: 'colM', width: 10 }, // Notes (M:O)
    { key: 'colN', width: 10 },
    { key: 'colO', width: 10 },
    { key: 'colP', width: 14 }, // Dokumentasi Foto (P:R, 3 cols)
    { key: 'colQ', width: 14 },
    { key: 'colR', width: 14 },
  ];

  // --- Header Kop: A1:D3 Logo & E1:R3 PT Name ---
  worksheet.mergeCells('A1:D3');
  const cellA1 = worksheet.getCell('A1');
  cellA1.value = '';
  cellA1.alignment = { vertical: 'middle', horizontal: 'center' };

  if (logoBase64) {
    try {
      const imgId = workbook.addImage({
        base64: logoBase64,
        extension: 'png',
      });
      worksheet.addImage(imgId, {
        tl: { col: 0.1, row: 0.15 },
        ext: { width: 110, height: 42 },
      });
    } catch (_) {}
  }

  worksheet.mergeCells('E1:R3');
  const cellE1 = worksheet.getCell('E1');
  cellE1.value = 'PT. NARARYA TEKNOLOGI INDONESIA';
  cellE1.font = { name: 'Times New Roman', size: 16, bold: true, color: { argb: 'FF000000' } };
  cellE1.alignment = { vertical: 'middle', horizontal: 'center' };

  // Set borders for header box A1:R3
  for (let r = 1; r <= 3; r++) {
    worksheet.getRow(r).height = 18;
    for (let c = 1; c <= 18; c++) {
      worksheet.getRow(r).getCell(c).border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    }
  }

  // --- Row 4: Metadata Hari/Tanggal & Shift ---
  worksheet.mergeCells('A4:C4');
  const cellA4 = worksheet.getCell('A4');
  cellA4.value = 'Hari / Tanggal';
  cellA4.font = { name: 'Times New Roman', size: 10, bold: true };
  cellA4.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  worksheet.mergeCells('D4:I4');
  const cellD4 = worksheet.getCell('D4');
  cellD4.value = `: ${formatDayDate(structuredData.operational_date)}`;
  cellD4.font = { name: 'Times New Roman', size: 10 };
  cellD4.alignment = { vertical: 'middle', horizontal: 'left' };

  worksheet.mergeCells('J4:L4');
  const cellJ4 = worksheet.getCell('J4');
  cellJ4.value = 'Shift';
  cellJ4.font = { name: 'Times New Roman', size: 10, bold: true };
  cellJ4.alignment = { vertical: 'middle', horizontal: 'left' };

  worksheet.mergeCells('M4:R4');
  const cellM4 = worksheet.getCell('M4');
  cellM4.value = `: ${(structuredData.shift || 'Pagi').toUpperCase()}`;
  cellM4.font = { name: 'Times New Roman', size: 10, bold: true };
  cellM4.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(4).height = 20;

  for (let c = 1; c <= 18; c++) {
    worksheet.getRow(4).getCell(c).border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
  }

  // --- Row 5: Metadata Teknisi On Duty ---
  const rawTechs =
    structuredData.technicians && structuredData.technicians.length > 0
      ? structuredData.technicians
      : ['LUTHFIANDA MUZAKI SULAEMAN'];

  worksheet.mergeCells('A5:C5');
  const cellA5 = worksheet.getCell('A5');
  cellA5.value = 'Teknisi On Duty';
  cellA5.font = { name: 'Times New Roman', size: 10, bold: true };
  cellA5.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  worksheet.mergeCells('D5:R5');
  const cellD5 = worksheet.getCell('D5');
  cellD5.value = `: ${rawTechs.map((t, i) => `${i + 1}. ${t}`).join('   |   ')}`;
  cellD5.font = { name: 'Times New Roman', size: 10 };
  cellD5.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(5).height = 20;

  for (let c = 1; c <= 18; c++) {
    worksheet.getRow(5).getCell(c).border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
  }

  // --- Row 6: Spacing ---
  worksheet.getRow(6).height = 8;

  // --- Row 7: Table Header ---
  const headerRow = worksheet.getRow(7);
  headerRow.height = 25;

  worksheet.getCell('A7').value = 'No';
  worksheet.mergeCells('B7:C7');
  worksheet.getCell('B7').value = 'Tipe Alat';
  worksheet.getCell('D7').value = 'Jenis Kegiatan';
  worksheet.getCell('E7').value = 'Waktu';
  worksheet.mergeCells('F7:L7');
  worksheet.getCell('F7').value = 'Uraian Kegiatan';
  worksheet.mergeCells('M7:O7');
  worksheet.getCell('M7').value = 'Notes';
  worksheet.mergeCells('P7:R7');
  worksheet.getCell('P7').value = 'Dokumentasi';

  for (let c = 1; c <= 18; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { name: 'Times New Roman', size: 10, bold: true, color: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF000000' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
  }

  let currentRowNum = 8;

  if (allTableRows.length === 0) {
    worksheet.mergeCells(`A${currentRowNum}:R${currentRowNum}`);
    const emptyCell = worksheet.getCell(`A${currentRowNum}`);
    emptyCell.value = 'Tidak ada catatan checklist atau perbaikan pada filter ini.';
    emptyCell.font = { name: 'Times New Roman', size: 10, italic: true };
    emptyCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(currentRowNum).height = 30;

    for (let c = 1; c <= 18; c++) {
      worksheet.getRow(currentRowNum).getCell(c).border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    }
    currentRowNum++;
  } else {
    for (let idx = 0; idx < allTableRows.length; idx++) {
      const row = allTableRows[idx];
      const isPreventive = row.kind === 'preventive';
      const eqNameUpper = row.equipment_name.toUpperCase();
      const typeUpper = row.type_code.toUpperCase();
      const displayEqName = eqNameUpper.includes(typeUpper)
        ? eqNameUpper
        : `${typeUpper} ${eqNameUpper}`;

      const jenisKegiatan = isPreventive
        ? `Preventive Maintenance ${INTERVAL_NAMES[row.checklist_frequency_id || freqId || 1] || 'Harian'}`
        : 'Corrective Maintenance';

      let uraianKegiatan = getUraianKegiatanForExcel(row.checklist_frequency_id || freqId || 1, row.type_code);
      if (!isPreventive) {
        const corr = row as any;
        const prob = corr.problem_description ? `Kerusakan: ${corr.problem_description}` : '';
        const act = corr.action_taken ? `Tindakan: ${corr.action_taken}` : '';
        uraianKegiatan = [prob, act].filter(Boolean).join('\n\n') || '-';
      }

      let defaultNote = `${row.type_code} bisa digunakan dengan normal`;
      if (row.type_code === 'XRAY') defaultNote = 'Xray bisa digunakan dengan normal';
      if (row.type_code === 'WTMD') defaultNote = 'WTMD bisa digunakan dengan normal';
      if (row.type_code === 'HHMD') defaultNote = 'HHMD bisa digunakan dengan normal';

      let notesText = row.notes || defaultNote;
      if (!isPreventive) {
        const corr = row as any;
        notesText = corr.result_text || corr.notes || 'Equipment sudah dapat digunakan kembali dengan normal.';
      }

      // Documentation photos: Extract at most 9 photos
      const validPhotoUrls = extractValidPhotoUrls(row.evidences || []);
      const boundedPhotoUrls = extractBoundedEvidences(validPhotoUrls, 9);
      const photoCount = boundedPhotoUrls.length;

      // Determine number of photo rows:
      // 0 photos: 0 rows (single row, height 36)
      // 1-3 photos: 1 photo row (height 80)
      // 4-6 photos: 2 photo rows (height 160)
      // 7-9 photos: 3 photo rows (height 240)
      const photoRows = photoCount === 0 ? 0 : Math.ceil(photoCount / 3);
      const rowHeight = photoRows === 0 ? 36 : Math.max(70, photoRows * 75);

      const r = worksheet.getRow(currentRowNum);
      r.height = rowHeight;

      // Merge cells for A:R structure
      worksheet.getCell(`A${currentRowNum}`).value = idx + 1;

      worksheet.mergeCells(`B${currentRowNum}:C${currentRowNum}`);
      worksheet.getCell(`B${currentRowNum}`).value = displayEqName;

      worksheet.getCell(`D${currentRowNum}`).value = jenisKegiatan;
      worksheet.getCell(`E${currentRowNum}`).value = row.time_range;

      worksheet.mergeCells(`F${currentRowNum}:L${currentRowNum}`);
      worksheet.getCell(`F${currentRowNum}`).value = uraianKegiatan;

      worksheet.mergeCells(`M${currentRowNum}:O${currentRowNum}`);
      worksheet.getCell(`M${currentRowNum}`).value = notesText;

      // Format alignment & borders for cells
      worksheet.getCell(`A${currentRowNum}`).alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getCell(`B${currentRowNum}`).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      worksheet.getCell(`D${currentRowNum}`).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      worksheet.getCell(`E${currentRowNum}`).alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getCell(`F${currentRowNum}`).alignment = { vertical: 'middle', horizontal: isPreventive ? 'center' : 'left', wrapText: true };
      worksheet.getCell(`M${currentRowNum}`).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      // Apply borders to all columns 1 to 18
      for (let c = 1; c <= 18; c++) {
        const cell = worksheet.getRow(currentRowNum).getCell(c);
        cell.font = { name: 'Times New Roman', size: 9.5 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        };
      }

      // Documentation Photo Embedding (3x3 grid into cols P, Q, R)
      if (photoCount === 0) {
        worksheet.mergeCells(`P${currentRowNum}:R${currentRowNum}`);
        const docCell = worksheet.getCell(`P${currentRowNum}`);
        docCell.value = '-';
        docCell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        // Embed images directly into cells P, Q, R
        const photoCols = [15, 16, 17]; // 0-indexed: Col P=15, Q=16, R=17
        const baseRow = currentRowNum - 1; // 0-indexed row for ExcelJS

        for (let pIdx = 0; pIdx < photoCount; pIdx++) {
          const photoUrl = boundedPhotoUrls[pIdx];
          const imgData = await fetchImageForEmbed(photoUrl);

          const gridColOffset = pIdx % 3; // 0, 1, or 2 (P, Q, or R)
          const gridRowOffset = Math.floor(pIdx / 3); // 0, 1, or 2

          if (imgData) {
            try {
              const imageId = workbook.addImage({
                base64: imgData.base64,
                extension: imgData.extension,
              });

              // Add image with proportional width/height inside column cell
              worksheet.addImage(imageId, {
                tl: {
                  col: photoCols[gridColOffset] + 0.08,
                  row: baseRow + (gridRowOffset / photoRows) + 0.05,
                },
                ext: { width: 95, height: 68 },
              });
            } catch (err) {
              console.warn('[ExcelReport] Error placing image in cell:', err);
            }
          }
        }
      }

      currentRowNum++;
    }
  }

  // --- Signature Block (Pelaksana & Pengawas Pekerjaan) ---
  currentRowNum++; // Blank row spacing
  worksheet.getRow(currentRowNum).height = 14;
  currentRowNum++;

  const sigStartRow = currentRowNum;

  // Title row
  worksheet.mergeCells(`B${sigStartRow}:F${sigStartRow}`);
  const pelaksanaTitle = worksheet.getCell(`B${sigStartRow}`);
  pelaksanaTitle.value = 'Pelaksana';
  pelaksanaTitle.font = { name: 'Times New Roman', size: 10.5, bold: true };
  pelaksanaTitle.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells(`M${sigStartRow}:Q${sigStartRow}`);
  const pengawasTitle = worksheet.getCell(`M${sigStartRow}`);
  pengawasTitle.value = 'Pengawas Pekerjaan';
  pengawasTitle.font = { name: 'Times New Roman', size: 10.5, bold: true };
  pengawasTitle.alignment = { horizontal: 'center', vertical: 'middle' };

  currentRowNum++;

  // Subtitle
  worksheet.mergeCells(`B${currentRowNum}:F${currentRowNum}`);
  const pelaksanaSub = worksheet.getCell(`B${currentRowNum}`);
  pelaksanaSub.value = 'PT. NARARYA TEKNOLOGI INDONESIA';
  pelaksanaSub.font = { name: 'Times New Roman', size: 10, bold: true };
  pelaksanaSub.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells(`M${currentRowNum}:Q${currentRowNum}`);
  const pengawasSub = worksheet.getCell(`M${currentRowNum}`);
  pengawasSub.value = 'FACILITY MAINTENANCE - ELEKTRONIKA';
  pengawasSub.font = { name: 'Times New Roman', size: 10, bold: true };
  pengawasSub.alignment = { horizontal: 'center', vertical: 'middle' };

  // Space for signature
  currentRowNum += 3;
  worksheet.getRow(currentRowNum).height = 25;

  // Name sign-off (Underlined)
  worksheet.mergeCells(`B${currentRowNum}:F${currentRowNum}`);
  const pelaksanaName = worksheet.getCell(`B${currentRowNum}`);
  pelaksanaName.value = rawTechs[0] ? rawTechs[0].toUpperCase() : 'LUTHFIANDA MUZAKI SULAEMAN';
  pelaksanaName.font = { name: 'Times New Roman', size: 10.5, bold: true, underline: true };
  pelaksanaName.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells(`M${currentRowNum}:Q${currentRowNum}`);
  const pengawasName = worksheet.getCell(`M${currentRowNum}`);
  pengawasName.value = 'RIZKO ENDRA NUGRAHA';
  pengawasName.font = { name: 'Times New Roman', size: 10.5, bold: true, underline: true };
  pengawasName.alignment = { horizontal: 'center', vertical: 'middle' };

  // --- Official Print Setup (A4 Portrait, fitToWidth = 1, printArea A1:R[lastRow]) ---
  worksheet.pageSetup = {
    paperSize: 9, // A4
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `A1:R${currentRowNum}`,
    printTitlesRow: '1:7',
  };

  return true;
}

/**
 * Generates an official Excel (.xlsx) report matching the PDF layout:
 * - Kop PT. Nararya Teknologi Indonesia (A1:D3 Logo, E1:R3 Company Name)
 * - Operational metadata (Hari/Tanggal, Shift, Teknisi On Duty)
 * - Structured table (No, Tipe Alat, Jenis Kegiatan, Waktu, Uraian Kegiatan, Notes, Dokumentasi)
 * - Embedded evidence photos (max 9 photos in 3x3 grid)
 * - Official sign-off block (Pelaksana & Pengawas Pekerjaan)
 * - Download Sheet Ini vs Download Semua Interval (.xlsx)
 */
export async function generateOfficialExcelReport(
  structuredData: StructuredReportData,
  options: ExcelExportOptions = {}
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PT. Nararya Teknologi Indonesia - NTI Maintenance';
  workbook.created = new Date();

  const logoBase64 = await fetchLogoBase64(options);
  const targetFreqId = options.freqId ?? 0;

  if (targetFreqId > 0) {
    // Single Interval Export
    const freqName = INTERVAL_NAMES[targetFreqId] || 'Harian';
    await buildWorksheetForInterval(
      workbook,
      `Preventive ${freqName}`,
      structuredData,
      targetFreqId,
      options,
      logoBase64
    );
  } else {
    // Multi-Interval Export (Download Semua Interval)
    // Build sheets for all intervals that have data:
    // 1: Harian, 2: Mingguan, 3: Bulanan, 4: Triwulan, and Corrective
    const intervals = [
      { id: 1, name: 'Preventive Harian' },
      { id: 2, name: 'Preventive Mingguan' },
      { id: 3, name: 'Preventive Bulanan' },
      { id: 4, name: 'Preventive Triwulan' },
      { id: 999, name: 'Corrective Maintenance' },
    ];

    let sheetsCreated = 0;
    for (const interval of intervals) {
      const created = await buildWorksheetForInterval(
        workbook,
        interval.name,
        structuredData,
        interval.id,
        { ...options, includeCorrective: interval.id === 999 },
        logoBase64
      );
      if (created) sheetsCreated++;
    }

    // Fallback if no specific interval matched: create a consolidated sheet
    if (sheetsCreated === 0) {
      await buildWorksheetForInterval(
        workbook,
        'Laporan Maintenance',
        structuredData,
        0,
        options,
        logoBase64
      );
    }
  }

  // Write and return blob
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * Triggers file download directly in user's browser
 */
export function downloadExcelFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
