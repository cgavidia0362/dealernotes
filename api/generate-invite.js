// api/generate-invite.js  (or .mjs)
export default async function handler(req, res) {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
  
    try {
      // Read JSON body safely
      let bodyObj = {};
      if (typeof req.body === 'string') {
        try { bodyObj = JSON.parse(req.body); } catch { bodyObj = {}; }
      } else if (req.body && typeof req.body === 'object') {
        bodyObj = req.body;
      } else {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try { bodyObj = raw ? JSON.parse(raw) : {}; } catch { bodyObj = {}; }
      }
  
      const { email, metadata = {} } = bodyObj;
      if (!email) { res.status(400).json({ error: 'Missing email' }); return; }
  
      const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
      const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if (!supabaseUrl || !serviceKey) {
        res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' });
        return;
      }
  
      const site = (process.env.SITE_URL || '').replace(/\/$/, '');
      const payload = { type: 'invite', email, data: metadata };
      if (site) payload.redirect_to = `${site}/auth/callback`;
  
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(payload),
      });
  
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  
      if (!r.ok) {
        const msg = json.error_description || json.error || json.raw || `HTTP ${r.status}`;
        res.status(400).json({ error: msg });
        return;
      }
  
      const link =
        json?.properties?.action_link ??
        json?.action_link ?? null;
  
      res.status(200).json({ link });
    } catch (err) {
      console.error('generate-invite error:', err);
      res.status(500).json({ error: err?.message || 'Server error' });
    }
  }
  