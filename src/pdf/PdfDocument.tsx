import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import { StructuredReportData, ReportEvidenceItem } from '../types';
import { formatTimeRange } from '../utils/timeFormat';
import { calculatePreventiveTimeRange } from '../services/reportService';
import { getSingleCollagePhotoUrl } from '../utils/evidenceUtils';
import { REPORT_SIGNATORIES } from '../config/reportSignatories';
import logoNararya from '../assets/logopt.png';

// Disable hyphenation to prevent awkward word breaks (e.g., "Mainte-nance", "pem-bersihan")
Font.registerHyphenationCallback((word) => [word]);

export interface PdfRowData {
  kind: 'preventive' | 'corrective';
  equipment_name: string;
  type_code: string;
  view_type?: string;
  notes?: string;
  evidences?: ReportEvidenceItem[];
  problem_description?: string;
  action_taken?: string;
  result?: string;
  result_text?: string;
  time_range?: string;
  checklist_frequency_id?: number;
  equipment_id?: number;
}

// Single Source of Truth for Numeric Column Widths in Points (Sum = 571 pt)
// Usable Page Width = 595.28 (A4 Width) - 12 (Left Padding) - 12 (Right Padding) = 571.28 pt
const COL_WIDTHS = {
  no: 20,        // ~3.5%
  type: 72,      // ~12.6%
  kind: 66,      // ~11.6%
  time: 22,      // ~3.8% (Sangat ramping)
  uraian: 91,    // ~15.9%
  notes: 91,     // ~15.9%
  docs: 209,     // ~36.6% (Landscape lebar)
};
// 20 + 72 + 66 + 22 + 91 + 91 + 209 = 571 pt total

const styles = StyleSheet.create({
  page: {
    paddingTop: 16,
    paddingBottom: 20,
    paddingLeft: 12,
    paddingRight: 12,
    fontFamily: 'Times-Roman',
    backgroundColor: '#FFFFFF',
    fontSize: 8.5,
    color: '#000000',
  },

  // Document Full Header Container (Normal flow to prevent overlapping with table rows)
  fullHeaderContainer: {
    flexDirection: 'column',
    width: 571,
    marginBottom: 0,
  },

  // 1. Company Header Block
  headerTable: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: '#000000',
    height: 72,
    alignItems: 'center',
  },
  logoCol: {
    width: 155,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  logoImage: {
    width: 148,
    height: 66,
    objectFit: 'contain',
  },
  titleCol: {
    width: 416,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    fontFamily: 'Times-Bold',
    fontSize: 16,
    color: '#000000',
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  // 2. Operational Info Block
  infoTable: {
    flexDirection: 'column',
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#000000',
    width: 571,
  },
  infoRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderColor: '#000000',
    minHeight: 18,
    alignItems: 'center',
  },
  labelCell18: {
    width: 130, // matches logoCol exactly
    padding: 3,
    paddingRight: 6,
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    textAlign: 'right',
    borderRightWidth: 0.5,
    borderColor: '#000000',
  },
  valCellDate: {
    width: 286,
    padding: 3,
    paddingLeft: 6,
    fontFamily: 'Times-Roman',
    fontSize: 8.5,
    textAlign: 'left',
    borderRightWidth: 0.5,
    borderColor: '#000000',
  },
  labelCellShift: {
    width: 50,
    padding: 3,
    paddingRight: 6,
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    textAlign: 'right',
    borderRightWidth: 0.5,
    borderColor: '#000000',
  },
  valCellShift: {
    width: 105,
    padding: 3,
    paddingLeft: 6,
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    textAlign: 'left',
  },
  valCellTechLeft: {
    width: 286,
    padding: 3,
    paddingLeft: 6,
    fontFamily: 'Times-Roman',
    fontSize: 8.5,
    textAlign: 'left',
    borderRightWidth: 0.5,
    borderColor: '#000000',
  },
  valCellTechRight: {
    width: 155,
    padding: 3,
    paddingLeft: 6,
    fontFamily: 'Times-Roman',
    fontSize: 8.5,
    textAlign: 'left',
  },

  // 3. Table Column Header Row
  tableHeaderRow: {
    flexDirection: 'row',
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#000000',
    backgroundColor: '#F3F4F6',
    minHeight: 22,
    alignItems: 'stretch',
    width: 571,
  },

  headerCellText: {
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    textAlign: 'center',
    color: '#000000',
  },

  // 4. Table Row Model
  tableRow: {
    flexDirection: 'row',
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#000000',
    width: 571,
    minHeight: 108,
    alignItems: 'stretch',
  },

  colNoCell: {
    width: COL_WIDTHS.no,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colTypeCell: {
    width: COL_WIDTHS.type,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colKindCell: {
    width: COL_WIDTHS.kind,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colTimeCell: {
    width: COL_WIDTHS.time,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colUraianCell: {
    width: COL_WIDTHS.uraian,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colNotesCell: {
    width: COL_WIDTHS.notes,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colDocsCell: {
    width: COL_WIDTHS.docs,
    paddingVertical: 2,
    paddingHorizontal: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },

  cellTextCenter: {
    fontFamily: 'Times-Roman',
    fontSize: 8,
    color: '#000000',
    textAlign: 'center',
    lineHeight: 1.3,
  },

  // Corrective Items List
  boldText: {
    fontFamily: 'Times-Bold',
    fontSize: 8,
    marginTop: 1,
    marginBottom: 1,
  },
  bulletItem: {
    fontFamily: 'Times-Roman',
    fontSize: 7.5,
    marginLeft: 0,
    lineHeight: 1.25,
  },

  // Clean, Proportional Image Container
  imageGrid: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  docImage: {
    width: 195,
    height: 102,
    objectFit: 'fill',
  },

  // Signature Block
  signatureContainer: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    width: 571,
  },
  signatureCol: {
    width: '45%',
    alignItems: 'center',
    textAlign: 'center',
  },
  sigTitle: {
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    textAlign: 'center',
  },
  sigSubTitle: {
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    marginTop: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  sigSpace: {
    height: 32,
  },
  sigName: {
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    textDecoration: 'underline',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});

const formatDayDate = (dateStr: string) => {
  if (!dateStr) return '';
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  if (days.some((day) => dateStr.toLowerCase().startsWith(day.toLowerCase()))) {
    return dateStr;
  }

  const cleanStr = dateStr.replace(/^(Minggu|Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)[,\s]*/i, '').trim();

  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  let d: Date | null = null;
  if (cleanStr.includes('-')) {
    const parts = cleanStr.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      } else {
        d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      }
    }
  } else {
    d = new Date(cleanStr);
  }

  if (!d || isNaN(d.getTime())) {
    const now = new Date();
    return `${days[now.getDay()]}, ${cleanStr}`;
  }

  return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const formatListItems = (text: string) => {
  if (!text || !text.trim()) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[\s\-\*•\d\.\)]+/, '').trim() || line);
};

interface ReportPdfProps {
  structuredData: StructuredReportData;
  targetFrequencyId?: number;
}

const INTERVAL_NAMES: Record<number, string> = {
  1: 'Harian',
  2: 'Mingguan',
  3: 'Bulanan',
  4: 'Triwulan',
  5: 'Semesteran',
  6: 'Tahunan'
};

export const ShiftReportPdfDocument: React.FC<ReportPdfProps> = ({ structuredData, targetFrequencyId }) => {
  const isCorrectiveOnly = targetFrequencyId === 7 || targetFrequencyId === 999;
  const effectiveFreqId = targetFrequencyId || 1;

  // Filter preventive entries strictly by the target frequency interval
  const matchingPreventiveEntries = isCorrectiveOnly
    ? []
    : structuredData.entries_by_type
        .flatMap((group) => group.entries)
        .filter((e) => !targetFrequencyId || e.checklist_frequency_id === effectiveFreqId);

  // Compute time range strictly for this frequency interval to avoid cross-frequency contamination
  const freqTimeCalc = calculatePreventiveTimeRange(
    matchingPreventiveEntries,
    structuredData.operational_date,
    structuredData.shift,
    structuredData.start_time,
    structuredData.end_time
  );

  const defaultTimeStr =
    freqTimeCalc.timeRangeText !== '-'
      ? freqTimeCalc.timeRangeText
      : formatTimeRange(structuredData.start_time, structuredData.end_time);

  const preventivePdfRows: PdfRowData[] = isCorrectiveOnly
    ? []
    : structuredData.entries_by_type.flatMap((group) =>
        group.entries
          .filter((e) => !targetFrequencyId || e.checklist_frequency_id === targetFrequencyId)
          .map((e) => ({
            kind: 'preventive' as const,
            equipment_name: e.equipment_name,
            type_code: group.type_code,
            view_type: e.view_type,
            notes: e.notes,
            evidences: e.evidences || [],
            checklist_frequency_id: e.checklist_frequency_id,
            equipment_id: e.equipment_id,
          }))
      );

  const includeCorrective = isCorrectiveOnly || !targetFrequencyId || targetFrequencyId === 1;
  const correctivePdfRows: PdfRowData[] = includeCorrective
    ? (structuredData.corrective_entries || []).map((c) => ({
        kind: 'corrective' as const,
        equipment_name: c.equipment_name,
        type_code: c.type_code,
        view_type: 'single' as const,
        notes: c.notes,
        evidences: c.evidences || [],
        problem_description: c.problem_description,
        action_taken: c.action_taken,
        result: c.result,
        result_text: c.result_text,
        time_range: c.time_range,
      }))
  : [];

  const allPdfRows = [...preventivePdfRows, ...correctivePdfRows];

  const renderRow = (row: PdfRowData, idx: number) => {
    const eqNameUpper = row.equipment_name.toUpperCase();
    const typeUpper = row.type_code.toUpperCase();
    const displayEquipmentName = eqNameUpper.includes(typeUpper)
      ? eqNameUpper
      : `${typeUpper} ${eqNameUpper}`;
    const isPreventiveRow = row.kind === 'preventive';

    const rawEvidences = row.evidences || [];
    // Strictly display HANYA 1 FOTO KOLASE in the Dokumentasi column
    const displayCollageUrl = getSingleCollagePhotoUrl(rawEvidences);

    let defaultNote = `${row.type_code} bisa digunakan dengan normal`;
    if (row.type_code === 'XRAY') defaultNote = 'Xray bisa digunakan dengan normal';
    if (row.type_code === 'WTMD') defaultNote = 'WTMD bisa digunakan dengan normal';
    if (row.type_code === 'HHMD') defaultNote = 'HHMD bisa digunakan dengan normal';

    const probItems = row.problem_description ? formatListItems(row.problem_description) : [];
    const actItems = row.action_taken ? formatListItems(row.action_taken) : [];

    let rowTimeStr = defaultTimeStr;
    if (row.kind === 'corrective' && row.time_range) {
      rowTimeStr = row.time_range.includes('WIB') ? row.time_range : `${row.time_range} WIB`;
    }

    return (
      <View key={idx} style={styles.tableRow} wrap={false}>
        {/* No */}
        <View style={styles.colNoCell}>
          <Text style={styles.cellTextCenter}>{idx + 1}</Text>
        </View>

        {/* Tipe Alat */}
        <View style={styles.colTypeCell}>
          <Text style={styles.cellTextCenter}>{displayEquipmentName}</Text>
        </View>

        {/* Jenis Kegiatan */}
        <View style={styles.colKindCell}>
          <Text style={styles.cellTextCenter}>
            {isPreventiveRow
              ? `Preventive Maintenance ${INTERVAL_NAMES[row.checklist_frequency_id || targetFrequencyId || 1] || 'Harian'}`
              : 'Corrective Maintenance'}
          </Text>
        </View>

        {/* Waktu */}
        <View style={styles.colTimeCell}>
          <Text style={styles.cellTextCenter}>{rowTimeStr}</Text>
        </View>

        {/* Uraian Kegiatan */}
        <View style={styles.colUraianCell}>
          {isPreventiveRow ? (
            <Text style={styles.cellTextCenter}>Melakukan Pembersihan dan Check List</Text>
          ) : (
            <View style={{ width: '100%', alignItems: 'center' }}>
              <Text style={[styles.boldText, { textAlign: 'center' }]}>Kerusakan :</Text>
              {probItems.length > 0 ? (
                probItems.map((pItem, pIdx) => (
                  <Text key={pIdx} style={[styles.bulletItem, { textAlign: 'center' }]}>{pItem}</Text>
                ))
              ) : (
                <Text style={[styles.bulletItem, { textAlign: 'center' }]}>-</Text>
              )}
              <Text style={[styles.boldText, { textAlign: 'center' }]}>Tindakan :</Text>
              {actItems.length > 0 ? (
                actItems.map((aItem, aIdx) => (
                  <Text key={aIdx} style={[styles.bulletItem, { textAlign: 'center' }]}>{aItem}</Text>
                ))
              ) : (
                <Text style={[styles.bulletItem, { textAlign: 'center' }]}>-</Text>
              )}
            </View>
          )}
        </View>

        {/* Notes */}
        <View style={styles.colNotesCell}>
          <Text style={styles.cellTextCenter}>
            {isPreventiveRow
              ? row.notes || defaultNote
              : row.result_text || row.notes || 'Equipment sudah dapat digunakan kembali dengan normal.'}
          </Text>
        </View>

        {/* Dokumentasi: HANYA 1 FOTO KOLASE PROPORTIONAL */}
        <View style={styles.colDocsCell}>
          {displayCollageUrl ? (
            <View style={styles.imageGrid}>
              <Image
                src={displayCollageUrl}
                style={styles.docImage}
              />
            </View>
          ) : (
            <Text style={styles.cellTextCenter}>-</Text>
          )}
        </View>
      </View>
    );
  };

  const rawTechs = structuredData.technicians && structuredData.technicians.length > 0
    ? structuredData.technicians
    : ['LUTHFIANDA MUZAKI SULAEMAN'];

  const techRowsCount = Math.max(1, Math.ceil(rawTechs.length / 2));

  return (
    <Document title={`Laporan Maintenance - ${structuredData.operational_date}`}>
      <Page size="A4" style={styles.page} wrap>
        {/* Full Header (Company Header + Operational Info + Table Column Header) in natural document flow */}
        <View style={styles.fullHeaderContainer}>
          {/* 1. Company Header Table */}
          <View style={styles.headerTable}>
            <View style={styles.logoCol}>
              <Image src={logoNararya} style={styles.logoImage} />
            </View>
            <View style={styles.titleCol}>
              <Text style={styles.titleText}>PT. NARARYA TEKNOLOGI INDONESIA</Text>
            </View>
          </View>

          {/* 2. Operational Info Table */}
          <View style={styles.infoTable}>
            {/* Row 1: Date & Shift */}
            <View style={styles.infoRow}>
              <Text style={styles.labelCell18}>Hari / Tanggal</Text>
              <Text style={styles.valCellDate}>{formatDayDate(structuredData.operational_date)}</Text>
              <Text style={styles.labelCellShift}>Shift</Text>
              <Text style={styles.valCellShift}>{structuredData.shift ? structuredData.shift.toUpperCase() : 'PAGI'}</Text>
            </View>

            {/* Technician Rows (Flat rows to guarantee zero overlapping in Yoga engine) */}
            {Array.from({ length: techRowsCount }).map((_, r) => {
              const leftIdx = r * 2;
              const rightIdx = r * 2 + 1;
              const leftTech = rawTechs[leftIdx];
              const rightTech = rawTechs[rightIdx];
              const isLastTechRow = r === techRowsCount - 1;

              return (
                <View
                  key={`tech-row-${r}`}
                  style={[
                    styles.infoRow,
                    isLastTechRow ? { borderBottomWidth: 0 } : {}
                  ]}
                >
                  <Text style={styles.labelCell18}>
                    {r === 0 ? 'Teknisi On Duty' : ''}
                  </Text>
                  <Text style={styles.valCellTechLeft}>
                    {leftTech ? `${leftIdx + 1}. ${leftTech}` : ''}
                  </Text>
                  <Text style={styles.valCellTechRight}>
                    {rightTech ? `${rightIdx + 1}. ${rightTech}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* 3. Table Column Header Row */}
          <View style={styles.tableHeaderRow}>
            <View style={styles.colNoCell}><Text style={styles.headerCellText}>No</Text></View>
            <View style={styles.colTypeCell}><Text style={styles.headerCellText}>Tipe Alat</Text></View>
            <View style={styles.colKindCell}><Text style={styles.headerCellText}>Jenis Kegiatan</Text></View>
            <View style={styles.colTimeCell}><Text style={styles.headerCellText}>Waktu</Text></View>
            <View style={styles.colUraianCell}><Text style={styles.headerCellText}>Uraian Kegiatan</Text></View>
            <View style={styles.colNotesCell}><Text style={styles.headerCellText}>Notes</Text></View>
            <View style={styles.colDocsCell}><Text style={styles.headerCellText}>Dokumentasi</Text></View>
          </View>
        </View>

        {/* Table Rows */}
        {allPdfRows.map((row, idx) => renderRow(row, idx))}

        {/* Signature Block (Wrap=false prevents signature from splitting) */}
        <View style={styles.signatureContainer} wrap={false}>
          <View style={styles.signatureCol}>
            <Text style={styles.sigTitle}>{REPORT_SIGNATORIES.executorTitle}</Text>
            <Text style={styles.sigSubTitle}>{REPORT_SIGNATORIES.executorCompany}</Text>
            <View style={styles.sigSpace} />
            <Text style={styles.sigName}>{REPORT_SIGNATORIES.executorName}</Text>
          </View>

          <View style={styles.signatureCol}>
            <Text style={styles.sigTitle}>{REPORT_SIGNATORIES.supervisorTitle}</Text>
            <Text style={styles.sigSubTitle}>{REPORT_SIGNATORIES.supervisorDepartment}</Text>
            <View style={styles.sigSpace} />
            <Text style={styles.sigName}>{REPORT_SIGNATORIES.supervisorName}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export const PreventivePdfDocument = ShiftReportPdfDocument;
export const CorrectivePdfDocument = ShiftReportPdfDocument;
