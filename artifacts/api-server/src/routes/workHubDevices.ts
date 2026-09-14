import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { db, userOrgMembershipsTable, workHubAudioLeasesTable } from "@workspace/db";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import {
  deviceCoordinator,
  WorkHubDeviceError,
  type DeviceActor,
} from "../work-hub/device-coordinator";
import { getDevicePreferences, saveDevicePreferences } from "../work-hub/device-preferences";
import { appendWorkHubAudit } from "../work-hub/audit";
import { fenceAudioLeasesForDevice } from "../work-hub/audio-lease-database";

const router: IRouter = Router();
const uuid = z.string().uuid();
const capabilitiesSchema = z.object({
  microphone: z.boolean().optional(), speaker: z.boolean().optional(), camera: z.boolean().optional(),
  fileSelection: z.boolean().optional(), pushNotifications: z.boolean().optional(), operationsDisplayControl: z.boolean().optional(),
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
const preferencesSchema = z.object({
  rankedDeviceIds: z.array(uuid).max(20), automaticBackupDeviceIds: z.array(uuid).max(20), clearLearning: z.boolean().optional(),
}).strict();
const renameSchema = z.object({ friendlyName: z.string().trim().min(1).max(80) }).strict();

function isOrganizationAdmin(session: SessionPayload): boolean {
  return session.role === "admin" || (session as SessionPayload & { membershipRole?: string | null }).membershipRole === "admin";
}

function deviceAuditSource(req: Request): "web" | "ios" {
  return req.get("x-work-hub-source") === "ios" ? "ios" : "web";
}

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
  res.locals.deviceActor = actor;
  res.locals.deviceAdmin = isOrganizationAdmin(getSessionFromRequest(req)!);
  return next();
});

router.post("/work-hub/devices/register", async (req, res) => {
  try { const row = await deviceCoordinator.registerDevice(res.locals.deviceActor, registerSchema.parse(req.body)); await appendWorkHubAudit({ actorUserId: res.locals.deviceActor.userId, owner: res.locals.deviceActor.owner, action: "device.registered", subjectType: "work_hub_device", subjectId: row.id, source: deviceAuditSource(req), metadata: { deviceClass: row.deviceClass } }); return res.status(201).json(row); }
  catch (error) { return handleError(res, error); }
});
router.post("/work-hub/devices/:deviceId/heartbeat", async (req, res) => {
  try { const row = await deviceCoordinator.heartbeatDevice(res.locals.deviceActor, uuid.parse(req.params.deviceId), heartbeatSchema.parse(req.body)); return res.json(row); }
  catch (error) { return handleError(res, error); }
});
async function deviceStatusRows(actor: DeviceActor, organization: boolean) {
  const devices = organization
    ? await deviceCoordinator.listOrganizationDevices(actor)
    : await deviceCoordinator.listDevices(actor);
  const live = devices.filter((device) => !device.revokedAt);
  const ids = live.map((device) => device.id);
  const connections = ids.length
    ? await deviceCoordinator.listDeviceConnections(actor, organization)
    : [];
  const audio = ids.length
    ? await db.select({ deviceId: workHubAudioLeasesTable.deviceId }).from(workHubAudioLeasesTable).where(and(
        inArray(workHubAudioLeasesTable.deviceId, ids),
        eq(workHubAudioLeasesTable.state, "active"),
        gt(workHubAudioLeasesTable.expiresAt, new Date()),
      )).limit(100)
    : [];
  return devices.map((device) => {
    const seen = connections.filter((connection) => connection.deviceId === device.id).sort((left, right) => right.seenAt.getTime() - left.seenAt.getTime())[0];
    return { ...device, connected: Boolean(seen), lastSeenAt: seen?.seenAt ?? null, currentAudioOwner: audio.some((lease) => lease.deviceId === device.id) };
  });
}
router.get("/work-hub/devices", async (req, res) => {
  if (req.query.scope === "organization") {
    if (!res.locals.deviceAdmin) return sendApiError(res, 404, "work_hub.not_found", "Not found");
    return res.json(await deviceStatusRows(res.locals.deviceActor, true));
  }
  return res.json(await deviceStatusRows(res.locals.deviceActor, false));
});
router.get("/work-hub/devices/preferences", async (_req, res) => res.json(await getDevicePreferences(res.locals.deviceActor)));
router.put("/work-hub/devices/preferences", async (req, res) => {
  try {
    const input = preferencesSchema.parse(req.body);
    const devices = await deviceCoordinator.listDevices(res.locals.deviceActor);
    const owned = new Set(devices.filter(device => !device.revokedAt).map(device => device.id));
    const rankedDeviceIds = [...new Set(input.rankedDeviceIds)];
    const automaticBackupDeviceIds = [...new Set(input.automaticBackupDeviceIds)];
    if (![...rankedDeviceIds, ...automaticBackupDeviceIds].every(id => owned.has(id))) return sendApiError(res, 404, "work_hub.not_found", "Device not found");
    const current = await getDevicePreferences(res.locals.deviceActor);
    const saved = await saveDevicePreferences(res.locals.deviceActor, { rankedDeviceIds, automaticBackupDeviceIds, learning: input.clearLearning ? {} : current.learning });
    await appendWorkHubAudit({ actorUserId: res.locals.deviceActor.userId, owner: res.locals.deviceActor.owner, action: input.clearLearning ? "device.learning_cleared" : "device.preferences_updated", subjectType: "work_hub_device_preferences", subjectId: res.locals.deviceActor.userId, source: deviceAuditSource(req), metadata: { rankedDeviceIds, automaticBackupDeviceIds } });
    return res.json(saved);
  } catch (error) { return handleError(res, error); }
});
router.patch("/work-hub/devices/:deviceId", async (req, res) => {
  try {
    const row = await deviceCoordinator.renameDevice(res.locals.deviceActor, uuid.parse(req.params.deviceId), renameSchema.parse(req.body).friendlyName);
    await appendWorkHubAudit({ actorUserId: res.locals.deviceActor.userId, owner: res.locals.deviceActor.owner, action: "device.renamed", subjectType: "work_hub_device", subjectId: row.id, source: deviceAuditSource(req) });
    return res.json(row);
  } catch (error) { return handleError(res, error); }
});
router.delete("/work-hub/devices/:deviceId", async (req, res) => {
  try {
    const deviceId = uuid.parse(req.params.deviceId);
    const organizationScope = req.query.scope === "organization";
    if (organizationScope && !res.locals.deviceAdmin) return sendApiError(res, 404, "work_hub.not_found", "Not found");
    await (organizationScope ? deviceCoordinator.revokeOrganizationDevice(res.locals.deviceActor, deviceId) : deviceCoordinator.revokeDevice(res.locals.deviceActor, deviceId));
    await fenceAudioLeasesForDevice(deviceId);
    await appendWorkHubAudit({ actorUserId: res.locals.deviceActor.userId, owner: res.locals.deviceActor.owner, action: "device.revoked", subjectType: "work_hub_device", subjectId: deviceId, source: deviceAuditSource(req), metadata: { organizationScope } });
    return res.status(204).end();
  }
  catch (error) { return handleError(res, error); }
});

export default router;
