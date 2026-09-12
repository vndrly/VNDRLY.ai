import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, userOrgMembershipsTable } from "@workspace/db";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import {
  deviceCoordinator,
  WorkHubDeviceError,
  type DeviceActor,
} from "../work-hub/device-coordinator";

const router: IRouter = Router();
const uuid = z.string().uuid();
const capabilitiesSchema = z.object({
  microphone: z.boolean().optional(), speaker: z.boolean().optional(), camera: z.boolean().optional(),
  fileSelection: z.boolean().optional(), pushNotifications: z.boolean().optional(),
}).strict();
const surfaceSchema = z.object({
  path: z.string().trim().min(1).max(512), entityType: z.string().trim().max(80).nullable(),
  entityId: z.string().trim().max(160).nullable(), updatedAt: z.number().int().nonnegative(),
}).strict();
const registerSchema = z.object({
  deviceId: uuid.optional(), friendlyName: z.string().trim().min(1).max(80),
  deviceClass: z.string().trim().min(1).max(32), capabilities: capabilitiesSchema.default({}),
}).strict();
const heartbeatSchema = z.object({
  connectionId: uuid, foreground: z.boolean(),
  microphonePermission: z.enum(["unknown", "granted", "denied"]),
  surface: surfaceSchema.nullable().optional(),
}).strict();

export function activeOwnerFromSession(session: SessionPayload & { userId: number }): DeviceActor | null {
  if (session.vendorId) return { userId: session.userId, owner: { type: "vendor", id: session.vendorId } };
  if (session.partnerId) return { userId: session.userId, owner: { type: "partner", id: session.partnerId } };
  return null;
}

export async function resolveActiveDeviceActor(req: Request): Promise<DeviceActor | null> {
  const session = getSessionFromRequest(req);
  if (!session?.userId) return null;
  const actor = activeOwnerFromSession(session as SessionPayload & { userId: number });
  if (!actor) return null;
  if (session.role === "admin") return actor;
  const [membership] = await db.select({ id: userOrgMembershipsTable.id }).from(userOrgMembershipsTable).where(and(
    eq(userOrgMembershipsTable.userId, actor.userId), eq(userOrgMembershipsTable.orgType, actor.owner.type),
    actor.owner.type === "vendor" ? eq(userOrgMembershipsTable.vendorId, actor.owner.id) : eq(userOrgMembershipsTable.partnerId, actor.owner.id),
  )).limit(1);
  return membership ? actor : null;
}

function handleError(res: Response, error: unknown): Response {
  if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_payload", "Invalid device payload");
  if (error instanceof WorkHubDeviceError) return sendApiError(res, error.code === "work_hub.not_found" ? 404 : 400, error.code, error.message);
  throw error;
}

router.use("/work-hub/devices", async (req: Request, res: Response, next: NextFunction) => {
  if (!(await isWorkHubEnabled())) return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const actor = await resolveActiveDeviceActor(req);
  if (!getSessionFromRequest(req)?.userId) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
  if (!actor) return sendApiError(res, 404, "work_hub.not_found", "Not found");
  res.locals.deviceActor = actor; return next();
});

router.post("/work-hub/devices/register", async (req, res) => {
  try { const row = await deviceCoordinator.registerDevice(res.locals.deviceActor, registerSchema.parse(req.body)); return res.status(201).json(row); }
  catch (error) { return handleError(res, error); }
});
router.post("/work-hub/devices/:deviceId/heartbeat", async (req, res) => {
  try { const row = await deviceCoordinator.heartbeatDevice(res.locals.deviceActor, uuid.parse(req.params.deviceId), heartbeatSchema.parse(req.body)); return res.json(row); }
  catch (error) { return handleError(res, error); }
});
router.get("/work-hub/devices", async (_req, res) => res.json(await deviceCoordinator.listDevices(res.locals.deviceActor)));
router.delete("/work-hub/devices/:deviceId", async (req, res) => {
  try { await deviceCoordinator.revokeDevice(res.locals.deviceActor, uuid.parse(req.params.deviceId)); return res.status(204).end(); }
  catch (error) { return handleError(res, error); }
});

export default router;
