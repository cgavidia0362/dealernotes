// /api/export-everything.ts
import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // service role
const supabaseAdmin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1) authenticate caller (bearer token from front-end)
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

    const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
    if (uErr || !u?.user?.id) return res.status(401).json({ error: 'Invalid session' });

    const uid = u.user.id;
    const { data: prof, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', uid)
      .single();

    if (pErr || !prof) return res.status(403).json({ error: 'Profile not found' });
    if (!(prof.role === 'Admin' || prof.role === 'Manager')) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // 2) pull all rows from each table (paged)
    async function fetchAll(table: string) {
      const page = 1000;
      let from = 0;
      let out: any[] = [];
      while (true) {
        const to = from + page - 1;
        const { data, error } = await supabaseAdmin.from(table).select('*').range(from, to);
        if (error) throw error;
        const rows = data || [];
        out = out.concat(rows);
        if (rows.length < page) break;
        from += page;
      }
      return out;
    }

    const [dealers, dealer_notes, dealer_tasks, profiles, rep_coverage, dealer_routes] =
      await Promise.all([
        fetchAll('dealers'),
        fetchAll('dealer_notes'),
        fetchAll('dealer_tasks'),
        fetchAll('profiles'),
        fetchAll('rep_coverage'),
        fetchAll('dealer_routes'),
      ]);

    // 3) enrich dealers with rep email/role (by username)
    const byUsername: Record<string, any> = {};
    for (const p of profiles) if (p?.username) byUsername[p.username] = p;
    const dealersExport = dealers.map((d: any) => {
      const rep = d.assigned_rep_username ? byUsername[d.assigned_rep_username] : null;
      return {
        ...d,                                  // includes d.id (Dealer ID UUID)
        assigned_rep_email: rep?.email || '',
        assigned_rep_role: rep?.role || '',
      };
    });

    // 4) tiny CSV helper
    const csvEscape = (v: any) => {
      if (v === null || v === undefined) return '';
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (s.includes('"')) s = s.replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    function toCSV(rows: any[], preferFirst: string[] = []) {
      if (!rows?.length) return '';
      const keySet = new Set<string>();
      rows.forEach((r) => Object.keys(r || {}).forEach((k) => keySet.add(k)));
      const keys = Array.from(keySet);
      const head = preferFirst.filter((k) => keys.includes(k));
      const tail = keys.filter((k) => !head.includes(k)).sort();
      const cols = head.concat(tail);
      const header = cols.join(',');
      const lines = rows.map((r) => cols.map((k) => csvEscape(r?.[k])).join(','));
      return [header, ...lines].join('\n');
    }

    // 5) build the zip
    const zip = new JSZip();
    zip.file(
      'dealers.csv',
      toCSV(dealersExport, [
        'id',                // Dealer ID (UUID) — first column
        'name','state','region','type','status',
        'address1','address2','city','zip','contacts',
        'assigned_rep_username','assigned_rep_email','assigned_rep_role',
        'last_visited','sending_deals','no_deal_reasons','created_at','updated_at',
      ])
    );
    zip.file('dealer_notes.csv',  toCSV(dealer_notes,  ['id','dealer_id','category','text','author_username','created_at']));
    zip.file('dealer_tasks.csv',  toCSV(dealer_tasks,  ['id','dealer_id','rep_username','text','created_at','completed_at']));
    zip.file('profiles.csv',      toCSV(profiles,      ['id','username','email','role','status','created_at']));
    zip.file('rep_coverage.csv',  toCSV(rep_coverage,  ['id','user_id','state','region','created_at']));
    zip.file('dealer_routes.csv', toCSV(dealer_routes, ['id','user_id','dealer_id','date','position','created_at']));

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="dealernotes-export_${stamp}.zip"`);
    return res.status(200).send(buf);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
