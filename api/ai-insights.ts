// /api/ai-insights.ts
// Admin-only, on-demand market insights over dealer_notes in a date range.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const MODEL = 'gpt-4.1-mini';
const MAX_NOTES = 400;
const MAX_NOTE_CHARS = 1500;
const PAGE = 200;

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const openaiKey = process.env.OPENAI_API_KEY;

const supabaseAdmin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SYSTEM_PROMPT = `You are a market-intelligence analyst for an auto finance / dealer lending team.
Reps visit dealerships and write field notes. Your job is to turn those notes into a clear executive briefing.

Rules:
- Use ONLY the notes provided. Do not invent dealers, lenders, quotes, or reasons.
- If a section has no evidence, return exactly one item: "Nothing notable in this range."
- Group similar points. Do not list every note.
- When a point is grounded in a specific conversation, cite it as "Dealer Name (rep username)".
- Be specific: name lenders, fees, process issues, regions, and programs when the notes do.
- Distinguish (a) the overall program, (b) eContracting, and (c) any new program. Do not mix them.
- Call out competitor losses and WHY the dealer says they went elsewhere.
- Neutral, concise, easy to scan. Short bullets, no preamble, no markdown.

Return a JSON object with exactly these keys, each an array of strings:
{
  "snapshot": [],
  "themes": [],
  "positive": [],
  "concerns": [],
  "competitiveLosses": [],
  "programReception": [],
  "eContracting": [],
  "newProgram": [],
  "watchItems": []
}

Section intent:
- snapshot: 3–5 bullets — the market story for this date range
- themes: what dealers are talking about (funding, rates/fees, program fit, process, staffing, etc.)
- positive: what is landing well
- concerns: friction, complaints, hesitation
- competitiveLosses: specific lenders named and why dealers say they are going there
- programReception: how dealerships feel about our program overall (good and bad)
- eContracting: reception of eContracting specifically
- newProgram: reception of the new program specifically
- watchItems: anything else leadership should not miss (region patterns, repeat dealers, process issues)`;

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function normalizeReport(parsed: any) {
  const fallback = ['Nothing notable in this range.'];
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const arr = asStringArray(parsed?.[k]);
      if (arr.length) return arr;
    }
    return fallback;
  };
  return {
    snapshot: pick('snapshot'),
    themes: pick('themes', 'whatDealersAreTalkingAbout'),
    positive: pick('positive'),
    concerns: pick('concerns', 'negatives'),
    competitiveLosses: pick('competitiveLosses', 'competitive_losses'),
    programReception: pick('programReception', 'program_reception'),
    eContracting: pick('eContracting', 'econtracting', 'e_contracting'),
    newProgram: pick('newProgram', 'new_program'),
    watchItems: pick('watchItems', 'watch_items'),
  };
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!openaiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
    }

    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

    const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
    if (uErr || !u?.user?.id) return res.status(401).json({ error: 'Invalid session' });

    const { data: prof, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', u.user.id)
      .single();

    if (pErr || !prof) return res.status(403).json({ error: 'Profile not found' });
    if (prof.role !== 'Admin') return res.status(403).json({ error: 'Not authorized' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const startISO = String(body.startISO || '').trim();
    const endISO = String(body.endISO || '').trim();
    const rangeLabel = String(body.rangeLabel || '').trim();

    if (!startISO || !endISO || Number.isNaN(Date.parse(startISO)) || Number.isNaN(Date.parse(endISO))) {
      return res.status(400).json({ error: 'Valid startISO and endISO required' });
    }
    if (Date.parse(endISO) <= Date.parse(startISO)) {
      return res.status(400).json({ error: 'endISO must be after startISO' });
    }

    const fetched: any[] = [];
    let from = 0;
    while (fetched.length <= MAX_NOTES) {
      const to = from + PAGE - 1;
      const { data, error } = await supabaseAdmin
        .from('dealer_notes')
        .select('id,dealer_id,author_username,created_at,category,text')
        .gte('created_at', startISO)
        .lt('created_at', endISO)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      const rows = data || [];
      fetched.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
      if (from > 5000) break;
    }

    const truncated = fetched.length > MAX_NOTES;
    const notes = fetched.slice(0, MAX_NOTES);

    if (!notes.length) {
      return res.status(200).json({
        noteCount: 0,
        truncated: false,
        rangeLabel,
        report: null,
        message: 'No notes in selected range.',
      });
    }

    const dealerIds = Array.from(new Set(notes.map((n) => n.dealer_id).filter(Boolean)));
    const dealerById: Record<string, { name: string; state: string; region: string }> = {};
    for (let i = 0; i < dealerIds.length; i += 100) {
      const chunk = dealerIds.slice(i, i + 100);
      const { data, error } = await supabaseAdmin
        .from('dealers')
        .select('id, name, state, region')
        .in('id', chunk);
      if (error) throw error;
      for (const d of data || []) {
        dealerById[d.id] = {
          name: d.name || 'Unknown dealer',
          state: d.state || '',
          region: d.region || '',
        };
      }
    }

    const lines = notes.map((n) => {
      const d = dealerById[n.dealer_id];
      const dealer = d ? `${d.name} (${d.region || '?'}, ${d.state || '?'})` : 'Unknown dealer';
      const when = String(n.created_at || '').slice(0, 16).replace('T', ' ');
      const text = String(n.text || '').slice(0, MAX_NOTE_CHARS);
      return `[${n.category || 'Note'}] ${dealer} — by ${n.author_username || 'unknown'} — ${when}\n${text}`;
    });

    const userContent =
      `Date range: ${rangeLabel || `${startISO} to ${endISO}`}\n` +
      `Note count: ${notes.length}${truncated ? ` (most recent ${MAX_NOTES}; older notes omitted)` : ''}\n` +
      `All reps included.\n\n` +
      lines.join('\n\n');

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 50000);
    let aiResp: Response;
    try {
      aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
        }),
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        return res.status(504).json({ error: 'Insights timed out. Try a smaller date range.' });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!aiResp.ok) {
      return res.status(502).json({ error: 'Insight model request failed. Try again.' });
    }

    const aiJson = await aiResp.json();
    const content = String(aiJson?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      return res.status(502).json({ error: 'Insight model returned an empty response.' });
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = null;
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'Insight model returned invalid JSON.' });
    }

    return res.status(200).json({
      noteCount: notes.length,
      truncated,
      rangeLabel,
      model: MODEL,
      report: normalizeReport(parsed),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
