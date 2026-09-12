import { Router, type IRouter } from "express";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isPersistedWorkHubEvent, workHubEventBus } from "../work-hub/events";
import { eventsAfter } from "../work-hub/device-coordinator";
import { resolveActiveDeviceActor } from "./workHubDevices";

const router: IRouter = Router();
router.get("/work-hub/events", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) { sendApiError(res, 401, "auth.unauthenticated", "Authentication required"); return; }
  const actor = await resolveActiveDeviceActor(req);
  if (!actor) { sendApiError(res, 404, "work_hub.not_found", "Not found"); return; }
  res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.setHeader("X-Accel-Buffering", "no");
  const lastEventHeader = req.header("Last-Event-ID"); const hasCursor = lastEventHeader !== undefined;
  const parsedLastSeen = Number(lastEventHeader); const lastSeen = Number.isSafeInteger(parsedLastSeen) && parsedLastSeen >= 0 ? parsedLastSeen : 0;
  const queued: Parameters<Parameters<typeof workHubEventBus.subscribe>[1]>[0][] = [];
  let catchingUp = true;
  const writeEvent = (event: Parameters<Parameters<typeof workHubEventBus.subscribe>[1]>[0]) => res.write(`${isPersistedWorkHubEvent(event) ? `id: ${event.sequence}\n` : ""}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  const unsubscribe = workHubEventBus.subscribe(session.userId, (event) => { if (catchingUp) queued.push(event); else writeEvent(event); });
  const catchUp = await eventsAfter(actor, hasCursor ? lastSeen : Number.MAX_SAFE_INTEGER);
  res.write(`event: work_hub.hello\ndata: ${JSON.stringify({ currentSequence: catchUp.latestSequence ?? workHubEventBus.currentSequence(), lastSeenSequence: lastSeen || null, gap: catchUp.gap })}\n\n`);
  if (!catchUp.gap) for (const event of catchUp.events) res.write(`id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`);
  const delivered = new Set(catchUp.events.map(event => event.sequence)); catchingUp = false;
  for (const event of queued) if (!delivered.has(event.sequence) && (!isPersistedWorkHubEvent(event) || event.sequence > lastSeen)) writeEvent(event);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});
export default router;
