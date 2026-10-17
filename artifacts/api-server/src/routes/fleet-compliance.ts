import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { FleetError } from "../services/fleet-repository";
import type { FleetActor } from "../services/fleet-ops";
import type { createFleetComplianceOperations } from "../services/fleet-compliance";
type Service = ReturnType<typeof createFleetComplianceOperations>;
export function createFleetComplianceRouter(
  service: Service,
  actor: (req: Request) => FleetActor,
) {
  const router = Router();
  const revision = (req: Request) =>
    req.query.revision === undefined
      ? undefined
      : z.coerce.number().int().positive().parse(req.query.revision);
  function endpoint(
    work: (req: Request, res: Response) => Promise<unknown>,
    binary = false,
  ) {
    return async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "private, no-store");
      try {
        const result = await work(req, res);
        if (!binary) res.json(result);
      } catch (error) {
        if (error instanceof FleetError) {
          res.status(error.status).json({ code: error.code });
          return;
        }
        if (error instanceof z.ZodError) {
          res.status(400).json({ code: "fleet.invalid_request" });
          return;
        }
        req.log?.error(
          {
            message:
              error instanceof Error ? error.message : "Private storage failed",
          },
          "Fleet compliance request failed",
        );
        res.status(500).json({ code: "fleet.internal_error" });
      }
    };
  }
  router.get(
    "/fleet/compliance/configuration",
    endpoint((req) => service.complianceConfiguration(actor(req))),
  );
  router.post(
    "/fleet/compliance/reviewers",
    endpoint((req) => service.saveComplianceReviewers(actor(req), req.body)),
  );
  router.post(
    "/fleet/compliance/requirements",
    endpoint((req) => service.adoptFleetRequirement(actor(req), req.body)),
  );
  router.get("/fleet/compliance/requirements",endpoint(req=>service.readFleetComplianceRequirements(actor(req))));
  router.get("/fleet/compliance/subjects",endpoint(req=>service.readFleetComplianceSubjects(actor(req),req.query)));
  router.get("/fleet/compliance/facts/:kind/:subjectId",endpoint(req=>{
    const kind=z.enum(["carrier","driver","vehicle","component","trip"]).parse(req.params.kind);
    const id=kind==="carrier"||kind==="driver"?z.coerce.number().int().positive().parse(req.params.subjectId):z.uuid().parse(req.params.subjectId);
    return req.query.revision===undefined?service.readFleetComplianceFacts(actor(req),{kind,id}):service.readFleetComplianceFacts(actor(req),{kind,id},revision(req));
  }));
  router.post(
    "/fleet/compliance/facts",
    endpoint((req) => service.recordFleetComplianceFacts(actor(req), req.body)),
  );
  router.post(
    "/fleet/compliance/assessments",
    endpoint((req) =>
      service.assessFleetComplianceSubjects(actor(req), req.body),
    ),
  );
  router.get(
    "/fleet/compliance",
    endpoint((req) =>
      service.readFleetComplianceRegister(actor(req), req.query),
    ),
  );
  router.post(
    "/fleet/compliance",
    endpoint((req) =>
      service.saveFleetComplianceEvidence(actor(req), req.body),
    ),
  );
  router.post(
    "/fleet/compliance/documents",
    endpoint((req) => service.uploadComplianceDocument(actor(req), req.body)),
  );
  router.post(
    "/fleet/compliance/:id/review",
    endpoint((req) => {
      const id = z.uuid().parse(req.params.id);
      if (req.body?.evidenceId !== id)
        throw new FleetError("fleet.invalid_request", 400);
      return service.verifyFleetComplianceEvidence(actor(req), req.body);
    }),
  );
  router.get(
    "/fleet/compliance/:id/receipt",
    endpoint(req => service.readFleetComplianceReceipt(actor(req), z.uuid().parse(req.params.id), z.coerce.number().int().positive().parse(req.query.revision))),
  );
  router.get(
    "/fleet/compliance/:id/private",
    endpoint((req) =>
      service.readPrivateComplianceRecord(
        actor(req),
        z.uuid().parse(req.params.id),
        revision(req),
      ),
    ),
  );
  router.get(
    "/fleet/compliance/:id/document",
    endpoint(async (req, res) => {
      const file = await service.readComplianceDocument(
        actor(req),
        z.uuid().parse(req.params.id),
        revision(req),
      );
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Length", String(file.size));
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(file.body);
    }, true),
  );
  return router;
}
