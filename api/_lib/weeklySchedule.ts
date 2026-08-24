import type { WeeklyReportSettings } from "./weeklyReportSettings.js";
import {
  addCalendarDays,
  daysSinceWeekStart,
  parseSendTime,
  zoneParts,
  zonedLocalToUtc,
} from "./weeklyRange.js";

/** Hobby cron is daily, so grace must cover one 24h gap plus hourly slop. */
export const DUE_GRACE_MS = 26 * 60 * 60 * 1000;
export const STALE_SENDING_MS = 10 * 60 * 1000;

export type ScheduleSettings = Pick<WeeklyReportSettings, "sendDay" | "sendTime" | "timezone" | "enabled">;

/** Most recent send_day + send_time in the saved timezone, including today's slot. */
export function getLatestSlotScheduledFor(settings: ScheduleSettings, now: Date = new Date()): Date {
  const timezone = settings.timezone || "America/Chicago";
  const parts = zoneParts(now, timezone);
  const since = daysSinceWeekStart(parts.weekday, settings.sendDay || "Saturday");
  const sendCal = addCalendarDays(parts.year, parts.month, parts.day, -since);
  const clock = parseSendTime(settings.sendTime);
  return zonedLocalToUtc(sendCal.year, sendCal.month, sendCal.day, clock.hour, clock.minute, 0, timezone);
}

export function getNextScheduledFor(
  settings: ScheduleSettings,
  now: Date = new Date(),
  latestSlotSent = false
): Date | null {
  if (!settings.enabled) return null;
  const latest = getLatestSlotScheduledFor(settings, now);
  if (latest.getTime() > now.getTime()) return latest;
  if (!latestSlotSent && isReportDue(latest, now)) return latest;
  return new Date(latest.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export function isReportDue(scheduledFor: Date, now: Date = new Date()): boolean {
  const t = now.getTime();
  const s = scheduledFor.getTime();
  return t >= s && t < s + DUE_GRACE_MS;
}

export function canRetryFailed(scheduledFor: Date, now: Date = new Date()): boolean {
  return isReportDue(scheduledFor, now);
}
