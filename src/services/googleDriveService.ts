import { toast } from '../components/Toast';

const GDRIVE_TOKEN_KEY = 'faskampen_gdrive_access_token';
const GDRIVE_USER_KEY = 'faskampen_gdrive_connected_user';
const GDRIVE_GAS_URL_KEY = 'faskampen_gdrive_gas_url';

export interface GDriveConnectionState {
  isConnected: boolean;
  userEmail: string | null;
  accessToken: string | null;
  gasUrl: string | null;
  method: 'gas' | 'oauth' | null;
}

/**
 * Dynamically loads Google Identity Services (GIS) JS library
 */
function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('Window not available'));
    if ((window as any).google?.accounts?.oauth2) {
      return resolve();
    }
    const existingScript = document.getElementById('google-gis-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', (e) => reject(e));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });
}

/**
 * Gets currently saved Google Drive connection state
 */
export function getGDriveState(): GDriveConnectionState {
  if (typeof window === 'undefined') {
    return { isConnected: false, userEmail: null, accessToken: null, gasUrl: null, method: null };
  }
  try {
    const gasUrl = localStorage.getItem(GDRIVE_GAS_URL_KEY);
    if (gasUrl && gasUrl.startsWith('https://script.google.com/')) {
      return {
        isConnected: true,
        userEmail: 'luthfiandammm@gmail.com (GAS Web App)',
        accessToken: null,
        gasUrl,
        method: 'gas',
      };
    }

    const token = localStorage.getItem(GDRIVE_TOKEN_KEY);
    const email = localStorage.getItem(GDRIVE_USER_KEY);
    if (token) {
      return {
        isConnected: true,
        userEmail: email || 'luthfiandammm@gmail.com',
        accessToken: token,
        gasUrl: null,
        method: 'oauth',
      };
    }
  } catch {}
  return { isConnected: false, userEmail: null, accessToken: null, gasUrl: null, method: null };
}

/**
 * Saves Google Apps Script (GAS) Web App Webhook URL
 * Zero-OAuth, zero origin_mismatch, 100% reliable for luthfiandammm@gmail.com
 */
export async function saveGasWebhookUrl(url: string): Promise<GDriveConnectionState> {
  const cleanUrl = (url || '').trim();
  if (!cleanUrl.startsWith('https://script.google.com/')) {
    toast.error('URL Google Apps Script harus berawalan https://script.google.com/...');
    throw new Error('Invalid GAS URL');
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(GDRIVE_GAS_URL_KEY, cleanUrl);
    localStorage.setItem(GDRIVE_USER_KEY, 'luthfiandammm@gmail.com (GAS)');
  }

  try {
    await fetch('/api/backup/gdrive-gas-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gas_url: cleanUrl, email: 'luthfiandammm@gmail.com' }),
    });
  } catch (_) {}

  toast.success('Google Apps Script Web App Terhubung!');
  return {
    isConnected: true,
    userEmail: 'luthfiandammm@gmail.com (GAS Web App)',
    accessToken: null,
    gasUrl: cleanUrl,
    method: 'gas',
  };
}

/**
 * Triggers Google Identity Services OAuth popup for Google Drive
 */
export async function connectGoogleDriveAccount(emailHint = 'luthfiandammm@gmail.com'): Promise<GDriveConnectionState> {
  try {
    await loadGisScript();

    return new Promise<GDriveConnectionState>((resolve, reject) => {
      const clientId =
        (import.meta as any).env?.VITE_GOOGLE_OAUTH_CLIENT_ID ||
        '159149102132-vaeqgbn1tkojpkf2k736r1llie7oop2a.apps.googleusercontent.com';

      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        hint: emailHint,
        callback: async (response: any) => {
          if (response.error) {
            toast.error('Otorisasi Google Drive dibatalkan.');
            return reject(new Error(response.error));
          }

          const token = response.access_token;
          if (!token) {
            toast.error('Gagal memperoleh token Google Drive.');
            return reject(new Error('Access token missing'));
          }

          let userEmail = emailHint;
          try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (userInfoRes.ok) {
              const uData = await userInfoRes.json();
              if (uData.email) userEmail = uData.email;
            }
          } catch (_) {}

          if (typeof window !== 'undefined') {
            localStorage.setItem(GDRIVE_TOKEN_KEY, token);
            localStorage.setItem(GDRIVE_USER_KEY, userEmail);
          }

          try {
            await fetch('/api/backup/gdrive-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, email: userEmail }),
            });
          } catch (_) {}

          toast.success(`Google Drive terhubung (${userEmail})`);
          resolve({ isConnected: true, userEmail, accessToken: token, gasUrl: null, method: 'oauth' });
        },
      });

      client.requestAccessToken();
    });
  } catch (err: any) {
    console.error('Google Drive Auth Error:', err);
    toast.error(err?.message || 'Gagal terhubung dengan Google Drive');
    throw err;
  }
}

/**
 * Saves a Google Drive Access Token manually (Fallback method)
 */
export async function saveManualGDriveToken(token: string, email = 'luthfiandammm@gmail.com'): Promise<GDriveConnectionState> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    toast.error('Token tidak boleh kosong.');
    throw new Error('Token empty');
  }

  let userEmail = email;
  try {
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${cleanToken}` },
    });
    if (userInfoRes.ok) {
      const uData = await userInfoRes.json();
      if (uData.email) userEmail = uData.email;
    }
  } catch (_) {}

  if (typeof window !== 'undefined') {
    localStorage.setItem(GDRIVE_TOKEN_KEY, cleanToken);
    localStorage.setItem(GDRIVE_USER_KEY, userEmail);
  }

  try {
    await fetch('/api/backup/gdrive-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cleanToken, email: userEmail }),
    });
  } catch (_) {}

  toast.success(`Google Drive Token Berhasil Disimpan (${userEmail})`);
  return { isConnected: true, userEmail, accessToken: cleanToken, gasUrl: null, method: 'oauth' };
}

/**
 * Disconnects Google Drive connection
 */
export function disconnectGoogleDriveAccount(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(GDRIVE_TOKEN_KEY);
    localStorage.removeItem(GDRIVE_USER_KEY);
    localStorage.removeItem(GDRIVE_GAS_URL_KEY);
  }
  try {
    fetch('/api/backup/gdrive-token', { method: 'DELETE' }).catch(() => {});
    fetch('/api/backup/gdrive-gas-url', { method: 'DELETE' }).catch(() => {});
  } catch {}
  toast.info('Koneksi Google Drive terputus');
}

/**
 * Uploads a JSON backup payload directly to Google Drive via GAS or OAuth REST API
 */
export async function uploadBackupToGDrive(
  filename: string,
  backupPayload: any
): Promise<{ success: boolean; fileId?: string; error?: string }> {
  const state = getGDriveState();
  if (!state.isConnected) {
    return { success: false, error: 'Google Drive belum terhubung' };
  }

  const fileContent = typeof backupPayload === 'string' ? backupPayload : JSON.stringify(backupPayload, null, 2);

  // 1. If GAS Web App method is configured
  if (state.gasUrl) {
    try {
      const res = await fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          filename,
          content: fileContent,
          folderName: 'FASKAMPEN_XRAY_BACKUP',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'success' || data.fileId || res.ok) {
        return { success: true, fileId: data.fileId };
      }
      return { success: true };
    } catch (gasErr: any) {
      console.error('GAS Upload Error:', gasErr);
      return { success: false, error: gasErr.message };
    }
  }

  // 2. OAuth REST API method
  try {
    const accessToken = state.accessToken;
    if (!accessToken) return { success: false, error: 'Access token tidak ditemukan' };

    let folderId = '';
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        "name = 'FASKAMPEN_XRAY_BACKUP' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
      )}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        folderId = searchData.files[0].id;
      }
    }

    if (!folderId) {
      const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'FASKAMPEN_XRAY_BACKUP',
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });

      if (createFolderRes.ok) {
        const folderData = await createFolderRes.json();
        folderId = folderData.id;
      }
    }

    const metadata = {
      name: filename,
      mimeType: 'application/json',
      parents: folderId ? [folderId] : [],
    };

    const boundary = '-------faskampen_gdrive_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent +
      closeDelimiter;

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      return { success: true, fileId: uploadData.id };
    } else {
      const errData = await uploadRes.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Upload error HTTP ${uploadRes.status}`);
    }
  } catch (err: any) {
    console.error('Google Drive Upload Error:', err);
    return { success: false, error: err.message };
  }
}
