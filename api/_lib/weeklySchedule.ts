import type { WeeklyReportSettings } from "./weeklyReportSettings.js";
import {
  addCalendarDays,
  addCalendarMonths,
  clampDayOfMonth,
  daysSinceWeekStart,
  parseSendTime,
  zoneParts,
  zonedLocalToUtc,
} from "./weeklyRange.js";

/** Retry window for a claimed slot. Unique scheduled_for still prevents duplicates. */
export const DUE_GRACE_MS = 26 * 60 * 60 * 1000;
export const STALE_SENDING_MS = 10 * 60 * 1000;

export type ScheduleSettings = Pick<
  WeeklyReportSettings,
  "sendDay" | "sendTime" | "timezone" | "enabled" | "frequency" | "sendDayOfMonth"
>;

function clockFor(settings: ScheduleSettings) {
  return parseSendTime(settings.sendTime);
}

function dailySlot(settings: ScheduleSettings, now: Date): Date {
  const timezone = settings.timezone || "America/Chicago";
  const parts = zoneParts(now, timezone);
  const clock = clockFor(settings);
  return zonedLocalToUtc(parts.year, parts.month, parts.day, clock.hour, clock.minute, 0, timezone);
}

function weeklySlot(settings: ScheduleSettings, now: Date): Date {
  const timezone = settings.timezone || "America/Chicago";
  const parts = zoneParts(now, timezone);
  const since = daysSinceWeekStart(parts.weekday, settings.sendDay || "Saturday");
  const sendCal = addCalendarDays(parts.year, parts.month, parts.day, -since);
  const clock = clockFor(settings);
  return zonedLocalToUtc(sendCal.year, sendCal.month, sendCal.day, clock.hour, clock.minute, 0, timezone);
}

function monthlySlot(settings: ScheduleSettings, now: Date): Date {
  const timezone = settings.timezone || "America/Chicago";
  const parts = zoneParts(now, timezone);
  const clock = clockFor(settings);
  const requested = settings.sendDayOfMonth || 1;
  const thisDay = clampDayOfMonth(parts.year, parts.month, requested);
  const thisSlot = zonedLocalToUtc(parts.year, parts.month, thisDay, clock.hour, clock.minute, 0, timezone);
  if (thisSlot.getTime() > now.getTime() && thisDay !== parts.day) {
    const prev = addCalendarMonths(parts.year, parts.month, -1);
    const prevDay = clampDayOfMonth(prev.year, prev.month, requested);
    return zonedLocalToUtc(prev.year, prev.month, prevDay, clock.hour, clock.minute, 0, timezone);
  }
  return thisSlot;
}

/** Most recent send slot in the saved timezone for the current frequency. */
export function getLatestSlotScheduledFor(settings: ScheduleSettings, now: Date = new Date()): Date {
  if (settings.frequency === "daily") return dailySlot(settings, now);
  if (settings.frequency === "monthly") return monthlySlot(settings, now);
  return weeklySlot(settings, now);
}

function nextAfter(settings: ScheduleSettings, latest: Date): Date {
  const timezone = settings.timezone || "America/Chicago";
  const clock = clockFor(settings);
  const parts = zoneParts(latest, timezone);
  if (settings.frequency === "daily") {
    const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
    return zonedLocalToUtc(next.year, next.month, next.day, clock.hour, clock.minute, 0, timezone);
  }
  if (settings.frequency === "monthly") {
    const next = addCalendarMonths(parts.year, parts.month, 1);
    const day = clampDayOfMonth(next.year, next.month, settings.sendDayOfMonth || 1);
    return zonedLocalToUtc(next.year, next.month, day, clock.hour, clock.minute, 0, timezone);
  }
  return new Date(latest.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export function getNextScheduledFor(
  settings: ScheduleSettings,
  now: Date = new Date(),
  latestSlotSent = false
): Date | null {
  if (!settings.enabled) return null;
  if (settings.frequency === "manual") return null;
  const latest = getLatestSlotScheduledFor(settings, now);
  if (latest.getTime() > now.getTime()) return latest;
  if (!latestSlotSent && isReportDue(latest, now)) return latest;
  return nextAfter(settings, latest);
}

export function isReportDue(scheduledFor: Date, now: Date = new Date()): boolean {
  const t = now.getTime();
  const s = scheduledFor.getTime();
  return t >= s && t < s + DUE_GRACE_MS;
}

export function canRetryFailed(scheduledFor: Date, now: Date = new Date()): boolean {
  return isReportDue(scheduledFor, now);
}
