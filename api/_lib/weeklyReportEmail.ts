import type { EnrichedNote, WeeklyReportingWindow } from "./types.js";

export type WeeklyReportEmailInput = {
  window: WeeklyReportingWindow;
  glance: string[];
  notes: EnrichedNote[];
};

export type WeeklyReportEmail = {
  subject: string;
  html: string;
  text: string;
};

export type RepNoteGroup = {
  rep: string;
  notes: EnrichedNote[];
};

const CHICAGO = "America/Chicago";
const MAX_GLANCE = 5;

function formatChicagoDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: CHICAGO, ...opts });
}

export function formatWeeklyEmailDates(window: WeeklyReportingWindow): {
  startLong: string;
  endLong: string;
  startShort: string;
  endShort: string;
} {
  const longOpts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
  };
  const shortOpts: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    year: "numeric",
  };
  return {
    startLong: formatChicagoDate(window.startISO, longOpts),
    endLong: formatChicagoDate(window.endISO, longOpts),
    startShort: formatChicagoDate(window.startISO, shortOpts),
    endShort: formatChicagoDate(window.endISO, shortOpts),
  };
}

export function weeklyActivityCounts(notes: EnrichedNote[]): {
  noteCount: number;
  repCount: number;
  dealerCount: number;
} {
  const reps = new Set(notes.map((n) => n.author_username || "unknown"));
  const dealers = new Set(notes.map((n) => n.dealer_id).filter(Boolean));
  return {
    noteCount: notes.length,
    repCount: reps.size,
    dealerCount: dealers.size,
  };
}

export function groupNotesByRep(notes: EnrichedNote[]): RepNoteGroup[] {
  const map = new Map<string, EnrichedNote[]>();
  for (const n of notes) {
    const rep = n.author_username || "unknown";
    const list = map.get(rep);
    if (list) list.push(n);
    else map.set(rep, [n]);
  }

  return Array.from(map.entries())
    .map(([rep, list]) => ({
      rep,
      notes: [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    }))
    .sort((a, b) => a.rep.localeCompare(b.rep, undefined, { sensitivity: "base" }));
}

export function weekAtAGlance(items: string[]): string[] {
  const cleaned = items.map((item) => String(item)).filter((item) => item.length > 0);
  const limited = cleaned.slice(0, MAX_GLANCE);
  return limited.length ? limited : ["Nothing notable in this range."];
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dealerName(note: EnrichedNote): string {
  return note.dealer?.name || "Unknown dealer";
}

function noteDateLabel(iso: string): string {
  return formatChicagoDate(iso, { month: "short", day: "numeric" });
}

function activityLine(counts: { noteCount: number; repCount: number; dealerCount: number }): string {
  return `${counts.noteCount} Notes • ${counts.repCount} Reps • ${counts.dealerCount} Dealers`;
}

/** Week at a Glance + original rep notes. Does not render the nine-section Insights report. */
export function renderWeeklyActivityEmail(input: WeeklyReportEmailInput): WeeklyReportEmail {
  const dates = formatWeeklyEmailDates(input.window);
  const subject = `Dealer Note Weekly Report — ${dates.startShort} through ${dates.endShort}`;
  const period = `${dates.startLong} – ${dates.endLong}`;
  const counts = weeklyActivityCounts(input.notes);
  const totals = activityLine(counts);
  const glance = weekAtAGlance(input.glance);
  const groups = groupNotesByRep(input.notes);
  const footer = "This report was generated from Dealer Note activity during the reporting period.";

  const textGlance = glance.map((item) => `• ${item}`).join("\n");
  const textReps = groups
    .map((g) => {
      const header = `${g.rep}\n${g.notes.length} Notes`;
      const body = g.notes
        .map((n) => {
          const when = noteDateLabel(n.created_at);
          const category = n.category || "Note";
          return `${dealerName(n)}\n${when} • ${category}\n\n${n.text ?? ""}`;
        })
        .join("\n\n");
      return `${header}\n\n${body}`;
    })
    .join("\n\n--------------------------------\n\n");

  const text = [
    "Dealer Note Weekly Report",
    "",
    "Reporting Period",
    period,
    "",
    totals,
    "",
    "WEEK AT A GLANCE",
    "",
    textGlance,
    "",
    "REP ACTIVITY",
    "",
    textReps,
    "",
    footer,
  ].join("\n");

  const glanceHtml = glance
    .map(
      (item) =>
        `<li style="margin:0 0 10px 0;padding:0;font-size:16px;line-height:1.45;color:#334155;">${escapeHtml(item)}</li>`
    )
    .join("");

  const repsHtml = groups
    .map((g, gi) => {
      const notesHtml = g.notes
        .map((n) => {
          const when = noteDateLabel(n.created_at);
          const category = n.category || "Note";
          return `<div style="margin:0 0 22px 0;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;font-weight:700;line-height:1.35;color:#0f172a;">${escapeHtml(dealerName(n))}</div>
  <div style="margin:4px 0 10px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.4;color:#64748b;">${escapeHtml(when)} • ${escapeHtml(category)}</div>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;color:#1e293b;white-space:pre-wrap;word-break:break-word;">${escapeHtml(n.text ?? "")}</div>
</div>`;
        })
        .join("");
      const divider =
        gi < groups.length - 1
          ? `<div style="margin:8px 0 28px 0;border-bottom:1px solid #cbd5e1;"></div>`
          : "";
      return `<div style="margin:0 0 8px 0;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#0f172a;">${escapeHtml(g.rep)}</div>
  <div style="margin:4px 0 18px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#64748b;">${g.notes.length} ${g.notes.length === 1 ? "Note" : "Notes"}</div>
  ${notesHtml}
  ${divider}
</div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;-webkit-text-size-adjust:100%;">
  <!-- format:week-at-a-glance+rep-activity -->
  <div style="width:100%;background:#f8fafc;padding:20px 12px;">
    <div style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;">
      <div style="padding:24px 20px 20px 20px;border-bottom:3px solid #1e3a8a;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">
          Dealer Note Weekly Report
        </div>
      </div>
      <div style="padding:20px 20px 8px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;margin:0 0 6px 0;">Reporting Period</div>
        <div style="font-size:16px;line-height:1.4;color:#0f172a;margin:0 0 12px 0;">${escapeHtml(period)}</div>
        <div style="font-size:14px;line-height:1.4;color:#475569;">${escapeHtml(totals)}</div>
      </div>
      <div style="padding:24px 20px 8px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-size:13px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#1e3a8a;margin:0 0 12px 0;">Week at a Glance</div>
        <ul style="margin:0;padding:0 0 0 20px;">
          ${glanceHtml}
        </ul>
      </div>
      <div style="padding:28px 20px 24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-size:13px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#1e3a8a;margin:0 0 18px 0;">Rep Activity</div>
        ${repsHtml}
      </div>
      <div style="padding:18px 20px 24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.45;color:#64748b;border-top:1px solid #e2e8f0;">
        ${escapeHtml(footer)}
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

/** @deprecated Use renderWeeklyActivityEmail. Same renderer. */
export const renderWeeklyReportEmail = renderWeeklyActivityEmail;
