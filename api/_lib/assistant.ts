import { INSIGHTS_MODEL } from "./insights.js";
import { getSupabaseAdmin, getSupabaseUserClient } from "./supabaseAdmin.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "./types.js";

export const MAX_ASSISTANT_NOTES = 20;
export const MAX_ROUTE_DEALERS = 40;

export type AssistantRole = "Admin" | "Manager" | "Rep" | string;
export type NoteCategory = "Visit" | "Called" | "Problem" | "Other" | "Manager";

export type AssistantDealer = {
  id: string;
  name: string;
  city: string;
  state: string;
  region: string;
  address1: string;
  zip: string;
  assignedRepUsername: string;
};

export type ConfirmPayload = {
  action: "create_route" | "add_note";
  date?: string;
  dealerIds?: string[];
  dealerId?: string;
  category?: NoteCategory;
  text?: string;
};

export type AssistantResult = {
  reply: string;
  pendingConfirm?: {
    action: "create_route" | "add_note";
    summary: string;
    payload: ConfirmPayload;
  };
};

type CoverageUser = {
  username: string;
  role: AssistantRole;
  states: string[];
  regionsByState: Record<string, string[]>;
};

function dealerSearchTokens(q: string): string[] {
  return String(q || "")
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function dealerMatchesQuery(d: AssistantDealer, q: string): boolean {
  const tokens = dealerSearchTokens(q);
  if (!tokens.length) return true;
  const hay = [d.name, d.city, d.state, d.region].join(" ").toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

function canAccessDealer(user: CoverageUser, d: AssistantDealer): boolean {
  if (user.role === "Admin" || user.role === "Manager") return true;
  if (d.assignedRepUsername && d.assignedRepUsername === user.username) return true;
  if (!user.states.includes(d.state)) return false;
  const regions = user.regionsByState[d.state] || [];
  if (regions.length === 0) return true;
  return regions.includes(d.region);
}

function orderDealersByAddress(dealers: AssistantDealer[]): AssistantDealer[] {
  return [...dealers].sort((a, b) => {
    const zip = a.zip.localeCompare(b.zip);
    if (zip) return zip;
    const street = a.address1.localeCompare(b.address1);
    if (street) return street;
    return a.name.localeCompare(b.name);
  });
}

function formatDealerLine(d: AssistantDealer): string {
  const addr = [d.address1, d.city, d.state, d.zip].filter(Boolean).join(", ");
  return addr ? `${d.name} — ${addr}` : d.name;
}

function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeDate(value: string | undefined): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayYmd();
}

function normalizeCategory(value: string | undefined, role: AssistantRole): NoteCategory {
  const raw = String(value || "Visit").trim();
  const allowed: NoteCategory[] = ["Visit", "Called", "Problem", "Other", "Manager"];
  const hit = allowed.find((c) => c.toLowerCase() === raw.toLowerCase()) || "Visit";
  if (hit === "Manager" && role !== "Admin" && role !== "Manager") return "Visit";
  return hit;
}

async function callJsonModel(system: string, user: string): Promise<Record<string, unknown>> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new HttpError(500, "OPENAI_API_KEY is not configured.");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);
  let aiResp: Response;
  try {
    aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: INSIGHTS_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new InsightsTimeoutError("The assistant timed out. Try a shorter question.");
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!aiResp.ok) throw new InsightsModelError("The assistant is unavailable. Try again.");
  const aiJson = (await aiResp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = String(aiJson?.choices?.[0]?.message?.content || "").trim();
  let parsed: unknown = null;
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
  if (!parsed || typeof parsed !== "object") {
    throw new InsightsModelError("The assistant returned an unreadable answer.");
  }
  return parsed as Record<string, unknown>;
}

export async function loadCoverageUser(opts: {
  userId: string;
  username: string;
  role: AssistantRole;
}): Promise<CoverageUser> {
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from("rep_coverage")
    .select("state, region")
    .eq("user_id", opts.userId);
  if (error) throw new HttpError(400, error.message);

  const states = new Set<string>();
  const regionsByState: Record<string, string[]> = {};
  const entire = new Set<string>();
  for (const row of rows || []) {
    const st = String((row as any).state || "").trim();
    if (!st) continue;
    states.add(st);
    const rg = String((row as any).region || "").trim();
    if (!rg) {
      entire.add(st);
      regionsByState[st] = [];
      continue;
    }
    if (entire.has(st)) continue;
    if (!regionsByState[st]) regionsByState[st] = [];
    if (!regionsByState[st].includes(rg)) regionsByState[st].push(rg);
  }

  return {
    username: opts.username,
    role: opts.role,
    states: Array.from(states),
    regionsByState,
  };
}

async function loadAccessibleDealers(user: CoverageUser, opts?: { city?: string; query?: string }): Promise<AssistantDealer[]> {
  const admin = getSupabaseAdmin();
  let q = admin
    .from("dealers")
    .select("id,name,city,state,region,address1,zip,assigned_rep_username")
    .order("name", { ascending: true })
    .limit(800);

  const city = (opts?.city || "").trim();
  if (city) q = q.ilike("city", `%${city}%`);

  const { data, error } = await q;
  if (error) throw new HttpError(400, error.message);

  let dealers = (data || []).map((d: any) => ({
    id: String(d.id),
    name: String(d.name || ""),
    city: String(d.city || ""),
    state: String(d.state || ""),
    region: String(d.region || ""),
    address1: String(d.address1 || ""),
    zip: String(d.zip || ""),
    assignedRepUsername: String(d.assigned_rep_username || ""),
  })) as AssistantDealer[];

  dealers = dealers.filter((d) => canAccessDealer(user, d));
  if (city) {
    const cityTok = city.toLowerCase();
    dealers = dealers.filter((d) => d.city.toLowerCase().includes(cityTok) || d.name.toLowerCase().includes(cityTok));
  }
  const query = (opts?.query || "").trim();
  if (query) dealers = dealers.filter((d) => dealerMatchesQuery(d, query));
  return dealers;
}

async function loadDealerNotes(dealerId: string): Promise<
  Array<{ author: string; createdAt: string; category: string; text: string }>
> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("dealer_notes")
    .select("author_username,created_at,category,text")
    .eq("dealer_id", dealerId)
    .order("created_at", { ascending: false })
    .limit(MAX_ASSISTANT_NOTES);
  if (error) throw new HttpError(400, error.message);
  return (data || []).map((n: any) => ({
    author: String(n.author_username || ""),
    createdAt: String(n.created_at || ""),
    category: String(n.category || ""),
    text: String(n.text || "").slice(0, 800),
  }));
}

function pickDealer(dealers: AssistantDealer[], query: string): AssistantDealer[] {
  if (dealers.length <= 1) return dealers;
  const tokens = dealerSearchTokens(query);
  const nameHits = dealers.filter((d) => tokens.every((t) => d.name.toLowerCase().includes(t)));
  if (nameHits.length === 1) return nameHits;
  if (nameHits.length > 1 && nameHits.length < dealers.length) return nameHits.slice(0, 8);
  return dealers.slice(0, 8);
}

async function parseIntent(message: string): Promise<{
  intent: "answer_notes" | "create_route" | "add_note" | "clarify" | "unsupported";
  dealerQuery: string;
  city: string;
  noteText: string;
  category: string;
  date: string;
}> {
  const parsed = await callJsonModel(
    `You extract one action for a dealer-notes field app. Return JSON only with keys:
intent, dealerQuery, city, noteText, category, date.

intent must be one of:
- answer_notes: last visit / who spoke / what was said about a dealer
- create_route: build a day's route of dealers in a city or matching a place
- add_note: save a note onto a named dealer
- clarify: missing dealer or city
- unsupported: anything else (HR, general knowledge, inventing facts)

Rules:
- dealerQuery is the dealer name words (e.g. "honda libertyville"). Empty if none.
- city is a city name only when they ask for a city route (e.g. "aurora").
- noteText is the note body to save. Empty unless add_note.
- category is Visit, Called, Problem, Other, or Manager. Default Visit.
- date is YYYY-MM-DD only if they named a date, else "".
- Do not invent a dealer name they did not mention.`,
    message
  );

  const intentRaw = String(parsed.intent || "clarify").toLowerCase();
  const intent =
    intentRaw === "answer_notes" ||
    intentRaw === "create_route" ||
    intentRaw === "add_note" ||
    intentRaw === "unsupported"
      ? (intentRaw as "answer_notes" | "create_route" | "add_note" | "unsupported")
      : "clarify";

  return {
    intent,
    dealerQuery: String(parsed.dealerQuery || "").trim(),
    city: String(parsed.city || "").trim(),
    noteText: String(parsed.noteText || "").trim(),
    category: String(parsed.category || "Visit").trim(),
    date: String(parsed.date || "").trim(),
  };
}

async function answerFromNotes(dealer: AssistantDealer, question: string): Promise<string> {
  const notes = await loadDealerNotes(dealer.id);
  if (!notes.length) {
    return `I found ${dealer.name}, but there are no notes on file yet.`;
  }
  const parsed = await callJsonModel(
    `You answer using ONLY the supplied dealer notes. Do not invent people, dates, or conversations.
Return JSON: { "reply": "..." }.
If the notes do not say who they spoke with, say that the note does not name a contact.
Include date, rep, category, and a short summary of what was written.`,
    `Question: ${question}\nDealer: ${formatDealerLine(dealer)}\nNotes (newest first):\n${notes
      .map((n, i) => `${i + 1}. ${n.createdAt.slice(0, 10)} | ${n.author} | ${n.category} | ${n.text}`)
      .join("\n")}`
  );
  return String(parsed.reply || "").trim() || `Latest note at ${dealer.name}: ${notes[0].createdAt.slice(0, 10)} by ${notes[0].author}. ${notes[0].text}`;
}

function listDealersReply(dealers: AssistantDealer[], label: string): string {
  const lines = dealers.map((d, i) => `${i + 1}. ${formatDealerLine(d)}`);
  return `${label}\n${lines.join("\n")}`;
}

export async function handleAssistantTurn(opts: {
  token: string;
  userId: string;
  username: string;
  role: AssistantRole;
  message: string;
  confirm?: ConfirmPayload | null;
  routeDate?: string;
}): Promise<AssistantResult> {
  const user = await loadCoverageUser({
    userId: opts.userId,
    username: opts.username,
    role: opts.role,
  });

  if (opts.confirm) {
    return executeConfirm({
      token: opts.token,
      user,
      userId: opts.userId,
      username: opts.username,
      confirm: opts.confirm,
    });
  }

  const message = opts.message.trim();
  if (!message) throw new HttpError(400, "Type a question first.");

  const intent = await parseIntent(message);
  const routeDate = normalizeDate(intent.date || opts.routeDate);

  if (intent.intent === "unsupported") {
    return {
      reply:
        "I can only help with Dealer Notes: last conversations, building a route from dealers in a city, or adding a note to a dealer you name.",
    };
  }

  if (intent.intent === "create_route") {
    const city = intent.city || intent.dealerQuery;
    if (!city) {
      return { reply: "Which city should I build the route from? For example: all dealers in Aurora." };
    }
    const found = orderDealersByAddress(await loadAccessibleDealers(user, { city }));
    if (!found.length) {
      return { reply: `I could not find any dealers you can access in ${city}.` };
    }
    const limited = found.slice(0, MAX_ROUTE_DEALERS);
    const extra = found.length > limited.length ? ` Showing the first ${limited.length} of ${found.length}.` : "";
    const summary = `Add ${limited.length} dealer${limited.length === 1 ? "" : "s"} in ${city} to the ${routeDate} route, ordered by zip then street.${extra}`;
    return {
      reply: `${summary}\n\n${limited.map((d, i) => `${i + 1}. ${formatDealerLine(d)}`).join("\n")}\n\nTap Confirm to save this on Rep Route.`,
      pendingConfirm: {
        action: "create_route",
        summary,
        payload: { action: "create_route", date: routeDate, dealerIds: limited.map((d) => d.id) },
      },
    };
  }

  if (intent.intent === "add_note") {
    if (!intent.dealerQuery) {
      return { reply: "Which dealer should I add the note to?" };
    }
    if (!intent.noteText) {
      return { reply: `What should the note say for ${intent.dealerQuery}?` };
    }
    const matches = pickDealer(await loadAccessibleDealers(user, { query: intent.dealerQuery }), intent.dealerQuery);
    if (!matches.length) {
      return { reply: `I could not find a dealer matching “${intent.dealerQuery}” that you can access.` };
    }
    if (matches.length > 1) {
      return { reply: listDealersReply(matches, "I found more than one dealer. Tell me the exact name:") };
    }
    const dealer = matches[0];
    const category = normalizeCategory(intent.category, user.role);
    const summary = `Add a ${category} note on ${dealer.name}: “${intent.noteText}”`;
    return {
      reply: `${summary}\n\nTap Confirm to save it under your username.`,
      pendingConfirm: {
        action: "add_note",
        summary,
        payload: {
          action: "add_note",
          dealerId: dealer.id,
          category,
          text: intent.noteText,
        },
      },
    };
  }

  if (intent.intent === "answer_notes") {
    if (!intent.dealerQuery) {
      return { reply: "Which dealer should I look up?" };
    }
    const matches = pickDealer(await loadAccessibleDealers(user, { query: intent.dealerQuery }), intent.dealerQuery);
    if (!matches.length) {
      return { reply: `I could not find a dealer matching “${intent.dealerQuery}” that you can access.` };
    }
    if (matches.length > 1) {
      return { reply: listDealersReply(matches, "I found more than one dealer. Tell me the exact name:") };
    }
    return { reply: await answerFromNotes(matches[0], message) };
  }

  return { reply: "Tell me a dealer to look up, a city to build a route, or a note to add." };
}

async function executeConfirm(opts: {
  token: string;
  user: CoverageUser;
  userId: string;
  username: string;
  confirm: ConfirmPayload;
}): Promise<AssistantResult> {
  const userClient = getSupabaseUserClient(opts.token);

  if (opts.confirm.action === "create_route") {
    const date = normalizeDate(opts.confirm.date);
    const ids = Array.from(new Set((opts.confirm.dealerIds || []).map((id) => String(id).trim()).filter(Boolean))).slice(
      0,
      MAX_ROUTE_DEALERS
    );
    if (!ids.length) throw new HttpError(400, "No dealers to add to the route.");

    const allowed = (await loadAccessibleDealers(opts.user)).filter((d) => ids.includes(d.id));
    const ordered = orderDealersByAddress(allowed);
    if (!ordered.length) throw new HttpError(403, "You do not have access to those dealers.");

    const { data: existing, error: existErr } = await userClient
      .from("dealer_routes")
      .select("dealer_id, position")
      .eq("user_id", opts.userId)
      .eq("date", date);
    if (existErr) throw new HttpError(400, existErr.message);

    const already = new Set((existing || []).map((r: any) => String(r.dealer_id)));
    let nextPos = 0;
    for (const r of existing || []) {
      const p = Number((r as any).position || 0);
      if (p > nextPos) nextPos = p;
    }

    const toAdd = ordered.filter((d) => !already.has(d.id));
    const rows = toAdd.map((d, i) => ({
      user_id: opts.userId,
      dealer_id: d.id,
      date,
      position: nextPos + i + 1,
    }));
    if (rows.length) {
      const { error } = await userClient.from("dealer_routes").upsert(rows, { onConflict: "user_id,date,dealer_id" });
      if (error) throw new HttpError(400, error.message);
    }

    const skipped = ordered.length - toAdd.length;
    return {
      reply: `Saved ${toAdd.length} dealer${toAdd.length === 1 ? "" : "s"} to the ${date} route${
        skipped ? ` (${skipped} were already on it)` : ""
      }. Open Rep Route to see the order.`,
    };
  }

  if (opts.confirm.action === "add_note") {
    const dealerId = String(opts.confirm.dealerId || "").trim();
    const text = String(opts.confirm.text || "").trim();
    if (!dealerId || !text) throw new HttpError(400, "Dealer and note text are required.");
    const allowed = await loadAccessibleDealers(opts.user);
    const dealer = allowed.find((d) => d.id === dealerId);
    if (!dealer) throw new HttpError(403, "You do not have access to that dealer.");
    const category = normalizeCategory(opts.confirm.category, opts.user.role);
    const clientId = `${opts.username}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { error } = await userClient.from("dealer_notes").insert({
      dealer_id: dealerId,
      user_id: opts.userId,
      author_username: opts.username,
      category,
      text,
      created_at: new Date().toISOString(),
      client_id: clientId,
    });
    if (error) throw new HttpError(400, error.message);
    return { reply: `Saved a ${category} note on ${dealer.name} under ${opts.username}.` };
  }

  throw new HttpError(400, "Unknown confirm action.");
}
