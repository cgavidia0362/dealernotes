// /api/weekly-report-preview.ts
// Admin-only preview of the weekly email. Same path as the test email. Does not send or schedule.
import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { buildWeeklyActivityReport } from "./_lib/weeklyActivity.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "./_lib/types.js";

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

    const result = await buildWeeklyActivityReport();
    if (!result.notes.length) {
      return res.status(400).json({
        error: "No notes in this week’s reporting window.",
        reportingWindow: result.window,
        noteCount: 0,
        format: "week-at-a-glance+rep-activity",
      });
    }

    return res.status(200).json({
      format: "week-at-a-glance+rep-activity",
      subject: result.email.subject,
      html: result.email.html,
      text: result.email.text,
      reportingWindow: result.window,
      noteCount: result.counts.noteCount,
      repCount: result.counts.repCount,
      dealerCount: result.counts.dealerCount,
      truncated: result.truncated,
      schedulingActive: false,
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
