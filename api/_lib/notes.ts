import type { DealerInfo, DealerNoteRow, EnrichedNote } from "./types.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export const MAX_NOTES = 400;
export const MAX_NOTE_CHARS = 1500;
const PAGE = 200;

export async function fetchDealerNotes(startISO: string, endISO: string): Promise<DealerNoteRow[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const fetched: DealerNoteRow[] = [];
  let from = 0;

  while (fetched.length <= MAX_NOTES) {
    const to = from + PAGE - 1;
    const { data, error } = await supabaseAdmin
      .from("dealer_notes")
      .select("id,dealer_id,author_username,created_at,category,text")
      .gte("created_at", startISO)
      .lt("created_at", endISO)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const rows = (data || []) as DealerNoteRow[];
    fetched.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
    if (from > 5000) break;
  }

  return fetched;
}

export async function enrichNotesWithDealers(notes: DealerNoteRow[]): Promise<EnrichedNote[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const dealerIds = Array.from(new Set(notes.map((n) => n.dealer_id).filter(Boolean)));
  const dealerById: Record<string, DealerInfo> = {};

  for (let i = 0; i < dealerIds.length; i += 100) {
    const chunk = dealerIds.slice(i, i + 100);
    const { data, error } = await supabaseAdmin
      .from("dealers")
      .select("id, name, state, region")
      .in("id", chunk);
    if (error) throw error;
    for (const d of data || []) {
      dealerById[d.id] = {
        name: d.name || "Unknown dealer",
        state: d.state || "",
        region: d.region || "",
      };
    }
  }

  return notes.map((n) => ({
    ...n,
    dealer: dealerById[n.dealer_id] || null,
  }));
}

export async function loadNotesForRange(
  startISO: string,
  endISO: string
): Promise<{ notes: EnrichedNote[]; truncated: boolean }> {
  const fetched = await fetchDealerNotes(startISO, endISO);
  const truncated = fetched.length > MAX_NOTES;
  const sliced = fetched.slice(0, MAX_NOTES);
  if (!sliced.length) return { notes: [], truncated: false };
  const notes = await enrichNotesWithDealers(sliced);
  return { notes, truncated };
}

export function formatNotesForAi(notes: EnrichedNote[]): string[] {
  return notes.map((n) => {
    const d = n.dealer;
    const dealer = d ? `${d.name} (${d.region || "?"}, ${d.state || "?"})` : "Unknown dealer";
    const when = String(n.created_at || "").slice(0, 16).replace("T", " ");
    const text = String(n.text || "").slice(0, MAX_NOTE_CHARS);
    return `[${n.category || "Note"}] ${dealer} — by ${n.author_username || "unknown"} — ${when}\n${text}`;
  });
}
