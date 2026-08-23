import { formatNotesForAi, enrichNotesWithDealers, fetchDealerNotes, MAX_NOTES } from "./notes";
import type { InsightsReport, InsightsResult } from "./types";
import { InsightsModelError, InsightsTimeoutError } from "./types";

export const INSIGHTS_MODEL = "gpt-4.1-mini";

export const SYSTEM_PROMPT = `You are a market-intelligence analyst for an auto finance / dealer lending team.
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

export function normalizeInsightsReport(parsed: unknown): InsightsReport {
  const fallback = ["Nothing notable in this range."];
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const arr = asStringArray(obj[k]);
      if (arr.length) return arr;
    }
    return fallback;
  };
  return {
    snapshot: pick("snapshot"),
    themes: pick("themes", "whatDealersAreTalkingAbout"),
    positive: pick("positive"),
    concerns: pick("concerns", "negatives"),
    competitiveLosses: pick("competitiveLosses", "competitive_losses"),
    programReception: pick("programReception", "program_reception"),
    eContracting: pick("eContracting", "econtracting", "e_contracting"),
    newProgram: pick("newProgram", "new_program"),
    watchItems: pick("watchItems", "watch_items"),
  };
}

export function buildInsightsPrompt(params: {
  rangeLabel: string;
  startISO: string;
  endISO: string;
  noteCount: number;
  truncated: boolean;
  formattedNotes: string[];
}): string {
  return (
    `Date range: ${params.rangeLabel || `${params.startISO} to ${params.endISO}`}\n` +
    `Note count: ${params.noteCount}${params.truncated ? ` (most recent ${MAX_NOTES}; older notes omitted)` : ""}\n` +
    `All reps included.\n\n` +
    params.formattedNotes.join("\n\n")
  );
}

export async function callOpenAIForInsights(userContent: string): Promise<unknown> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 50000);
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
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new InsightsTimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!aiResp.ok) {
    throw new InsightsModelError("Insight model request failed. Try again.");
  }

  const aiJson = (await aiResp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = String(aiJson?.choices?.[0]?.message?.content || "").trim();
  if (!content) {
    throw new InsightsModelError("Insight model returned an empty response.");
  }

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
    throw new InsightsModelError("Insight model returned invalid JSON.");
  }
  return parsed;
}

export async function generateInsightsReport(params: {
  startISO: string;
  endISO: string;
  rangeLabel?: string;
}): Promise<InsightsResult> {
  const rangeLabel = (params.rangeLabel || "").trim();
  const fetched = await fetchDealerNotes(params.startISO, params.endISO);
  const truncated = fetched.length > MAX_NOTES;
  const notes = fetched.slice(0, MAX_NOTES);

  if (!notes.length) {
    return {
      noteCount: 0,
      truncated: false,
      rangeLabel,
      model: INSIGHTS_MODEL,
      report: null,
      message: "No notes in selected range.",
    };
  }

  const enriched = await enrichNotesWithDealers(notes);
  const formattedNotes = formatNotesForAi(enriched);
  const userContent = buildInsightsPrompt({
    rangeLabel,
    startISO: params.startISO,
    endISO: params.endISO,
    noteCount: notes.length,
    truncated,
    formattedNotes,
  });
  const parsed = await callOpenAIForInsights(userContent);

  return {
    noteCount: notes.length,
    truncated,
    rangeLabel,
    model: INSIGHTS_MODEL,
    report: normalizeInsightsReport(parsed),
  };
}
