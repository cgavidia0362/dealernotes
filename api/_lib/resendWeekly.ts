import { HttpError } from "./types.js";

export function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new HttpError(500, `${name} is not configured.`);
  return value;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /<[^@\s]+@[^@\s]+\.[^@\s]+>/.test(value);
}

export async function sendResendEmail(opts: {
  from: string;
  to: string[];
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const resendKey = requiredEnv("RESEND_API_KEY");
  if (!opts.to.length) throw new HttpError(400, "No recipients to send to.");
  if (!looksLikeEmail(opts.from)) {
    throw new HttpError(500, "WEEKLY_REPORT_FROM_EMAIL is not a valid email address.");
  }
  if (opts.replyTo && !looksLikeEmail(opts.replyTo)) {
    throw new HttpError(400, "Reply-To is not a valid email address.");
  }

  const payload: Record<string, unknown> = {
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (opts.replyTo) payload.reply_to = opts.replyTo;

  const sendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!sendResp.ok) {
    throw new HttpError(502, "Email provider failed. Check Resend configuration.");
  }
}
