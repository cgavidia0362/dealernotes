import { getBearerToken, requireAdmin } from "./_lib/authAdmin.js";
import { authRedirectTo, buildCoverageRows } from "./_lib/authLinks.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { HttpError } from "./_lib/types.js";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const ROLES = new Set(["Admin", "Manager", "Rep"]);
const STATUSES = new Set(["Active", "Inactive"]);

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

async function findOrCreateAuthUser(opts: {
  id?: string | null;
  email: string;
  username: string;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const email = opts.email.trim().toLowerCase();
  const username = opts.username.trim();

  if (opts.id && UUID_RE.test(opts.id)) {
    const { data, error } = await admin.auth.admin.getUserById(opts.id);
    if (!error && data?.user?.id) {
      await admin.auth.admin.updateUserById(data.user.id, {
        email,
        user_metadata: { ...(data.user.user_metadata || {}), username },
      });
      return data.user.id;
    }
  }

  const { data: byEmail } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (byEmail?.id && UUID_RE.test(String(byEmail.id))) {
    await admin.auth.admin.updateUserById(String(byEmail.id), {
      email,
      user_metadata: { username },
    });
    return String(byEmail.id);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password: `${crypto.randomUUID()}Aa1!`,
    email_confirm: true,
    user_metadata: { username },
  });
  if (!created.error && created.data.user?.id) return created.data.user.id;

  if (created.error && alreadyRegistered(created.error.message || "", created.error.status)) {
    const recovery = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: authRedirectTo() },
    });
    const existingId = recovery.data?.user?.id;
    if (existingId) {
      await admin.auth.admin.updateUserById(existingId, {
        email,
        user_metadata: { username },
      });
      return existingId;
    }
  }

  throw new HttpError(400, created.error?.message || "Could not create or find this user.");
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    await requireAdmin(token);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "Rep").trim();
    const status = String(body.status || "Active").trim();
    const phone = String(body.phone || "").trim();
    const reportUrl = String(body.reportUrl || "").trim();
    const states = Array.isArray(body.states) ? body.states.map((s: unknown) => String(s || "").trim()).filter(Boolean) : [];
    const regionsByState =
      body.regionsByState && typeof body.regionsByState === "object" && !Array.isArray(body.regionsByState)
        ? (body.regionsByState as Record<string, string[]>)
        : {};

    if (!name || !username) throw new HttpError(400, "Name and username are required.");
    if (!looksLikeEmail(email)) throw new HttpError(400, "A valid email is required to save this user.");
    if (!ROLES.has(role)) throw new HttpError(400, "Invalid role.");
    if (!STATUSES.has(status)) throw new HttpError(400, "Invalid status.");

    const admin = getSupabaseAdmin();
    const incomingId = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : null;

    const { data: taken } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (taken?.id && taken.id !== incomingId) {
      throw new HttpError(400, "Username already exists.");
    }

    const userId = await findOrCreateAuthUser({ id: incomingId, email, username });

    const { error: profileErr } = await admin.from("profiles").upsert(
      {
        id: userId,
        username,
        email,
        role,
        status,
        name,
        phone: phone || null,
        report_url: reportUrl || null,
      },
      { onConflict: "id" }
    );
    if (profileErr) throw new HttpError(400, profileErr.message);

    const { error: delErr } = await admin.from("rep_coverage").delete().eq("user_id", userId);
    if (delErr) throw new HttpError(400, delErr.message);

    const rows = buildCoverageRows(userId, states, regionsByState);
    if (rows.length) {
      const { error: upErr } = await admin.from("rep_coverage").upsert(rows, { onConflict: "user_id,state,region" });
      if (upErr) throw new HttpError(400, upErr.message);
    }

    return res.status(200).json({
      ok: true,
      id: userId,
      username,
      email,
      role,
      status,
      states,
      regionsByState,
    });
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON body." });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
