import { HttpError } from "./types.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const RANGE_TYPES = ["week_to_send", "last_7_days", "custom_weekly"] as const;

export const TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "UTC",
] as const;

export const MAX_RECIPIENTS = 30;

export type Weekday = (typeof WEEKDAYS)[number];
export type RangeType = (typeof RANGE_TYPES)[number];
export type AllowedTimezone = (typeof TIMEZONES)[number];

export type WeeklyReportSettings = {
  id: number;
  enabled: boolean;
  sendDay: Weekday;
  sendTime: string;
  timezone: AllowedTimezone;
  rangeType: RangeType;
  rangeStartDay: Weekday;
  recipientEmails: string[];
  replyToEmail: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type SettingsRow = {
  id: number;
  enabled: boolean;
  send_day: string;
  send_time: string;
  timezone: string;
  range_type: string;
  range_start_day: string;
  recipient_emails: string[] | null;
  reply_to_email: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isWeekday(v: unknown): v is Weekday {
  return typeof v === "string" && (WEEKDAYS as readonly string[]).includes(v);
}

function isRangeType(v: unknown): v is RangeType {
  return typeof v === "string" && (RANGE_TYPES as readonly string[]).includes(v);
}

function isTimezone(v: unknown): v is AllowedTimezone {
  return typeof v === "string" && (TIMEZONES as readonly string[]).includes(v);
}

export function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(normalizeEmail(value));
}

function mapRow(row: SettingsRow): WeeklyReportSettings {
  return {
    id: Number(row.id) || 1,
    enabled: !!row.enabled,
    sendDay: isWeekday(row.send_day) ? row.send_day : "Saturday",
    sendTime: TIME_RE.test(String(row.send_time || "")) ? String(row.send_time) : "09:00",
    timezone: isTimezone(row.timezone) ? row.timezone : "America/Chicago",
    rangeType: isRangeType(row.range_type) ? row.range_type : "week_to_send",
    rangeStartDay: isWeekday(row.range_start_day) ? row.range_start_day : "Monday",
    recipientEmails: Array.isArray(row.recipient_emails)
      ? row.recipient_emails.map(normalizeEmail).filter(isValidEmail)
      : [],
    replyToEmail: row.reply_to_email ? normalizeEmail(row.reply_to_email) : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultSettings(): WeeklyReportSettings {
  return {
    id: 1,
    enabled: false,
    sendDay: "Saturday",
    sendTime: "09:00",
    timezone: "America/Chicago",
    rangeType: "week_to_send",
    rangeStartDay: "Monday",
    recipientEmails: [],
    replyToEmail: "",
    createdAt: null,
    updatedAt: null,
  };
}

function tableMissing(error: { message?: string; code?: string } | null): boolean {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || (msg.includes("weekly_report_settings") && msg.includes("does not exist"));
}

export function parseSettingsInput(body: unknown): Omit<WeeklyReportSettings, "id" | "createdAt" | "updatedAt"> {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const enabled = raw.enabled === true;

  if (!isWeekday(raw.sendDay)) throw new HttpError(400, "sendDay must be a valid weekday.");
  const rawTime = String(raw.sendTime || "").trim();
  const timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(rawTime);
  const sendTime = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : rawTime;
  if (!TIME_RE.test(sendTime)) throw new HttpError(400, "sendTime must be HH:MM in 24-hour format.");
  if (!isTimezone(raw.timezone)) throw new HttpError(400, "timezone is not supported.");
  if (!isRangeType(raw.rangeType)) throw new HttpError(400, "rangeType is not supported.");
  if (!isWeekday(raw.rangeStartDay)) throw new HttpError(400, "rangeStartDay must be a valid weekday.");

  const incoming = Array.isArray(raw.recipientEmails) ? raw.recipientEmails : [];
  if (incoming.length > MAX_RECIPIENTS) {
    throw new HttpError(400, `A maximum of ${MAX_RECIPIENTS} recipients is allowed.`);
  }
  const recipientEmails: string[] = [];
  for (const item of incoming) {
    const email = normalizeEmail(String(item || ""));
    if (!email) continue;
    if (!isValidEmail(email)) throw new HttpError(400, `Invalid recipient email: ${email}`);
    if (!recipientEmails.includes(email)) recipientEmails.push(email);
  }

  const replyToEmail = normalizeEmail(String(raw.replyToEmail || ""));
  if (replyToEmail && !isValidEmail(replyToEmail)) {
    throw new HttpError(400, "replyToEmail is not a valid email address.");
  }

  return {
    enabled,
    sendDay: raw.sendDay,
    sendTime,
    timezone: raw.timezone,
    rangeType: raw.rangeType,
    rangeStartDay: raw.rangeStartDay,
    recipientEmails,
    replyToEmail,
  };
}

export async function loadWeeklyReportSettings(): Promise<WeeklyReportSettings> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("weekly_report_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    if (tableMissing(error)) {
      throw new HttpError(500, "weekly_report_settings table is missing. Run the SQL migration in supabase/migrations.");
    }
    throw new HttpError(500, "Could not load weekly report settings.");
  }
  if (data) return mapRow(data as SettingsRow);

  const seed = defaultSettings();
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("weekly_report_settings")
    .insert({
      id: 1,
      enabled: seed.enabled,
      send_day: seed.sendDay,
      send_time: seed.sendTime,
      timezone: seed.timezone,
      range_type: seed.rangeType,
      range_start_day: seed.rangeStartDay,
      recipient_emails: seed.recipientEmails,
      reply_to_email: null,
    })
    .select("*")
    .single();

  if (insertErr) {
    if (tableMissing(insertErr)) {
      throw new HttpError(500, "weekly_report_settings table is missing. Run the SQL migration in supabase/migrations.");
    }
    throw new HttpError(500, "Could not create weekly report settings.");
  }
  return mapRow(inserted as SettingsRow);
}

export async function saveWeeklyReportSettings(
  input: Omit<WeeklyReportSettings, "id" | "createdAt" | "updatedAt">
): Promise<WeeklyReportSettings> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("weekly_report_settings")
    .upsert(
      {
        id: 1,
        enabled: input.enabled,
        send_day: input.sendDay,
        send_time: input.sendTime,
        timezone: input.timezone,
        range_type: input.rangeType,
        range_start_day: input.rangeStartDay,
        recipient_emails: input.recipientEmails,
        reply_to_email: input.replyToEmail || null,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) {
    if (tableMissing(error)) {
      throw new HttpError(500, "weekly_report_settings table is missing. Run the SQL migration in supabase/migrations.");
    }
    throw new HttpError(500, "Could not save weekly report settings.");
  }
  return mapRow(data as SettingsRow);
}
