import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";

export type TwilioStatusUpdate = { attemptToken: string; providerMessageId: string; status: string; errorCode: string | null; permanent: boolean };
const TERMINAL = new Set(["delivered", "undelivered", "failed"]);
const RANK: Record<string, number> = { sending: 0, unknown: 0, accepted: 0, queued: 1, sent: 2, delivered: 3, undelivered: 3, failed: 3 };
export function shouldApplyTwilioStatus(current: string, incoming: string) {
  return !TERMINAL.has(current) && incoming in RANK && current in RANK && RANK[incoming] > RANK[current];
}
export function isPermanentSmsError(code: string | null | undefined) {
  return ["21610", "21211", "21614", "30003", "30005", "30006"].includes(code ?? "");
}
export function createTwilioStatusRouter(dependencies: {
  config(): { url: string; authToken: string; accountSid: string };
  apply(update: TwilioStatusUpdate): Promise<void>;
}): IRouter {
  const router = Router();
  router.post("/twilio/gate-alert-status", async (req, res) => {
    const cfg = dependencies.config();
    const attempt = req.query.attempt;
    const body = req.body as Record<string, unknown>;
    if (!cfg.authToken || !cfg.url || typeof attempt !== "string" || !/^[a-f0-9-]{36}$/.test(attempt) ||
      Object.keys(req.query).length !== 1 || !req.is("application/x-www-form-urlencoded") || !body ||
      Object.values(body).some(value => typeof value !== "string")) return res.sendStatus(403);
    // Fixed public URL avoids trusting Host/X-Forwarded-* from arbitrary requests.
    const url = `${cfg.url}?attempt=${attempt}`;
    const expected = createHmac("sha1", cfg.authToken).update(url + Object.keys(body).sort().map(key => key + body[key]).join("")).digest("base64");
    const signature = req.get("X-Twilio-Signature") ?? "";
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) || body.AccountSid !== cfg.accountSid) return res.sendStatus(403);
    if (typeof body.MessageSid !== "string" || !/^SM[a-fA-F0-9]{32}$/.test(body.MessageSid) ||
      typeof body.MessageStatus !== "string" || !["queued", "sent", "delivered", "undelivered", "failed"].includes(body.MessageStatus)) return res.sendStatus(400);
    const errorCode = typeof body.ErrorCode === "string" && /^\d{3,6}$/.test(body.ErrorCode) ? body.ErrorCode : null;
    await dependencies.apply({ attemptToken: attempt, providerMessageId: body.MessageSid, status: body.MessageStatus, errorCode, permanent: isPermanentSmsError(errorCode) });
    return res.sendStatus(204);
  });
  return router;
}
export default createTwilioStatusRouter({
  config: () => ({ url: process.env.TWILIO_STATUS_CALLBACK_URL ?? "", authToken: process.env.TWILIO_AUTH_TOKEN ?? "", accountSid: process.env.TWILIO_ACCOUNT_SID ?? "" }),
  apply: async update => (await import("../services/gate-alert-repository")).applyTwilioStatus(update),
});
