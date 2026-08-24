// /api/cron/weekly-report
// Platform scheduler. Auth is CRON_SECRET, not an Admin session.
import { looksLikeEmail, requiredEnv, sendResendEmail } from "../_lib/resendWeekly.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "../_lib/types.js";
import { buildWeeklyActivityReport } from "../_lib/weeklyActivity.js";
import { claimScheduledRun, markRunFailed, markRunSent, markRunSkipped } from "../_lib/weeklyReportRuns.js";
import { loadWeeklyReportSettings, productionRecipients, productionReplyTo } from "../_lib/weeklyReportSettings.js";
import { getLatestSlotScheduledFor, isReportDue } from "../_lib/weeklySchedule.js";

export const config = { maxDuration: 60 };

function cronAuthorized(req: any): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) throw new HttpError(500, "CRON_SECRET is not configured.");
  const header = String(req.headers?.authorization || req.headers?.Authorization || "");
  return header === `Bearer ${secret}`;
}

function safeErrorMessage(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof InsightsTimeoutError || e instanceof InsightsModelError) return e.message;
  if (e instanceof Error && e.message) return e.message.slice(0, 300);
  return "Scheduled send failed.";
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!cronAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const settings = await loadWeeklyReportSettings();
    if (!settings.enabled) {
      return res.status(200).json({ ok: true, skipped: true, reason: "disabled" });
    }

    const now = new Date();
    const scheduledFor = getLatestSlotScheduledFor(settings, now);
    if (!isReportDue(scheduledFor, now)) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "not_due",
        scheduledFor: scheduledFor.toISOString(),
      });
    }

    const claimed = await claimScheduledRun({ scheduledFor });
    if (claimed.action === "skipped") {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: claimed.run.status === "sent" ? "already_sent" : claimed.run.status,
        runId: claimed.run.id,
        scheduledFor: scheduledFor.toISOString(),
      });
    }

    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new HttpError(500, "OPENAI_API_KEY is not configured.");
      }
      const from = requiredEnv("WEEKLY_REPORT_FROM_EMAIL");
      if (!looksLikeEmail(from)) {
        throw new HttpError(500, "WEEKLY_REPORT_FROM_EMAIL is not a valid email address.");
      }

      const to = productionRecipients(settings);
      const replyTo = productionReplyTo(settings);
      const result = await buildWeeklyActivityReport({ asOf: scheduledFor });

      if (!result.notes.length) {
        await markRunSkipped(claimed.run.id, "No notes in this week’s reporting window.");
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: "no_notes",
          runId: claimed.run.id,
          scheduledFor: scheduledFor.toISOString(),
          reportingWindow: result.window,
        });
      }

      const sent = await sendResendEmail({
        from,
        to,
        replyTo,
        subject: result.email.subject,
        html: result.email.html,
        text: result.email.text,
      });

      await markRunSent(claimed.run.id, {
        recipientCount: to.length,
        resendMessageId: sent.id,
        reportStart: result.window.startISO,
        reportEnd: result.window.endISO,
      });

      return res.status(200).json({
        ok: true,
        sent: true,
        runId: claimed.run.id,
        recipientCount: to.length,
        scheduledFor: scheduledFor.toISOString(),
        reportingWindow: result.window,
        noteCount: result.counts.noteCount,
      });
    } catch (e: unknown) {
      const message = safeErrorMessage(e);
      await markRunFailed(claimed.run.id, message);
      if (e instanceof HttpError) return res.status(e.status).json({ error: message, runId: claimed.run.id });
      if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: message, runId: claimed.run.id });
      if (e instanceof InsightsModelError) return res.status(502).json({ error: message, runId: claimed.run.id });
      return res.status(500).json({ error: message, runId: claimed.run.id });
    }
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
