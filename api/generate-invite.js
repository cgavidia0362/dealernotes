// api/generate-invite.js
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
  
    try {
      // Parse body safely (may arrive as string)
      const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const email = raw.email;
      const metadata = raw.metadata || {};
      if (!email) {
        res.status(400).json({ error: 'Missing email' });
        return;
      }
  
      const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if (!supabaseUrl || !serviceKey) {
        res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' });
        return;
      }
  
      const site = (process.env.SITE_URL || '').replace(/\/$/, '');
      const redirect_to = site ? `${site}/auth/callback` : undefined;
  
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
          options: { data: metadata, redirect_to },
        }),
      });
  
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
  
      if (!r.ok) {
        const msg = (json && (json.error_description || json.error || json.raw)) || 'Failed to generate link';
        res.status(400).json({ error: msg });
        return;
      }
  
      const link =
        (json && json.properties && json.properties.action_link) ||
        (json && json.action_link) ||
        null;
  
      res.status(200).json({ link });
    } catch (err) {
      console.error('invite error', err);
      res.status(500).json({ error: String(err && err.message || err) });
    }
  };
  