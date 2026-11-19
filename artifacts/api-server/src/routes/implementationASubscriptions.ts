import { Router, type Response } from "express";
import { z } from "zod/v4";
import { CreateEmployeeSubscriptionSchema, UpdateEmployeeSubscriptionSchema } from "@workspace/api-zod";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { EmployeeSubscriptionError, readEmployeeSubscriptions, readMyEmployeeSubscriptions, saveEmployeeSubscription } from "../services/employee-subscriptions";

const router = Router();
function failure(res: Response, error: unknown) {
  if (error instanceof EmployeeSubscriptionError) return res.status(error.status).json({ code: error.code, error: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ code: "subscription.invalid_fields", error: "Check the subscription details and employee." });
  console.error("Employee subscription request failed", error);
  return res.status(500).json({ code: "subscription.request_failed", error: "Could not save or load subscriptions. Please retry." });
}
router.use("/implementation-a/subscriptions", async (req, res, next) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) return res.status(401).json({ error: "Sign in to view subscriptions." });
  try { res.locals.subscriptionSession = await validateAssistantSession(session); }
  catch { return res.status(403).json({ error: "Your account context changed. Sign in again." }); }
  res.setHeader("Cache-Control", "no-store"); next();
});
const currentSession = (res: Response) => res.locals.subscriptionSession as SessionPayload;
router.get("/implementation-a/subscriptions/mine", async (_req, res) => {
  try { return res.json(await readMyEmployeeSubscriptions(currentSession(res).userId!)); }
  catch (error) { return failure(res, error); }
});
router.get("/implementation-a/subscriptions", async (_req, res) => {
  try { return res.json(await readEmployeeSubscriptions(currentSession(res))); }
  catch (error) { return failure(res, error); }
});
router.post("/implementation-a/subscriptions", async (req, res) => {
  try {
    const { operationId, ...fields } = CreateEmployeeSubscriptionSchema.parse(req.body);
    return res.status(201).json({ subscription: await saveEmployeeSubscription(currentSession(res), fields, { operationId }) });
  } catch (error) { return failure(res, error); }
});
router.put("/implementation-a/subscriptions/:id", async (req, res) => {
  try {
    const id = z.uuid().parse(req.params.id), { expectedVersion, ...fields } = UpdateEmployeeSubscriptionSchema.parse(req.body);
    return res.json({ subscription: await saveEmployeeSubscription(currentSession(res), fields, { id, expectedVersion }) });
  } catch (error) { return failure(res, error); }
});
export default router;
