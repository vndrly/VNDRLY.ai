import { Router } from "express";
import { z } from "zod/v4";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { deleteGateDefinition, gateDefinitionList, saveGateDefinition } from "../work-hub/gate-shift-definitions";
import { gateShiftDefinitionSchema } from "../work-hub/gate-shift-definition-policy";
import { isWorkHubEnabled } from "../work-hub/feature-access";
const router = Router();
router.use("/work-hub/gate-shift-definitions", async (req, res, next) => {
  if (!getSessionFromRequest(req)?.userId) return res.status(401).json({ message: "Sign in required" });
  if (!(await isWorkHubEnabled())) return res.sendStatus(404);
  res.setHeader("Cache-Control", "no-store"); return next();
});
function failure(res: import("express").Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid shift definition" });
  const status = Number((error as { status?: number })?.status ?? 500);
  return res.status([400, 403, 404, 409, 422].includes(status) ? status : 500).json({ message: status === 500 ? "Shift definitions could not be saved. Please retry." : error instanceof Error ? error.message : "Shift definitions unavailable" });
}
router.get("/work-hub/gate-shift-definitions", async (req, res) => {
  try { return res.json(await gateDefinitionList(getSessionFromRequest(req)!, z.coerce.number().int().positive().parse(req.query.vendorId))); }
  catch (error) { return failure(res, error); }
});
router.post("/work-hub/gate-shift-definitions", async (req, res) => {
  try { const envelope = workHubCommandEnvelopeSchema.parse(req.body); return res.json(await saveGateDefinition(getSessionFromRequest(req)!, envelope, gateShiftDefinitionSchema.parse(envelope.payload))); }
  catch (error) { return failure(res, error); }
});
router.post("/work-hub/gate-shift-definitions/retire", async (req, res) => {
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const input = z.object({ id: z.uuid(), version: z.number().int().positive() }).parse(envelope.payload);
    return res.json(await deleteGateDefinition(getSessionFromRequest(req)!, envelope, input));
  } catch (error) { return failure(res, error); }
});
export default router;
