import { HttpError } from "./types.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { DEFAULT_SUBJECT_TEMPLATE, parseSubjectTemplate } from "./reportSubject.js";

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const FREQUENCIES = ["manual", "daily", "weekly", "monthly"] as const;

export const RANGE_TYPES = [
  "today_to_send",
  "previous_day",
  "last_24_hours",
  "week_to_send",
  "last_7_days",
  "custom_weekly",
  "previous_month",
  "month_to_date",
  "last_30_days",
] as const;

const RANGE_BY_FREQUENCY: Record<(typeof FREQUENCIES)[number], readonly string[]> = {
  manual: RANGE_TYPES,
  daily: ["today_to_send", "previous_day", "last_24_hours"],
  weekly: ["week_to_send", "last_7_days", "custom_weekly"],
  monthly: ["previous_month", "month_to_date", "last_30_days"],
};

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
export type Frequency = (typeof FREQUENCIES)[number];
export type RangeType = (typeof RANGE_TYPES)[number];
export type AllowedTimezone = (typeof TIMEZONES)[number];

export type WeeklyReportSettings = {
  id: number;
  enabled: boolean;
  frequency: Frequency;
  subjectTemplate: string;
  sendDay: Weekday;
  sendTime: string;
  sendDayOfMonth: number;
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
  frequency?: string | null;
  subject_template?: string | null;
  send_day: string;
  send_time: string;
  send_day_of_month?: number | null;
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

function isFrequency(v: unknown): v is Frequency {
  return typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);
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

export function parseRecipientList(incoming: unknown): string[] {
  const list = Array.isArray(incoming) ? incoming : [];
  if (list.length > MAX_RECIPIENTS) {
    throw new HttpError(400, `A maximum of ${MAX_RECIPIENTS} recipients is allowed.`);
  }
  const recipientEmails: string[] = [];
  for (const item of list) {
    const email = normalizeEmail(String(item || ""));
    if (!email) continue;
    if (!isValidEmail(email)) throw new HttpError(400, `Invalid recipient email: ${email}`);
    if (!recipientEmails.includes(email)) recipientEmails.push(email);
  }
  return recipientEmails;
}

function parseSendDayOfMonth(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new HttpError(400, "sendDayOfMonth must be a whole number from 1 to 31.");
  }
  return n;
}

function mapRow(row: SettingsRow): WeeklyReportSettings {
  return {
    id: Number(row.id) || 1,
    enabled: !!row.enabled,
    frequency: isFrequency(row.frequency) ? row.frequency : "weekly",
    subjectTemplate: String(row.subject_template || "").trim() || DEFAULT_SUBJECT_TEMPLATE,
    sendDay: isWeekday(row.send_day) ? row.send_day : "Saturday",
    sendTime: TIME_RE.test(String(row.send_time || "")) ? String(row.send_time) : "09:00",
    sendDayOfMonth:
      typeof row.send_day_of_month === "number" && row.send_day_of_month >= 1 && row.send_day_of_month <= 31
        ? row.send_day_of_month
        : 1,
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
    frequency: "weekly",
    subjectTemplate: DEFAULT_SUBJECT_TEMPLATE,
    sendDay: "Saturday",
    sendTime: "09:00",
    sendDayOfMonth: 1,
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

export type SettingsInput = Omit<WeeklyReportSettings, "id" | "createdAt" | "updatedAt">;

export function parseSettingsInput(body: unknown): SettingsInput {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const enabled = raw.enabled === true;
  const frequency = isFrequency(raw.frequency) ? raw.frequency : "weekly";

  if (!isWeekday(raw.sendDay)) throw new HttpError(400, "sendDay must be a valid weekday.");
  const rawTime = String(raw.sendTime || "").trim();
  const timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(rawTime);
  const sendTime = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : rawTime;
  if (!TIME_RE.test(sendTime)) throw new HttpError(400, "sendTime must be HH:MM in 24-hour format.");
  if (!isTimezone(raw.timezone)) throw new HttpError(400, "timezone is not supported.");
  if (!isRangeType(raw.rangeType)) throw new HttpError(400, "rangeType is not supported.");
  if (raw.rangeType === "custom_weekly") {
    throw new HttpError(
      400,
      "Custom weekly range is not supported yet. Choose Start of week through send time or Last 7 days."
    );
  }
  const allowedRanges = RANGE_BY_FREQUENCY[frequency];
  if (frequency !== "manual" && !allowedRanges.includes(raw.rangeType)) {
    throw new HttpError(400, "Reporting range does not match the selected frequency.");
  }
  if (!isWeekday(raw.rangeStartDay)) throw new HttpError(400, "rangeStartDay must be a valid weekday.");

  const recipientEmails = parseRecipientList(raw.recipientEmails);
  const replyToEmail = normalizeEmail(String(raw.replyToEmail || ""));
  if (replyToEmail && !isValidEmail(replyToEmail)) {
    throw new HttpError(400, "replyToEmail is not a valid email address.");
  }

  return {
    enabled,
    frequency,
    subjectTemplate: parseSubjectTemplate(raw.subjectTemplate ?? DEFAULT_SUBJECT_TEMPLATE),
    sendDay: raw.sendDay,
    sendTime,
    sendDayOfMonth: parseSendDayOfMonth(raw.sendDayOfMonth ?? 1),
    timezone: raw.timezone,
    rangeType: raw.rangeType,
    rangeStartDay: raw.rangeStartDay,
    recipientEmails,
    replyToEmail,
  };
}

function rowPayload(input: SettingsInput) {
  return {
    id: 1,
    enabled: input.enabled,
    frequency: input.frequency,
    subject_template: input.subjectTemplate,
    send_day: input.sendDay,
    send_time: input.sendTime,
    send_day_of_month: input.sendDayOfMonth,
    timezone: input.timezone,
    range_type: input.rangeType,
    range_start_day: input.rangeStartDay,
    recipient_emails: input.recipientEmails,
    reply_to_email: input.replyToEmail || null,
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
    .insert(rowPayload(seed))
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

export async function saveWeeklyReportSettings(input: SettingsInput): Promise<WeeklyReportSettings> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("weekly_report_settings")
    .upsert(rowPayload(input), { onConflict: "id" })
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

export function productionRecipients(settings: WeeklyReportSettings): string[] {
  const emails = parseRecipientList(settings.recipientEmails);
  if (!emails.length) {
    throw new HttpError(400, "Add at least one valid recipient before sending the report.");
  }
  return emails;
}

export function productionReplyTo(settings: WeeklyReportSettings): string | null {
  const email = normalizeEmail(settings.replyToEmail || "");
  if (!email) return null;
  if (!isValidEmail(email)) throw new HttpError(400, "Saved Reply-To is not a valid email address.");
  return email;
}
