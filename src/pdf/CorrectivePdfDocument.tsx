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
import { CorrectiveReport, Equipment, Location } from '../types';
import { formatIndonesianDate } from '../utils/timeFormat';
import logoNararya from '../assets/logopt.png';
import { REPORT_SIGNATORIES } from '../config/reportSignatories';

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: 20,
    paddingBottom: 24,
    paddingLeft: 24,
    paddingRight: 24,
    fontFamily: 'Times-Roman',
    backgroundColor: '#FFFFFF',
    fontSize: 9,
    color: '#000000',
  },
  headerTable: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#000000',
    height: 64,
    alignItems: 'center',
    marginBottom: 10,
  },
  logoCol: {
    width: 140,
    borderRightWidth: 1,
    borderColor: '#000000',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  logoImage: {
    width: 130,
    height: 52,
    objectFit: 'contain',
  },
  titleCol: {
    flex: 1,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    fontFamily: 'Times-Bold',
    fontSize: 13,
    color: '#000000',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  subTitleText: {
    fontFamily: 'Times-Roman',
    fontSize: 9,
    color: '#333333',
    textAlign: 'center',
    marginTop: 2,
  },
  sectionTitle: {
    fontFamily: 'Times-Bold',
    fontSize: 9.5,
    backgroundColor: '#f1f5f9',
    padding: 4,
    borderWidth: 0.5,
    borderColor: '#000000',
    marginTop: 8,
    textTransform: 'uppercase',
  },
  metaTable: {
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#000000',
  },
  metaRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderColor: '#000000',
    minHeight: 18,
    alignItems: 'center',
  },
  metaLabel: {
    width: 110,
    padding: 3,
    fontFamily: 'Times-Bold',
    fontSize: 8.5,
    borderRightWidth: 0.5,
    borderColor: '#000000',
    backgroundColor: '#f8fafc',
  },
  metaVal: {
    flex: 1,
    padding: 3,
    fontSize: 8.5,
  },
  contentBox: {
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#000000',
    padding: 6,
    minHeight: 36,
    fontSize: 8.5,
    lineHeight: 1.35,
  },
  bulletItem: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  bulletDot: {
    width: 10,
    fontFamily: 'Times-Bold',
  },
  bulletText: {
    flex: 1,
    fontSize: 8.5,
  },
  collageContainer: {
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#000000',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
    backgroundColor: '#ffffff',
  },
  collageImage: {
    maxWidth: 380,
    maxHeight: 280,
    objectFit: 'contain',
    borderWidth: 0.5,
    borderColor: '#cbd5e1',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    width: '100%',
  },
  photoGridItem: {
    width: '48%',
    height: 120,
    objectFit: 'cover',
    borderWidth: 0.5,
    borderColor: '#cbd5e1',
  },
  signSection: {
    flexDirection: 'row',
    marginTop: 14,
    borderWidth: 0.5,
    borderColor: '#000000',
    pageBreakInside: 'avoid',
  },
  signCol: {
    flex: 1,
    alignItems: 'center',
    padding: 5,
    borderRightWidth: 0.5,
    borderColor: '#000000',
  },
  signColLast: {
    flex: 1,
    alignItems: 'center',
    padding: 5,
  },
  signTitle: {
    fontFamily: 'Times-Bold',
    fontSize: 8,
    textAlign: 'center',
    marginBottom: 35,
  },
  signName: {
    fontFamily: 'Times-Bold',
    fontSize: 8,
    textAlign: 'center',
    textDecoration: 'underline',
  },
  signRole: {
    fontFamily: 'Times-Roman',
    fontSize: 7.5,
    textAlign: 'center',
    color: '#475569',
    marginTop: 1,
  },
});

export interface CorrectiveReportPdfProps {
  report: CorrectiveReport;
  equipment?: Equipment;
  location?: Location;
  collageUrl?: string;
}

export const CorrectiveReportPdfDocument: React.FC<CorrectiveReportPdfProps> = ({
  report,
  equipment,
  location,
  collageUrl,
}) => {
  const dateFormatted = formatIndonesianDate(report.corrective_date, { includeDayName: true });
  const shiftStr = report.shift ? `Shift ${report.shift}` : 'Shift Pagi';
  const techsStr = Array.isArray(report.technicians) && report.technicians.length > 0
    ? report.technicians.join(', ')
    : (report.created_by || 'Teknisi Jaga');

  const eqName = equipment?.name || 'Peralatan';
  const locName = location?.name || '';
  const lokasiAlat = locName ? `${eqName} (${locName})` : eqName;

  const rawAction = report.action_taken || '-';
  const actionLines = rawAction.split('\n').map((l) => l.trim()).filter(Boolean);

  const cleanTime = (t?: string) => {
    if (!t || t.trim() === '-') return '-';
    const c = t.trim().replace(':', '.');
    return c.toUpperCase().includes('WIB') ? c : `${c} WIB`;
  };

  // Do not hand private S3 keys / expiring proxy URLs to React PDF.
  // Only the pre-resolved authenticated image may be embedded.
  const effectiveCollage = collageUrl || undefined;
  const rawEvidences: string[] = [];

  return (
    <Document title={`Laporan Corrective Maintenance - ${report.corrective_code || 'CR'}`}>
      <Page size="A4" style={styles.page}>
        {/* Company Header */}
        <View style={styles.headerTable}>
          <View style={styles.logoCol}>
            <Image src={logoNararya} style={styles.logoImage} />
          </View>
          <View style={styles.titleCol}>
            <Text style={styles.titleText}>LAPORAN CORRECTIVE MAINTENANCE</Text>
            <Text style={styles.subTitleText}>
              FASILITAS KEAMANAN PENERBANGAN (AVSEC) - BANDARA HALIM PERDANAKUSUMA
            </Text>
          </View>
        </View>

        {/* Section 1: Informasi Pelaksanaan */}
        <Text style={styles.sectionTitle}>1. Informasi Gangguan & Penanganan</Text>
        <View style={styles.metaTable}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Kode Laporan</Text>
            <Text style={styles.metaVal}>{report.corrective_code || '-'}</Text>
            <Text style={styles.metaLabel}>Hari / Tanggal</Text>
            <Text style={styles.metaVal}>{dateFormatted} • {shiftStr}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Alat & Lokasi</Text>
            <Text style={styles.metaVal}>{lokasiAlat}</Text>
            <Text style={styles.metaLabel}>Waktu Pengerjaan</Text>
            <Text style={styles.metaVal}>{cleanTime(report.start_time)} s/d {cleanTime(report.end_time)}</Text>
          </View>
          <View style={{ ...styles.metaRow, borderBottomWidth: 0 }}>
            <Text style={styles.metaLabel}>Teknisi Pelaksana</Text>
            <Text style={styles.metaVal}>{techsStr}</Text>
            <Text style={styles.metaLabel}>Hasil Status</Text>
            <Text style={{ ...styles.metaVal, fontFamily: 'Times-Bold' }}>
              {report.result_text || report.result || 'Selesai (Normal)'}
            </Text>
          </View>
        </View>

        {/* Section 2: Uraian Masalah */}
        <Text style={styles.sectionTitle}>2. Uraian Masalah / Gejala Kerusakan</Text>
        <View style={styles.contentBox}>
          <Text>{report.problem_description || 'Tidak ada uraian masalah.'}</Text>
        </View>

        {/* Section 3: Tindakan Perbaikan */}
        <Text style={styles.sectionTitle}>3. Tindakan Perbaikan</Text>
        <View style={styles.contentBox}>
          {actionLines.length > 0 ? (
            actionLines.map((line, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{line.replace(/^[-•*]\s*/, '')}</Text>
              </View>
            ))
          ) : (
            <Text>-</Text>
          )}
        </View>

        {/* Section 4: Hasil & Catatan */}
        <Text style={styles.sectionTitle}>4. Hasil Penanganan & Catatan Tambahan</Text>
        <View style={styles.contentBox}>
          <Text style={{ fontFamily: 'Times-Bold', marginBottom: 2 }}>
            Hasil Akhir: <Text style={{ fontFamily: 'Times-Roman' }}>{report.result_text || report.result || 'Xray sudah bisa di Gunakan dengan Normal.'}</Text>
          </Text>
          {report.notes && report.notes !== '-' && (
            <Text style={{ color: '#334155', marginTop: 2 }}>
              Catatan: {report.notes}
            </Text>
          )}
        </View>

        {/* Section 5: Foto Dokumentasi (Foto Kolase) */}
        <Text style={styles.sectionTitle}>5. Dokumentasi Foto Penanganan (Foto Kolase)</Text>
        <View style={styles.collageContainer}>
          {effectiveCollage ? (
            <Image src={effectiveCollage} style={styles.collageImage} />
          ) : rawEvidences.length > 0 ? (
            <View style={styles.photoGrid}>
              {rawEvidences.slice(0, 4).map((imgUrl, i) => (
                <Image key={i} src={imgUrl} style={styles.photoGridItem} />
              ))}
            </View>
          ) : (
            <Text style={{ color: '#94a3b8', fontStyle: 'italic' }}>
              Tidak ada dokumentasi foto yang dilampirkan.
            </Text>
          )}
        </View>

        {/* Section 6: Lembar Pengesahan / Tanda Tangan */}
        <View style={styles.signSection}>
          <View style={styles.signCol}>
            <Text style={styles.signTitle}>Pelaksana Pekerjaan</Text>
            <Text style={styles.signName}>{techsStr.split(',')[0] || REPORT_SIGNATORIES.executorName}</Text>
            <Text style={styles.signRole}>{REPORT_SIGNATORIES.executorCompany}</Text>
          </View>
          <View style={styles.signColLast}>
            <Text style={styles.signTitle}>Pengawas Fasilitas</Text>
            <Text style={styles.signName}>{REPORT_SIGNATORIES.supervisorName}</Text>
            <Text style={styles.signRole}>{REPORT_SIGNATORIES.supervisorDepartment}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};
