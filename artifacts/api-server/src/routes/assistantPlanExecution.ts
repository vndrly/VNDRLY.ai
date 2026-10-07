import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { SESSION_SECRET, getSessionFromRequest } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { createPlanExecutionConsentService } from "../assistant/plan-execution-consent";
import { ASSISTANT_ISSUER } from "../assistant/chatgpt-oauth";

// Disabled deployments must not initialize signing/persistence at import time.
const service = () => createPlanExecutionConsentService({ secret: SESSION_SECRET });
const cookieName = "vndrly_plan_execution_review";
const cookiePath = "/api/assistant-connection/executions";
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function page(res: Response, content: string) {
  return res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VNDRLY background work</title></head><body><main><h1>VNDRLY background work</h1>${content}</main></body></html>`);
}
async function browserSession(req: Request) {
  const session = getSessionFromRequest(req);
  if (!session) throw Error("VNDRLY sign-in required");
  return validateAssistantSession(session);
}
function reviewToken(req: Request) {
  const token = req.query.token;
  if (typeof token !== "string" || token.length > 240000) throw Error("Invalid review");
  return token;
}
const router = Router();
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
  if (process.env.ASSISTANT_PLAN_EXECUTION_ENABLED !== "1") return res.status(503).json({ error: "background_work_unavailable" });
  return next();
});
router.get("/review", async (req, res) => {
  if (!getSessionFromRequest(req)) return page(res, '<p>Sign into the same VNDRLY account, then return here and refresh.</p><a href="/switch-account" target="_blank" rel="noopener">Sign into VNDRLY</a>');
  try {
    const token = reviewToken(req), session = await browserSession(req);
    const review = await service().getPrepared(token, session);
    const nonce = randomBytes(32).toString("base64url");
    res.cookie(cookieName, `${nonce}.${hash(token)}`, { httpOnly: true, secure: true, sameSite: "lax", path: cookiePath, maxAge: 300000 });
    return page(res, `<h2>Review the exact background work</h2><p>Account ${escape(String(review.proposal.requester.userId))}; ${escape(review.proposal.requester.organizationKey)}.</p><p>Expires ${escape(new Date(review.proposal.expiresAt).toISOString())}. Maximum attempts per step: ${review.proposal.maxAttempts}.</p><pre>${escape(JSON.stringify(review.proposal.steps, null, 2))}</pre><p>Only these bounded reads and any listed self-assigned company review draft are authorized. Company drafts follow normal company visibility. No money transfer, outgoing recipient message, calendar change or device capture is included. An inbox brief is a saved notification, not guaranteed delivery or sound.</p><form method="post"><input type="hidden" name="nonce" value="${escape(nonce)}"><button type="submit">Approve this background work</button></form><p>Prepared work has not started. After approval, closing ChatGPT does not cancel this delegation.</p>`);
  } catch { return res.status(403).type("html").send("This review is unavailable for the current account or has expired. Request a fresh review from V."); }
});
router.post("/review", async (req, res) => {
  try {
    if (req.headers.origin !== new URL(ASSISTANT_ISSUER).origin) throw Error("Wrong origin");
    const token = reviewToken(req);
    if (typeof req.body?.nonce !== "string" || req.cookies?.[cookieName] !== `${req.body.nonce}.${hash(token)}`) throw Error("Review confirmation unavailable");
    const run = await service().approve(token, await browserSession(req));
    res.clearCookie(cookieName, { path: cookiePath, secure: true, sameSite: "lax" });
    return page(res, `<h2>Background work approved</h2><p>Reference: ${escape(run.authorization.id)}</p><p>Current saved state: ${escape(run.state)}. Approval does not mean the steps have completed. Ask V to check this exact reference.</p>`);
  } catch { return res.status(403).json({ error: "background_work_approval_unavailable" }); }
});
export default router;
