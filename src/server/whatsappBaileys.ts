import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WASocket,
  ConnectionState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { getJakartaLogTimestamp } from '../utils/logger';

// Suppress noisy libsignal decryption warnings for unneeded incoming WhatsApp messages
const isBadMacOrDecryptionError = (str: string): boolean => {
  return (
    str.includes('Failed to decrypt message with any known session') ||
    str.includes('Session error') ||
    str.includes('Bad MAC') ||
    str.includes('SessionError') ||
    str.includes('No matching sessions found')
  );
};

const origConsoleError = console.error;
console.error = function (...args: any[]) {
  const str = args.map((a) => (typeof a === 'string' ? a : (a?.message || a?.stack || ''))).join(' ');
  if (isBadMacOrDecryptionError(str)) {
    return;
  }
  origConsoleError.apply(console, args);
};

if (process.stderr && typeof process.stderr.write === 'function') {
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function (chunk: any, ...rest: any[]): boolean {
    const str = typeof chunk === 'string' ? chunk : chunk?.toString?.() || '';
    if (isBadMacOrDecryptionError(str)) {
      return true;
    }
    return (origStderrWrite as any)(chunk, ...rest);
  };
}

// File Paths
const DATA_DIR = path.join(process.cwd(), 'data');
const AUTH_DIR = path.join(DATA_DIR, 'whatsapp_auth');
const CONFIG_FILE = path.join(DATA_DIR, 'whatsapp_config.json');
const LOGS_DIR = path.join(process.cwd(), 'logs');
const ERROR_LOG_FILE = path.join(LOGS_DIR, 'error.log');

// Ensure necessary directories exist
[DATA_DIR, AUTH_DIR, LOGS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Check if valid saved Baileys WhatsApp credentials exist
 */
export function hasSavedWhatsAppCredentials(): boolean {
  try {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const raw = fs.readFileSync(credsPath, 'utf8');
      const parsed = JSON.parse(raw);
      return Boolean(parsed && (parsed.me?.id || parsed.registered || parsed.account));
    }
  } catch (_) {}
  return false;
}

/**
 * Server-side error logger writing to logs/error.log with Asia/Jakarta (WIB) time
 */
export function writeServerErrorLog(context: string, message: string, details?: any) {
  const ts = getJakartaLogTimestamp();
  let detailsText = '';
  if (details !== undefined && details !== null) {
    if (details instanceof Error) {
      detailsText = ` | Error: ${details.message}${details.stack ? `\nStack: ${details.stack}` : ''}`;
    } else if (typeof details === 'object') {
      try {
        detailsText = ` | Data: ${JSON.stringify(details)}`;
      } catch (_) {
        detailsText = ` | Data: [Unserializable]`;
      }
    } else {
      detailsText = ` | Details: ${String(details)}`;
    }
  }

  const logLine = `[${ts}] [ERROR] [${context}]: ${message}${detailsText}\n`;
  console.error(logLine.trim());

  try {
    fs.appendFileSync(ERROR_LOG_FILE, logLine, 'utf8');
  } catch (fsErr) {
    console.error('Failed to append to error.log:', fsErr);
  }
}

export interface WhatsAppConfig {
  enabled: boolean;
  target_jid: string; // Group JID (e.g. 120363xxxxxx@g.us) or Phone (628123456789@s.whatsapp.net)
  auto_notify_preventive: boolean;
  auto_notify_attendance: boolean;
  auto_notify_export: boolean;
  recipient_name?: string;
}

export interface WhatsAppStatus {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'logged_out';
  qrDataUrl: string | null;
  pairingCode: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  lastConnected: string | null;
  config: WhatsAppConfig;
}

// Default Configuration
const DEFAULT_CONFIG: WhatsAppConfig = {
  enabled: true,
  target_jid: '',
  auto_notify_preventive: true,
  auto_notify_attendance: true,
  auto_notify_export: true,
  recipient_name: 'Grup WhatsApp Dinas Faskampen',
};

export function loadWhatsAppConfig(): WhatsAppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    writeServerErrorLog('loadWhatsAppConfig', 'Gagal membaca config WhatsApp', err);
  }
  return { ...DEFAULT_CONFIG };
}

export function saveWhatsAppConfig(newConfig: Partial<WhatsAppConfig>): WhatsAppConfig {
  try {
    const current = loadWhatsAppConfig();
    const updated = { ...current, ...newConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    writeServerErrorLog('saveWhatsAppConfig', 'Gagal menyimpan config WhatsApp', err);
    throw err;
  }
}

// Module State
let sock: WASocket | null = null;
let currentStatus: WhatsAppStatus['status'] = 'disconnected';
let currentQrDataUrl: string | null = null;
let currentPairingCode: string | null = null;
let connectedPhoneNumber: string | null = null;
let connectedPushName: string | null = null;
let lastConnectedTime: string | null = null;
let isInitializing = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Get current live WhatsApp connection status
 */
export function getWhatsAppStatus(): WhatsAppStatus {
  return {
    status: currentStatus,
    qrDataUrl: currentQrDataUrl,
    pairingCode: currentPairingCode,
    phoneNumber: connectedPhoneNumber,
    pushName: connectedPushName,
    lastConnected: lastConnectedTime,
    config: loadWhatsAppConfig(),
  };
}

/**
 * Initializes Baileys WhatsApp Connection
 */
export async function initializeWhatsApp(forceRestart: boolean = false): Promise<void> {
  if (isInitializing && !forceRestart) return;
  if (sock && currentStatus === 'connected' && !forceRestart) return;

  isInitializing = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[Baileys WhatsApp] Menggunakan versi ${version.join('.')} (Latest: ${isLatest})`);

    currentStatus = 'connecting';
    currentQrDataUrl = null;

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      browser: ['Faskampen Halim', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      shouldIgnoreJid: (jid: string) => {
        return (
          jid.endsWith('@broadcast') ||
          jid === 'status@broadcast' ||
          jid.includes('newsletter')
        );
      },
      getMessage: async (_key) => {
        return undefined;
      },
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 500,
      maxMsgRetryCount: 2,
    });

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

    // Connection events
    sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentStatus = 'qr_ready';
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 7,
          });
          console.log('[Baileys WhatsApp] QR Code baru berhasil dibuat untuk web UI.');
        } catch (qrErr) {
          writeServerErrorLog('connection.update', 'Gagal mengonversi QR ke DataURL', qrErr);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isQrTimeout = statusCode === DisconnectReason.timedOut || statusCode === 408;
        const hasSavedAuth = hasSavedWhatsAppCredentials();

        // Only auto-reconnect if it was an active logged-in session that experienced a network glitch
        // Do NOT auto-reconnect in an infinite loop if we are waiting for a QR scan and it timed out!
        const shouldReconnect = !isLoggedOut && !isQrTimeout && hasSavedAuth;

        console.warn(`[Baileys WhatsApp] Koneksi terputus. Kode: ${statusCode}. Reconnect: ${shouldReconnect}`);

        if (isLoggedOut) {
          currentStatus = 'logged_out';
          connectedPhoneNumber = null;
          connectedPushName = null;
          currentQrDataUrl = null;
          currentPairingCode = null;

          // Delete session files on loggedOut
          try {
            if (fs.existsSync(AUTH_DIR)) {
              fs.rmSync(AUTH_DIR, { recursive: true, force: true });
              fs.mkdirSync(AUTH_DIR, { recursive: true });
            }
          } catch (e) {
            writeServerErrorLog('connection.update', 'Gagal membersihkan auth dir setelah logout', e);
          }
        } else {
          currentStatus = 'disconnected';
          if (isQrTimeout) {
            currentQrDataUrl = null;
            currentPairingCode = null;
          }
          if (shouldReconnect && reconnectAttempts < 5) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
            console.log(`[Baileys WhatsApp] Mencoba reconnect otomatis dalam ${delay / 1000} detik (Percobaan ${reconnectAttempts})...`);
            setTimeout(() => {
              initializeWhatsApp(true).catch((e) =>
                writeServerErrorLog('autoReconnect', 'Gagal auto-reconnect Baileys', e)
              );
            }, delay);
          } else {
            reconnectAttempts = 0;
          }
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        currentStatus = 'connected';
        currentQrDataUrl = null;
        currentPairingCode = null;
        lastConnectedTime = getJakartaLogTimestamp();

        const userJid = sock?.user?.id || '';
        connectedPhoneNumber = userJid.split(':')[0] || null;
        connectedPushName = sock?.user?.name || null;

        console.log(`[Baileys WhatsApp] Terhubung sukses! Nomor: ${connectedPhoneNumber} (${connectedPushName || 'Device'})`);
      }
    });
  } catch (err: any) {
    currentStatus = 'disconnected';
    writeServerErrorLog('initializeWhatsApp', 'Inisialisasi Baileys gagal', err);
  } finally {
    isInitializing = false;
  }
}

/**
 * Request an 8-character pairing code using phone number (alternative to QR scan)
 */
export async function requestWhatsAppPairingCode(phoneNumber: string): Promise<string> {
  if (!sock) {
    await initializeWhatsApp(true);
  }
  if (!sock) {
    throw new Error('Socket WhatsApp belum terinisialisasi.');
  }

  // Clean phone number (e.g. 0812... -> 62812...)
  let cleanNumber = phoneNumber.replace(/[^\d]/g, '');
  if (cleanNumber.startsWith('0')) {
    cleanNumber = '62' + cleanNumber.slice(1);
  }

  if (cleanNumber.length < 10) {
    throw new Error('Nomor WhatsApp tidak valid. Gunakan format seperti 08123456789 atau 628123456789.');
  }

  try {
    const code = await sock.requestPairingCode(cleanNumber);
    currentPairingCode = code;
    console.log(`[Baileys WhatsApp] Pairing code berhasil dibuat untuk ${cleanNumber}: ${code}`);
    return code;
  } catch (err: any) {
    writeServerErrorLog('requestWhatsAppPairingCode', 'Gagal meminta pairing code', err);
    throw err;
  }
}

/**
 * Disconnect / Logout WhatsApp Session
 */
export async function logoutWhatsApp(): Promise<void> {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
      sock = null;
    }

    currentStatus = 'disconnected';
    currentQrDataUrl = null;
    currentPairingCode = null;
    connectedPhoneNumber = null;
    connectedPushName = null;

    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    console.log('[Baileys WhatsApp] Sesi berhasil di-logout dan auth storage dibersihkan.');
  } catch (err) {
    writeServerErrorLog('logoutWhatsApp', 'Gagal logout Baileys', err);
    throw err;
  }
}

/**
 * Formats a phone number or group ID into standard WhatsApp JID
 */
export function formatRecipientJid(target: string): string {
  if (!target) return '';
  const trimmed = target.trim();
  if (!trimmed) return '';

  // If target contains newlines, markdown formatting, or spaces, it is a message text, NOT a JID!
  if (trimmed.includes('\n') || trimmed.includes('*') || trimmed.includes(' ') || trimmed.length > 100) {
    const config = loadWhatsAppConfig();
    const defaultJid = config.target_jid?.trim() || '';
    if (defaultJid && !defaultJid.includes('\n') && !defaultJid.includes('*')) {
      return formatRecipientJid(defaultJid);
    }
    return '';
  }

  if (trimmed.endsWith('@g.us') || trimmed.endsWith('@s.whatsapp.net')) {
    return trimmed;
  }

  // Group JID pattern: must be strictly numeric or digits with hyphens (e.g. 120363023849102938 or 62812345678-1612345678)
  if (/^[\d-]+$/.test(trimmed) && (trimmed.includes('-') || trimmed.length >= 16)) {
    return `${trimmed}@g.us`;
  }

  let cleanPhone = trimmed.replace(/[^\d]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.slice(1);
  }
  if (!cleanPhone) return '';
  return `${cleanPhone}@s.whatsapp.net`;
}

/**
 * Sends a Text Message via WhatsApp
 */
export async function sendWhatsAppTextMessage(
  targetOrMessage: string,
  maybeMessage?: string
): Promise<boolean> {
  let target = targetOrMessage;
  let message = maybeMessage || '';

  if (!maybeMessage) {
    message = targetOrMessage;
    const config = loadWhatsAppConfig();
    target = config.target_jid || '';
  }

  if (!sock || currentStatus !== 'connected') {
    throw new Error('WhatsApp Bot belum terhubung. Silakan hubungkan WhatsApp terlebih dahulu.');
  }

  const jid = formatRecipientJid(target);
  if (!jid) {
    throw new Error('Nomor atau Group JID tujuan tidak valid.');
  }

  try {
    await sock.sendMessage(jid, { text: message });
    return true;
  } catch (err: any) {
    writeServerErrorLog('sendWhatsAppTextMessage', `Gagal kirim chat WA ke ${jid}`, err);
    throw err;
  }
}

/**
 * Sends an Image (Photo) with optional caption via WhatsApp
 */
export async function sendWhatsAppImageMessage(
  to: string,
  imageInput: Buffer | string,
  caption?: string
): Promise<boolean> {
  if (!sock || currentStatus !== 'connected') {
    throw new Error('WhatsApp Bot belum terhubung.');
  }

  const jid = formatRecipientJid(to);
  if (!jid) {
    throw new Error('Nomor atau Group JID tujuan tidak valid.');
  }

  try {
    let payloadMedia: Buffer;
    if (Buffer.isBuffer(imageInput)) {
      payloadMedia = imageInput;
    } else if (typeof imageInput === 'string' && imageInput.startsWith('data:image')) {
      const commaIdx = imageInput.indexOf(',');
      const base64Data = commaIdx !== -1 ? imageInput.substring(commaIdx + 1) : imageInput;
      payloadMedia = Buffer.from(base64Data, 'base64');
    } else if (typeof imageInput === 'string' && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
      const res = await fetch(imageInput);
      const arrBuf = await res.arrayBuffer();
      payloadMedia = Buffer.from(arrBuf);
    } else if (typeof imageInput === 'string' && imageInput.startsWith('/')) {
      if (fs.existsSync(imageInput)) {
        payloadMedia = fs.readFileSync(imageInput);
      } else {
        const localUrl = `http://localhost:3000${imageInput}`;
        const res = await fetch(localUrl);
        const arrBuf = await res.arrayBuffer();
        payloadMedia = Buffer.from(arrBuf);
      }
    } else {
      payloadMedia = Buffer.from(imageInput, 'base64');
    }

    const msgPayload: any = {
      image: payloadMedia,
    };
    if (caption && caption.trim().length > 0) {
      msgPayload.caption = caption.trim();
    }

    await sock.sendMessage(jid, msgPayload);
    return true;
  } catch (err: any) {
    writeServerErrorLog('sendWhatsAppImageMessage', `Gagal kirim foto WA ke ${jid}`, err);
    throw err;
  }
}

/**
 * Sends a Document (PDF) with caption via WhatsApp
 */
export async function sendWhatsAppDocumentMessage(
  to: string,
  docInput: Buffer | string,
  fileName: string,
  caption?: string
): Promise<boolean> {
  if (!sock || currentStatus !== 'connected') {
    throw new Error('WhatsApp Bot belum terhubung.');
  }

  const jid = formatRecipientJid(to);
  if (!jid) {
    throw new Error('Nomor atau Group JID tujuan tidak valid.');
  }

  try {
    let payloadDoc: Buffer;
    if (Buffer.isBuffer(docInput)) {
      payloadDoc = docInput;
    } else if (typeof docInput === 'string' && docInput.startsWith('data:')) {
      const commaIdx = docInput.indexOf(',');
      const base64Data = commaIdx !== -1 ? docInput.substring(commaIdx + 1) : docInput;
      payloadDoc = Buffer.from(base64Data, 'base64');
    } else if (typeof docInput === 'string' && (docInput.startsWith('http://') || docInput.startsWith('https://'))) {
      const res = await fetch(docInput);
      const arrBuf = await res.arrayBuffer();
      payloadDoc = Buffer.from(arrBuf);
    } else if (typeof docInput === 'string' && docInput.startsWith('/')) {
      if (fs.existsSync(docInput)) {
        payloadDoc = fs.readFileSync(docInput);
      } else {
        const localUrl = `http://localhost:3000${docInput}`;
        const res = await fetch(localUrl);
        const arrBuf = await res.arrayBuffer();
        payloadDoc = Buffer.from(arrBuf);
      }
    } else {
      payloadDoc = Buffer.from(docInput, 'base64');
    }

    const msgPayload: any = {
      document: payloadDoc,
      fileName,
      mimetype: 'application/pdf',
    };
    if (caption && caption.trim().length > 0) {
      msgPayload.caption = caption.trim();
    }

    await sock.sendMessage(jid, msgPayload);
    return true;
  } catch (err: any) {
    writeServerErrorLog('sendWhatsAppDocumentMessage', `Gagal kirim PDF WA ke ${jid}`, err);
    throw err;
  }
}

/**
 * Fetches all participating WhatsApp groups of the authenticated account
 */
export async function getWhatsAppGroupList(): Promise<Array<{ id: string; subject: string; participantsCount: number }>> {
  if (!sock || currentStatus !== 'connected') {
    return [];
  }

  try {
    const rawGroups = await sock.groupFetchAllParticipating();
    const list = Object.values(rawGroups).map((g: any) => ({
      id: g?.id || '',
      subject: g?.subject || 'Grup WhatsApp',
      participantsCount: Array.isArray(g?.participants) ? g.participants.length : 0,
    }));

    list.sort((a, b) => a.subject.localeCompare(b.subject, 'id'));
    return list;
  } catch (err: any) {
    writeServerErrorLog('getWhatsAppGroupList', 'Gagal mengambil daftar grup WhatsApp', err);
    throw err;
  }
}
