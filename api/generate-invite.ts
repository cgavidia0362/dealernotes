// /api/generate-invite.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // service role
const SITE_URL = process.env.SITE_URL!;

const supabaseAdmin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, metadata } = (req.body || {}) as { email?: string; metadata?: { username?: string } };
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

    const username = (metadata?.username || '').trim();
    const redirectTo = `${SITE_URL}/auth/callback?next=/reset`;

    // Prefer generateLink; it returns action_link reliably.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo,
        data: username ? { username } : undefined, // <-- include username metadata
      },
    });

    if (error) return res.status(400).json({ error: error.message });

    // Normalize response
    const link =
      (data as any)?.properties?.action_link ||
      (data as any)?.action_link ||
      undefined;

    return res.status(200).json({ link, data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
