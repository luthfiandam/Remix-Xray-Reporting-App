/** Optional WAHA transport. Default provider remains Baileys for backward compatibility.
 * WAHA credentials and endpoint are server-only; never expose to Vite/browser.
 */
export function isWahaEnabled(): boolean {
  return process.env.WHATSAPP_PROVIDER?.toLowerCase() === 'waha';
}

const config = () => ({
  base: (process.env.WAHA_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  apiKey: process.env.WAHA_API_KEY || '',
  session: process.env.WAHA_SESSION || 'default',
});

function chatIdForWaha(input: string): string {
  const jid = input.trim();
  if (jid.endsWith('@g.us') || jid.endsWith('@c.us')) return jid;
  if (jid.endsWith('@s.whatsapp.net')) return jid.replace('@s.whatsapp.net', '@c.us');
  const digits = jid.replace(/[^0-9]/g, '');
  if (!/^\d{10,16}$/.test(digits)) throw new Error('Target WhatsApp tidak valid.');
  return `${digits.startsWith('0') ? `62${digits.slice(1)}` : digits}@c.us`;
}

async function wahaFetch(path: string, body?: Record<string, unknown>): Promise<any> {
  const { base, apiKey } = config();
  if (!apiKey) throw new Error('WAHA_API_KEY belum ditetapkan di server .env');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`WAHA HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
    return response.json().catch(() => ({}));
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWahaConnectionStatus(): Promise<boolean> {
  try {
    const sessions = await wahaFetch('/api/sessions');
    const row = Array.isArray(sessions) ? sessions.find((s: any) => s.name === config().session) : null;
    return row?.status === 'WORKING';
  } catch { return false; }
}

export async function wahaSendText(chat: string, message: string): Promise<boolean> {
  await wahaFetch('/api/sendText', { session: config().session, chatId: chatIdForWaha(chat), text: message });
  return true; // Accepted by WAHA, not a confirmed delivery/read receipt.
}

export async function wahaSendMedia(kind: 'image' | 'file', chat: string, bytes: Buffer,
  mimetype: string, filename: string, caption?: string): Promise<boolean> {
  const endpoint = kind === 'image' ? '/api/sendImage' : '/api/sendFile';
  await wahaFetch(endpoint, {
    session: config().session,
    chatId: chatIdForWaha(chat),
    file: { mimetype, filename, data: bytes.toString('base64') },
    caption: caption || '',
  });
  return true;
}

export async function wahaGetGroups(): Promise<Array<{ id: string; subject: string; participantsCount: number }>> {
  const records = await wahaFetch(`/api/${encodeURIComponent(config().session)}/groups?limit=100&exclude=participants`);
  const groups = Array.isArray(records) ? records : (Array.isArray(records?.data) ? records.data : []);
  return groups.map((item: any) => ({
    id: item.id || '',
    subject: item.subject || item.name || 'Grup WhatsApp',
    participantsCount: Array.isArray(item.participants) ? item.participants.length : 0,
  })).filter((item: any) => item.id);
}
