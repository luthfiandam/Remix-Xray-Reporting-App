import { getSupabaseClient, isSupabaseConfigured, setCustomSupabaseConfig, getSupabaseUrl, getSupabaseAnonKey } from '../lib/supabase';
import { TelegramConfig, getStoredTelegramConfig, saveTelegramConfig } from './telegramService';

export interface AppSettings {
  telegram_bot_token: string;
  telegram_chat_ids: string; // Comma or space separated multi-target chat IDs
  telegram_enabled: boolean;
  supabase_url: string;
  supabase_anon_key: string;
}

const SETTINGS_TABLE = 'app_settings';

/**
 * Parses raw chat_id string into clean array of individual chat IDs.
 * Supports comma, space, semicolon, or newline delimiter.
 * Example: "-100123456789, -100987654321 12345678" -> ["-100123456789", "-100987654321", "12345678"]
 */
export function parseTargetChatIds(rawInput?: string): string[] {
  if (!rawInput) return [];
  return rawInput
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && (s.startsWith('-') || /^\d+$/.test(s)));
}

/**
 * Gets currently active local application settings
 */
export function getLocalAppSettings(): AppSettings {
  const tgConfig = getStoredTelegramConfig();
  return {
    telegram_bot_token: tgConfig.bot_token || '',
    telegram_chat_ids: tgConfig.chat_id || '',
    telegram_enabled: tgConfig.enable_bot ?? true,
    supabase_url: getSupabaseUrl() || '',
    supabase_anon_key: getSupabaseAnonKey() || '',
  };
}

/**
 * Saves application settings locally (localStorage)
 */
export function saveLocalAppSettings(settings: Partial<AppSettings>): void {
  const currentTg = getStoredTelegramConfig();
  const updatedTg: TelegramConfig = {
    ...currentTg,
    bot_token: settings.telegram_bot_token !== undefined ? settings.telegram_bot_token : currentTg.bot_token,
    chat_id: settings.telegram_chat_ids !== undefined ? settings.telegram_chat_ids : currentTg.chat_id,
    enable_bot: settings.telegram_enabled !== undefined ? settings.telegram_enabled : currentTg.enable_bot,
  };
  saveTelegramConfig(updatedTg);

  if (settings.supabase_url !== undefined || settings.supabase_anon_key !== undefined) {
    const url = settings.supabase_url !== undefined ? settings.supabase_url : getSupabaseUrl();
    const key = settings.supabase_anon_key !== undefined ? settings.supabase_anon_key : getSupabaseAnonKey();
    setCustomSupabaseConfig(url, key);
  }
}

/**
 * Fetches settings directly from Supabase table `app_settings` and updates local state.
 */
export async function loadAppSettingsFromSupabase(): Promise<{
  success: boolean;
  settings?: Partial<AppSettings>;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase client belum dikonfigurasi' };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(SETTINGS_TABLE)
      .select('key, value');

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data || data.length === 0) {
      return { success: true, settings: {} };
    }

    const map: Record<string, string> = {};
    data.forEach((row: { key: string; value: string }) => {
      map[row.key] = row.value;
    });

    const fetchedSettings: Partial<AppSettings> = {};

    if (map['telegram_bot_token'] !== undefined) {
      fetchedSettings.telegram_bot_token = map['telegram_bot_token'];
    }
    if (map['telegram_chat_ids'] !== undefined) {
      fetchedSettings.telegram_chat_ids = map['telegram_chat_ids'];
    }
    if (map['telegram_enabled'] !== undefined) {
      fetchedSettings.telegram_enabled = map['telegram_enabled'] === 'true';
    }
    if (map['supabase_url'] !== undefined) {
      fetchedSettings.supabase_url = map['supabase_url'];
    }
    if (map['supabase_anon_key'] !== undefined) {
      fetchedSettings.supabase_anon_key = map['supabase_anon_key'];
    }

    // Apply fetched settings locally so the app uses them
    saveLocalAppSettings(fetchedSettings);

    return { success: true, settings: fetchedSettings };
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal memuat pengaturan dari Supabase' };
  }
}

/**
 * Upserts application settings into Supabase table `app_settings`.
 */
export async function saveAppSettingsToSupabase(
  settings: Partial<AppSettings>
): Promise<{ success: boolean; error?: string }> {
  // Save locally first
  saveLocalAppSettings(settings);

  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase client belum dikonfigurasi' };
  }

  try {
    const client = getSupabaseClient();
    const rowsToUpsert: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    if (settings.telegram_bot_token !== undefined) {
      rowsToUpsert.push({ key: 'telegram_bot_token', value: settings.telegram_bot_token, updated_at: now });
    }
    if (settings.telegram_chat_ids !== undefined) {
      rowsToUpsert.push({ key: 'telegram_chat_ids', value: settings.telegram_chat_ids, updated_at: now });
    }
    if (settings.telegram_enabled !== undefined) {
      rowsToUpsert.push({ key: 'telegram_enabled', value: String(settings.telegram_enabled), updated_at: now });
    }
    if (settings.supabase_url !== undefined) {
      rowsToUpsert.push({ key: 'supabase_url', value: settings.supabase_url, updated_at: now });
    }
    if (settings.supabase_anon_key !== undefined) {
      rowsToUpsert.push({ key: 'supabase_anon_key', value: settings.supabase_anon_key, updated_at: now });
    }

    if (rowsToUpsert.length === 0) {
      return { success: true };
    }

    const { error } = await client
      .from(SETTINGS_TABLE)
      .upsert(rowsToUpsert, { onConflict: 'key' });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal menyimpan pengaturan ke Supabase' };
  }
}

/**
 * Returns SQL DDL script to create `app_settings` table in Supabase SQL Editor
 */
export function getAppSettingsSqlScript(): string {
  return `-- SQL Script untuk membuat tabel app_settings di Supabase
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS & Izinkan Akses Publik / Authenticated
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow All Read for app_settings" ON app_settings
  FOR SELECT USING (true);

CREATE POLICY "Allow All Insert/Update for app_settings" ON app_settings
  FOR ALL USING (true) WITH CHECK (true);
`;
}
