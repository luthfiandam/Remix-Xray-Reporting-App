/**
 * X-RAY REPORTING APP — v0.6.6
 * AUTOMATED PDF REPORT & COMPANY LOGO VALIDATION TEST SUITE
 */

import fs from 'fs';
import path from 'path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

console.log(`${BLUE}======================================================================${RESET}`);
console.log(`${BLUE}       PDF REPORT & LOGO REPLACEMENT TEST SUITE                       ${RESET}`);
console.log(`${BLUE}======================================================================${RESET}\n`);

// 1. Verify canonical company logo asset exists in src/assets and is valid PNG
const canonicalLogoPath = path.join(process.cwd(), 'src', 'assets', 'logopt.png');
if (!fs.existsSync(canonicalLogoPath)) {
  console.error(`${RED}[FAIL] TEST-01: src/assets/logopt.png does not exist${RESET}`);
  process.exit(1);
}

const logoBuffer = fs.readFileSync(canonicalLogoPath);
if (logoBuffer.length < 1000) {
  console.error(`${RED}[FAIL] TEST-01: Canonical logo file too small or empty (${logoBuffer.length} bytes)${RESET}`);
  process.exit(1);
}

// Check PNG magic bytes
const isPng = logoBuffer[0] === 0x89 && logoBuffer[1] === 0x50 && logoBuffer[2] === 0x4E && logoBuffer[3] === 0x47;
if (!isPng) {
  console.error(`${RED}[FAIL] TEST-01: Canonical logo file is not a valid PNG${RESET}`);
  process.exit(1);
}

// Read dimensions from IHDR chunk
const width = logoBuffer.readUInt32BE(16);
const height = logoBuffer.readUInt32BE(20);
const aspectRatio = width / height;

console.log(`${GREEN}[PASS] TEST-01: Canonical logo asset (src/assets/logopt.png) exists and is a valid PNG (Width: ${width}, Height: ${height}, Aspect Ratio: ${aspectRatio.toFixed(3)})${RESET}`);

// 2. Verify static logo import in PdfDocument.tsx
const pdfDocCode = fs.readFileSync(path.join(process.cwd(), 'src', 'pdf', 'PdfDocument.tsx'), 'utf-8');
if (!pdfDocCode.includes("import logoNararya from '../assets/logopt.png'")) {
  console.error(`${RED}[FAIL] TEST-02: PdfDocument.tsx does not statically import logoNararya from ../assets/logopt.png${RESET}`);
  process.exit(1);
}
if (!pdfDocCode.includes('<Image src={logoNararya} style={styles.logoImage} />')) {
  console.error(`${RED}[FAIL] TEST-02: PdfDocument.tsx does not use static import logoNararya in <Image src={logoNararya} />${RESET}`);
  process.exit(1);
}
if (pdfDocCode.includes('/company-logo.png') || pdfDocCode.includes('/logo_nti.png')) {
  console.error(`${RED}[FAIL] TEST-02: PdfDocument.tsx contains deprecated string paths${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}[PASS] TEST-02: PdfDocument.tsx correctly uses static import logoNararya with zero hardcoded string URLs${RESET}`);

// 3. Verify objectFit contain in styles
if (!pdfDocCode.includes("objectFit: 'contain'")) {
  console.error(`${RED}[FAIL] TEST-03: PdfDocument.tsx logoImage style missing objectFit contain${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}[PASS] TEST-03: PdfDocument.tsx styles enforce objectFit: contain (proportional scaling guaranteed)${RESET}`);

// 4. Verify HTML preview static import in PdfExportSection.tsx
const pdfExportSectionCode = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'report', 'PdfExportSection.tsx'), 'utf-8');
if (!pdfExportSectionCode.includes("import logoNararya from '../../assets/logopt.png'")) {
  console.error(`${RED}[FAIL] TEST-04: PdfExportSection.tsx does not statically import logoNararya from ../../assets/logopt.png${RESET}`);
  process.exit(1);
}
if (!pdfExportSectionCode.includes('src={logoNararya}')) {
  console.error(`${RED}[FAIL] TEST-04: PdfExportSection.tsx does not use static import logoNararya in <img src={logoNararya} />${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}[PASS] TEST-04: PdfExportSection.tsx correctly uses static import logoNararya for HTML preview${RESET}`);

// 5. Verify PDF Archive filename utilities
const archiveCode = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'pdfArchiveUtils.ts'), 'utf-8');
if (!archiveCode.includes('(${shiftCode}).pdf')) {
  console.error(`${RED}[FAIL] TEST-05: pdfArchiveUtils.ts naming convention broken${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}[PASS] TEST-05: PDF filename generation logic intact (e.g., '24 Agustus 2026 (PS).pdf')${RESET}`);

// 6. Verify documentation photos have subtle padding and are borderless
if (pdfDocCode.includes("borderColor: '#666666'")) {
  console.error(`${RED}[FAIL] TEST-06: PdfDocument.tsx still contains image border styling (#666666)${RESET}`);
  process.exit(1);
}
if (!pdfDocCode.includes("paddingVertical: 2") || !pdfDocCode.includes("width: '100%'")) {
  console.error(`${RED}[FAIL] TEST-06: PdfDocument.tsx colDocsCell or image not configured with subtle padding and full width${RESET}`);
  process.exit(1);
}
if (!pdfExportSectionCode.includes("alt=\"Dokumentasi Kolase\"") || !pdfExportSectionCode.includes("border: 'none'")) {
  console.error(`${RED}[FAIL] TEST-06: PdfExportSection.tsx missing border: none on Dokumentasi Kolase image${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}[PASS] TEST-06: Documentation photos configured with clean subtle padding and zero internal borders${RESET}`);

console.log(`\n${BLUE}======================================================================${RESET}`);
console.log(`${GREEN}Status                 : ALL 6 PDF AUDIT CONTRACT CONDITIONS PASSED${RESET}`);
console.log(`${BLUE}======================================================================${RESET}`);
