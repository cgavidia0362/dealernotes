// /api/weekly-report-test-email.ts
// Admin-only manual send of the current weekly report to WEEKLY_REPORT_TEST_EMAIL.
import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { generateInsightsFromNotes } from "./_lib/insights.js";
import { loadNotesForRange } from "./_lib/notes.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "./_lib/types.js";
import { getWeeklyReportingRange } from "./_lib/weeklyRange.js";
import { renderWeeklyReportEmail } from "./_lib/weeklyReportEmail.js";

export const config = { maxDuration: 60 };

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new HttpError(500, `${name} is not configured.`);
  return value;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /<[^@\s]+@[^@\s]+\.[^@\s]+>/.test(value);
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const resendKey = requiredEnv("RESEND_API_KEY");
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

    const window = getWeeklyReportingRange();
    const loaded = await loadNotesForRange(window.startISO, window.endISO);
    const result = await generateInsightsFromNotes({
      notes: loaded.notes,
      truncated: loaded.truncated,
      startISO: window.startISO,
      endISO: window.endISO,
      rangeLabel: window.rangeLabel,
    });

    if (!loaded.notes.length || !result.report) {
      return res.status(400).json({
        error: result.message || "No notes in this week’s reporting window.",
      });
    }

    const email = renderWeeklyReportEmail({
      window,
      glance: result.report.snapshot,
      notes: loaded.notes,
    });

    const payload: Record<string, unknown> = {
      from,
      to: [testTo],
      subject: email.subject,
      html: email.html,
      text: email.text,
    };
    if (replyTo) payload.reply_to = replyTo;

    const sendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!sendResp.ok) {
      return res.status(502).json({ error: "Email provider failed. Check Resend configuration." });
    }

    return res.status(200).json({
      ok: true,
      message: "Test email sent successfully.",
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
