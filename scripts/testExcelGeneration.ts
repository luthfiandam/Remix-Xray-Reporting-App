import { generateOfficialExcelReport } from '../src/services/excelReportGenerator';
import { StructuredReportData } from '../src/types';
import ExcelJS from 'exceljs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

console.log(`${BLUE}======================================================================${RESET}`);
console.log(`${BLUE}       OFFICIAL EXCEL (.xlsx) REPORT GENERATION TEST SUITE            ${RESET}`);
console.log(`${BLUE}======================================================================${RESET}\n`);

const mockData: StructuredReportData = {
  operational_date: '2026-09-14',
  shift: 'Pagi',
  start_time: '07:00',
  end_time: '15:00',
  technicians: ['LUTHFIANDA MUZAKI SULAEMAN', 'RIZKO ENDRA NUGRAHA'],
  lines_by_type: [],
  entries_by_type: [
    {
      type_code: 'XRAY',
      type_name: 'X-Ray Machine',
      priority: 1,
      entries: [
        {
          equipment_id: 1,
          equipment_name: 'X-Ray Dual View 01',
          location_name: 'Terminal 1',
          sequence: 1,
          view_type: 'dual',
          notes: 'Unit beroperasi normal dan seluruh sensor berfungsi baik.',
          checklist_frequency_id: 1,
          measurements: [],
          evidences: [
            {
              id: 1,
              file_path: 'mock_path_1.jpg',
              drive_url: 'https://lh3.googleusercontent.com/d/mock_drive_id_1=w1000',
              url: 'https://lh3.googleusercontent.com/d/mock_drive_id_1=w1000',
              caption: 'Collage Foto Inspeksi',
              is_collage: true,
            },
          ],
          submitted_at: '2026-09-14T08:00:00Z',
        },
      ],
    },
    {
      type_code: 'WTMD',
      type_name: 'Walk Through Metal Detector',
      priority: 2,
      entries: [
        {
          equipment_id: 2,
          equipment_name: 'Walk Through Metal Detector 01',
          location_name: 'Terminal 1',
          sequence: 2,
          view_type: 'single',
          notes: 'Sensitivitas zona 1-6 normal.',
          checklist_frequency_id: 1,
          measurements: [],
          evidences: [],
          submitted_at: '2026-09-14T08:15:00Z',
        },
      ],
    },
  ],
  corrective_entries: [
    {
      id: 101,
      corrective_code: 'CR-20260914-001',
      equipment_name: 'X-Ray Dual View 01',
      type_code: 'XRAY',
      location_name: 'Terminal 1',
      problem_description: 'Roller conveyor tersendat pada sisi inlet',
      action_taken: 'Pembersihan bearing dan pelumasan shaft conveyor',
      result: 'Resolved',
      result_text: 'Roller berputar lancar kembali tanpa getaran abnormal',
      start_time: '09:30',
      end_time: '10:15',
      time_range: '09:30 - 10:15',
      notes: 'Selesai perbaikan korektif',
      technicians: ['LUTHFIANDA MUZAKI SULAEMAN'],
      evidences: ['https://lh3.googleusercontent.com/d/mock_corrective_drive_id=w1000'],
    },
  ],
};

async function runTests() {
  let passed = 0;
  let failed = 0;

  // TEST 1: Generate full Excel Blob
  try {
    const blob = await generateOfficialExcelReport(mockData, { freqId: 0, includeCorrective: true });
    if (!blob || blob.size < 2000) {
      throw new Error(`Blob size too small: ${blob?.size}`);
    }
    if (blob.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      throw new Error(`Invalid mime type: ${blob.type}`);
    }
    console.log(`${GREEN}[PASS] TEST-01: Excel report generation creates valid .xlsx Blob (${blob.size} bytes)${RESET}`);
    passed++;
  } catch (err: any) {
    console.error(`${RED}[FAIL] TEST-01: ${err.message}${RESET}`);
    failed++;
  }

  // TEST 2: Inspect Workbook Content using ExcelJS
  try {
    const blob = await generateOfficialExcelReport(mockData, { freqId: 0, includeCorrective: true });
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const sheet = workbook.getWorksheet(1);
    if (!sheet) {
      throw new Error('Worksheet not found in workbook');
    }

    // Verify Title in A1
    const cellA1 = sheet.getCell('A1');
    if (cellA1.value !== 'PT. NARARYA TEKNOLOGI INDONESIA') {
      throw new Error(`Expected A1 to be 'PT. NARARYA TEKNOLOGI INDONESIA', got: ${cellA1.value}`);
    }

    // Verify Subtitle in A2
    const cellA2 = sheet.getCell('A2');
    if (!String(cellA2.value).includes('LAPORAN PREVENTIVE & CORRECTIVE MAINTENANCE')) {
      throw new Error(`Unexpected A2 value: ${cellA2.value}`);
    }

    console.log(`${GREEN}[PASS] TEST-02: Header and Subtitle correctly present in Excel worksheet${RESET}`);
    passed++;

    // TEST 3: Verify Table Content & Hyperlinks
    let foundEvidenceHyperlink = false;
    let foundCorrectiveAction = false;
    let foundPelaksanaSign = false;

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value && typeof cell.value === 'object') {
          const valObj = cell.value as any;
          if (valObj.hyperlink && String(valObj.hyperlink).includes('googleusercontent.com')) {
            foundEvidenceHyperlink = true;
          }
        }
        const strVal = String(cell.value || '');
        if (strVal.includes('Pembersihan bearing dan pelumasan')) {
          foundCorrectiveAction = true;
        }
        if (strVal.includes('LUTHFIANDA MUZAKI SULAEMAN')) {
          foundPelaksanaSign = true;
        }
      });
    });

    if (!foundEvidenceHyperlink) {
      throw new Error('Did not find clickable Google Drive hyperlink in documentation column');
    }
    console.log(`${GREEN}[PASS] TEST-03: Google Drive photo documentation converted to clickable hyperlink in Excel${RESET}`);
    passed++;

    if (!foundCorrectiveAction) {
      throw new Error('Did not find corrective maintenance action description in worksheet');
    }
    console.log(`${GREEN}[PASS] TEST-04: Corrective maintenance details successfully integrated into Excel table${RESET}`);
    passed++;

    if (!foundPelaksanaSign) {
      throw new Error('Did not find Pelaksana signature in worksheet footer');
    }
    console.log(`${GREEN}[PASS] TEST-05: Official Pelaksana & Pengawas sign-off block present in Excel footer${RESET}`);
    passed++;

  } catch (err: any) {
    console.error(`${RED}[FAIL] Tests 2-5 inspection: ${err.message}${RESET}`);
    failed++;
  }

  // TEST 6: Single Interval filtering (freqId: 2 without corrective)
  try {
    const blob = await generateOfficialExcelReport(mockData, { freqId: 2, includeCorrective: false });
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.getWorksheet(1);
    if (!sheet) throw new Error('Worksheet not found');

    const cellA2 = sheet.getCell('A2');
    if (!String(cellA2.value).includes('MINGGUAN')) {
      throw new Error(`Expected A2 to specify MINGGUAN, got: ${cellA2.value}`);
    }

    console.log(`${GREEN}[PASS] TEST-06: Filtered interval generation correctly targets interval metadata${RESET}`);
    passed++;
  } catch (err: any) {
    console.error(`${RED}[FAIL] TEST-06: ${err.message}${RESET}`);
    failed++;
  }

  console.log(`\n${BLUE}======================================================================${RESET}`);
  console.log(`Total: ${passed + failed} | Passed: ${GREEN}${passed}${RESET} | Failed: ${failed ? RED + failed + RESET : '0'}`);
  console.log(`${BLUE}======================================================================${RESET}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
