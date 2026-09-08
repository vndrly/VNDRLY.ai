import { Router, type IRouter } from "express";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { workHubEventBus } from "../work-hub/events";

const router: IRouter = Router();
router.get("/work-hub/events", (req, res): void => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) { sendApiError(res, 401, "auth.unauthenticated", "Authentication required"); return; }
  res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.setHeader("X-Accel-Buffering", "no");
  const lastSeen = Number(req.header("Last-Event-ID")); const current = workHubEventBus.currentSequence();
  res.write(`event: work_hub.hello\ndata: ${JSON.stringify({ currentSequence: current, lastSeenSequence: Number.isFinite(lastSeen) ? lastSeen : null, gap: Number.isFinite(lastSeen) && current > lastSeen })}\n\n`);
  const unsubscribe = workHubEventBus.subscribe(session.userId, (event) => { res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});
export default router;
