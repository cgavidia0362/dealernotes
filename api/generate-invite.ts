// api/generate-invite.ts

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  
    try {
      // 1) Read input safely
      const { email, metadata } = (req.body || {}) as { email?: string; metadata?: Record<string, any> };
      if (!email) return res.status(400).json({ error: 'Missing email' });
  
      // 2) Read env vars
      const supabaseUrl =
        (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if (!supabaseUrl || !serviceKey) {
        return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' });
      }
  
      const site = (process.env.SITE_URL || '').replace(/\/$/, '');
      const redirect_to = site ? `${site}/auth/callback` : undefined;
  
      // 3) Call Supabase Admin REST endpoint directly
      const url = `${supabaseUrl}/auth/v1/admin/generate_link`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          type: 'invite',
          email,
          options: { data: metadata || {}, redirect_to },
        }),
      });
  
      const json = await r.json().catch(() => ({} as any));
  
      if (!r.ok) {
        // Supabase often returns error_description or error
        const msg = (json && (json.error_description || json.error)) || 'Failed to generate link';
        return res.status(400).json({ error: msg });
      }
  
      // 4) Support both response shapes
      const link =
        (json as any)?.properties?.action_link ??
        (json as any)?.action_link ??
        null;
  
      return res.status(200).json({ link });
    } catch (err: any) {
      console.error('generate-invite error:', err);
      return res.status(500).json({ error: err?.message || 'Server error' });
    }
  }
  
  
  