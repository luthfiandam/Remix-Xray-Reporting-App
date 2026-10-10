import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import { AttendanceRecord, ShiftType } from '../types';

Font.registerHyphenationCallback((word) => [word]);

export interface RosterDaySchedule {
  dayNumber: number;
  dayNameEn: string;
  dayNameId: string;
  dayAbbrId: string;
  fullDateStr: string; // e.g. "Tuesday, September 1, 2026"
  dateYmd: string;     // e.g. "2026-09-01"
  isWeekend: boolean;
  shifts: {
    PS: Record<string, boolean>; // techName -> isOnDuty
    M: Record<string, boolean>;  // techName -> isOnDuty
  };
  technicianShiftMap: Record<string, 'P' | 'PS' | 'M' | '-'>;
}

export interface DaftarHadirPdfProps {
  monthName: string;         // e.g. "September"
  year: number;              // e.g. 2026
  startDateStr?: string;     // e.g. "01 September 2026"
  endDateStr?: string;       // e.g. "30 September 2026"
  technicians: string[];     // ['LUTHFI', 'DESI', 'FARIZ', 'ZAKY', 'REZA', 'YOAN']
  days: RosterDaySchedule[]; // Array of 1..30 or 1..31 days
  attendanceRecords?: AttendanceRecord[];
  mode?: 'blank' | 'filled'; // 'blank' for physical signing, 'filled' for checkmarks/timestamps
  supervisorName?: string;   // default 'RIZKO ENDRA NUGRAHA'
  supervisorTitle?: string;  // default 'FACILITY MAINTENANCE - ELEKTRONIKA'
}

const CYAN_HEADER_BG = '#00E5FF';
const DARK_CELL_BG = '#2A2A2A';
const BORDER_COLOR = '#000000';

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 24,
    paddingLeft: 28,
    paddingRight: 28,
    fontFamily: 'Helvetica',
    backgroundColor: '#FFFFFF',
    fontSize: 8,
    color: '#000000',
  },
  titleContainer: {
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
  mainTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10.5,
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  subTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 4,
  },
  table: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER_COLOR,
  },
  tableHeaderRowTop: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CYAN_HEADER_BG,
    height: 18,
  },
  tableHeaderRowBottom: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CYAN_HEADER_BG,
    height: 18,
  },
  colNo: {
    width: 26,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colDate: {
    width: 140,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colShift: {
    width: 32,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colNamaHeader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colTech: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colTechLast: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    textAlign: 'center',
  },
  headerTextNama: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  dataRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: BORDER_COLOR,
    height: 20,
  },
  cellNo: {
    width: 26,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellDate: {
    width: 140,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    paddingLeft: 8,
    justifyContent: 'center',
  },
  cellDateText: {
    fontSize: 7.5,
    fontFamily: 'Helvetica',
  },
  cellShift: {
    width: 32,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellShiftText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
  },
  cellTechWhite: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTechWhiteLast: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTechDark: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: DARK_CELL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTechDarkLast: {
    flex: 1,
    backgroundColor: DARK_CELL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 6.5,
    color: '#0369A1',
    textAlign: 'center',
  },
  footerContainer: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  legendBlock: {
    width: 200,
  },
  legendItem: {
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    lineHeight: 1.4,
  },
  signatoryBlock: {
    width: 230,
    alignItems: 'center',
  },
  signatoryLabel: {
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    textAlign: 'center',
  },
  signatoryDepartment: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.5,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 50,
  },
  signatoryName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.5,
    textAlign: 'center',
  },
});

export const DaftarHadirPdfDocument: React.FC<DaftarHadirPdfProps> = ({
  monthName,
  year,
  startDateStr,
  endDateStr,
  technicians = ['LUTHFI', 'DESI', 'FARIZ', 'ZAKY', 'REZA', 'YOAN'],
  days,
  attendanceRecords = [],
  mode = 'blank',
  supervisorName = 'RIZKO ENDRA NUGRAHA',
  supervisorTitle = 'FACILITY MAINTENANCE - ELEKTRONIKA',
}) => {
  const lastDay = days.length > 0 ? days[days.length - 1].dayNumber : 30;
  const startLabel = startDateStr || `01 ${monthName} ${year}`;
  const endLabel = endDateStr || `${String(lastDay).padStart(2, '0')} ${monthName} ${year}`;

  // Split into chunks: Page 1 (days 1-14), Page 2 (days 15-28), Page 3 (days 29+)
  const page1Days = days.filter((d) => d.dayNumber >= 1 && d.dayNumber <= 14);
  const page2Days = days.filter((d) => d.dayNumber >= 15 && d.dayNumber <= 28);
  const page3Days = days.filter((d) => d.dayNumber >= 29);

  const pages = [
    { pageNum: 1, daysList: page1Days, isLast: page3Days.length === 0 && page2Days.length === 0 },
    { pageNum: 2, daysList: page2Days, isLast: page3Days.length === 0 },
    { pageNum: 3, daysList: page3Days, isLast: true },
  ].filter((p) => p.daysList.length > 0);

  // Helper to check if technician attended on that date and shift
  const getAttendanceCheck = (dateYmd: string, shiftKey: 'PS' | 'M', techName: string): string => {
    if (mode === 'blank') return '';
    const cleanTech = techName.trim().toLowerCase();
    const isNight = shiftKey === 'M';
    const match = attendanceRecords.find((r) => {
      const recTech = (r.technician_name || '').trim().toLowerCase();
      const matchTech = recTech === cleanTech || recTech.includes(cleanTech) || cleanTech.includes(recTech);
      const matchDate = r.attendance_date === dateYmd;
      const isRecordNight = String(r.shift || '').toLowerCase().includes('malam') || (r.shift as string) === 'M';
      return matchTech && matchDate && (isNight ? isRecordNight : !isRecordNight);
    });
    if (match) {
      if (match.attendance_time) {
        return `✓ ${match.attendance_time.replace(/WIB/i, '').trim()}`;
      }
      return '✓ HADIR';
    }
    return '';
  };

  const renderTable = (dayItems: RosterDaySchedule[], isLastPage: boolean) => (
    <View style={styles.table}>
      {/* Table Header Row 1 */}
      <View style={styles.tableHeaderRowTop}>
        <View style={styles.colNo}>
          <Text style={styles.headerText}>No</Text>
        </View>
        <View style={styles.colDate}>
          <Text style={styles.headerText}>Hari / Tanggal</Text>
        </View>
        <View style={styles.colShift}>
          <Text style={styles.headerText}>Shift</Text>
        </View>
        <View style={styles.colNamaHeader}>
          <Text style={styles.headerTextNama}>NAMA</Text>
        </View>
      </View>

      {/* Table Header Row 2 (Technician Column Subheaders) */}
      <View style={styles.tableHeaderRowBottom}>
        <View style={styles.colNo} />
        <View style={styles.colDate} />
        <View style={styles.colShift} />
        {technicians.map((name, idx) => {
          const isLast = idx === technicians.length - 1;
          return (
            <View key={name} style={isLast ? styles.colTechLast : styles.colTech}>
              <Text style={styles.headerText}>{name.toUpperCase()}</Text>
            </View>
          );
        })}
      </View>

      {/* Rows for Each Day: 2 rows (PS & M) */}
      {dayItems.map((day) => {
        return (
          <React.Fragment key={`day-${day.dayNumber}`}>
            {/* Row 1: Shift PS */}
            <View style={styles.dataRow}>
              {/* No cell */}
              <View style={styles.cellNo}>
                <Text style={styles.cellShiftText}>{day.dayNumber}</Text>
              </View>

              {/* Date cell */}
              <View style={styles.cellDate}>
                <Text style={styles.cellDateText}>{day.fullDateStr}</Text>
              </View>

              {/* Shift cell */}
              <View style={styles.cellShift}>
                <Text style={styles.cellShiftText}>PS</Text>
              </View>

              {/* Technician cells for PS */}
              {technicians.map((tech, idx) => {
                const isLast = idx === technicians.length - 1;
                const isOnDuty = Boolean(day.shifts.PS[tech]);
                const checkVal = isOnDuty ? getAttendanceCheck(day.dateYmd, 'PS', tech) : '';

                if (isOnDuty) {
                  return (
                    <View key={`${tech}-PS`} style={isLast ? styles.cellTechWhiteLast : styles.cellTechWhite}>
                      {checkVal ? <Text style={styles.checkText}>{checkVal}</Text> : null}
                    </View>
                  );
                }
                return (
                  <View key={`${tech}-PS`} style={isLast ? styles.cellTechDarkLast : styles.cellTechDark} />
                );
              })}
            </View>

            {/* Row 2: Shift M */}
            <View style={styles.dataRow}>
              <View style={styles.cellNo} />
              <View style={styles.cellDate} />
              <View style={styles.cellShift}>
                <Text style={styles.cellShiftText}>M</Text>
              </View>

              {/* Technician cells for M */}
              {technicians.map((tech, idx) => {
                const isLast = idx === technicians.length - 1;
                const isOnDuty = Boolean(day.shifts.M[tech]);
                const checkVal = isOnDuty ? getAttendanceCheck(day.dateYmd, 'M', tech) : '';

                if (isOnDuty) {
                  return (
                    <View key={`${tech}-M`} style={isLast ? styles.cellTechWhiteLast : styles.cellTechWhite}>
                      {checkVal ? <Text style={styles.checkText}>{checkVal}</Text> : null}
                    </View>
                  );
                }
                return (
                  <View key={`${tech}-M`} style={isLast ? styles.cellTechDarkLast : styles.cellTechDark} />
                );
              })}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );

  return (
    <Document title={`Daftar Hadir OM NTI - ${monthName} ${year}`}>
      {pages.map((p, idx) => {
        return (
          <Page key={p.pageNum} size="A4" style={styles.page}>
            {/* Header Box on every page */}
            <View style={styles.titleContainer}>
              <Text style={styles.mainTitle}>DAFTAR HADIR OM NTI HALIM PERDANA KUSUMA</Text>
              <Text style={styles.subTitle}>
                {startLabel} s.d {endLabel}
              </Text>
            </View>

            {/* Table */}
            {renderTable(p.daysList, p.isLast)}

            {/* Footer on Last Page */}
            {p.isLast && (
              <View style={styles.footerContainer}>
                <View style={styles.legendBlock}>
                  <Text style={styles.legendItem}>P   : 08.00 s/d 17.00 WIB</Text>
                  <Text style={styles.legendItem}>PS : 07.00 s/d 19.00 WIB</Text>
                  <Text style={styles.legendItem}>M  : 19.00 s/d 07.00 WIB</Text>
                </View>

                <View style={styles.signatoryBlock}>
                  <Text style={styles.signatoryLabel}>Pengawas Pekerjaan</Text>
                  <Text style={styles.signatoryDepartment}>{supervisorTitle}</Text>
                  <Text style={styles.signatoryName}>( {supervisorName} )</Text>
                </View>
              </View>
            )}
          </Page>
        );
      })}
    </Document>
  );
};
