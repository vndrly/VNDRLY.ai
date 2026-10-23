import { Router } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { createGateArrivalsService, GateArrivalsError } from "../services/gate-arrivals";
import { OfflineGateError } from "../services/gate-offline-observation";

export function createGateArrivalsRouter(service = createGateArrivalsService()) {
  const router = Router();
  const query = z.object({siteLocationId:z.coerce.number().int().positive()}).strict();
  router.get("/gate-arrivals/visit/:visitId",async(req,res)=>{
    res.setHeader("Cache-Control","private, no-store");
    const session=getSessionFromRequest(req);
    if (!session?.userId) {res.status(401).json({code:"auth.unauthenticated"});return;}
    try {
      const {siteLocationId}=query.parse(req.query),visitId=z.coerce.number().int().positive().parse(req.params.visitId);
      res.json(await service.visitLinks(session,siteLocationId,visitId));
    } catch(error) {
      const known=error instanceof GateArrivalsError || error instanceof OfflineGateError;
      res.status(known?error.status:error instanceof z.ZodError?400:500).json({code:known?error.code:"gate_arrivals.unavailable"});
    }
  });
  for (const path of ["/gate-arrivals", "/gate-arrivals/:runId"]) {
    router.get(path, async (req,res) => {
      res.setHeader("Cache-Control","private, no-store");
      const session = getSessionFromRequest(req);
      if (!session?.userId) { res.status(401).json({code:"auth.unauthenticated"}); return; }
      try {
        const {siteLocationId} = query.parse(req.query);
        const runId = req.params.runId ? z.uuid().parse(req.params.runId) : null;
        res.json(runId ? await service.detail(session,siteLocationId,runId) : await service.list(session,siteLocationId));
      } catch (error) {
        const known = error instanceof GateArrivalsError || error instanceof OfflineGateError;
        res.status(known ? error.status : error instanceof z.ZodError ? 400 : 500)
          .json({code:known ? error.code : error instanceof z.ZodError ? "gate_arrivals.invalid_request" : "gate_arrivals.unavailable"});
      }
    });
  }
  return router;
}
export default createGateArrivalsRouter();
