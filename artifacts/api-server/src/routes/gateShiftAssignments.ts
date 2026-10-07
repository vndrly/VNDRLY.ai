import { Router } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { ChangeOverError } from "../services/gate-change-over";
import { executeGateShiftAssignment, GateShiftAssignmentError, readGateShiftAssignment, readGateShiftCandidates, readShiftCreationOperation } from "../services/gate-shift-assignment";

const router = Router();
router.get("/work-hub/shifts/operations/:operationId", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSessionFromRequest(req);
  if (!session?.userId) return sendApiError(res, 401, "auth.unauthenticated", "Sign in to continue");
  try { return res.json(await readShiftCreationOperation(session, z.uuid().parse(req.params.operationId))); }
  catch (error) {
    if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "An exact saved operation is required");
    if (error instanceof GateShiftAssignmentError || error instanceof ChangeOverError) return sendApiError(res, error.status, error.code, "Current shift authority is required");
    return sendApiError(res, 503, "server.internal_error", "Creation result remains unverified");
  }
});
for (const [method, path, action] of [
  ["get", "/work-hub/shifts/:id/staffing-candidates", "candidates"],
  ["post", "/work-hub/shifts/:id/assignments", "assign"],
  ["get", "/work-hub/shifts/:id/assignments/operations/:operationId", "readback"],
  ["get", "/work-hub/shifts/:id/claim/operations/:operationId", "claim_readback"],
] as const) {
  router[method](path, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = getSessionFromRequest(req);
    if (!session?.userId) return sendApiError(res, 401, "auth.unauthenticated", "Sign in to continue");
    try {
      const shiftId = z.uuid().parse(req.params.id);
      const result = action === "candidates" ? await readGateShiftCandidates(session, shiftId)
        : action === "assign" ? await executeGateShiftAssignment(session, shiftId, req.body)
        : await readGateShiftAssignment(session, shiftId, z.uuid().parse((req.params as Record<string, string>).operationId), undefined, action === "claim_readback");
      return res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "Review the assignment fields");
      if (error instanceof GateShiftAssignmentError || error instanceof ChangeOverError) return sendApiError(res, error.status, error.code, "Review current Gate assignment authority and saved eligibility");
      if (error instanceof Error && /^(gate_assignment|gate_candidates)\./.test(error.message)) return sendApiError(res, 409, "work_hub.invalid_operation", error.message);
      return sendApiError(res, 503, "server.internal_error", "Assignment result is unverified. Check the saved operation before retrying.");
    }
  });
}
export default router;
