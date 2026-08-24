import { HttpError } from "./types.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { canRetryFailed, STALE_SENDING_MS } from "./weeklySchedule.js";

export type RunSource = "scheduled" | "manual";
export type RunStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type WeeklyReportRun = {
  id: string;
  source: RunSource;
  status: RunStatus;
  frequency: string | null;
  rangeType: string | null;
  subject: string | null;
  reportStart: string | null;
  reportEnd: string | null;
  scheduledFor: string;
  startedAt: string | null;
  sentAt: string | null;
  recipientCount: number | null;
  resendMessageId: string | null;
  errorMessage: string | null;
  createdAt: string | null;
};

type RunRow = {
  id: string;
  source: string;
  status: string;
  frequency?: string | null;
  range_type?: string | null;
  subject?: string | null;
  report_start: string | null;
  report_end: string | null;
  scheduled_for: string;
  started_at: string | null;
  sent_at: string | null;
  recipient_count: number | null;
  resend_message_id: string | null;
  error_message: string | null;
  created_at: string | null;
};

function mapRun(row: RunRow): WeeklyReportRun {
  return {
    id: String(row.id),
    source: row.source === "manual" ? "manual" : "scheduled",
    status: (row.status as RunStatus) || "pending",
    frequency: row.frequency ? String(row.frequency) : null,
    rangeType: row.range_type ? String(row.range_type) : null,
    subject: row.subject ? String(row.subject) : null,
    reportStart: row.report_start,
    reportEnd: row.report_end,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    sentAt: row.sent_at,
    recipientCount: row.recipient_count,
    resendMessageId: row.resend_message_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function tableMissing(error: { message?: string; code?: string } | null): boolean {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || (msg.includes("weekly_report_runs") && msg.includes("does not exist"));
}

function throwIfMissing(error: { message?: string; code?: string } | null, fallback: string): never {
  if (tableMissing(error)) {
    throw new HttpError(500, "weekly_report_runs table is missing. Run the SQL migration in supabase/migrations.");
  }
  throw new HttpError(500, fallback);
}

export async function listRecentRuns(limit = 8): Promise<WeeklyReportRun[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("weekly_report_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (tableMissing(error)) return [];
    throw new HttpError(500, "Could not load weekly report runs.");
  }
  return (data || []).map((row) => mapRun(row as RunRow));
}

export async function latestSentAt(): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("weekly_report_runs")
    .select("sent_at")
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return null;
    throw new HttpError(500, "Could not load last sent time.");
  }
  return data?.sent_at ? String(data.sent_at) : null;
}

export async function findScheduledRun(scheduledFor: Date): Promise<WeeklyReportRun | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("weekly_report_runs")
    .select("*")
    .eq("source", "scheduled")
    .eq("scheduled_for", scheduledFor.toISOString())
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return null;
    throwIfMissing(error, "Could not load scheduled run.");
  }
  return data ? mapRun(data as RunRow) : null;
}

export async function hasScheduledSent(scheduledFor: Date): Promise<boolean> {
  const existing = await findScheduledRun(scheduledFor);
  return existing?.status === "sent";
}

/** Atomically claim the scheduled slot, or reuse a failed/stale row for retry. */
export async function claimScheduledRun(opts: {
  scheduledFor: Date;
  reportStart?: string | null;
  reportEnd?: string | null;
  frequency?: string | null;
  rangeType?: string | null;
}): Promise<{ run: WeeklyReportRun; action: "claimed" | "skipped" }> {
  const supabaseAdmin = getSupabaseAdmin();
  const scheduledIso = opts.scheduledFor.toISOString();
  const nowIso = new Date().toISOString();

  const insert = await supabaseAdmin
    .from("weekly_report_runs")
    .insert({
      source: "scheduled",
      status: "sending",
      scheduled_for: scheduledIso,
      started_at: nowIso,
      report_start: opts.reportStart || null,
      report_end: opts.reportEnd || null,
      frequency: opts.frequency || null,
      range_type: opts.rangeType || null,
    })
    .select("*")
    .maybeSingle();

  if (!insert.error && insert.data) {
    return { run: mapRun(insert.data as RunRow), action: "claimed" };
  }

  const conflict =
    insert.error?.code === "23505" ||
    String(insert.error?.message || "").toLowerCase().includes("duplicate") ||
    String(insert.error?.message || "").toLowerCase().includes("unique");

  if (insert.error && !conflict) {
    throwIfMissing(insert.error, "Could not claim scheduled run.");
  }

  const existing = await findScheduledRun(opts.scheduledFor);
  if (!existing) throw new HttpError(500, "Could not claim scheduled run.");
  if (existing.status === "sent") return { run: existing, action: "skipped" };
  if (existing.status === "skipped") return { run: existing, action: "skipped" };

  if (!canRetryFailed(opts.scheduledFor)) return { run: existing, action: "skipped" };

  let retry = supabaseAdmin
    .from("weekly_report_runs")
    .update({
      status: "sending",
      started_at: nowIso,
      error_message: null,
      report_start: opts.reportStart || existing.reportStart,
      report_end: opts.reportEnd || existing.reportEnd,
    })
    .eq("id", existing.id);

  if (existing.status === "sending") {
    const started = existing.startedAt ? new Date(existing.startedAt).getTime() : 0;
    if (Date.now() - started < STALE_SENDING_MS) return { run: existing, action: "skipped" };
    retry = retry.eq("status", "sending").lt("started_at", new Date(Date.now() - STALE_SENDING_MS).toISOString());
  } else if (existing.status === "failed" || existing.status === "pending") {
    retry = retry.in("status", ["failed", "pending"]);
  } else {
    return { run: existing, action: "skipped" };
  }

  const { data, error } = await retry.select("*").maybeSingle();

  if (error) throwIfMissing(error, "Could not retry scheduled run.");
  if (!data) return { run: existing, action: "skipped" };
  return { run: mapRun(data as RunRow), action: "claimed" };
}

export async function markRunSent(
  id: string,
  opts: {
    recipientCount: number;
    resendMessageId?: string | null;
    reportStart?: string | null;
    reportEnd?: string | null;
    subject?: string | null;
  }
) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("weekly_report_runs")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      recipient_count: opts.recipientCount,
      resend_message_id: opts.resendMessageId || null,
      error_message: null,
      ...(opts.reportStart ? { report_start: opts.reportStart } : {}),
      ...(opts.reportEnd ? { report_end: opts.reportEnd } : {}),
      ...(opts.subject ? { subject: opts.subject } : {}),
    })
    .eq("id", id);
  if (error) throwIfMissing(error, "Could not update run as sent.");
}

export async function markRunSkipped(id: string, message: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("weekly_report_runs")
    .update({
      status: "skipped",
      error_message: String(message || "Skipped.").slice(0, 500),
    })
    .eq("id", id);
  if (error) throwIfMissing(error, "Could not update run as skipped.");
}

export async function markRunFailed(id: string, message: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("weekly_report_runs")
    .update({
      status: "failed",
      error_message: String(message || "Send failed.").slice(0, 500),
    })
    .eq("id", id);
  if (error) throwIfMissing(error, "Could not update run as failed.");
}

export async function recordManualRun(opts: {
  status: "sent" | "failed";
  scheduledFor?: Date;
  reportStart?: string | null;
  reportEnd?: string | null;
  recipientCount?: number | null;
  resendMessageId?: string | null;
  errorMessage?: string | null;
  frequency?: string | null;
  rangeType?: string | null;
  subject?: string | null;
}): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const now = new Date();
  const { error } = await supabaseAdmin.from("weekly_report_runs").insert({
    source: "manual",
    status: opts.status,
    scheduled_for: (opts.scheduledFor || now).toISOString(),
    started_at: now.toISOString(),
    sent_at: opts.status === "sent" ? now.toISOString() : null,
    report_start: opts.reportStart || null,
    report_end: opts.reportEnd || null,
    recipient_count: opts.recipientCount ?? null,
    resend_message_id: opts.resendMessageId || null,
    error_message: opts.errorMessage ? String(opts.errorMessage).slice(0, 500) : null,
    frequency: opts.frequency || "manual",
    range_type: opts.rangeType || null,
    subject: opts.subject || null,
  });
  if (error && !tableMissing(error)) {
    console.error("[weekly-report] could not record manual run");
  }
}
