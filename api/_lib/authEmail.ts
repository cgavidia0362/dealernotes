import { requiredEnv, sendResendEmail } from "./resendWeekly.js";

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function authFromEmail(): string {
  return String(process.env.AUTH_FROM_EMAIL || process.env.WEEKLY_REPORT_FROM_EMAIL || "").trim();
}

export async function sendAuthLinkEmail(opts: {
  to: string;
  link: string;
  kind: "invite" | "recovery";
  username?: string;
}): Promise<{ id: string | null }> {
  const from = authFromEmail() || requiredEnv("WEEKLY_REPORT_FROM_EMAIL");
  const username = (opts.username || "").trim();
  const isInvite = opts.kind === "invite";
  const subject = isInvite ? "Set up your Dealer Notes password" : "Reset your Dealer Notes password";
  const heading = isInvite ? "Finish setting up your Dealer Notes account" : "Reset your Dealer Notes password";
  const intro = isInvite
    ? "An administrator invited you to Dealer Notes. Click the button below to create your password."
    : "Click the button below to choose a new password for your Dealer Notes account.";
  const greeting = username ? `Hi ${username},` : "Hi,";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:#f8fafc;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:24px 28px 8px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:20px;line-height:1.3;color:#0f172a;font-weight:700;">
              ${escapeHtml(heading)}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 20px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#334155;">
              <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 20px 0;">${escapeHtml(intro)}</p>
              <p style="margin:0 0 20px 0;">
                <a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;">
                  ${isInvite ? "Create password" : "Reset password"}
                </a>
              </p>
              <p style="margin:0;font-size:13px;color:#64748b;">This link is one-time use and expires after a short time. If you did not request it, you can ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    heading,
    "",
    greeting,
    intro,
    "",
    opts.link,
    "",
    "This link is one-time use and expires after a short time.",
  ].join("\n");

  return sendResendEmail({
    from,
    to: [opts.to],
    subject,
    html,
    text,
  });
}
