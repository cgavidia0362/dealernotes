// /api/generate-invite.ts
// Works on Vercel without extra types. If you want types later, import from '@vercel/node'.
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // service role
const SITE_URL = process.env.SITE_URL!;

const supabaseAdmin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, metadata } = (req.body || {}) as { email?: string; metadata?: { username?: string } };
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

    const username = (metadata?.username || '').trim();
    const redirectTo = `${SITE_URL}/auth/callback?next=/reset`;

    // Helper to normalize Supabase link responses
    const extractLink = (data: any) =>
      data?.properties?.action_link || data?.action_link || data?.email_otp?.action_link || undefined;

    // 1) Try an INVITE link first
    const inviteResp = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo,
        data: username ? { username } : undefined, // carry username metadata on invite
      },
    });

    if (!inviteResp.error) {
      const link = extractLink(inviteResp.data);
      return res.status(200).json({ link, mode: 'invite', data: inviteResp.data });
    }

    // 2) If invite failed because user already exists, fallback to RECOVERY
    const msg = String(inviteResp.error.message || '').toLowerCase();
    const isAlreadyRegistered =
      msg.includes('already been registered') ||
      msg.includes('user already registered') ||
      inviteResp.error.status === 422 ||
      inviteResp.error.status === 409;

    if (isAlreadyRegistered) {
      const recoveryResp = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      });

      if (recoveryResp.error) {
        return res.status(400).json({ error: recoveryResp.error.message });
      }

      const link = extractLink(recoveryResp.data);
      return res.status(200).json({ link, mode: 'recovery', data: recoveryResp.data });
    }

    // Other errors
    return res.status(400).json({ error: inviteResp.error.message });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
