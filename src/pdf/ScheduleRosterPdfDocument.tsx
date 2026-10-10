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
import logoNararya from '../assets/logopt.png';
import { RosterDaySchedule } from './DaftarHadirPdfDocument';

Font.registerHyphenationCallback((word) => [word]);

export interface ScheduleRosterPdfProps {
  monthName: string;         // e.g. "SEPTEMBER"
  year: number;              // e.g. 2026
  technicians: string[];     // ['LUTHFI', 'DESI', 'FARIZ', 'ZAKY', 'REZA', 'YOAN']
  days: RosterDaySchedule[]; // Array of 1..30 or 1..31 days
  supervisorName?: string;   // default 'RIZKO ENDRA NUGRAHA'
  supervisorTitle?: string;  // default 'FACILITY MAINTENANCE - ELEKTRONIKA'
}

const BORDER_COLOR = '#000000';
const WEEKEND_BG = '#222222';
const COLOR_P = '#F59E0B';  // Amber
const COLOR_PS = '#FACC15'; // Bright Yellow
const COLOR_M = '#38BDF8';  // Cyan / Light Blue
const COLOR_OFF = '#FFFFFF';

const styles = StyleSheet.create({
  page: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingLeft: 24,
    paddingRight: 24,
    fontFamily: 'Helvetica',
    backgroundColor: '#FFFFFF',
    fontSize: 7.5,
    color: '#000000',
  },
  headerBox: {
    borderWidth: 1.5,
    borderColor: BORDER_COLOR,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
    height: 64,
  },
  logoSection: {
    width: 140,
    borderRightWidth: 1.5,
    borderColor: BORDER_COLOR,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  logoImage: {
    width: 125,
    height: 48,
    objectFit: 'contain',
  },
  titleSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  mainTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    textDecoration: 'underline',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  monthTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    marginTop: 6,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  table: {
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: BORDER_COLOR,
  },
  colNo: {
    width: 24,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colName: {
    width: 72,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    paddingLeft: 6,
    justifyContent: 'center',
  },
  colNameHeader: {
    width: 72,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayHeaderRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER_COLOR,
    height: 16,
  },
  dateNumberRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: BORDER_COLOR,
    height: 16,
  },
  dayHeaderCell: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  dayHeaderCellWeekend: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WEEKEND_BG,
  },
  dayHeaderText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
  },
  dayHeaderTextWeekend: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
    color: '#FFFFFF',
  },
  dateNumberCell: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  dateNumberText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
  },
  techRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: BORDER_COLOR,
    height: 20,
  },
  cellNoText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    textAlign: 'center',
  },
  cellNameText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
  },
  cellShiftCode: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftCodeText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
  },
  footerSection: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingRight: 40,
  },
  signatoryContainer: {
    width: 250,
    alignItems: 'center',
  },
  signatoryLabel: {
    fontFamily: 'Helvetica',
    fontSize: 8.5,
  },
  signatoryDept: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.5,
    marginTop: 2,
    marginBottom: 44,
  },
  signatoryName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },
});

export const ScheduleRosterPdfDocument: React.FC<ScheduleRosterPdfProps> = ({
  monthName,
  year,
  technicians = ['LUTHFI', 'DESI', 'FARIZ', 'ZAKY', 'REZA', 'YOAN'],
  days,
  supervisorName = 'RIZKO ENDRA NUGRAHA',
  supervisorTitle = 'FACILITY MAINTENANCE - ELEKTRONIKA',
}) => {
  const getCellBgColor = (code: string) => {
    switch (code) {
      case 'P':
        return COLOR_P;
      case 'PS':
        return COLOR_PS;
      case 'M':
        return COLOR_M;
      default:
        return COLOR_OFF;
    }
  };

  return (
    <Document title={`Schedule OM NTI Halim - ${monthName} ${year}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Header Box */}
        <View style={styles.headerBox}>
          <View style={styles.logoSection}>
            <Image src={logoNararya} style={styles.logoImage} />
          </View>
          <View style={styles.titleSection}>
            <Text style={styles.mainTitle}>SCHEDULE OM NTI HALIM PERDANA KUSUMA</Text>
            <Text style={styles.monthTitle}>{monthName.toUpperCase()} {year}</Text>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Row 1: Day Name Abbr (SL, RB, KM, JM, SB, MG, SN...) */}
          <View style={styles.dayHeaderRow}>
            <View style={styles.colNo}>
              <Text style={styles.dayHeaderText}>No</Text>
            </View>
            <View style={styles.colNameHeader}>
              <Text style={styles.dayHeaderText}>Nama</Text>
            </View>
            {days.map((day) => {
              const isWk = day.isWeekend;
              return (
                <View
                  key={`day-name-${day.dayNumber}`}
                  style={isWk ? styles.dayHeaderCellWeekend : styles.dayHeaderCell}
                >
                  <Text style={isWk ? styles.dayHeaderTextWeekend : styles.dayHeaderText}>
                    {day.dayAbbrId}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Row 2: Date Number (1, 2, 3, 4, ...) */}
          <View style={styles.dateNumberRow}>
            <View style={styles.colNo} />
            <View style={styles.colName} />
            {days.map((day) => (
              <View key={`day-num-${day.dayNumber}`} style={styles.dateNumberCell}>
                <Text style={styles.dateNumberText}>{day.dayNumber}</Text>
              </View>
            ))}
          </View>

          {/* Technician Rows */}
          {technicians.map((techName, idx) => {
            return (
              <View key={techName} style={styles.techRow}>
                {/* No column */}
                <View style={styles.colNo}>
                  <Text style={styles.cellNoText}>{idx + 1}</Text>
                </View>

                {/* Name column */}
                <View style={styles.colName}>
                  <Text style={styles.cellNameText}>{techName.toUpperCase()}</Text>
                </View>

                {/* Day cells */}
                {days.map((day) => {
                  const shiftCode = day.technicianShiftMap[techName] || '-';
                  const bg = getCellBgColor(shiftCode);
                  return (
                    <View
                      key={`${techName}-${day.dayNumber}`}
                      style={[styles.cellShiftCode, { backgroundColor: bg }]}
                    >
                      <Text style={styles.shiftCodeText}>{shiftCode}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* Footer Signatory (Bottom Right) */}
        <View style={styles.footerSection}>
          <View style={styles.signatoryContainer}>
            <Text style={styles.signatoryLabel}>Pengawas Pekerjaan</Text>
            <Text style={styles.signatoryDept}>{supervisorTitle}</Text>
            <Text style={styles.signatoryName}>( {supervisorName} )</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};
