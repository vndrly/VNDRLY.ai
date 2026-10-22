import { Router } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { expectedWorkforceContext } from "../lib/workforce-context";
import { AssistantOAuthError } from "../assistant/chatgpt-oauth";
import { WorkHubAccessError } from "../work-hub/context-access";
import { ChangeOverError } from "../services/gate-change-over";
import { GateShiftAssignmentError } from "../services/gate-shift-assignment";
import { readWorkforceRoster } from "../services/workforce-roster";
import { createWorkforceOffer, listWorkforceShiftOffers, listIncomingWorkforceOffers, respondWorkforceOffer, readWorkforceOfferOperation } from "../services/workforce-offers";

const router = Router();
for (const [method, path, action] of [
  ["get", "/work-hub/workforce/roster", "roster"],
  ["get", "/work-hub/workforce/offers", "incoming"],
  ["get", "/work-hub/shifts/:id/offers", "list"],
  ["post", "/work-hub/shifts/:id/offers", "offer"],
  ["get", "/work-hub/shifts/:id/offers/operations/:operationId", "operation"],
  ["post", "/work-hub/shifts/:id/offers/:offerId/respond", "respond"],
] as const) router[method](path, expectedWorkforceContext, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const session = getSessionFromRequest(req);
  if (!session?.userId) return sendApiError(res, 401, "auth.unauthenticated", "Sign in to continue");
  if (method === "post" && session.publicDemo) return sendApiError(res, 403, "work_hub.forbidden", "Demo access is read only");
  try {
    if (action === "roster") return res.json(await readWorkforceRoster(session));
    if (action === "incoming") return res.json(await listIncomingWorkforceOffers(session));
    const params = req.params as Record<string, string>;
    const shiftId = z.uuid().parse(params.id);
    if (action === "list") return res.json(await listWorkforceShiftOffers(session, shiftId));
    if (action === "offer") return res.json(await createWorkforceOffer(session, shiftId, req.body));
    if (action === "respond") return res.json(await respondWorkforceOffer(session, shiftId, z.uuid().parse(params.offerId), req.body));
    return res.json(await readWorkforceOfferOperation(session, shiftId, z.uuid().parse(params.operationId)));
  } catch (error) {
    if (error instanceof AssistantOAuthError) return sendApiError(res, 403, "work_hub.forbidden", "Current company membership is required");
    if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "Review the workforce request fields");
    if (error instanceof GateShiftAssignmentError || error instanceof ChangeOverError || error instanceof WorkHubAccessError)
      return sendApiError(res, error.status, error.code, "Review current company, site authority and saved staffing eligibility");
    if (error instanceof Error && /^(gate_assignment|gate_candidates)\./.test(error.message)) return sendApiError(res, 409, "work_hub.invalid_operation", error.message);
    req.log?.error({ err: error }, "Workforce operation failed");
    return sendApiError(res, 503, "server.internal_error", "The result is unverified. Check the saved operation before retrying.");
  }
});
export default router;
