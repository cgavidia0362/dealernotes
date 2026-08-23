import type { InsightsReport, WeeklyReportingWindow } from "./types.js";

export const REPORT_EMAIL_SECTIONS: { key: keyof InsightsReport; title: string }[] = [
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

export type WeeklyReportEmailInput = {
  window: WeeklyReportingWindow;
  report: InsightsReport;
  noteCount: number;
  truncated: boolean;
};

export type WeeklyReportEmail = {
  subject: string;
  html: string;
  text: string;
};

const CHICAGO = "America/Chicago";

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
    year: "numeric",
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

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sectionItems(report: InsightsReport, key: keyof InsightsReport): string[] {
  return (report[key] || []).map((item) => String(item).trim()).filter(Boolean);
}

export function renderWeeklyReportEmail(input: WeeklyReportEmailInput): WeeklyReportEmail {
  const dates = formatWeeklyEmailDates(input.window);
  const subject = `Dealer Note Weekly Report — ${dates.startShort} through ${dates.endShort}`;
  const period = `${dates.startLong} – ${dates.endLong}`;
  const notesLine = String(input.noteCount);
  const footer = "This report was generated from Dealer Note activity during the reporting period.";

  const textSections = REPORT_EMAIL_SECTIONS.map((s) => {
    const items = sectionItems(input.report, s.key);
    const bullets = items.length ? items.map((item) => `• ${item}`).join("\n") : "• Nothing notable in this range.";
    return `${s.title}\n${bullets}`;
  }).join("\n\n");

  const text = [
    "Dealer Note Weekly Report",
    "",
    "Reporting Period:",
    period,
    "",
    "Notes Reviewed:",
    notesLine,
    "",
    textSections,
    "",
    footer,
  ].join("\n");

  const htmlSections = REPORT_EMAIL_SECTIONS.map((s) => {
    const items = sectionItems(input.report, s.key);
    const list = (items.length ? items : ["Nothing notable in this range."])
      .map((item) => `<li style="margin:0 0 8px 0;line-height:1.45;color:#334155;">${escapeHtml(item)}</li>`)
      .join("");
    return `
      <tr>
        <td style="padding:18px 0 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;">
                ${escapeHtml(s.title)}
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;">
                <ul style="margin:0;padding:0 0 0 20px;">
                  ${list}
                </ul>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8fafc;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:28px 28px 20px 28px;border-bottom:3px solid #1e3a8a;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">
                Dealer Note Weekly Report
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 8px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#334155;line-height:1.5;">
              <div style="margin:0 0 10px 0;"><strong style="color:#0f172a;">Reporting Period:</strong><br />${escapeHtml(period)}</div>
              <div><strong style="color:#0f172a;">Notes Reviewed:</strong><br />${escapeHtml(notesLine)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 28px 8px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                ${htmlSections}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.45;color:#64748b;border-top:1px solid #e2e8f0;">
              ${escapeHtml(footer)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
