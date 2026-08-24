import { HttpError } from "./types.js";

export function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new HttpError(500, `${name} is not configured.`);
  return value;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /<[^@\s]+@[^@\s]+\.[^@\s]+>/.test(value);
}

function senderDomain(from: string): string {
  const m = /@([^>\s]+)/.exec(String(from || ""));
  return (m?.[1] || "").toLowerCase();
}

function readProviderError(raw: unknown): { type?: string; message?: string } {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const nested = obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
  const type = String(obj.name || obj.type || nested?.name || nested?.type || "").trim() || undefined;
  const message = String(obj.message || nested?.message || "").trim() || undefined;
  return { type, message };
}

function humanProviderMessage(opts: {
  from: string;
  status: number;
  providerType?: string;
  providerMessage?: string;
}): string {
  const domain = senderDomain(opts.from);
  const providerText = `${opts.providerMessage || ""} ${opts.providerType || ""}`.toLowerCase();
  const testingOnly =
    domain === "resend.dev" ||
    providerText.includes("only send testing emails") ||
    providerText.includes("verify a domain");

  if (testingOnly && opts.status === 403) {
    return "Resend blocked this send because the From address is on resend.dev. That test sender can only email the Resend account owner. Verify your own domain in Resend, then set WEEKLY_REPORT_FROM_EMAIL to an address on that domain.";
  }
  if (opts.providerMessage) return opts.providerMessage;
  return "Email provider failed. Check Resend configuration.";
}

export async function sendResendEmail(opts: {
  from: string;
  to: string[];
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
}): Promise<{ id: string | null }> {
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

  if (sendResp.ok) {
    const okJson = (await sendResp.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
    return { id: okJson?.id || okJson?.data?.id || null };
  }

  const raw = await sendResp.json().catch(() => null);
  const parsed = readProviderError(raw);
  console.error("[resend] send failed", {
    status: sendResp.status,
    providerType: parsed.type || null,
    providerMessage: parsed.message || null,
    fromDomain: senderDomain(opts.from) || null,
    recipientCount: opts.to.length,
    hasReplyTo: Boolean(opts.replyTo),
  });

  const status = sendResp.status >= 400 && sendResp.status < 500 ? sendResp.status : 502;
  throw new HttpError(status, humanProviderMessage({
    from: opts.from,
    status: sendResp.status,
    providerType: parsed.type,
    providerMessage: parsed.message,
  }), {
    providerStatus: sendResp.status,
    providerType: parsed.type || null,
    providerMessage: parsed.message || null,
  });
}
