import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

type ToastKind = "success" | "error";

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
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [savedRecipientCount, setSavedRecipientCount] = useState(0);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewError, setPreviewError] = useState("");

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
        setSavedRecipientCount(Array.isArray(json.settings?.recipientEmails) ? json.settings.recipientEmails.length : 0);
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
        subject: String(json.subject || "Dealer Note Weekly Report"),
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
      setSavedRecipientCount(Array.isArray(json.settings?.recipientEmails) ? json.settings.recipientEmails.length : 0);
      showToast(json?.message || "Settings saved.", "success");
      await refreshPreview({ quiet: true });
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
        showToast(json?.error || "Could not send the weekly report.", "error");
        return;
      }
      setConfirmSend(false);
      showToast(json?.message || "Weekly report sent.", "success");
    } catch (e: any) {
      showToast(e?.message || "Could not send the weekly report.", "error");
    } finally {
      setSendingNow(false);
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
          Control weekly report settings here. Automatic sending is not active yet.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div className="min-w-0 space-y-5">
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
                <option value="custom_weekly" disabled>
                  Custom weekly range (not yet supported)
                </option>
              </select>
            </label>
            {settings.rangeType === "custom_weekly" && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Custom weekly range is not supported yet. It needs its own end weekday, separate from send day. Use Start of week through send time, and set Week starts on to the first day of your window.
              </div>
            )}
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
            <div className="text-xs text-slate-500">Optional. Used as Reply-To for Send Report Now. Leave blank to omit it.</div>
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
              onClick={() => refreshPreview()}
              disabled={previewing}
            >
              {previewing ? "Refreshing…" : "Refresh Preview"}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-400 text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              onClick={sendTestEmail}
              disabled={sendingTest || sendingNow}
            >
              {sendingTest ? "Sending…" : "Send Test Email"}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-60"
              onClick={() => setConfirmSend(true)}
              disabled={sendingTest || sendingNow || savedRecipientCount === 0}
            >
              Send Report Now
            </button>
          </div>
          <div className="text-xs text-slate-500">
            Preview and both send actions use the last saved reporting range and timezone. Send Test Email goes only to the configured test inbox. Send Report Now goes to the saved recipient list and uses the saved Reply-To.
          </div>
        </div>

        <aside className="min-w-0 md:sticky md:top-20">
          <div className="rounded-xl border bg-slate-100 p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">Email preview</div>
                <div className="text-xs text-slate-500 break-words">
                  {preview
                    ? [preview.subject, preview.rangeLabel, `${preview.noteCount} notes`].filter(Boolean).join(" · ")
                    : "Same content as the weekly email."}
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 bg-white"
                onClick={() => refreshPreview()}
                disabled={previewing}
              >
                {previewing ? "Refreshing…" : "Refresh Preview"}
              </button>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              {previewing && !preview && (
                <div className="p-6 text-sm text-slate-500">Building the weekly email preview…</div>
              )}
              {!previewing && previewError && !preview && (
                <div className="p-6 text-sm text-slate-600">{previewError}</div>
              )}
              {!previewing && !preview && !previewError && (
                <div className="p-6 text-sm text-slate-500">
                  Click Refresh Preview to see the weekly email. This uses the saved reporting range and does not send anything.
                </div>
              )}
              {preview?.html && (
                <iframe
                  title="Weekly email preview"
                  sandbox=""
                  srcDoc={preview.html}
                  className="w-full bg-white block"
                  style={{ height: "min(78vh, 920px)", border: 0 }}
                />
              )}
            </div>
          </div>
        </aside>
      </div>

      {confirmSend && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => !sendingNow && setConfirmSend(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5 space-y-4">
              <div className="text-lg font-semibold text-slate-800">Send this weekly report now?</div>
              <p className="text-sm text-slate-600">
                Send this weekly report to {savedRecipientCount} {savedRecipientCount === 1 ? "recipient" : "recipients"} now?
              </p>
              <p className="text-xs text-slate-500">
                This uses the saved recipient list, saved Reply-To, and the same email shown in the preview. It does not use the test inbox. Automatic scheduling is still off.
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
    </div>
  );
}
