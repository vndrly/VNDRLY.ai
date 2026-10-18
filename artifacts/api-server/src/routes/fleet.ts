import { createFleetWorkRouter } from "./fleet-work";
import { RequiredWorkError } from "../work-hub/required-work-guard";
import { withNativeLocationCollection } from "../services/native-operations";
import { NativeOperationError } from "../services/native-operations-policy";
import { Router } from "express";
import { createFleetComplianceRouter } from "./fleet-compliance";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import {FleetCanonicalIdSchema} from "@workspace/api-zod";
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
router.use(createFleetComplianceRouter(service, actor));
router.use(createFleetWorkRouter({actor}));
router.get("/fleet/monitoring",endpoint(req=>service.readFleetMonitoring(actor(req))));
router.post("/fleet/monitoring",endpoint(req=>service.saveFleetTrigger(actor(req),req.body)));
router.get("/fleet/runs/:id/assignment-delivery",endpoint(req=>service.readFleetAssignmentDelivery(actor(req),z.uuid().parse(req.params.id))));
router.post("/fleet/runs/:id/monitoring/evaluate",endpoint(req=>service.evaluateFleetRunTriggers(actor(req),z.uuid().parse(req.params.id))));
router.get("/fleet/runs/:id/events", endpoint(req=>service.eventHistory(actor(req),z.uuid().parse(req.params.id),req.query)));
router.get("/fleet/location-observations",endpoint(req=>service.locationObservationPage(actor(req),req.query)));
router.post("/fleet/workdays/events", endpoint(req => service.recordWorkday(actor(req), req.body)));
router.get("/fleet/workdays/operations/:operationId", endpoint(req => service.workdayOperation(actor(req), z.uuid().parse(req.params.operationId))));
router.get("/fleet/workdays/:id", endpoint(req => service.workday(actor(req), z.uuid().parse(req.params.id))));
router.get("/fleet/drivers/:driverUserId/workdays", endpoint(req => service.driverWorkdays(actor(req), z.coerce.number().int().positive().parse(req.params.driverUserId), req.query)));
router.get("/fleet/run-orders",endpoint(req=>service.readFleetRunOrders(actor(req),req.query)));
router.get("/fleet/run-orders/operations/:operationId",endpoint(req=>service.fleetRunOrderReceipt(actor(req),z.uuid().parse(req.params.operationId))));
router.get("/fleet/run-orders/:id/history",endpoint(req=>service.fleetRunOrderHistory(actor(req),z.uuid().parse(req.params.id),req.query)));
router.get("/fleet/run-orders/:id/locations",endpoint(req=>service.fleetRunOrderLocations(actor(req),z.uuid().parse(req.params.id))));
router.get("/fleet/run-orders/:id",endpoint(req=>service.fleetRunOrder(actor(req),z.uuid().parse(req.params.id))));
router.post("/fleet/run-orders",endpoint(req=>service.saveFleetRunOrder(actor(req),req.body)));
router.patch("/fleet/run-orders/:id",endpoint(req=>{
 if(FleetCanonicalIdSchema.parse(req.body?.order?.id)!==FleetCanonicalIdSchema.parse(req.params.id))throw new FleetError("fleet.invalid_request",400);
 return service.saveFleetRunOrder(actor(req),req.body);
}));
router.get("/fleet/details", endpoint(req => service.readFleetDetails(actor(req), req.query)));
router.get("/fleet/details/operations/:operationId", endpoint(req => service.fleetResourceReceipt(actor(req), z.uuid().parse(req.params.operationId))));
router.get("/fleet/details/:id/history", endpoint(req => service.fleetResourceHistory(actor(req), "detail", z.uuid().parse(req.params.id), req.query)));
router.get("/fleet/details/:id", endpoint(req => service.fleetDetailSnapshot(actor(req), z.uuid().parse(req.params.id))));
router.post("/fleet/details", endpoint(req => service.saveFleetDetail(actor(req), req.body)));
router.patch("/fleet/details/:id", endpoint(req => {
  if (FleetCanonicalIdSchema.parse(req.body?.detail?.id) !== FleetCanonicalIdSchema.parse(req.params.id)) throw new FleetError("fleet.invalid_request", 400);
  return service.saveFleetDetail(actor(req), req.body);
}));
router.get("/fleet/rig-packages", endpoint(req => service.readFleetRigPackages(actor(req), req.query)));
router.get("/fleet/rig-packages/operations/:operationId", endpoint(req => service.fleetResourceReceipt(actor(req), z.uuid().parse(req.params.operationId))));
router.get("/fleet/rig-packages/:id/history", endpoint(req => service.fleetResourceHistory(actor(req), "rig_package", z.uuid().parse(req.params.id), req.query)));
router.get("/fleet/rig-packages/:id", endpoint(req => service.fleetRigPackage(actor(req), z.uuid().parse(req.params.id))));
router.post("/fleet/rig-packages", endpoint(req => service.saveFleetRigPackage(actor(req), req.body)));
router.patch("/fleet/rig-packages/:id", endpoint(req => {
  if (FleetCanonicalIdSchema.parse(req.body?.package?.id) !== FleetCanonicalIdSchema.parse(req.params.id)) throw new FleetError("fleet.invalid_request", 400);
  return service.saveFleetRigPackage(actor(req), req.body);
}));
router.get("/fleet/inventory", endpoint(req => service.fleetInventory(actor(req), req.query)));
router.get("/fleet/inventory/operations/:operationId", endpoint(req => service.fleetInventoryReceipt(actor(req), z.uuid().parse(req.params.operationId))));
router.get("/fleet/inventory/:assetId", endpoint(req => service.fleetInventoryDetail(actor(req), z.uuid().parse(req.params.assetId))));
router.post("/fleet/inventory", endpoint(req => service.createFleetAsset(actor(req), req.body)));
router.post("/fleet/inventory/:assetId/enroll", endpoint(req => service.enrollFleetAsset(actor(req), z.uuid().parse(req.params.assetId), req.body)));
router.patch("/fleet/inventory/:assetId", endpoint(req => service.editFleetAsset(actor(req), z.uuid().parse(req.params.assetId), req.body)));
router.get("/fleet/runs/:id/location-history",endpoint(req=>service.locationHistory(actor(req),z.uuid().parse(req.params.id))));
router.get("/fleet/map-context",endpoint(req=>service.mapContext(actor(req))));
router.get("/fleet/commercial",endpoint(req=>service.commercialSettings(actor(req),req.query.siteId?z.coerce.number().int().positive().parse(req.query.siteId):undefined)));
router.get("/fleet/billing-options",endpoint(req=>service.billingOptions(actor(req),req.query)));
router.post("/fleet/tickets/:ticketId/finalize",endpoint(req=>service.finalizeTicket(actor(req),z.coerce.number().int().positive().parse(req.params.ticketId),req.body)));
router.get("/fleet/destinations/recommend",endpoint(req=>service.recommendDestinations(actor(req),z.coerce.number().int().positive().parse(req.query.siteId),z.string().trim().max(80).optional().parse(req.query.material))));
router.post("/fleet/destinations",endpoint(req=>service.saveDestination(actor(req),req.body)));
router.post("/fleet/commercial/default",endpoint(req=>service.saveCommercialDefault(actor(req),req.body)));
router.get("/fleet/tickets/:ticketId/plan",endpoint(req=>service.ticketPlan(actor(req),z.coerce.number().int().positive().parse(req.params.ticketId))));
router.post("/fleet/tickets/:ticketId/plan",endpoint(req=>service.saveTicketPlan(actor(req),z.coerce.number().int().positive().parse(req.params.ticketId),req.body)));
router.post("/fleet/tickets/:ticketId/plan/close",endpoint(req=>service.closeTicketPlan(actor(req),z.coerce.number().int().positive().parse(req.params.ticketId),req.body)));

router.get(
  "/fleet/drivers/:driverUserId/availability",
  endpoint((req) =>
    service.driverAvailability(
      actor(req),
      z.coerce.number().int().positive().parse(req.params.driverUserId),
    ),
  ),
);
router.post(
  "/fleet/drivers/:driverUserId/availability",
  endpoint((req) => {
    const driverUserId = z.coerce
      .number()
      .int()
      .positive()
      .parse(req.params.driverUserId);
    if (req.body?.driverUserId !== driverUserId)
      throw new FleetError("fleet.invalid_request", 400);
    return service.recordDriverAvailability(actor(req), req.body);
  }),
);
router.get(
  "/fleet/drivers/:driverUserId/availability/operations/:operationId",
  endpoint((req) =>
    service.driverAvailabilityOperation(
      actor(req),
      z.coerce.number().int().positive().parse(req.params.driverUserId),
      z.uuid().parse(req.params.operationId),
    ),
  ),
);
router.get(
  "/fleet/runs/:id/review-packet",
  endpoint((req) =>
    service.reviewPacket(actor(req), z.uuid().parse(req.params.id)),
  ),
);
router.get(
  "/fleet/runs/:id/replacements",
  endpoint((req) =>
    service.replacements(actor(req), z.uuid().parse(req.params.id)),
  ),
);
router.post(
  "/fleet/runs/:id/replacements",
  endpoint((req) =>
    service.proposeReplacement(
      actor(req),
      z.uuid().parse(req.params.id),
      req.body,
    ),
  ),
);
router.post(
  "/fleet/runs/:id/replacements/:replacementId/actions",
  endpoint((req) =>
    service.replacementAction(
      actor(req),
      z.uuid().parse(req.params.id),
      z.uuid().parse(req.params.replacementId),
      req.body,
    ),
  ),
);
router.get(
  "/fleet/runs/:id/cargo-transfers",
  endpoint((req) =>
    service.cargoTransfers(actor(req), z.uuid().parse(req.params.id)),
  ),
);
router.get(
  "/fleet/cargo-transfers/:id",
  endpoint((req) =>
    service.cargoTransfer(actor(req), z.uuid().parse(req.params.id)),
  ),
);
router.post(
  "/fleet/cargo-transfers",
  endpoint((req) => service.prepareCargoTransfer(actor(req), req.body)),
);
router.post(
  "/fleet/cargo-transfers/:id/actions",
  endpoint((req) =>
    service.cargoAction(actor(req), z.uuid().parse(req.params.id), req.body),
  ),
);
router.get(
  "/fleet/runs/:id/evidence",
  endpoint((req) =>
    service.evidence(actor(req), z.uuid().parse(req.params.id)),
  ),
);
router.post(
  "/fleet/runs/:id/evidence",
  endpoint((req) =>
    service.addEvidence(actor(req), z.uuid().parse(req.params.id), req.body),
  ),
);
router.get("/fleet/runs/:id/evidence/:evidenceId/file", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const result = await service.evidenceFile(
      actor(req),
      z.uuid().parse(req.params.id),
      z.uuid().parse(req.params.evidenceId),
    );
    res.setHeader("Content-Type", result.object.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fleet-${result.record.evidenceId}.${result.record.contentType === "application/pdf" ? "pdf" : result.record.contentType === "image/png" ? "png" : result.record.contentType === "image/webp" ? "webp" : "jpg"}"`,
    );
    res.setHeader("Content-Length", String(result.object.size));
    res.send(result.object.body);
  } catch (error) {
    if (error instanceof FleetError) {
      res.status(error.status).json({ code: error.code });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ code: "fleet.invalid_request" });
      return;
    }
    req.log?.error({ err: error }, "Fleet evidence read failed");
    res.status(500).json({ code: "fleet.internal_error" });
  }
});
router.patch(
  "/fleet/runs/:id/draft",
  endpoint((req) =>
    service.editDraft(actor(req), z.uuid().parse(req.params.id), req.body),
  ),
);
router.get(
  "/fleet/runs/:id/eta",
  endpoint((req) => service.eta(actor(req), z.uuid().parse(req.params.id))),
);
router.post(
  "/fleet/runs/:id/location",
  endpoint((req) =>
    withNativeLocationCollection(
      getSessionFromRequest(req)!,
      req.header("x-vndrly-device-id"),
      async () =>
        service.recordLocation(
          actor(req),
          z.uuid().parse(req.params.id),
          req.body,
        ),
    ).catch((error) => {
      if (error instanceof NativeOperationError)
        throw new FleetError(error.code, error.status);
      throw error;
    }),
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
    readOnly: s.realm === "demo" || s.publicDemo === true,
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
    if (error instanceof RequiredWorkError) { res.status(error.status).json({ code: error.code, message: error.message, assignments: error.assignments }); return; }
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
router.get("/fleet/service-templates",endpoint(req=>service.serviceTemplates(actor(req))));
router.get("/fleet/service-templates/:id",endpoint(req=>service.serviceTemplate(actor(req),z.coerce.number().int().positive().parse(req.params.id),req.query.revision===undefined?undefined:z.coerce.number().int().positive().parse(req.query.revision))));
export default router;
