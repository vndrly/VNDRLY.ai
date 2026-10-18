import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  GateDailyBillingConfigureSchema,
  GateDailyBillingCloseSchema,
} from "@workspace/api-zod";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import {
  GateBillingError,
  gateDailyBillingService,
} from "../services/gate-daily-billing";
import { ChangeOverError } from "../services/gate-change-over";

export function createGateDailyBillingRouter(
  service: Pick<
    typeof gateDailyBillingService,
    "posts" | "setup" | "preview" | "configure" | "invoiceNow" | "receipt"
  > = gateDailyBillingService,
) {
  const router = Router();
  const endpoint =
    (action: (session: SessionPayload, req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "private, no-store");
      const session = getSessionFromRequest(req);
      if (!session?.userId)
        return res.status(401).json({ code: "auth.unauthenticated" });
      try {
        return res.json(await action(session, req));
      } catch (error) {
        if (
          error instanceof GateBillingError ||
          error instanceof ChangeOverError
        )
          return res.status(error.status).json({ code: error.code });
        if (error instanceof z.ZodError)
          return res.status(400).json({ code: "gate_billing.invalid_request" });
        req.log?.error({ err: error }, "Gate daily billing request failed");
        return res.status(500).json({ code: "gate_billing.internal_error" });
      }
    };
  router.get(
    "/gate-billing/posts",
    endpoint((session, req) =>
      service.posts(
        session,
        z.object({ after: z.uuid().optional() }).strict().parse(req.query),
      ),
    ),
  );
  router.get(
    "/gate-billing/:stationId/receipts/:operationId",
    endpoint((session, req) =>
      service.receipt(
        session,
        z.uuid().parse(req.params.stationId),
        z.uuid().parse(req.params.operationId),
      ),
    ),
  );
  router.get(
    "/gate-billing/:stationId/setup",
    endpoint((session, req) =>
      service.setup(session, z.uuid().parse(req.params.stationId)),
    ),
  );
  router.get(
    "/gate-billing/:stationId/preview",
    endpoint((session, req) =>
      service.preview(session, z.uuid().parse(req.params.stationId)),
    ),
  );
  router.post(
    "/gate-billing/:stationId/configure",
    endpoint((session, req) =>
      service.configure(
        session,
        z.uuid().parse(req.params.stationId),
        GateDailyBillingConfigureSchema.parse(req.body),
      ),
    ),
  );
  router.post(
    "/gate-billing/:stationId/invoice-now",
    endpoint((session, req) =>
      service.invoiceNow(
        session,
        z.uuid().parse(req.params.stationId),
        GateDailyBillingCloseSchema.parse(req.body),
      ),
    ),
  );
  return router;
}
export default createGateDailyBillingRouter();
