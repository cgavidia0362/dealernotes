// /api/ai-insights.ts
// Admin-only, on-demand market insights over dealer_notes in a date range.
import { getBearerToken, requireAdmin } from "../lib/server/authAdmin";
import { generateInsightsReport, INSIGHTS_MODEL } from "../lib/server/insights";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "../lib/server/types";

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const startISO = String(body.startISO || "").trim();
    const endISO = String(body.endISO || "").trim();
    const rangeLabel = String(body.rangeLabel || "").trim();

    if (!startISO || !endISO || Number.isNaN(Date.parse(startISO)) || Number.isNaN(Date.parse(endISO))) {
      return res.status(400).json({ error: "Valid startISO and endISO required" });
    }
    if (Date.parse(endISO) <= Date.parse(startISO)) {
      return res.status(400).json({ error: "endISO must be after startISO" });
    }

    const result = await generateInsightsReport({ startISO, endISO, rangeLabel });

    if (!result.report) {
      return res.status(200).json({
        noteCount: 0,
        truncated: false,
        rangeLabel,
        report: null,
        message: result.message || "No notes in selected range.",
      });
    }

    return res.status(200).json({
      noteCount: result.noteCount,
      truncated: result.truncated,
      rangeLabel,
      model: result.model || INSIGHTS_MODEL,
      report: result.report,
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
