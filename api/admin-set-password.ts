import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { HttpError } from "./_lib/types.js";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const id = String(body.id || "").trim();
    const password = String(body.password || "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "A saved user is required to set a password.");
    if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");

    const admin = getSupabaseAdmin();
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) throw new HttpError(400, error.message);

    return res.status(200).json({ ok: true, id });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON body." });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
