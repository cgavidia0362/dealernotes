// /api/admin-delete-user.ts
// Minimal server-side delete (Auth user + cascades profiles via FK)

export default async function handler(req: any, res: any) {
    const { createClient } = await import('@supabase/supabase-js');
  
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
  
    // Accept JSON { id: "<auth UUID>" }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = body?.id as string;
  
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
      return res.status(400).json({ error: 'Missing or invalid user id' });
    }
  
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase env vars not set' });
    }
  
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  
    // Delete the Auth user (profiles row will be removed via ON DELETE CASCADE)
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return res.status(400).json({ error: error.message });
  
    return res.status(200).json({ ok: true });
  }
  