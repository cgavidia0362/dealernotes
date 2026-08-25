import { sendAuthLinkEmail } from "./_lib/authEmail.js";
import { generateAuthActionLink } from "./_lib/authLinks.js";
import { looksLikeEmail } from "./_lib/resendWeekly.js";
import { HttpError } from "./_lib/types.js";

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    if (!looksLikeEmail(email)) {
      return res.status(200).json({ ok: true });
    }

    try {
      const generated = await generateAuthActionLink({ email, prefer: "recovery" });
      await sendAuthLinkEmail({
        to: email,
        link: generated.link,
        kind: "recovery",
        username: generated.mode === "recovery" ? email.split("@")[0] : undefined,
      });
    } catch (e) {
      console.error("[send-auth-email] recovery send skipped or failed", e instanceof Error ? e.message : e);
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON body." });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
