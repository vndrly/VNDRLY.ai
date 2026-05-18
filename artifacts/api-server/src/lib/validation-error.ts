import type { Response } from "express";

import {
  VALIDATION_FAILED,
  zodErrorToWire,
  type ValidationFailedBody,
  type ZodErrorLike,
} from "@workspace/zod-validation-issues";

/**
 * Send a 400 response for a failed `safeParse`. The body always
 * includes the structured `issues` array so the mobile/web clients
 * can render per-field localized messages.
 *
 * Usage
 * -----
 *
 * Without a route-specific code (the new default — produces
 * `code: "validation.failed"`):
 *
 *   const parsed = CreateTicketBody.safeParse(req.body);
 *   if (!parsed.success) {
 *     sendValidationFailed(res, parsed.error);
 *     return;
 *   }
 *
 * With a more specific semantic code (kept for routes whose error
 * has a stable identifier the client already translates, e.g.
 * `ticket.invalid_check_in_body`):
 *
 *   const parsed = CheckInTicketBody.safeParse(req.body);
 *   if (!parsed.success) {
 *     sendValidationFailed(res, parsed.error, {
 *       code: "ticket.invalid_check_in_body",
 *       error: "invalid_check_in_body",
 *     });
 *     return;
 *   }
 *
 * In both cases, the wire body now includes:
 *   - `code` (defaults to `"validation.failed"`)
 *   - `error` (defaults to the same as `code`)
 *   - `message` (English, for logs and dev tools)
 *   - `issues` (structured Zod issues — `path` + `code` + bound info,
 *     translated per-issue on the client)
 *
 * Why both forms ship `issues`
 * ----------------------------
 * Even when a route has a meaningful semantic code (so the client
 * has a single localized banner-level string to show), the mobile
 * forms can ALSO pin per-control errors next to the offending input
 * by walking the `issues` array. The server doesn't have to choose
 * between the two — both consumers get what they need from the same
 * body.
 */
export function sendValidationFailed(
  res: Response,
  error: ZodErrorLike,
  options?: { code?: string; error?: string; status?: number },
): void {
  const status = options?.status ?? 400;
  const body: ValidationFailedBody = zodErrorToWire(error, {
    code: options?.code,
    error: options?.error,
  });
  res.status(status).json(body);
}

export { VALIDATION_FAILED };
