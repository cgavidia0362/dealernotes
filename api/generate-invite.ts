// api/generate-invite.ts
import { createClient } from '@supabase/supabase-js';

// Uses server-side secrets (we'll add these in Step 2)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { email, metadata } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const site = (process.env.SITE_URL || '').replace(/\/$/, '');
    const redirectTo = site ? `${site}/#/auth/callback?next=/reset` : undefined;

    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: metadata || {}, redirectTo },
    });

    if (error) return res.status(400).json({ error: error.message });

    const link =
      (data as any)?.properties?.action_link ??
      (data as any)?.action_link ??
      null;

    return res.status(200).json({ link });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
}