// /api/weekly-report-send.ts
// Admin-only manual production send to saved recipient_emails. No scheduler.
import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { looksLikeEmail, requiredEnv, sendResendEmail } from "./_lib/resendWeekly.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "./_lib/types.js";
import { buildWeeklyActivityReport } from "./_lib/weeklyActivity.js";
import { loadWeeklyReportSettings, productionRecipients, productionReplyTo } from "./_lib/weeklyReportSettings.js";

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({ error: "Confirmation is required to send the weekly report." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const from = requiredEnv("WEEKLY_REPORT_FROM_EMAIL");
    if (!looksLikeEmail(from)) {
      return res.status(500).json({ error: "WEEKLY_REPORT_FROM_EMAIL is not a valid email address." });
    }

    const settings = await loadWeeklyReportSettings();
    const to = productionRecipients(settings);
    const replyTo = productionReplyTo(settings);

    const result = await buildWeeklyActivityReport();
    if (!result.notes.length) {
      return res.status(400).json({
        error: "No notes in this week’s reporting window.",
        reportingWindow: result.window,
      });
    }

    await sendResendEmail({
      from,
      to,
      replyTo,
      subject: result.email.subject,
      html: result.email.html,
      text: result.email.text,
    });

    return res.status(200).json({
      ok: true,
      format: "week-at-a-glance+rep-activity",
      message: `Weekly report sent to ${to.length} ${to.length === 1 ? "recipient" : "recipients"}.`,
      recipientCount: to.length,
      reportingWindow: result.window,
      noteCount: result.counts.noteCount,
      schedulingActive: false,
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.details || {}) });
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON body." });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
