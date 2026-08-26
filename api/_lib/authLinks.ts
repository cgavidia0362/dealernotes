import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./types.js";

/** Redirect URLs in the Supabase dashboard must include `{SITE_URL}/auth/callback`.
 *  Auth emails are sent via Resend (WEEKLY_REPORT_FROM_EMAIL). Confirm that
 *  SITE_URL matches the live host and consider raising email OTP expiry if links die quickly.
 */
export function siteUrl(): string {
  const explicit = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = String(process.env.VERCEL_URL || "").trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "https://dealernotes.vercel.app";
}

export function authRedirectTo(): string {
  return `${siteUrl()}/auth/callback?next=/reset`;
}

function extractHashedToken(data: unknown): { token_hash: string; type?: string } | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const props = obj.properties && typeof obj.properties === "object" ? (obj.properties as Record<string, unknown>) : null;
  const nested = obj.email_otp && typeof obj.email_otp === "object" ? (obj.email_otp as Record<string, unknown>) : null;
  const token_hash = String(
    props?.hashed_token || obj.hashed_token || nested?.hashed_token || ""
  ).trim();
  if (!token_hash) return null;
  const rawType = String(
    props?.verification_type || props?.type || obj.type || nested?.type || ""
  ).toLowerCase();
  const type =
    rawType === "invite" || rawType === "signup" || rawType === "recovery" ? rawType : undefined;
  return { token_hash, type };
}

export function buildAuthVerifyUrl(token_hash: string, type: string): string {
  const params = new URLSearchParams({
    next: "/reset",
    token_hash,
    type: type || "recovery",
  });
  return `${siteUrl()}/auth/callback?${params.toString()}`;
}

function alreadyRegistered(message: string, status?: number): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("already been registered") ||
    msg.includes("user already registered") ||
    msg.includes("already exists") ||
    status === 422 ||
    status === 409
  );
}

export async function generateAuthActionLink(opts: {
  email: string;
  username?: string;
  prefer: "invite" | "recovery";
}): Promise<{ link: string; mode: "invite" | "recovery"; userId?: string }> {
  const supabaseAdmin = getSupabaseAdmin();
  const redirectTo = authRedirectTo();
  const email = opts.email.trim().toLowerCase();
  const username = (opts.username || "").trim();

  const tryInvite = async () =>
    supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo,
        data: username ? { username } : undefined,
      },
    });

  const tryRecovery = async () =>
    supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

  const toAppLink = (data: unknown, mode: "invite" | "recovery"): string => {
    const hashed = extractHashedToken(data);
    if (hashed) return buildAuthVerifyUrl(hashed.token_hash, hashed.type || mode);
    throw new HttpError(500, `${mode === "invite" ? "Invite" : "Reset"} link was created but the verify token was missing.`);
  };

  if (opts.prefer === "invite") {
    const inviteResp = await tryInvite();
    if (!inviteResp.error) {
      return { link: toAppLink(inviteResp.data, "invite"), mode: "invite", userId: inviteResp.data.user?.id };
    }
    if (!alreadyRegistered(inviteResp.error.message || "", inviteResp.error.status)) {
      throw new HttpError(400, inviteResp.error.message);
    }
  }

  const recoveryResp = await tryRecovery();
  if (recoveryResp.error) throw new HttpError(400, recoveryResp.error.message);
  return { link: toAppLink(recoveryResp.data, "recovery"), mode: "recovery", userId: recoveryResp.data.user?.id };
}

export function buildCoverageRows(
  userId: string,
  states: string[],
  regionsByState: Record<string, string[]>
): { user_id: string; state: string; region: string }[] {
  const rows: { user_id: string; state: string; region: string }[] = [];
  for (const st of states) {
    const state = String(st || "").trim().toUpperCase();
    if (!state) continue;
    const rgs = (regionsByState?.[st] || regionsByState?.[state] || [])
      .map((rg) => String(rg || "").trim())
      .filter(Boolean);
    if (!rgs.length) {
      rows.push({ user_id: userId, state, region: "" });
      continue;
    }
    for (const region of rgs) {
      rows.push({ user_id: userId, state, region });
    }
  }
  return rows;
}
