/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPERVISOR_EMAIL?: string;
  readonly VITE_GAS_API_URL?: string;

  // Preventive Backend Selector: 'sheets' | 'supabase' (default 'supabase' if configured)
  readonly VITE_PREVENTIVE_BACKEND?: 'sheets' | 'supabase' | string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

