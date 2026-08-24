import { HttpError } from "./types.js";
import type { WeeklyReportingWindow } from "./types.js";
import { addCalendarDays, zoneParts } from "./weeklyRange.js";

export const DEFAULT_SUBJECT_TEMPLATE = "Dealer Note Report — {startDate} to {endDate}";
export const MAX_SUBJECT_LENGTH = 180;

const UNSAFE_SUBJECT = /[<>]|javascript:|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i;

export function frequencyLabel(frequency: string): string {
  if (frequency === "daily") return "Daily";
  if (frequency === "monthly") return "Monthly";
  if (frequency === "manual") return "Manual";
  return "Weekly";
}

export function parseSubjectTemplate(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) throw new HttpError(400, "Subject is required.");
  if (raw.length > MAX_SUBJECT_LENGTH) {
    throw new HttpError(400, `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer.`);
  }
  if (UNSAFE_SUBJECT.test(raw)) {
    throw new HttpError(400, "Subject cannot contain HTML or script content.");
  }
  return raw;
}

function formatShortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** Inclusive last calendar day for an exclusive end bound. */
export function inclusiveEndIso(window: WeeklyReportingWindow): string {
  const timeZone = window.timezone || "America/Chicago";
  const endParts = zoneParts(new Date(window.endISO), timeZone);
  if (endParts.hour === 0 && endParts.minute === 0 && endParts.second === 0) {
    const prev = addCalendarDays(endParts.year, endParts.month, endParts.day, -1);
    const prevUtc = Date.UTC(prev.year, prev.month - 1, prev.day, 12, 0, 0);
    return new Date(prevUtc).toISOString();
  }
  return window.endISO;
}

export function renderSubjectTemplate(
  template: string,
  opts: {
    window: WeeklyReportingWindow;
    frequency: string;
    reportAt?: Date;
  }
): string {
  const parsed = parseSubjectTemplate(template);
  const timeZone = opts.window.timezone || "America/Chicago";
  const reportAt = opts.reportAt || new Date();
  const startDate = formatShortDate(opts.window.startISO, timeZone);
  const endDate = formatShortDate(inclusiveEndIso(opts.window), timeZone);
  const reportDate = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(reportAt);
  const rendered = parsed
    .replace(/\{startDate\}/g, startDate)
    .replace(/\{endDate\}/g, endDate)
    .replace(/\{reportDate\}/g, reportDate)
    .replace(/\{frequency\}/g, frequencyLabel(opts.frequency));
  const cleaned = rendered.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new HttpError(400, "Subject is empty after placeholders are filled.");
  if (cleaned.length > MAX_SUBJECT_LENGTH) return cleaned.slice(0, MAX_SUBJECT_LENGTH).trim();
  if (UNSAFE_SUBJECT.test(cleaned)) {
    throw new HttpError(400, "Subject cannot contain HTML or script content.");
  }
  return cleaned;
}
