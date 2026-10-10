/**
 * X-RAY REPORTING APP — PUPPETEER HIGH-FIDELITY PDF GENERATOR
 * 
 * Generates official Maintenance Reports matching the Excel/manual standard format
 * using HTML/CSS + Puppeteer Chrome Headless on Linux VPS.
 * 
 * VPS Resource Optimizations:
 * - Mutex concurrency lock (max 1 concurrent PDF job)
 * - Single reusable browser instance with auto-recycle after 50 jobs
 * - Isolated Page per job with explicit cleanup in finally block
 * - 30-second execution timeout guard
 * - Zero permanent disk writes (in-memory Buffer pipeline)
 */

import fs from 'fs';
import path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { StructuredReportData } from '../types';
import { formatTimeRange } from '../utils/timeFormat';
import { calculatePreventiveTimeRange } from '../services/reportService';
import { getSingleCollagePhotoUrl } from '../utils/evidenceUtils';

function loadS3Config() {
  const envEndpoint = process.env.IDCLOUDHOST_ENDPOINT || process.env.S3_ENDPOINT || 'https://is3.cloudhost.id';
  const envAccessKey = process.env.IDCLOUDHOST_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || 'T1XEG7T26UHPPG2C2I1U';
  const envSecretKey = process.env.IDCLOUDHOST_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY || '';
  const envBucket = process.env.IDCLOUDHOST_BUCKET || process.env.S3_BUCKET_NAME || '';
  const envRegion = process.env.IDCLOUDHOST_REGION || process.env.S3_REGION || 'us-east-1';

  const candidatePaths = [
    path.join(process.cwd(), '.data', 'storage_config.json'),
    path.join(process.cwd(), 'data', 'storage_config.json'),
    path.join(process.cwd(), 'storage_config.json'),
    path.join(process.cwd(), 'idcloudhost_storage_config.json'),
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const data = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(data);
        return {
          endpoint: parsed.endpoint || envEndpoint,
          region: parsed.region || envRegion,
          accessKeyId: (parsed.accessKeyId || envAccessKey).trim(),
          secretAccessKey: (parsed.secretAccessKey || envSecretKey).trim(),
          bucketName: (parsed.bucketName || envBucket).trim(),
          enabled: parsed.enabled !== undefined ? parsed.enabled : true,
        };
      }
    } catch (e) {
      console.error('Error reading storage config file:', e);
    }
  }

  return {
    endpoint: envEndpoint,
    region: envRegion,
    accessKeyId: envAccessKey.trim(),
    secretAccessKey: envSecretKey.trim(),
    bucketName: envBucket.trim(),
    enabled: true,
  };
}

let s3ClientInstance: S3Client | null = null;
function getS3ClientInstance(cfg: any): S3Client {
  if (!s3ClientInstance) {
    const cleanEndpoint = cfg.endpoint.startsWith('http') ? cfg.endpoint : `https://${cfg.endpoint}`;
    s3ClientInstance = new S3Client({
      endpoint: cleanEndpoint,
      region: cfg.region || 'us-east-1',
      credentials: {
        accessKeyId: (cfg.accessKeyId || '').trim(),
        secretAccessKey: (cfg.secretAccessKey || '').trim(),
      },
      forcePathStyle: true,
    });
  }
  return s3ClientInstance;
}

async function fetchS3ObjectAsDataUri(objectKey: string): Promise<string | null> {
  const cleanKey = (objectKey || '').replace(/\.\./g, '').replace(/^\/+/, '').trim();
  if (!cleanKey) return null;

  const cfg = loadS3Config();
  if (!cfg.enabled || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
    return null;
  }

  try {
    const s3 = getS3ClientInstance(cfg);
    const s3Res = await s3.send(
      new GetObjectCommand({
        Bucket: cfg.bucketName,
        Key: cleanKey,
      })
    );

    if (!s3Res.Body) return null;
    const byteArray = await (s3Res.Body as any).transformToByteArray();
    const buffer = Buffer.from(byteArray);

    let mime = 'image/jpeg';
    const lowerKey = cleanKey.toLowerCase();
    if (lowerKey.endsWith('.png')) mime = 'image/png';
    else if (lowerKey.endsWith('.webp')) mime = 'image/webp';

    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err: any) {
    console.warn(`[Puppeteer S3 Fetch Warning] Could not fetch '${cleanKey}' from S3:`, err?.message || err);
    return null;
  }
}

async function fetchHttpUrlAsDataUri(urlStr: string): Promise<string | null> {
  try {
    let targetUrl = (urlStr || '').trim();
    if (!targetUrl) return null;
    if (targetUrl.startsWith('/')) {
      const port = process.env.PORT || '3000';
      targetUrl = `http://127.0.0.1:${port}${targetUrl}`;
    }
    const res = await fetch(targetUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err: any) {
    console.warn(`[Puppeteer HTTP Fetch Warning] Could not fetch image from URL:`, err?.message || err);
    return null;
  }
}

function extractS3KeyFromString(str: string): string | null {
  if (!str || typeof str !== 'string') return null;
  let decoded = str;
  try {
    while (decoded.includes('%')) {
      const prev = decoded;
      decoded = decodeURIComponent(decoded);
      if (decoded === prev) break;
    }
  } catch (_) {}

  const kIdx = decoded.indexOf('!Kantor/');
  if (kIdx !== -1) {
    return decoded.substring(kIdx).split('?')[0].replace(/\.\./g, '').trim();
  }
  return null;
}

/**
 * Server-side resolver that converts object_key or HTTP evidence URLs into in-memory Base64 Data URIs.
 * Eliminates browser CORS issues and ensures private S3 images render in Puppeteer.
 */
export async function resolveAllEvidencesServerSide(structuredData: StructuredReportData): Promise<void> {
  if (!structuredData) return;

  const resolveItem = async (evItem: any, index: number, arr: any[]): Promise<void> => {
    if (!evItem) return;

    if (typeof evItem === 'string') {
      if (evItem.startsWith('data:image/')) return;
      
      const extractedKey = extractS3KeyFromString(evItem);
      if (extractedKey) {
        const dataUri = await fetchS3ObjectAsDataUri(extractedKey);
        if (dataUri) {
          arr[index] = dataUri;
          return;
        }
      }

      if (evItem.startsWith('http')) {
        const dataUri = await fetchHttpUrlAsDataUri(evItem);
        if (dataUri) arr[index] = dataUri;
      }
      return;
    }

    if (typeof evItem === 'object' && evItem !== null) {
      // 1. Check if already has base64 Data URI
      const existingUri = evItem.dataUrl || evItem.data_uri || evItem.photo_base64 || evItem.file_path || evItem.photo_url || evItem.url;
      if (typeof existingUri === 'string' && existingUri.startsWith('data:image/')) {
        evItem.file_path = existingUri;
        return;
      }

      // 2. Check for S3 key in object_key / photo_object_key / file_path / photo_url / url
      const rawCandidates = [
        evItem.object_key,
        evItem.photo_object_key,
        evItem.file_path,
        evItem.photo_url,
        evItem.url,
        evItem.drive_url,
      ];

      for (const cand of rawCandidates) {
        if (typeof cand === 'string' && cand.length > 0) {
          const key = extractS3KeyFromString(cand);
          if (key) {
            const dataUri = await fetchS3ObjectAsDataUri(key);
            if (dataUri) {
              evItem.file_path = dataUri;
              evItem.photo_url = dataUri;
              evItem.url = dataUri;
              evItem.dataUrl = dataUri;
              return;
            }
          }
        }
      }

      // 3. Fallback to HTTP URL fetch
      const urlCandidate = evItem.photo_url || evItem.url || evItem.drive_url || evItem.file_path;
      if (urlCandidate && typeof urlCandidate === 'string' && urlCandidate.startsWith('http')) {
        const dataUri = await fetchHttpUrlAsDataUri(urlCandidate);
        if (dataUri) {
          evItem.file_path = dataUri;
          evItem.photo_url = dataUri;
          evItem.url = dataUri;
          evItem.dataUrl = dataUri;
        }
      }
    }
  };

  // Process all preventive group evidences
  if (Array.isArray(structuredData.entries_by_type)) {
    for (const group of structuredData.entries_by_type) {
      if (Array.isArray(group.entries)) {
        for (const entry of group.entries) {
          if (Array.isArray(entry.evidences)) {
            for (let k = 0; k < entry.evidences.length; k++) {
              await resolveItem(entry.evidences[k], k, entry.evidences);
            }
          }
        }
      }
    }
  }

  // Process all corrective group evidences
  if (Array.isArray(structuredData.corrective_entries)) {
    for (const corr of structuredData.corrective_entries) {
      if (Array.isArray(corr.evidences)) {
        for (let k = 0; k < corr.evidences.length; k++) {
          await resolveItem(corr.evidences[k], k, corr.evidences);
        }
      }
    }
  }
}

// Cached Base64 Logo
let cachedLogoBase64: string | null = null;
function getCompanyLogoBase64(): string {
  if (cachedLogoBase64) return cachedLogoBase64;
  try {
    const candidatePaths = [
      path.join(process.cwd(), 'src', 'assets', 'logopt.png'),
      path.join(process.cwd(), 'assets', 'logopt.png'),
      path.join(process.cwd(), 'logopt.png'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        cachedLogoBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        return cachedLogoBase64;
      }
    }
  } catch (err) {
    console.warn('[Puppeteer PDF] Warning reading logo file:', err);
  }
  return '';
}

// ==============================================================================
// 1. PUPPETEER BROWSER POOL & CONCURRENCY MUTEX
// ==============================================================================

class PuppeteerManager {
  private browser: Browser | null = null;
  private renderCount = 0;
  private readonly maxRendersBeforeRecycle = 50;
  private isLaunching = false;
  private isShuttingDown = false;
  private queue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;

  async getBrowser(): Promise<Browser> {
    if (this.isShuttingDown) {
      throw new Error('[PuppeteerManager] Cannot acquire browser: Puppeteer is shutting down.');
    }

    if (this.browser && this.browser.connected) {
      if (this.renderCount >= this.maxRendersBeforeRecycle) {
        console.log(`[PuppeteerManager] Recycling browser after ${this.renderCount} renders to free RAM.`);
        await this.recycleBrowser();
      } else {
        return this.browser;
      }
    }

    if (this.isLaunching) {
      // Wait for existing launch to finish
      await new Promise((resolve) => setTimeout(resolve, 300));
      return this.getBrowser();
    }

    this.isLaunching = true;
    try {
      if (this.isShuttingDown) {
        throw new Error('[PuppeteerManager] Cannot launch browser: Puppeteer is shutting down.');
      }
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-zygote',
          '--single-process',
          '--disable-accelerated-2d-canvas',
          '--font-render-hinting=none',
        ],
      });
      this.renderCount = 0;
      console.log('[PuppeteerManager] Headless Chrome browser launched successfully.');
      return this.browser;
    } finally {
      this.isLaunching = false;
    }
  }

  private async recycleBrowser(): Promise<void> {
    const currentBrowser = this.browser;
    this.browser = null;
    this.renderCount = 0;

    if (currentBrowser) {
      try {
        if (currentBrowser.connected) {
          await currentBrowser.close();
        }
      } catch (err: any) {
        console.warn('[PuppeteerManager] Notice while recycling browser:', err?.message || err);
      }
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.isShuttingDown && !this.browser) {
      return; // Idempotent
    }
    this.isShuttingDown = true;
    const currentBrowser = this.browser;
    this.browser = null;
    this.renderCount = 0;

    // Clear queue
    this.queue = [];
    this.isProcessingQueue = false;

    if (currentBrowser) {
      try {
        if (currentBrowser.connected) {
          await currentBrowser.close();
          console.log('[PuppeteerManager] Persistent Headless Chrome closed cleanly.');
        }
      } catch (err: any) {
        console.warn('[PuppeteerManager] Notice while closing browser:', err?.message || err);
      }
    }
  }

  /**
   * Concurrency Limiter: Guarantees max 1 PDF render at a time on VPS (2 vCPU, 4GB RAM)
   */
  async runExclusive<T>(task: (browser: Browser) => Promise<T>): Promise<T> {
    if (this.isShuttingDown) {
      throw new Error('[PuppeteerManager] Cannot schedule task: Puppeteer is shutting down.');
    }
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        if (this.isShuttingDown) {
          reject(new Error('[PuppeteerManager] Task cancelled: Puppeteer is shutting down.'));
          return;
        }
        try {
          const browser = await this.getBrowser();
          this.renderCount++;
          const result = await task(browser);
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.processNextInQueue();
        }
      };

      this.queue.push(execute);
      if (!this.isProcessingQueue) {
        this.processNextInQueue();
      }
    });
  }

  private async processNextInQueue() {
    if (this.queue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }
    this.isProcessingQueue = true;
    const nextTask = this.queue.shift();
    if (nextTask) {
      try {
        await nextTask();
      } catch (err) {
        console.error('[PuppeteerManager] Queue task execution error:', err);
      }
    }
  }
}

export const puppeteerManager = new PuppeteerManager();

/**
 * Safe, idempotent shutdown function for persistent Headless Chrome instance.
 * Invoked during server graceful shutdown.
 */
export async function closePuppeteerBrowser(): Promise<void> {
  await puppeteerManager.closeBrowser();
}

export async function shutdownPuppeteer(): Promise<void> {
  await puppeteerManager.closeBrowser();
}

// ==============================================================================
// 2. HTML REPORT TEMPLATE GENERATOR
// ==============================================================================

const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const INDONESIAN_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const INTERVAL_NAMES: Record<number, string> = {
  1: 'Harian',
  2: 'Mingguan',
  3: 'Bulanan',
  4: 'Triwulan',
  5: 'Semesteran',
  6: 'Tahunan',
};

function formatDayDate(dateStr: string): string {
  if (!dateStr) return '';
  if (INDONESIAN_DAYS.some((day) => dateStr.toLowerCase().startsWith(day.toLowerCase()))) {
    return dateStr;
  }

  const cleanStr = dateStr.replace(/^(Minggu|Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)[,\s]*/i, '').trim();
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
    return `${INDONESIAN_DAYS[now.getDay()]}, ${cleanStr}`;
  }

  return `${INDONESIAN_DAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${INDONESIAN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getUraianKegiatanForPdf(freqId: number, typeCode: string): string {
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

export interface HtmlReportOptions {
  targetFrequencyId?: number;
  signatories?: {
    executorName?: string;
    executorTitle?: string;
    executorCompany?: string;
    supervisorName?: string;
    supervisorTitle?: string;
    supervisorDepartment?: string;
  };
}

/**
 * Builds standard HTML/CSS document string for Puppeteer rendering
 */
export function buildReportHtml(
  structuredData: StructuredReportData,
  options?: HtmlReportOptions
): string {
  const targetFrequencyId = options?.targetFrequencyId || 1;
  const logoDataUri = getCompanyLogoBase64();

  // Filter preventive entries strictly for this frequency interval to prevent cross-frequency contamination
  const matchingPreventiveEntries = structuredData.entries_by_type
    .flatMap((group) => group.entries)
    .filter((e) => !targetFrequencyId || e.checklist_frequency_id === targetFrequencyId);

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

  // 1. Prepare Preventive Rows
  const preventiveRows = structuredData.entries_by_type.flatMap((group) =>
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
        time_range: defaultTimeStr,
        problem_description: '',
        action_taken: '',
        result_text: '',
      }))
  );

  // 2. Prepare Corrective Rows
  const includeCorrective = !targetFrequencyId || targetFrequencyId === 1;
  const correctiveRows = includeCorrective
    ? (structuredData.corrective_entries || []).map((c) => ({
        kind: 'corrective' as const,
        equipment_name: c.equipment_name,
        type_code: c.type_code,
        view_type: 'single' as const,
        notes: c.notes,
        evidences: c.evidences || [],
        checklist_frequency_id: undefined,
        equipment_id: undefined,
        time_range: c.time_range ? (c.time_range.includes('WIB') ? c.time_range : `${c.time_range} WIB`) : defaultTimeStr,
        problem_description: c.problem_description || '',
        action_taken: c.action_taken || '',
        result_text: c.result_text || c.result || '',
      }))
    : [];

  const allRows = [...preventiveRows, ...correctiveRows];

  // 3. Page Chunking & Vertical Time Merge per Page (Preventive block merge vs Corrective individual time)
  const ROWS_PER_PAGE_1 = 5;

  interface ProcessedRow {
    row: typeof allRows[0];
    index: number;
    timeSpan: number; // > 0 means render <td> with rowspan, 0 means skip because of rowspan above
  }

  const computePageProcessedRows = (rowsChunk: typeof allRows, pageStartIndex: number): ProcessedRow[] => {
    const result: ProcessedRow[] = [];
    const n = rowsChunk.length;

    let i = 0;
    while (i < n) {
      const current = rowsChunk[i];
      if (current.kind === 'corrective') {
        result.push({
          row: current,
          index: pageStartIndex + i + 1,
          timeSpan: 1,
        });
        i++;
      } else {
        // Contiguous block of preventive rows on this page
        let blockCount = 0;
        let j = i;
        while (j < n && rowsChunk[j].kind === 'preventive') {
          blockCount++;
          j++;
        }

        // First row in preventive block gets timeSpan = blockCount
        result.push({
          row: current,
          index: pageStartIndex + i + 1,
          timeSpan: blockCount,
        });

        // Subsequent rows in same preventive block get timeSpan = 0
        for (let k = 1; k < blockCount; k++) {
          result.push({
            row: rowsChunk[i + k],
            index: pageStartIndex + i + k + 1,
            timeSpan: 0,
          });
        }

        i = j;
      }
    }
    return result;
  };

  const page1RowsRaw = allRows.slice(0, ROWS_PER_PAGE_1);
  const page2RowsRaw = allRows.slice(ROWS_PER_PAGE_1);

  const page1Processed = computePageProcessedRows(page1RowsRaw, 0);
  const page2Processed = computePageProcessedRows(page2RowsRaw, page1RowsRaw.length);

  // 4. Signatories
  const executorTitle = options?.signatories?.executorTitle || 'Pelaksana';
  const executorCompany = options?.signatories?.executorCompany || 'PT. NARARYA TEKNOLOGI INDONESIA';
  const executorName =
    options?.signatories?.executorName ||
    process.env.VITE_REPORT_EXECUTOR_NAME ||
    'LUTHFIANDA MUZAKI SULAEMAN';

  const supervisorTitle = options?.signatories?.supervisorTitle || 'Pengawas Pekerjaan';
  const supervisorDepartment = options?.signatories?.supervisorDepartment || 'FACILITY MAINTENANCE - ELEKTRONIKA';
  const supervisorName =
    options?.signatories?.supervisorName ||
    process.env.VITE_REPORT_SUPERVISOR_NAME ||
    'RIZKO ENDRA NUGRAHA';

  // 5. On-Duty Technicians List
  const rawTechs = structuredData.technicians && structuredData.technicians.length > 0
    ? structuredData.technicians
    : ['LUTHFIANDA MUZAKI SULAEMAN'];
  const techRowsCount = Math.max(1, Math.ceil(rawTechs.length / 2));

  let techRowsHtml = '';
  for (let r = 0; r < techRowsCount; r++) {
    const leftIdx = r * 2;
    const rightIdx = r * 2 + 1;
    const leftTech = rawTechs[leftIdx];
    const rightTech = rawTechs[rightIdx];

    techRowsHtml += `
      <tr class="info-row">
        <td class="info-label" colspan="2">${r === 0 ? 'Teknisi On Duty' : ''}</td>
        <td class="info-val-tech-left" colspan="3">${leftTech ? `${leftIdx + 1}. ${escapeHtml(leftTech)}` : ''}</td>
        <td class="info-val-tech-right" colspan="2">${rightTech ? `${rightIdx + 1}. ${escapeHtml(rightTech)}` : ''}</td>
      </tr>
    `;
  }

  // 6. Split Rows into Pages
  const page1Rows = page1Processed;
  const page2Rows = page2Processed;

  const renderRow = ({ row, index, timeSpan }: ProcessedRow) => {
    const rawEqName = row.equipment_name || (row.equipment_id ? `Unit #${row.equipment_id}` : 'Equipment');
    const rawTypeCode = row.type_code || 'EQUIPMENT';
    const eqNameUpper = String(rawEqName).toUpperCase();
    const typeUpper = String(rawTypeCode).toUpperCase();
    const displayEquipmentName = eqNameUpper.includes(typeUpper)
      ? eqNameUpper
      : `${typeUpper} ${eqNameUpper}`.trim();

    const isPreventive = row.kind === 'preventive';
    const kindLabel = isPreventive
      ? `Preventive Maintenance ${INTERVAL_NAMES[row.checklist_frequency_id || targetFrequencyId || 1] || 'Harian'}`
      : 'Corrective Maintenance';

    // Uraian Kegiatan
    let uraianHtml = '';
    if (isPreventive) {
      const activeFreqId = row.checklist_frequency_id || targetFrequencyId || 1;
      uraianHtml = escapeHtml(getUraianKegiatanForPdf(activeFreqId, row.type_code));
    } else {
      const probItems = (row.problem_description || '')
        .split('\n')
        .map((l) => l.trim().replace(/^[\s\-\*•\d\.\)]+/, ''))
        .filter(Boolean);
      const actItems = (row.action_taken || '')
        .split('\n')
        .map((l) => l.trim().replace(/^[\s\-\*•\d\.\)]+/, ''))
        .filter(Boolean);

      uraianHtml = `
        <div class="corrective-block">
          <div class="corrective-title">Kerusakan :</div>
          <ul class="corrective-list">
            ${probItems.length > 0 ? probItems.map((p) => `<li>${escapeHtml(p)}</li>`).join('') : '<li>-</li>'}
          </ul>
          <div class="corrective-title">Tindakan :</div>
          <ul class="corrective-list">
            ${actItems.length > 0 ? actItems.map((a) => `<li>${escapeHtml(a)}</li>`).join('') : '<li>-</li>'}
          </ul>
        </div>
      `;
    }

    // Notes
    let defaultNote = `${row.type_code} bisa digunakan dengan normal`;
    if (row.type_code === 'XRAY') defaultNote = 'Xray bisa digunakan dengan normal';
    if (row.type_code === 'WTMD') defaultNote = 'WTMD bisa digunakan dengan normal';
    if (row.type_code === 'HHMD') defaultNote = 'HHMD bisa digunakan dengan normal';

    const notesText = isPreventive
      ? (row.notes || defaultNote)
      : (row.result_text || row.notes || 'Equipment sudah dapat digunakan kembali dengan normal.');

    // Single Collage Photo
    const collageUrl = getSingleCollagePhotoUrl(row.evidences || []);
    const photoHtml = collageUrl
      ? `<div class="doc-photo-wrapper"><img src="${escapeHtml(collageUrl)}" alt="Dokumentasi" class="doc-photo" /></div>`
      : `<div class="text-center">-</div>`;

    const timeTdHtml = timeSpan > 0
      ? `<td class="col-time" rowspan="${timeSpan}"><div class="time-vertical-wrapper"><span class="time-vertical-text">${escapeHtml(row.time_range)}</span></div></td>`
      : '';

    return `
      <tr class="data-row">
        <td class="col-no">${index}</td>
        <td class="col-type">${escapeHtml(displayEquipmentName)}</td>
        <td class="col-kind">${escapeHtml(kindLabel)}</td>
        ${timeTdHtml}
        <td class="col-uraian">${uraianHtml}</td>
        <td class="col-notes">${escapeHtml(notesText)}</td>
        <td class="col-docs">${photoHtml}</td>
      </tr>
    `;
  };

  const page1RowsHtml = page1Rows.map(renderRow).join('');
  const page2RowsHtml = page2Rows.map(renderRow).join('');

  const renderHeaderHtml = () => `
    <thead>
      <!-- 1. Company Header Row -->
      <tr class="header-company-row">
        <td class="company-logo-col" colspan="2">
          ${logoDataUri ? `<img src="${logoDataUri}" alt="Logo PT. Nararya" />` : '<b>PT. NTI</b>'}
        </td>
        <td class="company-title-col" colspan="5">
          <div class="company-title-text">PT. NARARYA TEKNOLOGI INDONESIA</div>
        </td>
      </tr>

      <!-- 2. Operational Info Rows (Native integrated into main table grid) -->
      <tr class="info-row">
        <td class="info-label" colspan="2">Hari / Tanggal</td>
        <td class="info-val-date" colspan="3">${escapeHtml(formatDayDate(structuredData.operational_date))}</td>
        <td class="info-label-shift" colspan="1">Shift</td>
        <td class="info-val-shift" colspan="1">${escapeHtml(structuredData.shift ? structuredData.shift.toUpperCase() : 'PAGI')}</td>
      </tr>
      ${techRowsHtml}

      <!-- 3. Column Header Row -->
      <tr class="table-header-row">
        <th class="col-no">No</th>
        <th class="col-type">Tipe Alat</th>
        <th class="col-kind">Jenis Kegiatan</th>
        <th class="col-time">Waktu</th>
        <th class="col-uraian">Uraian Kegiatan</th>
        <th class="col-notes">Notes</th>
        <th class="col-docs">Dokumentasi</th>
      </tr>
    </thead>
  `;

  // 7. Full HTML Document
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Laporan Maintenance - ${escapeHtml(structuredData.operational_date)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm 14mm 14mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 8.5pt;
      color: #000000;
      background: #FFFFFF;
      line-height: 1.25;
      padding: 0;
    }

    .report-container {
      width: 100%;
      margin: 0 auto;
    }

    /* Main Table and Full-Border Styling */
    table {
      width: 100%;
      border-collapse: collapse;
      page-break-inside: auto;
    }

    /* Header Repeat Support */
    thead {
      display: table-header-group;
    }

    tbody {
      display: table-row-group;
    }

    tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    tr.data-row {
      height: 136px;
    }

    th, td {
      border: 0.5pt solid #000000;
      vertical-align: middle;
      padding: 2px 3px;
    }

    /* 1. Company Header - Single unified outer table (No double border) */
    .header-company-row td {
      border: 0.5pt solid #000000;
      vertical-align: middle;
    }

    .company-logo-col {
      padding: 4px 8px;
      text-align: center;
      vertical-align: middle;
      height: 75px;
    }

    .company-logo-col img {
      max-width: 190px;
      max-height: 70px;
      object-fit: contain;
      display: inline-block;
    }

    .company-title-col {
      padding: 6px;
      text-align: center;
      vertical-align: middle;
    }

    .company-title-text {
      font-size: 16.5pt;
      font-weight: bold;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    /* 2. Operational Info Rows (Labels right-aligned, values left-aligned) */
    .info-row td {
      border: 0.5pt solid #000000;
      padding: 3px 6px;
      font-size: 8.5pt;
    }

    .info-label {
      font-weight: bold;
      text-align: right !important;
      padding-right: 8px !important;
    }

    .info-val-date {
      text-align: left !important;
      padding-left: 8px !important;
      white-space: nowrap;
      font-family: 'Times-Roman', serif;
    }

    .info-label-shift {
      font-weight: bold;
      text-align: right !important;
      padding-right: 8px !important;
    }

    .info-val-shift {
      font-weight: bold;
      text-align: left !important;
      padding-left: 8px !important;
    }

    .info-val-tech-left {
      text-align: left !important;
      padding-left: 8px !important;
    }

    .info-val-tech-right {
      text-align: left !important;
      padding-left: 8px !important;
    }

    /* 3. Column Widths & Table Header (Exact Match to Reference Sample) */
    .table-header-row th {
      background-color: #FFFFFF !important;
      font-weight: bold;
      text-align: center;
      font-size: 8.5pt;
      padding: 4px 2px;
      border: 0.5pt solid #000000;
    }

    .col-no { width: 3.5%; text-align: center; font-size: 8.5pt; font-weight: 500; }
    .col-type { width: 12.5%; text-align: center; font-size: 8.5pt; font-weight: bold; line-height: 1.25; }
    .col-kind { width: 11.5%; text-align: center; font-size: 8.5pt; line-height: 1.25; }
    /* Vertical Time: Uses standards-compliant writing-mode to avoid layout disappearance */
    .col-time {
      width: 3.8%;
      text-align: center;
      font-size: 8.5pt;
      padding: 0;
      vertical-align: middle;
    }
    .col-uraian { width: 16%; font-size: 8.5pt; text-align: center; line-height: 1.25; }
    .col-notes { width: 16%; font-size: 8.5pt; text-align: center; line-height: 1.25; }
    .col-docs { width: 36.7%; text-align: center; padding: 2px 3px !important; }

    .time-vertical-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 0;
      box-sizing: border-box;
    }

    .time-vertical-text {
      writing-mode: vertical-rl;
      -webkit-writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
      font-size: 8.5pt;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: #000000;
      display: inline-block;
    }

    .text-center {
      text-align: center;
    }

    /* Corrective items */
    .corrective-block {
      text-align: center;
      width: 100%;
    }

    .corrective-title {
      font-weight: bold;
      font-size: 7.5pt;
      margin-top: 1px;
      margin-bottom: 1px;
    }

    .corrective-list {
      list-style-type: none;
      padding: 0;
      margin: 0;
      font-size: 7pt;
      line-height: 1.15;
    }

    .corrective-list li {
      margin-bottom: 1px;
    }

    /* Documentation Photo - Landscape lebar mengisi penuh lebar sel (stretch width, height tetap) */
    .doc-photo-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 2px 3px;
      margin: 0;
      box-sizing: border-box;
      overflow: hidden;
    }

    .doc-photo {
      width: 100%;
      height: 130px;
      max-height: 130px;
      object-fit: fill;
      display: block;
      margin: 0 auto;
      padding: 0;
      border: 0.5pt solid #CCCCCC;
      outline: none;
    }

    /* Page-specific layout & page break */
    .report-page {
      width: 100%;
      page-break-after: always;
      break-after: page;
    }

    .report-page:last-child {
      page-break-after: avoid;
      break-after: avoid;
    }

    /* 4. Signature Block */
    .signature-container {
      margin-top: 18px;
      width: 100%;
      display: flex;
      justify-content: space-between;
      padding: 0 30px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .signature-col {
      width: 44%;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .sig-title {
      font-weight: bold;
      font-size: 8pt;
    }

    .sig-subtitle {
      font-weight: bold;
      font-size: 8pt;
      margin-top: 1px;
      text-transform: uppercase;
    }

    .sig-space {
      height: 38px;
    }

    .sig-name {
      font-weight: bold;
      font-size: 8pt;
      text-decoration: underline;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="report-container">
    <!-- PAGE 1: Rows 1 to 6 with full merged time column -->
    <div class="report-page">
      <table>
        ${renderHeaderHtml()}
        <tbody>
          ${page1RowsHtml}
        </tbody>
      </table>
    </div>

    <!-- PAGE 2: Rows 7+ with merged time column and official signatures -->
    ${page2Rows.length > 0 ? `
    <div class="report-page" style="page-break-before: always; break-before: page; margin-top: 10px;">
      <table>
        ${renderHeaderHtml()}
        <tbody>
          ${page2RowsHtml}
        </tbody>
      </table>

      <!-- 4. Signature Block (on page 2) -->
      <div class="signature-container">
        <div class="signature-col">
          <div class="sig-title">${escapeHtml(executorTitle)}</div>
          <div class="sig-subtitle">${escapeHtml(executorCompany)}</div>
          <div class="sig-space"></div>
          <div class="sig-name">${escapeHtml(executorName)}</div>
        </div>

        <div class="signature-col">
          <div class="sig-title">${escapeHtml(supervisorTitle)}</div>
          <div class="sig-subtitle">${escapeHtml(supervisorDepartment)}</div>
          <div class="sig-space"></div>
          <div class="sig-name">${escapeHtml(supervisorName)}</div>
        </div>
      </div>
    </div>
    ` : `
      <!-- If total rows <= 6, put signature directly under page 1 -->
      <div class="signature-container">
        <div class="signature-col">
          <div class="sig-title">${escapeHtml(executorTitle)}</div>
          <div class="sig-subtitle">${escapeHtml(executorCompany)}</div>
          <div class="sig-space"></div>
          <div class="sig-name">${escapeHtml(executorName)}</div>
        </div>

        <div class="signature-col">
          <div class="sig-title">${escapeHtml(supervisorTitle)}</div>
          <div class="sig-subtitle">${escapeHtml(supervisorDepartment)}</div>
          <div class="sig-space"></div>
          <div class="sig-name">${escapeHtml(supervisorName)}</div>
        </div>
      </div>
    `}
  </div>
</body>
</html>`;
}

// ==============================================================================
// 3. PUPPETEER BUFFER RENDER FUNCTION
// ==============================================================================

/**
 * Renders HTML string to PDF Buffer using Puppeteer Headless Chrome
 */
export async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  return puppeteerManager.runExclusive(async (browser) => {
    let page: Page | null = null;
    try {
      page = await browser.newPage();
      
      // Set viewport for standard A4
      await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
      
      // Load HTML with 30s timeout guard
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: 30000,
      });

      // Emulate print media type
      await page.emulateMediaType('print');

      // Generate PDF Buffer
      const pdfUint8 = await page.pdf({
        format: 'A4',
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: '12mm',
          bottom: '14mm',
          left: '14mm',
          right: '14mm',
        },
      });

      return Buffer.from(pdfUint8);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (_) {}
      }
    }
  });
}

/**
 * High-level function: converts StructuredReportData directly to PDF Buffer via Puppeteer
 */
export async function generateReportPdfWithPuppeteer(
  structuredData: StructuredReportData,
  targetFrequencyId?: number,
  options?: HtmlReportOptions
): Promise<Buffer> {
  // Pre-fetch all evidence photos server-side from S3 as Base64 Data URIs
  await resolveAllEvidencesServerSide(structuredData);

  const html = buildReportHtml(structuredData, {
    targetFrequencyId,
    signatories: options?.signatories,
  });
  return renderHtmlToPdfBuffer(html);
}
