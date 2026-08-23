import { HttpError, type WeeklyReportingWindow } from "./types.js";

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

const LONG_WEEKDAY_TO_SHORT: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

export type ReportingWindowSettings = {
  rangeType: string;
  rangeStartDay: string;
  sendDay: string;
  sendTime: string;
  timezone: string;
};

function daysSinceWeekStart(currentShort: string, startDay: string): number {
  const current = WEEKDAY_TO_OFFSET[currentShort] ?? 0;
  const startShort = LONG_WEEKDAY_TO_SHORT[startDay] || "Mon";
  const start = WEEKDAY_TO_OFFSET[startShort] ?? 0;
  return (current - start + 7) % 7;
}

function parseSendTime(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  const hour = m ? Number(m[1]) : 9;
  const minute = m ? Number(m[2]) : 0;
  return {
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute: Number.isFinite(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

function assertTimezone(timezone: string): string {
  const tz = String(timezone || "").trim();
  if (!tz) throw new HttpError(400, "timezone is required.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new HttpError(400, "timezone is not a valid IANA timezone.");
  }
  return tz;
}

function makeWindow(
  timezone: string,
  start: Date,
  end: Date,
  startLocal: string,
  endLocal: string
): WeeklyReportingWindow {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new HttpError(400, "Could not calculate the reporting window start.");
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw new HttpError(400, "Could not calculate the reporting window end.");
  }
  if (end.getTime() <= start.getTime()) {
    throw new HttpError(400, "Reporting window is invalid: end must be after start.");
  }
  return {
    timezone,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startLocal,
    endLocal,
    rangeLabel: `${startLocal} – ${endLocal} (${timezone})`,
  };
}

/**
 * Weekly window in America/Chicago: Monday 00:00 through `now`.
 * Kept as the default fallback when settings are unavailable.
 */
export function getWeeklyReportingRange(now: Date = new Date()): WeeklyReportingWindow {
  const chicagoNow = zoneParts(now, REPORTING_TIMEZONE);
  const daysSinceMonday = WEEKDAY_TO_OFFSET[chicagoNow.weekday] ?? 0;
  const monday = addCalendarDays(chicagoNow.year, chicagoNow.month, chicagoNow.day, -daysSinceMonday);
  const start = zonedLocalToUtc(monday.year, monday.month, monday.day, 0, 0, 0, REPORTING_TIMEZONE);

  return makeWindow(
    REPORTING_TIMEZONE,
    start,
    now,
    `${monday.year}-${pad2(monday.month)}-${pad2(monday.day)} 00:00`,
    formatLocalStamp(chicagoNow)
  );
}

/**
 * Reporting window from saved automation settings.
 * Boundaries are computed in the saved timezone, then stored as UTC ISO.
 * endISO is an exclusive upper bound for note queries.
 *
 * week_to_send: range_start_day 00:00 through current send time, or through
 * this week's scheduled send day/time if that moment has already passed.
 * last_7_days: previous seven days ending at the current send time.
 * custom_weekly: not supported until a dedicated end weekday is stored.
 */
export function getReportingWindowFromSettings(
  settings: ReportingWindowSettings,
  now: Date = new Date()
): WeeklyReportingWindow {
  const timezone = assertTimezone(settings.timezone);
  const nowParts = zoneParts(now, timezone);

  if (settings.rangeType === "custom_weekly") {
    throw new HttpError(
      400,
      "Custom weekly range is not supported yet. It needs a dedicated end weekday, which is not stored. Use Start of week through send time or Last 7 days."
    );
  }

  if (settings.rangeType === "last_7_days") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startParts = zoneParts(start, timezone);
    return makeWindow(timezone, start, now, formatLocalStamp(startParts), formatLocalStamp(nowParts));
  }

  if (settings.rangeType !== "week_to_send") {
    throw new HttpError(400, "rangeType is not supported.");
  }

  const startOffset = daysSinceWeekStart(nowParts.weekday, settings.rangeStartDay || "Monday");
  const startCal = addCalendarDays(nowParts.year, nowParts.month, nowParts.day, -startOffset);
  const start = zonedLocalToUtc(startCal.year, startCal.month, startCal.day, 0, 0, 0, timezone);

  const sendOffset = daysSinceWeekStart(nowParts.weekday, settings.sendDay || "Saturday");
  const sendCal = addCalendarDays(nowParts.year, nowParts.month, nowParts.day, -sendOffset);
  const sendClock = parseSendTime(settings.sendTime);
  const sendAt = zonedLocalToUtc(sendCal.year, sendCal.month, sendCal.day, sendClock.hour, sendClock.minute, 0, timezone);

  let end = now;
  if (sendAt.getTime() >= start.getTime() && sendAt.getTime() <= now.getTime()) {
    end = sendAt;
  }

  const endParts = zoneParts(end, timezone);
  return makeWindow(
    timezone,
    start,
    end,
    `${startCal.year}-${pad2(startCal.month)}-${pad2(startCal.day)} 00:00`,
    formatLocalStamp(endParts)
  );
}
