import { HttpError } from "./types.js";
import { parseSubjectTemplate } from "./reportSubject.js";
import { getInclusiveDateWindow } from "./weeklyRange.js";
import {
  parseRecipientList,
  type WeeklyReportSettings,
} from "./weeklyReportSettings.js";

export function parseManualReportInput(
  body: unknown,
  settings: WeeklyReportSettings,
  opts?: { requireRecipients?: boolean }
) {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fromDate = String(raw.fromDate || "").trim();
  const toDate = String(raw.toDate || "").trim();
  if (!fromDate || !toDate) throw new HttpError(400, "From date and To date are required.");
  const window = getInclusiveDateWindow(fromDate, toDate, settings.timezone);

  const subjectTemplate = parseSubjectTemplate(raw.subject || settings.subjectTemplate);
  const useSavedRecipients = raw.useSavedRecipients !== false;
  const to = useSavedRecipients ? parseRecipientList(settings.recipientEmails) : parseRecipientList(raw.recipientEmails);
  if (opts?.requireRecipients !== false && !to.length) {
    throw new HttpError(400, "Add at least one valid recipient before sending the report.");
  }
  return { window, subjectTemplate, to, useSavedRecipients, fromDate, toDate };
}
