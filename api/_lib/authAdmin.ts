import { HttpError } from "./types.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export function getBearerToken(req: { headers?: Record<string, unknown> }): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization ?? "";
  const auth = String(raw);
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export async function requireAdmin(token: string): Promise<{ userId: string; role: string }> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
  if (uErr || !u?.user?.id) throw new HttpError(401, "Invalid session");

  const { data: prof, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", u.user.id)
    .single();

  if (pErr || !prof) throw new HttpError(403, "Profile not found");
  if (prof.role !== "Admin") throw new HttpError(403, "Not authorized");

  return { userId: u.user.id, role: String(prof.role) };
}
