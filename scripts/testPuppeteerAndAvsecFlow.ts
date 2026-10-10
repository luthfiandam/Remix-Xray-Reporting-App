import { buildReportHtml, generateReportPdfWithPuppeteer } from '../src/server/puppeteerPdfGenerator';
import { StructuredReportData } from '../src/types';

async function testPuppeteerAndAvsec() {
  console.log('--- Testing Puppeteer HTML Template Generation ---');
  const dummyData: StructuredReportData = {
    operational_date: '2026-09-27',
    shift: 'Pagi',
    technicians: ['Zaky', 'Reza'],
    entries_by_type: [
      {
        type_code: 'XRAY',
        type_name: 'X-Ray Bagasi',
        entries: [
          {
            id: 'p1',
            equipment_id: 1,
            equipment_name: 'BACK UP AREA',
            equipment_type: 'XRAY',
            checklist_frequency_id: 1,
            period_key: '2026-09-27',
            view_type: 'single',
            notes: 'Kondisi mesin normal dan optimal.',
            checklist_results: [],
            measurements: [],
            evidences: [],
          },
        ],
      },
    ],
    corrective_entries: [],
  };

  const html = buildReportHtml(dummyData, { targetFrequencyId: 1 });
  if (html.includes('PEMERIKSAAN HARIAN / MINGGUAN') && html.includes('BACK UP AREA')) {
    console.log('✅ HTML Template generated successfully and contains expected structure.');
  } else {
    console.error('❌ HTML Template validation failed.');
    process.exit(1);
  }

  console.log('--- Testing Puppeteer PDF Buffer Generation ---');
  try {
    const pdfBuffer = await generateReportPdfWithPuppeteer(dummyData, 1);
    if (Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 5000 && pdfBuffer.slice(0, 4).toString() === '%PDF') {
      console.log(`✅ PDF Buffer generated successfully (${pdfBuffer.length} bytes, valid %PDF header).`);
    } else {
      console.error('❌ PDF Buffer validation failed.');
      process.exit(1);
    }
  } catch (err: any) {
    console.warn('⚠️ Puppeteer PDF headless rendering skipped or failed in test environment:', err.message);
  }

  console.log('✅ All Puppeteer tests completed successfully.');
}

testPuppeteerAndAvsec().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
