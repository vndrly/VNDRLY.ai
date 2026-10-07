import { Router } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import {
  databaseFleetRepository,
  FleetError,
} from "../services/fleet-repository";
import { createFleetService, type FleetActor } from "../services/fleet-ops";
const router = Router();
const service = createFleetService(databaseFleetRepository);
function actor(req: Parameters<typeof getSessionFromRequest>[0]): FleetActor {
  const s = getSessionFromRequest(req);
  if (!s?.userId) throw new FleetError("fleet.login_required", 401);
  if (!s.vendorId || !["vendor", "field_employee"].includes(s.role ?? ""))
    throw new FleetError("fleet.company_required", 403);
  return {
    userId: s.userId,
    companyId: s.vendorId,
    sv: s.sv,
    activeMembershipId: s.activeMembershipId,
    membershipRole: s.membershipRole,
    role: s.role,
    vendorPeopleId: s.vendorPeopleId,
  };
}
function endpoint(
  operation: (req: import("express").Request) => Promise<unknown>,
) {
  return async (
    req: import("express").Request,
    res: import("express").Response,
  ) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      return res.json(await operation(req));
    } catch (error) {
      if (error instanceof FleetError)
        return res.status(error.status).json({ code: error.code });
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ code: "fleet.invalid_request", details: error.issues });
      req.log?.error({ err: error }, "Fleet request failed");
      return res.status(500).json({ code: "fleet.internal_error" });
    }
  };
}
router.get(
  "/fleet/overview",
  endpoint((req) => service.overview(actor(req))),
);
router.get(
  "/fleet/resources",
  endpoint((req) => service.resources(actor(req))),
);
router.get(
  "/fleet/runs/:id",
  endpoint((req) => service.detail(actor(req), z.uuid().parse(req.params.id))),
);
router.post("/fleet/preferences",endpoint(req=>service.preference(actor(req),req.body)));
router.get(
  "/fleet/setup",
  endpoint((req) => service.setupRead(actor(req))),
);
router.post(
  "/fleet/setup",
  endpoint((req) => service.setup(actor(req), req.body)),
);
router.post(
  "/fleet/runs",
  endpoint((req) => service.create(actor(req), req.body)),
);
router.post(
  "/fleet/runs/:id/actions",
  endpoint((req) =>
    service.action(actor(req), z.uuid().parse(req.params.id), req.body),
  ),
);
export default router;
