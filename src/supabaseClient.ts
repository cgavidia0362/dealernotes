import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Be tolerant in StackBlitz: 'import.meta.env' types may not be loaded in the editor.
const meta: any = (typeof import.meta !== 'undefined' ? import.meta : {}) as any;
const env = (meta && meta.env) ? meta.env : {};

const url: string | undefined = env.VITE_SUPABASE_URL;
const anon: string | undefined = env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient;

// In production (Vercel), env vars exist → use the real client
if (url && anon) {
  client = createClient(url, anon, {
    auth: { autoRefreshToken: true, persistSession: true },
  });
} else {
  // In StackBlitz or local without env, provide a no-op stub so the UI can render
  console.warn('[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Using a no-op stub for preview.');
  const noop = () => {};
  const fakeSub = { unsubscribe: noop };
  client = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: fakeSub } } as any),
      updateUser: async () => ({ data: {}, error: null } as any),
    },
  } as any;
}

export const supabase = client;

