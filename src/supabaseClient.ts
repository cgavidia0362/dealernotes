import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Fail fast but with a clear message instead of a blank screen
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anon, {
  auth: { autoRefreshToken: true, persistSession: true },
});
