import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read Vite env that gets baked at build time
const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// Detect StackBlitz/WebContainer sandbox only
const isSandbox =
  typeof window !== 'undefined' &&
  /stackblitz|webcontainer/.test(location.hostname);

let client: SupabaseClient;

if (url && anon) {
  // ✅ Real client (Production/Preview builds on Vercel)
  client = createClient(url, anon, {
    auth: { autoRefreshToken: true, persistSession: true },
  });
} else if (isSandbox) {
  // 🧪 Sandbox-only: tiny no-op stub so the UI can render in StackBlitz
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in sandbox. Using a no-op stub for preview.'
  );
  const noop = () => {};
  const fakeSub = { unsubscribe: noop };
  client = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: fakeSub } } as any),
      updateUser: async () => ({ data: {}, error: null } as any),
      getUser: async () => ({ data: { user: null }, error: null } as any),
      getSession: async () => ({ data: { session: null }, error: null } as any),
      setSession: async () => ({ data: { session: null, user: null }, error: null } as any),
      signOut: async () => ({ error: null } as any),
    },
    from: () => ({
      select: async () => ({ data: null, error: null } as any),
      update: async () => ({ data: null, error: null } as any),
      eq: () => ({ select: async () => ({ data: null, error: null } as any) }),
    }),
  } as any;
} else {
  // ❌ Not sandbox and envs missing → fail loudly so we never ship a broken build
  console.error('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = client;


