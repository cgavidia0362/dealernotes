// /api/weekly-report-test-email.ts
// Admin-only manual send of the current weekly report to WEEKLY_REPORT_TEST_EMAIL.
import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { looksLikeEmail, requiredEnv, sendResendEmail } from "./_lib/resendWeekly.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "./_lib/types.js";
import { buildWeeklyActivityReport } from "./_lib/weeklyActivity.js";

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const testTo = requiredEnv("WEEKLY_REPORT_TEST_EMAIL");
    const from = requiredEnv("WEEKLY_REPORT_FROM_EMAIL");
    const replyTo = String(process.env.WEEKLY_REPORT_REPLY_TO || "").trim();

    if (!looksLikeEmail(testTo)) {
      return res.status(500).json({ error: "WEEKLY_REPORT_TEST_EMAIL is not a valid email address." });
    }
    if (!looksLikeEmail(from)) {
      return res.status(500).json({ error: "WEEKLY_REPORT_FROM_EMAIL is not a valid email address." });
    }
    if (replyTo && !looksLikeEmail(replyTo)) {
      return res.status(500).json({ error: "WEEKLY_REPORT_REPLY_TO is not a valid email address." });
    }

    const result = await buildWeeklyActivityReport();
    if (!result.notes.length) {
      return res.status(400).json({
        error: "No notes in this reporting window.",
      });
    }

    await sendResendEmail({
      from,
      to: [testTo],
      replyTo: replyTo || null,
      subject: result.email.subject,
      html: result.email.html,
      text: result.email.text,
    });

    return res.status(200).json({
      ok: true,
      format: "week-at-a-glance+rep-activity",
      message: "Test email sent successfully.",
      reportingWindow: result.window,
      noteCount: result.counts.noteCount,
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.details || {}) });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
