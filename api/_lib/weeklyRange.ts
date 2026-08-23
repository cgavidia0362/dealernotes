import type { WeeklyReportingWindow } from "./types.js";

export const REPORTING_TIMEZONE = "America/Chicago" as const;

type ZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

const WEEKDAY_TO_OFFSET: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function zoneParts(date: Date, timeZone: string): ZoneParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday,
  };
}

/** Offset of `timeZone` at `instant`: localClock - UTC, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = zoneOffsetMs(new Date(utcGuess), timeZone);
  const corrected = new Date(utcGuess - offset1);
  const offset2 = zoneOffsetMs(corrected, timeZone);
  return new Date(utcGuess - offset2);
}

function addCalendarDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function formatLocalStamp(p: { year: number; month: number; day: number; hour?: number; minute?: number }): string {
  const h = p.hour ?? 0;
  const m = p.minute ?? 0;
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(h)}:${pad2(m)}`;
}

/**
 * Weekly window in America/Chicago: Monday 00:00 through `now` (exclusive upper bound).
 * Intended generation time is Saturday; preview may be called any day this week.
 */
export function getWeeklyReportingRange(now: Date = new Date()): WeeklyReportingWindow {
  const chicagoNow = zoneParts(now, REPORTING_TIMEZONE);
  const daysSinceMonday = WEEKDAY_TO_OFFSET[chicagoNow.weekday] ?? 0;
  const monday = addCalendarDays(chicagoNow.year, chicagoNow.month, chicagoNow.day, -daysSinceMonday);
  const start = zonedLocalToUtc(monday.year, monday.month, monday.day, 0, 0, 0, REPORTING_TIMEZONE);

  return {
    timezone: REPORTING_TIMEZONE,
    startISO: start.toISOString(),
    endISO: now.toISOString(),
    startLocal: `${monday.year}-${pad2(monday.month)}-${pad2(monday.day)} 00:00`,
    endLocal: formatLocalStamp(chicagoNow),
    rangeLabel: `${monday.year}-${pad2(monday.month)}-${pad2(monday.day)} – ${chicagoNow.year}-${pad2(chicagoNow.month)}-${pad2(chicagoNow.day)} (${REPORTING_TIMEZONE})`,
  };
}
