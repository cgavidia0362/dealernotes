import { generateWeekAtAGlance } from "./insights.js";
import { loadNotesForRange } from "./notes.js";
import type { EnrichedNote, WeeklyReportingWindow } from "./types.js";
import { getReportingWindowFromSettings } from "./weeklyRange.js";
import {
  renderWeeklyActivityEmail,
  weeklyActivityCounts,
  type WeeklyReportEmail,
} from "./weeklyReportEmail.js";
import { loadWeeklyReportSettings, type WeeklyReportSettings } from "./weeklyReportSettings.js";

export type WeeklyActivityReport = {
  settings: WeeklyReportSettings;
  window: WeeklyReportingWindow;
  notes: EnrichedNote[];
  glance: string[];
  truncated: boolean;
  counts: { noteCount: number; repCount: number; dealerCount: number };
  email: WeeklyReportEmail;
};

/** Shared weekly-email path: notes → glance → view model → renderer. */
export async function buildWeeklyActivityReport(opts?: { asOf?: Date }): Promise<WeeklyActivityReport> {
  const settings = await loadWeeklyReportSettings();
  const rangeSettings = {
    rangeType: settings.rangeType,
    rangeStartDay: settings.rangeStartDay,
    sendDay: settings.sendDay,
    sendTime: settings.sendTime,
    timezone: settings.timezone,
  };
  const window = opts?.asOf
    ? getReportingWindowFromSettings(rangeSettings, opts.asOf)
    : getReportingWindowFromSettings(rangeSettings);
  const loaded = await loadNotesForRange(window.startISO, window.endISO);
  const glance = loaded.notes.length
    ? await generateWeekAtAGlance({
        notes: loaded.notes,
        truncated: loaded.truncated,
        startISO: window.startISO,
        endISO: window.endISO,
        rangeLabel: window.rangeLabel,
      })
    : [];
  const email = renderWeeklyActivityEmail({
    window,
    glance,
    notes: loaded.notes,
  });
  return {
    settings,
    window,
    notes: loaded.notes,
    glance,
    truncated: loaded.truncated,
    counts: weeklyActivityCounts(loaded.notes),
    email,
  };
}
