import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import {
  databaseFleetRepository,
  FleetError,
} from "../services/fleet-repository";
import { createFleetService, type FleetActor } from "../services/fleet-ops";
import {
  createFleetSiteActivityService,
  type FleetSiteActor,
} from "../services/fleet-site-activity";
import {
  createFleetSupportService,
  type FleetSupportActor,
} from "../services/fleet-support";
const router = Router();
const service = createFleetService(databaseFleetRepository);
router.get(
  "/fleet/runs/:id/eta",
  endpoint((req) => service.eta(actor(req), z.uuid().parse(req.params.id))),
);
router.post(
  "/fleet/runs/:id/location",
  endpoint((req) =>
    service.recordLocation(actor(req), z.uuid().parse(req.params.id), req.body),
  ),
);
router.get(
  "/fleet/locations",
  endpoint((req) => service.locationObservations(actor(req))),
);
const siteService = createFleetSiteActivityService(pool);
const supportService = createFleetSupportService(pool);
function supportActor(
  req: Parameters<typeof getSessionFromRequest>[0],
): FleetSupportActor {
  const s = getSessionFromRequest(req);
  if (!s?.userId) throw new FleetError("fleet.login_required", 401);
  if (s.role !== "admin" || typeof s.sv !== "number")
    throw new FleetError("fleet.support_authority_required", 403);
  return { userId: s.userId, sv: s.sv, role: "admin" };
}
router.get(
  "/fleet/support",
  endpoint((req) => supportService.companies(supportActor(req))),
);
router.get(
  "/fleet/support/:companyId",
  endpoint((req) =>
    supportService.read(
      supportActor(req),
      z.coerce.number().int().positive().parse(req.params.companyId),
      z.string().optional().parse(req.query.cursor),
    ),
  ),
);
function siteActor(
  req: Parameters<typeof getSessionFromRequest>[0],
): FleetSiteActor {
  const s = getSessionFromRequest(req);
  if (!s?.userId) throw new FleetError("fleet.login_required", 401);
  if (
    s.role !== "partner" ||
    typeof s.partnerId !== "number" ||
    typeof s.sv !== "number" ||
    typeof s.activeMembershipId !== "number" ||
    typeof s.membershipRole !== "string"
  )
    throw new FleetError("fleet.site_authority_required", 403);
  return {
    userId: s.userId,
    partnerId: s.partnerId,
    sv: s.sv,
    activeMembershipId: s.activeMembershipId,
    membershipRole: s.membershipRole,
    role: "partner",
  };
}
router.get(
  "/fleet/site-activity",
  endpoint((req) => siteService.sites(siteActor(req))),
);
router.get(
  "/fleet/site-activity/:siteId",
  endpoint((req) =>
    siteService.activity(
      siteActor(req),
      z.coerce.number().int().positive().parse(req.params.siteId),
      req.query,
    ),
  ),
);
router.get(
  "/fleet/runs/:id/gate-observations",
  endpoint((req) =>
    service.gateObservations(actor(req), z.uuid().parse(req.params.id)),
  ),
);
router.post(
  "/fleet/runs/:id/gate-links",
  endpoint((req) =>
    service.linkGateVisit(actor(req), z.uuid().parse(req.params.id), req.body),
  ),
);
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
router.get(
  "/fleet/reports",
  endpoint((req) =>
    service.report(actor(req), {
      ...req.query,
      ...(req.query.siteId
        ? { siteId: z.coerce.number().int().positive().parse(req.query.siteId) }
        : {}),
    }),
  ),
);
router.get(
  "/fleet/views",
  endpoint((req) => service.savedViews(actor(req))),
);
router.post(
  "/fleet/views",
  endpoint((req) => service.saveView(actor(req), req.body)),
);
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
  "/fleet/maintenance",
  endpoint((req) =>
    service.maintenanceList(
      actor(req),
      z.coerce.number().int().min(1).max(50).default(50).parse(req.query.limit),
      z.string().optional().parse(req.query.cursor),
    ),
  ),
);
router.get(
  "/fleet/maintenance/:id",
  endpoint((req) =>
    service.maintenanceDetail(actor(req), z.uuid().parse(req.params.id)),
  ),
);
router.post(
  "/fleet/maintenance",
  endpoint((req) => service.maintenanceCreate(actor(req), req.body)),
);
router.post(
  "/fleet/maintenance/:id/actions",
  endpoint((req) =>
    service.maintenanceAction(
      actor(req),
      z.uuid().parse(req.params.id),
      req.body,
    ),
  ),
);
router.get(
  "/fleet/overview",
  endpoint((req) =>
    service.overview({
      ...actor(req),
      runPage: {
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(50)
          .default(50)
          .parse(req.query.limit),
        cursor: z
          .string()
          .regex(/^\d{1,10}:\d{1,10}$/)
          .optional()
          .parse(req.query.cursor),
      },
    }),
  ),
);
router.get(
  "/fleet/resources",
  endpoint((req) => service.resources(actor(req))),
);
router.get(
  "/fleet/runs/:id",
  endpoint((req) => service.detail(actor(req), z.uuid().parse(req.params.id))),
);
router.post(
  "/fleet/preferences",
  endpoint((req) => service.preference(actor(req), req.body)),
);
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
