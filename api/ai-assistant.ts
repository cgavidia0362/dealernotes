import { handleAssistantTurn, type ConfirmPayload } from "./_lib/assistant.js";
import { getBearerToken, requireUser } from "./_lib/authAdmin.js";
import { HttpError, InsightsModelError, InsightsTimeoutError } from "./_lib/types.js";

export const config = { maxDuration: 30 };

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    const auth = await requireUser(token);
    if (auth.role !== "Admin") throw new HttpError(403, "Ask is available to administrators only.");

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const message = String(body.message || "").trim();
    const routeDate = String(body.routeDate || "").trim();
    const confirm = body.confirm && typeof body.confirm === "object" ? (body.confirm as ConfirmPayload) : null;

    if (!confirm && !message) return res.status(400).json({ error: "Type a question first." });

    const result = await handleAssistantTurn({
      token,
      userId: auth.userId,
      username: auth.username,
      role: auth.role,
      message,
      confirm,
      routeDate,
    });

    return res.status(200).json(result);
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON body." });
    if (e instanceof InsightsTimeoutError) return res.status(504).json({ error: e.message });
    if (e instanceof InsightsModelError) return res.status(502).json({ error: e.message });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
