import { listRecentRuns, latestSentAt, hasScheduledSent, type WeeklyReportRun } from "./weeklyReportRuns.js";
import type { WeeklyReportSettings } from "./weeklyReportSettings.js";
import { getLatestSlotScheduledFor, getNextScheduledFor } from "./weeklySchedule.js";

export type PublicRun = {
  id: string;
  source: WeeklyReportRun["source"];
  status: WeeklyReportRun["status"];
  scheduledFor: string;
  sentAt: string | null;
  recipientCount: number | null;
  errorMessage: string | null;
};

export type ScheduleStatus = {
  schedulingActive: true;
  lastSent: string | null;
  nextScheduled: string | null;
  recentRuns: PublicRun[];
};

function toPublicRun(run: WeeklyReportRun): PublicRun {
  return {
    id: run.id,
    source: run.source,
    status: run.status,
    scheduledFor: run.scheduledFor,
    sentAt: run.sentAt,
    recipientCount: run.recipientCount,
    errorMessage: run.errorMessage,
  };
}

export async function loadScheduleStatus(settings: WeeklyReportSettings): Promise<ScheduleStatus> {
  const now = new Date();
  try {
    const latest = getLatestSlotScheduledFor(settings, now);
    const [lastSent, recentRuns, latestSlotSent] = await Promise.all([
      latestSentAt(),
      listRecentRuns(8),
      hasScheduledSent(latest),
    ]);
    const next = getNextScheduledFor(settings, now, latestSlotSent);
    return {
      schedulingActive: true,
      lastSent,
      nextScheduled: next ? next.toISOString() : null,
      recentRuns: recentRuns.map(toPublicRun),
    };
  } catch {
    const next = getNextScheduledFor(settings, now, false);
    return {
      schedulingActive: true,
      lastSent: null,
      nextScheduled: next ? next.toISOString() : null,
      recentRuns: [],
    };
  }
}
