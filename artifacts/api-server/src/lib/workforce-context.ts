import type { RequestHandler } from "express";
import { getSessionFromRequest } from "./session";
import { sendApiError } from "./apiError";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { AssistantOAuthError } from "../assistant/chatgpt-oauth";
import { logger } from "./logger";

const contextHeaders = ["X-VNDRLY-Actor-User", "X-VNDRLY-Vendor", "X-VNDRLY-Membership"] as const;

/** Optional for existing clients. A mounted Workforce view binds every request
 * to its original actor/company/membership even if another tab replaces cookies. */
export const expectedWorkforceContext: RequestHandler = async (req, res, next) => {
  const values = contextHeaders.map(name => req.get(name));
  if (values.every(value => value === undefined)) { next(); return; }
  res.setHeader("Cache-Control", "private, no-store");
  if (values.some(value => !value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    sendApiError(res, 409, "workforce.context_changed", "Refresh Workforce in the current account before continuing"); return;
  }
  const session = getSessionFromRequest(req);
  if (!session?.userId) { sendApiError(res, 401, "auth.unauthenticated", "Sign in to continue"); return; }
  try {
    // Cookie fields alone are not authority: re-resolve the active context from DB.
    const fresh = await validateAssistantSession(session);
    if (values[0] !== String(fresh.userId) || values[1] !== String(fresh.vendorId) || values[2] !== String(fresh.activeMembershipId)) {
      sendApiError(res, 409, "workforce.context_changed", "Refresh Workforce in the current account before continuing"); return;
    }
    next();
  } catch (error) {
    if (error instanceof AssistantOAuthError) { sendApiError(res, 403, "work_hub.forbidden", "Current company membership is required"); return; }
    logger.error({ err: error }, "Workforce context verification failed");
    sendApiError(res, 503, "server.internal_error", "Current Workforce account could not be verified");
  }
};
