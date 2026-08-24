// /api/weekly-report-settings.ts
// Admin-only load/save of weekly report automation preferences.
import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { HttpError } from "./_lib/types.js";
import { loadWeeklyReportSettings, parseSettingsInput, saveWeeklyReportSettings } from "./_lib/weeklyReportSettings.js";
import { loadScheduleStatus } from "./_lib/weeklyScheduleStatus.js";

function publicFromEmail(): string {
  return String(process.env.WEEKLY_REPORT_FROM_EMAIL || "").trim();
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "GET" && req.method !== "PUT" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    if (req.method === "GET") {
      const settings = await loadWeeklyReportSettings();
      const status = await loadScheduleStatus(settings);
      return res.status(200).json({
        settings,
        fromEmail: publicFromEmail(),
        ...status,
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = parseSettingsInput(body);
    const settings = await saveWeeklyReportSettings(parsed);
    const status = await loadScheduleStatus(settings);
    return res.status(200).json({
      settings,
      fromEmail: publicFromEmail(),
      ...status,
      message: settings.enabled
        ? "Settings saved. Automatic sending will follow this schedule."
        : "Settings saved. Automatic sending is disabled.",
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON body." });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
