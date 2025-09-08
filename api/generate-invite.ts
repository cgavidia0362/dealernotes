// api/generate-invite.ts

// We keep req/res as `any` to avoid adding @vercel/node types
export default async function handler(req: any, res: any) {
  // Dynamic import to keep the serverless bundle light and avoid ESM/CJS quirks
  const { createClient } = await import('@supabase/supabase-js');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, metadata } = (req.body || {}) as { email?: string; metadata?: any };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Missing or invalid email' });
  }

  // Create Supabase admin client using Service Role
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceRoleKey) {
    return res
      .status(500)
      .json({ error: 'Supabase environment variables are not set' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Where to send the user back after they click the magic link.
  // We keep the "next=/reset" hint; the client also detects the hash type.
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const redirectTo = site ? `${site}/auth/callback?next=/reset` : undefined;

  // ---- 1) Try to create an INVITE link (for brand new users) ----
  const inviteParams = {
    type: 'invite' as const, // <— literal type so TS picks the correct overload
    email,
    options: { data: metadata || {}, redirectTo },
  };

  let { data, error } = await supabase.auth.admin.generateLink(inviteParams);

  // ---- 2) If user already exists, generate a RECOVERY link instead ----
  if (error && /already|exists|registered/i.test(error.message || '')) {
    const recoveryParams = {
      type: 'recovery' as const, // <— literal type so TS picks the correct overload
      email,
      options: { data: metadata || {}, redirectTo },
    };
    const r2 = await supabase.auth.admin.generateLink(recoveryParams);
    data = r2.data;
    error = r2.error;
  }

  if (error) {
    return res.status(400).json({ error: error.message || 'Failed to generate link' });
  }

  // ---- 2.5) NEW: upsert profiles on INVITE when we have a user id ----
  try {
    const userId = (data as any)?.user?.id;
    if (userId) {
      const username = ((metadata && (metadata as any).username) || email.split('@')[0]).toString();
      const { error: upsertErr } = await supabase
        .from('profiles')
        .upsert(
          { id: userId, email, username, role: 'Rep', status: 'Active' },
          { onConflict: 'id' }
        );
      if (upsertErr) console.error('profiles upsert (invite) failed:', upsertErr);
    }
  } catch (e) {
    console.error('profiles upsert try/catch:', e);
  }

  // Supabase can return different shapes depending on version
  const link =
    (data as any)?.properties?.action_link ??
    (data as any)?.action_link ??
    null;

  if (!link) {
    return res.status(400).json({ error: 'Invite created but link missing' });
  }

  return res.status(200).json({ link });
}
