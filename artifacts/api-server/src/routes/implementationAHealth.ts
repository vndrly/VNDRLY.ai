import { Router, type Request, type Response } from "express";
import { getSessionFromRequest } from "../lib/session";
import { getOperationsHealth } from "../services/operations-health";

const router = Router();

function context(req: Request) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) throw Object.assign(new Error("Sign in required"), { status: 401, code: "operations_health.unauthenticated" });
  if (session.role !== "admin" && session.membershipRole !== "admin") {
    throw Object.assign(new Error("Company administrator access required"), { status: 403, code: "operations_health.admin_required" });
  }
  const owner = session.vendorId
    ? ({ type: "vendor", id: session.vendorId } as const)
    : session.partnerId
      ? ({ type: "partner", id: session.partnerId } as const)
      : null;
  if (!owner) throw Object.assign(new Error("Active company context required"), { status: 403, code: "operations_health.owner_required" });
  return owner;
}

router.get("/implementation-a/operations-health", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(await getOperationsHealth(context(req)));
  } catch (error) {
    const value = error as { status?: number; code?: string; message?: string };
    return res.status(value.status ?? 500).json({ code: value.code ?? "operations_health.internal_error", message: value.message });
  }
});

export default router;
