import { Router } from "express";
import { getSessionFromRequest } from "../lib/session";
import { expectedWorkforceContext } from "../lib/workforce-context";
import { recordWorkflowHelperCompletion, WorkflowHelperError } from "../services/workflow-helper-progress";

const router = Router();
router.post("/workflow-helpers/completions", expectedWorkforceContext, async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  const session = getSessionFromRequest(req);
  if (!session?.userId) { res.status(401).json({ message: "Sign in required" }); return; }
  try { res.json(await recordWorkflowHelperCompletion(session, req.body)); }
  catch (error) {
    if (error instanceof WorkflowHelperError) res.status(error.status).json({ message: error.message, code: error.code });
    else next(error);
  }
});
export default router;
