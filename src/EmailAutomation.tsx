import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

type ToastKind = "success" | "error";

type InsightsReport = {
  snapshot: string[];
  themes: string[];
  positive: string[];
  concerns: string[];
  competitiveLosses: string[];
  programReception: string[];
  eContracting: string[];
  newProgram: string[];
  watchItems: string[];
};

type WeeklyReportSettings = {
  enabled: boolean;
  sendDay: string;
  sendTime: string;
  timezone: string;
  rangeType: "week_to_send" | "last_7_days" | "custom_weekly";
  rangeStartDay: string;
  recipientEmails: string[];
  replyToEmail: string;
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 30;

function normalizeTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
  if (!m) return value;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

const emptySettings = (): WeeklyReportSettings => ({
  enabled: false,
  sendDay: "Saturday",
  sendTime: "09:00",
  timezone: "America/Chicago",
  rangeType: "week_to_send",
  rangeStartDay: "Monday",
  recipientEmails: [],
  replyToEmail: "",
});

const PREVIEW_SECTIONS: { key: keyof InsightsReport; title: string }[] = [
  { key: "snapshot", title: "Snapshot" },
  { key: "themes", title: "What dealers are talking about" },
  { key: "positive", title: "Positive" },
  { key: "concerns", title: "Concerns" },
  { key: "competitiveLosses", title: "Competitive losses" },
  { key: "programReception", title: "Program reception" },
  { key: "eContracting", title: "eContracting" },
  { key: "newProgram", title: "New program" },
  { key: "watchItems", title: "Watch items" },
];

async function authHeader(): Promise<HeadersInit | null> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function rangeLabel(settings: WeeklyReportSettings): string {
  if (settings.rangeType === "last_7_days") return "Last 7 days";
  if (settings.rangeType === "custom_weekly") return `Custom week starting ${settings.rangeStartDay}`;
  return `${settings.rangeStartDay} through send time`;
}

export function EmailAutomationView({
  showToast,
}: {
  showToast: (m: string, k?: ToastKind) => void;
}) {
  const [settings, setSettings] = useState<WeeklyReportSettings>(emptySettings());
  const [fromEmail, setFromEmail] = useState("");
  const [schedulingActive, setSchedulingActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewReport, setPreviewReport] = useState<InsightsReport | null>(null);
  const [previewMeta, setPreviewMeta] = useState("");

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
        if (json.settings) setSettings({ ...emptySettings(), ...json.settings });
        setFromEmail(String(json.fromEmail || ""));
        setSchedulingActive(json.schedulingActive === true);
      } catch (e: any) {
        if (!cancelled) showToast(e?.message || "Could not load email settings.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load once on mount. showToast is not stable and must not retrigger the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLine = useMemo(() => {
    const on = settings.enabled ? "Enabled (not sending yet)" : "Disabled";
    return `${on} · ${settings.sendDay} at ${settings.sendTime} · ${settings.timezone}`;
  }, [settings]);

  const addRecipient = () => {
    const email = recipientDraft.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      showToast("Enter a valid email address.", "error");
      return;
    }
    if (settings.recipientEmails.includes(email)) {
      showToast("That recipient is already on the list.", "error");
      return;
    }
    if (settings.recipientEmails.length >= MAX_RECIPIENTS) {
      showToast(`A maximum of ${MAX_RECIPIENTS} recipients is allowed.`, "error");
      return;
    }
    setSettings((s) => ({ ...s, recipientEmails: [...s.recipientEmails, email] }));
    setRecipientDraft("");
  };

  const removeRecipient = (email: string) => {
    setSettings((s) => ({ ...s, recipientEmails: s.recipientEmails.filter((e) => e !== email) }));
  };

  const save = async () => {
    if (settings.replyToEmail && !EMAIL_RE.test(settings.replyToEmail.trim().toLowerCase())) {
      showToast("Reply-To must be a valid email address.", "error");
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
        }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        showToast(json?.error || "Could not save settings.", "error");
        return;
      }
      if (json.settings) setSettings({ ...emptySettings(), ...json.settings });
      showToast(json?.message || "Settings saved.", "success");
    } catch (e: any) {
      showToast(e?.message || "Could not save settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  const previewWeeklyReport = async () => {
    setPreviewing(true);
    try {
      const headers = await authHeader();
      if (!headers) {
        showToast("Please log in again.", "error");
        return;
      }
      const resp = await fetch("/api/weekly-report-preview", { method: "POST", headers });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        showToast(json?.error || "Preview failed.", "error");
        return;
      }
      setPreviewReport(json.report || null);
      setPreviewMeta(
        [json.reportingWindow?.rangeLabel, json.noteCount != null ? `${json.noteCount} notes` : ""]
          .filter(Boolean)
          .join(" · ")
      );
      setPreviewOpen(true);
    } catch (e: any) {
      showToast(e?.message || "Preview failed.", "error");
    } finally {
      setPreviewing(false);
    }
  };

  const sendTestEmail = async () => {
    setSending(true);
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
      setSending(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-slate-500">Loading email settings…</div>;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="text-xl font-semibold text-slate-800">Email Automation</div>
        <div className="text-sm text-slate-500 mt-1">
          Control weekly report settings here. Automatic sending is not active yet.
        </div>
      </div>

      <section className="rounded-xl border bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">Current status</div>
        <div className="text-sm text-slate-700">{statusLine}</div>
        <div className="text-sm text-slate-600">
          {settings.recipientEmails.length} {settings.recipientEmails.length === 1 ? "recipient" : "recipients"} · {rangeLabel(settings)}
        </div>
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Last sent: not available yet
          <br />
          Next scheduled: not available yet
          <br />
          {schedulingActive
            ? "Automatic sending is on."
            : "Scheduling is not active yet. Saving these settings will not send automatic emails."}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">Automation status</div>
        <label className="flex items-center gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={settings.enabled}
            onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
          />
          Automatic Reports Enabled
        </label>
        <div className="text-xs text-slate-500">This only saves your preference. It does not turn on a schedule.</div>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">Schedule</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">Reporting range</div>
        <label className="block text-sm">
          <div className="text-xs text-slate-500 mb-1">Window</div>
          <select
            className="w-full border rounded-lg px-2 py-2"
            value={settings.rangeType}
            onChange={(e) =>
              setSettings((s) => ({ ...s, rangeType: e.target.value as WeeklyReportSettings["rangeType"] }))
            }
          >
            <option value="week_to_send">Start of week through send time</option>
            <option value="last_7_days">Last 7 days</option>
            <option value="custom_weekly">Custom weekly range</option>
          </select>
        </label>
        {settings.rangeType !== "last_7_days" && (
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
                addRecipient();
              }
            }}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm hover:bg-slate-50"
            onClick={addRecipient}
          >
            Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {settings.recipientEmails.length === 0 && (
            <div className="text-sm text-slate-500">No recipients yet.</div>
          )}
          {settings.recipientEmails.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 text-sm px-3 py-1"
            >
              {email}
              <button
                type="button"
                className="text-slate-500 hover:text-slate-800"
                onClick={() => removeRecipient(email)}
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
        <div className="text-xs text-slate-500">Optional. Replies will go here once automatic sending is turned on.</div>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-1">
        <div className="text-sm font-semibold text-slate-800">Sender</div>
        <div className="text-sm text-slate-700">
          {fromEmail ? `Sender: ${fromEmail}` : "Sender: Configured by system"}
        </div>
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
          onClick={previewWeeklyReport}
          disabled={previewing}
        >
          {previewing ? "Previewing…" : "Preview Weekly Report"}
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-400 text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          onClick={sendTestEmail}
          disabled={sending}
        >
          {sending ? "Sending…" : "Send Test Email"}
        </button>
      </div>
      <div className="text-xs text-slate-500">
        Preview and test email still use the current weekly window (Monday through now, Central Time). Saved schedule settings do not change those yet.
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreviewOpen(false)} />
          <div className="absolute inset-0 flex items-end md:items-center justify-center p-0 md:p-4">
            <div className="w-full max-w-3xl bg-white shadow-xl md:rounded-2xl overflow-hidden flex flex-col h-[92vh] md:max-h-[90vh]">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div>
                  <div className="font-semibold text-slate-800">Weekly Report Preview</div>
                  {previewMeta && <div className="text-xs text-slate-500">{previewMeta}</div>}
                </div>
                <button type="button" className="text-slate-500 px-2" onClick={() => setPreviewOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2">
                {!previewReport && <div className="text-sm text-slate-500">No report for this week.</div>}
                {previewReport &&
                  PREVIEW_SECTIONS.map((s) => (
                    <div key={s.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-sm font-semibold text-slate-800">{s.title}</div>
                      <ul className="mt-1 list-disc pl-5 space-y-1">
                        {(previewReport[s.key] || []).map((item, i) => (
                          <li key={i} className="text-sm text-slate-700 break-words">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
