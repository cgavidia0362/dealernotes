import { HttpError } from "./types.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export function getBearerToken(req: { headers?: Record<string, unknown> }): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization ?? "";
  const auth = String(raw);
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export async function requireUser(token: string): Promise<{
  userId: string;
  username: string;
  role: string;
}> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
  if (uErr || !u?.user?.id) throw new HttpError(401, "Invalid session");

  const { data: prof, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("id, username, role, status")
    .eq("id", u.user.id)
    .single();

  if (pErr || !prof) throw new HttpError(403, "Profile not found");
  if (String(prof.status || "Active") === "Inactive") throw new HttpError(403, "Account inactive");

  const username = String(prof.username || u.user.user_metadata?.username || "").trim();
  if (!username) throw new HttpError(403, "Profile username is missing");

  return { userId: u.user.id, username, role: String(prof.role || "Rep") };
}

export async function requireAdmin(token: string): Promise<{ userId: string; role: string }> {
  const auth = await requireUser(token);
  if (auth.role !== "Admin") throw new HttpError(403, "Not authorized");
  return { userId: auth.userId, role: auth.role };
}
