import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

type ToastKind = "success" | "error";
type Frequency = "manual" | "daily" | "weekly" | "monthly";
type RangeType =
  | "today_to_send"
  | "previous_day"
  | "last_24_hours"
  | "week_to_send"
  | "last_7_days"
  | "custom_weekly"
  | "previous_month"
  | "month_to_date"
  | "last_30_days";

type WeeklyReportSettings = {
  enabled: boolean;
  frequency: Frequency;
  subjectTemplate: string;
  sendDay: string;
  sendTime: string;
  sendDayOfMonth: number;
  timezone: string;
  rangeType: RangeType;
  rangeStartDay: string;
  recipientEmails: string[];
  replyToEmail: string;
};

type RecentRun = {
  id: string;
  source: "scheduled" | "manual";
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  frequency: string | null;
  rangeType: string | null;
  scheduledFor: string;
  sentAt: string | null;
  reportStart: string | null;
  reportEnd: string | null;
  recipientCount: number | null;
  errorMessage: string | null;
};

type EmailPreview = {
  subject: string;
  html: string;
  noteCount: number;
  repCount: number;
  dealerCount: number;
  rangeLabel: string;
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "UTC",
];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 30;
const MAX_SUBJECT = 180;
const DEFAULT_SUBJECT = "Dealer Note Report — {startDate} to {endDate}";

function normalizeTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
  if (!m) return value;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function defaultRange(frequency: Frequency): RangeType {
  if (frequency === "daily") return "today_to_send";
  if (frequency === "monthly") return "previous_month";
  return "week_to_send";
}

const emptySettings = (): WeeklyReportSettings => ({
  enabled: false,
  frequency: "weekly",
  subjectTemplate: DEFAULT_SUBJECT,
  sendDay: "Saturday",
  sendTime: "09:00",
  sendDayOfMonth: 1,
  timezone: "America/Chicago",
  rangeType: "week_to_send",
  rangeStartDay: "Monday",
  recipientEmails: [],
  replyToEmail: "",
});

async function authHeader(): Promise<HeadersInit | null> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function ymdInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatWhen(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  const zone = timeZone || "America/Chicago";
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${datePart} at ${timePart}`;
}

function statusLabel(status: RecentRun["status"]): string {
  if (status === "sent") return "Sent";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "sending") return "Sending";
  return "Pending";
}

function frequencyLabel(value: string | null | undefined): string {
  if (value === "daily") return "Daily";
  if (value === "monthly") return "Monthly";
  if (value === "manual") return "Manual";
  if (value === "weekly") return "Weekly";
  return "";
}

function rangeLabel(rangeType: string, rangeStartDay?: string): string {
  if (rangeType === "today_to_send") return "Today through send time";
  if (rangeType === "previous_day") return "Previous completed day";
  if (rangeType === "last_24_hours") return "Last 24 hours";
  if (rangeType === "last_7_days") return "Last 7 days";
  if (rangeType === "previous_month") return "Previous completed month";
  if (rangeType === "month_to_date") return "Month to date through send time";
  if (rangeType === "last_30_days") return "Last 30 days";
  if (rangeType === "custom" || rangeType === "custom_range") return "Custom dates";
  if (rangeType === "custom_weekly") return `Custom week starting ${rangeStartDay || "Monday"}`;
  if (rangeType === "week_to_send") return `${rangeStartDay || "Monday"} through send time`;
  return rangeType || "";
}

function PreviewFrame({
  title,
  previewing,
  preview,
  previewError,
  emptyHint,
  onRefresh,
  refreshLabel,
}: {
  title: string;
  previewing: boolean;
  preview: EmailPreview | null;
  previewError: string;
  emptyHint: string;
  onRefresh: () => void;
  refreshLabel: string;
}) {
  return (
    <div className="rounded-xl border bg-slate-100 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500 break-words">
            {preview
              ? [preview.subject, preview.rangeLabel, `${preview.noteCount} notes`].filter(Boolean).join(" · ")
              : emptyHint}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 bg-white"
          onClick={onRefresh}
          disabled={previewing}
        >
          {previewing ? "Refreshing…" : refreshLabel}
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {previewing && !preview && <div className="p-6 text-sm text-slate-500">Building the email preview…</div>}
        {!previewing && previewError && !preview && <div className="p-6 text-sm text-slate-600">{previewError}</div>}
        {!previewing && !preview && !previewError && <div className="p-6 text-sm text-slate-500">{emptyHint}</div>}
        {preview?.html && (
          <iframe
            title={title}
            sandbox=""
            srcDoc={preview.html}
            className="w-full bg-white block"
            style={{ height: "min(78vh, 920px)", border: 0 }}
          />
        )}
      </div>
    </div>
  );
}

export function EmailAutomationView({
  showToast,
}: {
  showToast: (m: string, k?: ToastKind) => void;
}) {
  const [settings, setSettings] = useState<WeeklyReportSettings>(emptySettings());
  const [fromEmail, setFromEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [savedRecipientCount, setSavedRecipientCount] = useState(0);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [nextScheduled, setNextScheduled] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);

  const [manualFrom, setManualFrom] = useState("");
  const [manualTo, setManualTo] = useState("");
  const [manualSubject, setManualSubject] = useState(DEFAULT_SUBJECT);
  const [manualUseSaved, setManualUseSaved] = useState(true);
  const [manualRecipients, setManualRecipients] = useState<string[]>([]);
  const [manualDraft, setManualDraft] = useState("");
  const [manualPreviewing, setManualPreviewing] = useState(false);
  const [manualPreview, setManualPreview] = useState<EmailPreview | null>(null);
  const [manualPreviewError, setManualPreviewError] = useState("");
  const [manualSending, setManualSending] = useState(false);
  const [confirmManual, setConfirmManual] = useState(false);

  const applySettingsPayload = (json: any) => {
    if (json.settings) setSettings({ ...emptySettings(), ...json.settings });
    if (json.fromEmail !== undefined) setFromEmail(String(json.fromEmail || ""));
    if ("lastSent" in json) setLastSent(json.lastSent || null);
    if ("nextScheduled" in json) setNextScheduled(json.nextScheduled || null);
    if (Array.isArray(json.recentRuns)) setRecentRuns(json.recentRuns);
    if (Array.isArray(json.settings?.recipientEmails)) {
      setSavedRecipientCount(json.settings.recipientEmails.length);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeader();
        if (!headers) {
          showToast("Please log in again.", "error");
          return;
        }
        const resp = await fetch("/api/weekly-report-settings", { headers });
        const json = await resp.json().catch(() => ({} as any));
        if (!resp.ok) {
          showToast(json?.error || "Could not load email settings.", "error");
          return;
        }
        if (cancelled) return;
        applySettingsPayload(json);
        const tz = String(json.settings?.timezone || "America/Chicago");
        const today = ymdInZone(new Date(), tz);
        const weekAgo = ymdInZone(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), tz);
        setManualFrom(weekAgo);
        setManualTo(today);
        setManualSubject(String(json.settings?.subjectTemplate || DEFAULT_SUBJECT));
      } catch (e: any) {
        if (!cancelled) showToast(e?.message || "Could not load email settings.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStatus = async () => {
    const headers = await authHeader();
    if (!headers) return;
    const resp = await fetch("/api/weekly-report-settings", { headers });
    const json = await resp.json().catch(() => ({} as any));
    if (resp.ok) applySettingsPayload(json);
  };

  const isManualFrequency = settings.frequency === "manual";
  const statusLine = useMemo(() => {
    const on = settings.enabled && !isManualFrequency ? "Automation Enabled" : "Automation Disabled";
    const freq = frequencyLabel(settings.frequency);
    if (settings.frequency === "daily") return `${on} · ${freq} at ${settings.sendTime} · ${settings.timezone}`;
    if (settings.frequency === "monthly") {
      return `${on} · ${freq} on day ${settings.sendDayOfMonth} at ${settings.sendTime} · ${settings.timezone}`;
    }
    if (settings.frequency === "manual") return `${on} · Manual only · ${settings.timezone}`;
    return `${on} · ${freq} ${settings.sendDay} at ${settings.sendTime} · ${settings.timezone}`;
  }, [settings, isManualFrequency]);

  const lastSentLabel = lastSent ? formatWhen(lastSent, settings.timezone) : "Never";
  const nextScheduledLabel =
    !settings.enabled || isManualFrequency
      ? "Disabled"
      : nextScheduled
        ? formatWhen(nextScheduled, settings.timezone)
        : "Disabled";

  const addToList = (
    list: string[],
    draft: string,
    setList: (next: string[]) => void,
    setDraft: (v: string) => void
  ) => {
    const email = draft.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      showToast("Enter a valid email address.", "error");
      return;
    }
    if (list.includes(email)) {
      showToast("That recipient is already on the list.", "error");
      return;
    }
    if (list.length >= MAX_RECIPIENTS) {
      showToast(`A maximum of ${MAX_RECIPIENTS} recipients is allowed.`, "error");
      return;
    }
    setList([...list, email]);
    setDraft("");
  };

  const refreshPreview = async (opts?: { quiet?: boolean }) => {
    setPreviewing(true);
    setPreviewError("");
    try {
      const headers = await authHeader();
      if (!headers) {
        showToast("Please log in again.", "error");
        return;
      }
      const resp = await fetch("/api/weekly-report-preview", { method: "POST", headers });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        const msg = json?.error || "Preview failed.";
        setPreview(null);
        setPreviewError(msg);
        if (!opts?.quiet) showToast(msg, "error");
        return;
      }
      setPreview({
        subject: String(json.subject || "Dealer Note Report"),
        html: String(json.html || ""),
        noteCount: Number(json.noteCount) || 0,
        repCount: Number(json.repCount) || 0,
        dealerCount: Number(json.dealerCount) || 0,
        rangeLabel: String(json.reportingWindow?.rangeLabel || ""),
      });
    } catch (e: any) {
      const msg = e?.message || "Preview failed.";
      setPreview(null);
      setPreviewError(msg);
      if (!opts?.quiet) showToast(msg, "error");
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (settings.replyToEmail && !EMAIL_RE.test(settings.replyToEmail.trim().toLowerCase())) {
      showToast("Reply-To must be a valid email address.", "error");
      return;
    }
    if (!settings.subjectTemplate.trim()) {
      showToast("Subject is required.", "error");
      return;
    }
    setSaving(true);
    try {
      const headers = await authHeader();
      if (!headers) {
        showToast("Please log in again.", "error");
        return;
      }
      const resp = await fetch("/api/weekly-report-settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ...settings,
          sendTime: normalizeTime(settings.sendTime),
          replyToEmail: settings.replyToEmail.trim().toLowerCase(),
          subjectTemplate: settings.subjectTemplate.trim(),
        }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        showToast(json?.error || "Could not save settings.", "error");
        return;
      }
      applySettingsPayload(json);
      showToast(json?.message || "Settings saved.", "success");
      if (json.settings?.frequency !== "manual") await refreshPreview({ quiet: true });
    } catch (e: any) {
      showToast(e?.message || "Could not save settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  const sendTestEmail = async () => {
    setSendingTest(true);
    try {
      const headers = await authHeader();
      if (!headers) {
        showToast("Please log in again.", "error");
        return;
      }
      const resp = await fetch("/api/weekly-report-test-email", { method: "POST", headers });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        showToast(json?.error || "Test email failed.", "error");
        return;
      }
      showToast(json?.message || "Test email sent successfully.", "success");
    } catch (e: any) {
      showToast(e?.message || "Test email failed.", "error");
    } finally {
      setSendingTest(false);
    }
  };

  const sendReportNow = async () => {
    setSendingNow(true);
    try {
      const headers = await authHeader();
      if (!headers) {
        showToast("Please log in again.", "error");
        return;
      }
      const resp = await fetch("/api/weekly-report-send", {
        method: "POST",
        headers,
        body: JSON.stringify({ confirm: true }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        showToast(json?.error || "Could not send the report.", "error");
        return;
      }
      setConfirmSend(false);
      showToast(json?.message || "Report sent.", "success");
      await refreshStatus();
    } catch (e: any) {
      showToast(e?.message || "Could not send the report.", "error");
    } finally {
      setSendingNow(false);
    }
  };

  const manualRecipientCount = manualUseSaved ? savedRecipientCount : manualRecipients.length;

  const previewManual = async (opts?: { quiet?: boolean }) => {
    setManualPreviewing(true);
    setManualPreviewError("");
    try {
      const headers = await authHeader();
      if (!headers) {
        showToast("Please log in again.", "error");
        return;
      }
      const resp = await fetch("/api/weekly-report-manual-preview", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fromDate: manualFrom,
          toDate: manualTo,
          subject: manualSubject.trim() || DEFAULT_SUBJECT,
          useSavedRecipients: manualUseSaved,
          recipientEmails: manualUseSaved ? undefined : manualRecipients,
        }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        const msg = json?.error || "Manual preview failed.";
        setManualPreview(null);
        setManualPreviewError(msg);
        if (!opts?.quiet) showToast(msg, "error");
        return;
      }
      setManualPreview({
        subject: String(json.subject || "Dealer Note Report"),
        html: String(json.html || ""),
        noteCount: Number(json.noteCount) || 0,
        repCount: Number(json.repCount) || 0,
        dealerCount: Number(json.dealerCount) || 0,
        rangeLabel: String(json.reportingWindow?.rangeLabel || ""),
      });
    } catch (e: any) {
      const msg = e?.message || "Manual preview failed.";
      setManualPreview(null);
      setManualPreviewError(msg);
      if (!opts?.quiet) showToast(msg, "error");
    } finally {
      setManualPreviewing(false);
    }
  };

  const sendManual = async () => {
    setManualSending(true);
    try {
      const headers = await authHeader();
      if (!headers) {
        showToast("Please log in again.", "error");
        return;
      }
      const resp = await fetch("/api/weekly-report-manual-send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          confirm: true,
          fromDate: manualFrom,
          toDate: manualTo,
          subject: manualSubject.trim() || DEFAULT_SUBJECT,
          useSavedRecipients: manualUseSaved,
          recipientEmails: manualUseSaved ? undefined : manualRecipients,
        }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        showToast(json?.error || "Could not send the manual report.", "error");
        return;
      }
      setConfirmManual(false);
      showToast(json?.message || "Manual report sent.", "success");
      await refreshStatus();
    } catch (e: any) {
      showToast(e?.message || "Could not send the manual report.", "error");
    } finally {
      setManualSending(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-slate-500">Loading email settings…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-semibold text-slate-800">Email Automation</div>
        <div className="text-sm text-slate-500 mt-1">
          Control scheduled and manual Dealer Note reports. Automatic sending follows the frequency and schedule you save.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border bg-white p-4 space-y-2">
            <div className="text-sm font-semibold text-slate-800">Automation status</div>
            <div className="text-sm text-slate-700">{statusLine}</div>
            <div className="text-sm text-slate-600">
              {settings.recipientEmails.length} {settings.recipientEmails.length === 1 ? "recipient" : "recipients"} ·{" "}
              {rangeLabel(settings.rangeType, settings.rangeStartDay)}
            </div>
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 space-y-1">
              <div>Last sent: {lastSentLabel}</div>
              <div>Next scheduled: {nextScheduledLabel}</div>
              {settings.enabled && !isManualFrequency ? (
                <div className="text-slate-500">Automatic sending is on. The scheduler checks about every 5 minutes.</div>
              ) : (
                <div className="text-slate-500">
                  {isManualFrequency ? "Frequency is Manual, so nothing is sent automatically." : "Automatic sending is disabled."}
                </div>
              )}
            </div>
            <label className="flex items-center gap-3 text-sm text-slate-700 pt-1">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={settings.enabled}
                onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
              />
              Automatic Reports Enabled
            </label>
          </section>

          <section className="rounded-xl border bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800">Frequency</div>
            <select
              className="w-full border rounded-lg px-2 py-2 text-sm"
              value={settings.frequency}
              onChange={(e) => {
                const frequency = e.target.value as Frequency;
                setSettings((s) => ({ ...s, frequency, rangeType: defaultRange(frequency) }));
              }}
            >
              <option value="manual">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </section>

          <section className="rounded-xl border bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800">Schedule</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {settings.frequency === "weekly" && (
                <label className="block text-sm">
                  <div className="text-xs text-slate-500 mb-1">Day</div>
                  <select
                    className="w-full border rounded-lg px-2 py-2"
                    value={settings.sendDay}
                    onChange={(e) => setSettings((s) => ({ ...s, sendDay: e.target.value }))}
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {settings.frequency === "monthly" && (
                <label className="block text-sm">
                  <div className="text-xs text-slate-500 mb-1">Day of month</div>
                  <select
                    className="w-full border rounded-lg px-2 py-2"
                    value={settings.sendDayOfMonth}
                    onChange={(e) => setSettings((s) => ({ ...s, sendDayOfMonth: Number(e.target.value) }))}
                  >
                    {MONTH_DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {settings.frequency !== "manual" && (
                <label className="block text-sm">
                  <div className="text-xs text-slate-500 mb-1">Time</div>
                  <input
                    type="time"
                    className="w-full border rounded-lg px-2 py-2"
                    value={settings.sendTime}
                    step={60}
                    onChange={(e) => setSettings((s) => ({ ...s, sendTime: normalizeTime(e.target.value) }))}
                  />
                </label>
              )}
              <label className="block text-sm">
                <div className="text-xs text-slate-500 mb-1">Timezone</div>
                <select
                  className="w-full border rounded-lg px-2 py-2"
                  value={settings.timezone}
                  onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                >
                  {TIMEZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {settings.frequency === "monthly" && (
              <div className="text-xs text-slate-500">
                If you choose 31 and a month has fewer days, the report sends on the last day of that month.
              </div>
            )}
            {isManualFrequency && (
              <div className="text-xs text-slate-500">Timezone is used for Manual Report dates and previews.</div>
            )}
          </section>

          {!isManualFrequency && (
            <section className="rounded-xl border bg-white p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-800">Reporting range</div>
              <label className="block text-sm">
                <div className="text-xs text-slate-500 mb-1">Window</div>
                <select
                  className="w-full border rounded-lg px-2 py-2"
                  value={settings.rangeType}
                  onChange={(e) => setSettings((s) => ({ ...s, rangeType: e.target.value as RangeType }))}
                >
                  {settings.frequency === "daily" && (
                    <>
                      <option value="today_to_send">Today through send time</option>
                      <option value="previous_day">Previous completed day</option>
                      <option value="last_24_hours">Last 24 hours</option>
                    </>
                  )}
                  {settings.frequency === "weekly" && (
                    <>
                      <option value="week_to_send">Start of week through send time</option>
                      <option value="last_7_days">Last 7 days</option>
                      <option value="custom_weekly" disabled>
                        Custom weekly range (not yet supported)
                      </option>
                    </>
                  )}
                  {settings.frequency === "monthly" && (
                    <>
                      <option value="previous_month">Previous completed calendar month</option>
                      <option value="month_to_date">Month to date through send time</option>
                      <option value="last_30_days">Last 30 days</option>
                    </>
                  )}
                </select>
              </label>
              {settings.frequency === "weekly" && settings.rangeType === "week_to_send" && (
                <label className="block text-sm">
                  <div className="text-xs text-slate-500 mb-1">Week starts on</div>
                  <select
                    className="w-full border rounded-lg px-2 py-2"
                    value={settings.rangeStartDay}
                    onChange={(e) => setSettings((s) => ({ ...s, rangeStartDay: e.target.value }))}
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>
          )}

          <section className="rounded-xl border bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800">Subject</div>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              maxLength={MAX_SUBJECT}
              value={settings.subjectTemplate}
              onChange={(e) => setSettings((s) => ({ ...s, subjectTemplate: e.target.value }))}
            />
            <div className="text-xs text-slate-500">
              Placeholders: {"{startDate}"}, {"{endDate}"}, {"{reportDate}"}, {"{frequency}"}. Preview shows the filled-in subject.
            </div>
          </section>

          <section className="rounded-xl border bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800">Recipients</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="name@company.com"
                value={recipientDraft}
                onChange={(e) => setRecipientDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addToList(settings.recipientEmails, recipientDraft, (next) => setSettings((s) => ({ ...s, recipientEmails: next })), setRecipientDraft);
                  }
                }}
              />
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm hover:bg-slate-50"
                onClick={() =>
                  addToList(settings.recipientEmails, recipientDraft, (next) => setSettings((s) => ({ ...s, recipientEmails: next })), setRecipientDraft)
                }
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {settings.recipientEmails.length === 0 && <div className="text-sm text-slate-500">No recipients yet.</div>}
              {settings.recipientEmails.map((email) => (
                <span key={email} className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 text-sm px-3 py-1">
                  {email}
                  <button
                    type="button"
                    className="text-slate-500 hover:text-slate-800"
                    onClick={() => setSettings((s) => ({ ...s, recipientEmails: s.recipientEmails.filter((x) => x !== email) }))}
                    aria-label={`Remove ${email}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-xl border bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800">Reply-To</div>
            <input
              type="email"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="you@gmail.com"
              value={settings.replyToEmail}
              onChange={(e) => setSettings((s) => ({ ...s, replyToEmail: e.target.value }))}
            />
            <div className="text-xs text-slate-500">Optional. Used for scheduled sends, Send Report Now, and Manual Report.</div>
          </section>

          <section className="rounded-xl border bg-white p-4 space-y-1">
            <div className="text-sm font-semibold text-slate-800">Sender</div>
            <div className="text-sm text-slate-700">{fromEmail ? `Sender: ${fromEmail}` : "Sender: Configured by system"}</div>
            <div className="text-xs text-slate-500">The From address is set on the server and cannot be changed here.</div>
          </section>

          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Settings"}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg text-sm font-medium border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
              onClick={() => refreshPreview()}
              disabled={previewing}
            >
              {previewing ? "Refreshing…" : "Refresh Preview"}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-400 text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              onClick={sendTestEmail}
              disabled={sendingTest || sendingNow || manualSending}
            >
              {sendingTest ? "Sending…" : "Send Test Email"}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-60"
              onClick={() => setConfirmSend(true)}
              disabled={sendingTest || sendingNow || savedRecipientCount === 0 || isManualFrequency}
            >
              Send Report Now
            </button>
          </div>
          <div className="text-xs text-slate-500">
            {isManualFrequency
              ? "Send Report Now is turned off for Manual frequency. Use Manual Report below for custom dates."
              : "Send Report Now uses the saved schedule, range, subject, recipients, and Reply-To. It does not block the next scheduled send. Send Test Email goes only to the configured test inbox."}
          </div>
        </div>

        <aside className="min-w-0 md:sticky md:top-20">
          <PreviewFrame
            title="Scheduled Report Preview"
            previewing={previewing}
            preview={preview}
            previewError={previewError}
            emptyHint="Click Refresh Preview to see the saved scheduled report. This uses the last saved settings and does not send anything."
            onRefresh={() => refreshPreview()}
            refreshLabel="Refresh Preview"
          />
        </aside>
      </div>

      <section className="rounded-xl border bg-white p-4 space-y-4">
        <div>
          <div className="text-sm font-semibold text-slate-800">Manual Report</div>
          <div className="text-xs text-slate-500 mt-1">
            Send a one-off report for any date range. Temporary recipients are not saved to the scheduled recipient list.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <div className="text-xs text-slate-500 mb-1">From date</div>
            <input type="date" className="w-full border rounded-lg px-2 py-2" value={manualFrom} onChange={(e) => setManualFrom(e.target.value)} />
          </label>
          <label className="block text-sm">
            <div className="text-xs text-slate-500 mb-1">To date</div>
            <input type="date" className="w-full border rounded-lg px-2 py-2" value={manualTo} onChange={(e) => setManualTo(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          <div className="text-xs text-slate-500 mb-1">Subject</div>
          <input
            type="text"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            maxLength={MAX_SUBJECT}
            value={manualSubject}
            onChange={(e) => setManualSubject(e.target.value)}
          />
        </label>
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Recipients</div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" checked={manualUseSaved} onChange={() => setManualUseSaved(true)} />
            Use saved recipients ({savedRecipientCount})
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" checked={!manualUseSaved} onChange={() => setManualUseSaved(false)} />
            Temporary list
          </label>
          {!manualUseSaved && (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="name@company.com"
                  value={manualDraft}
                  onChange={(e) => setManualDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addToList(manualRecipients, manualDraft, setManualRecipients, setManualDraft);
                    }
                  }}
                />
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm hover:bg-slate-50"
                  onClick={() => addToList(manualRecipients, manualDraft, setManualRecipients, setManualDraft)}
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {manualRecipients.length === 0 && <div className="text-sm text-slate-500">No temporary recipients yet.</div>}
                {manualRecipients.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 text-sm px-3 py-1">
                    {email}
                    <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => setManualRecipients((list) => list.filter((x) => x !== email))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded-lg text-sm font-medium border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
            onClick={() => previewManual()}
            disabled={manualPreviewing}
          >
            {manualPreviewing ? "Refreshing…" : "Preview Manual Report"}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-60"
            onClick={() => setConfirmManual(true)}
            disabled={manualSending || manualRecipientCount === 0}
          >
            Send Manual Report
          </button>
        </div>
        <PreviewFrame
          title="Manual Report Preview"
          previewing={manualPreviewing}
          preview={manualPreview}
          previewError={manualPreviewError}
          emptyHint="Click Preview Manual Report to build this custom date range. It does not change saved settings."
          onRefresh={() => previewManual()}
          refreshLabel="Preview Manual Report"
        />
      </section>

      {recentRuns.length > 0 && (
        <section className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-semibold text-slate-800">Recent activity</div>
          <div className="divide-y divide-slate-100">
            {recentRuns.slice(0, 8).map((run) => (
              <div key={run.id} className="py-2 first:pt-0 last:pb-0 text-xs text-slate-600 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-slate-800">{statusLabel(run.status)}</span>
                  <span>·</span>
                  <span>{run.source === "manual" ? "Manual" : "Scheduled"}</span>
                  {frequencyLabel(run.frequency) && (
                    <>
                      <span>·</span>
                      <span>{frequencyLabel(run.frequency)}</span>
                    </>
                  )}
                  {run.recipientCount != null && (
                    <>
                      <span>·</span>
                      <span>
                        {run.recipientCount} {run.recipientCount === 1 ? "recipient" : "recipients"}
                      </span>
                    </>
                  )}
                </div>
                {run.rangeType && <div>Range: {rangeLabel(run.rangeType, settings.rangeStartDay)}</div>}
                <div>Scheduled: {formatWhen(run.scheduledFor, settings.timezone)}</div>
                {run.sentAt && <div>Sent: {formatWhen(run.sentAt, settings.timezone)}</div>}
                {run.status === "failed" && run.errorMessage && <div className="text-red-700">{run.errorMessage}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {confirmSend && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => !sendingNow && setConfirmSend(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5 space-y-4">
              <div className="text-lg font-semibold text-slate-800">Send the saved report now?</div>
              <p className="text-sm text-slate-600">
                Send this {frequencyLabel(settings.frequency).toLowerCase()} report to {savedRecipientCount}{" "}
                {savedRecipientCount === 1 ? "recipient" : "recipients"} now?
              </p>
              <p className="text-xs text-slate-500">
                This uses the saved recipient list, saved Reply-To, and the scheduled report preview. It does not replace the next automatic send.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => setConfirmSend(false)}
                  disabled={sendingNow}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-60"
                  onClick={sendReportNow}
                  disabled={sendingNow}
                >
                  {sendingNow ? "Sending…" : "Send Report Now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmManual && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => !manualSending && setConfirmManual(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5 space-y-4">
              <div className="text-lg font-semibold text-slate-800">Send this manual report?</div>
              <p className="text-sm text-slate-600">
                Send {manualFrom} through {manualTo} to {manualRecipientCount} {manualRecipientCount === 1 ? "recipient" : "recipients"}?
              </p>
              <p className="text-xs text-slate-500">
                Temporary recipients are not saved. This does not change scheduled automation.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => setConfirmManual(false)}
                  disabled={manualSending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-60"
                  onClick={sendManual}
                  disabled={manualSending}
                >
                  {manualSending ? "Sending…" : "Send Manual Report"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
