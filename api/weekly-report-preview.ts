// /api/weekly-report-preview.ts
// Admin-only preview of the weekly insights report. Does not send email or schedule.
import { getBearerToken, requireAdmin } from "../lib/server/authAdmin";
import { generateInsightsReport, INSIGHTS_MODEL } from "../lib/server/insights";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "../lib/server/types";
import { getWeeklyReportingRange } from "../lib/server/weeklyRange";

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    const window = getWeeklyReportingRange();
    const result = await generateInsightsReport({
      startISO: window.startISO,
      endISO: window.endISO,
      rangeLabel: window.rangeLabel,
    });

    return res.status(200).json({
      reportingWindow: window,
      report: result.report,
      noteCount: result.noteCount,
      model: result.model || INSIGHTS_MODEL,
      truncated: result.truncated,
      ...(result.message ? { message: result.message } : {}),
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
