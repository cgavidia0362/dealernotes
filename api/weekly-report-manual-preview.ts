// /api/weekly-report-manual-preview.ts
// Admin-only preview of a custom-date report. Does not send or change saved recipients.
import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { parseManualReportInput } from "./_lib/manualReport.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "./_lib/types.js";
import { buildWeeklyActivityReport } from "./_lib/weeklyActivity.js";
import { loadWeeklyReportSettings } from "./_lib/weeklyReportSettings.js";

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
    const settings = await loadWeeklyReportSettings();
    const parsed = parseManualReportInput(body, settings, { requireRecipients: false });
    const result = await buildWeeklyActivityReport({
      window: parsed.window,
      subjectTemplate: parsed.subjectTemplate,
      frequency: "manual",
    });
    if (!result.notes.length) {
      return res.status(400).json({
        error: "No notes in this reporting window.",
        reportingWindow: result.window,
        subject: result.email.subject,
        noteCount: 0,
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
      recipientCount: parsed.to.length,
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON body." });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
