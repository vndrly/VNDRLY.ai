import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  cameraChannelsTable,
  cameraCredentialReferencesTable,
  cameraDevicesTable,
  cameraGatewaysTable,
  db,
  siteLocationsTable,
} from "@workspace/db";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { createCameraService, type CameraRepository } from "../cameras/service";

type SiteIdentity = { id: number; partnerId: number };
type GatewayCreateInput = { siteLocationId: number; name: string; createdByUserId: number };
type CredentialReferenceInput = {
  gatewayId: string;
  externalRef: string;
  label: string;
  scope: { permissions: ["view", ...string[]]; deviceStableKeys?: string[]; channelStableKeys?: string[] };
  createdByUserId: number;
};

export interface CameraRouteDependencies {
  getSite(siteId: number): Promise<SiteIdentity | null>;
  getGatewaySite(gatewayId: string): Promise<SiteIdentity | null>;
  getChannelSite(channelId: string): Promise<SiteIdentity | null>;
  listSiteCameras(siteId: number): Promise<unknown>;
  createGateway(input: GatewayCreateInput): Promise<{ gateway: unknown; enrollmentToken: string }>;
  addCredentialReference(input: CredentialReferenceInput): Promise<unknown>;
  authenticateGateway(gatewayId: string, token: string): Promise<boolean>;
  heartbeatGateway(input: {
    gatewayId: string;
    softwareVersion?: string;
    playbackBaseUrl?: string;
    seenAt: Date;
  }): Promise<void>;
  reconcileInventory(input: { gatewayId: string; devices: unknown[] }): Promise<unknown>;
  createPlaybackDescriptor(channelId: string, protocol: "webrtc" | "hls"): Promise<unknown>;
}

const id = z.string().uuid();
const numericId = z.coerce.number().int().positive();
const gatewayBody = z.strictObject({ name: z.string().trim().min(1).max(120) });
const credentialReferenceBody = z.strictObject({
  externalRef: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  scope: z.strictObject({
    permissions: z.tuple([z.literal("view")]).rest(z.string().min(1).max(40)),
    deviceStableKeys: z.array(z.string().min(1).max(200)).max(500).optional(),
    channelStableKeys: z.array(z.string().min(1).max(200)).max(2000).optional(),
  }),
});
const heartbeatBody = z.strictObject({
  softwareVersion: z.string().trim().min(1).max(80).optional(),
  playbackBaseUrl: z.string().url().startsWith("https://").optional(),
});
const inventoryBody = z.strictObject({
  devices: z.array(z.unknown()).max(2000),
});
const playbackBody = z.strictObject({
  protocol: z.enum(["webrtc", "hls"]).default("webrtc"),
});

function sendError(res: any, status: number, code: string) {
  return res.status(status).json({ code });
}

function authenticatedSession(req: Request, res: any): SessionPayload | null {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    sendError(res, 401, "auth.not_authenticated");
    return null;
  }
  return session;
}

function canReadSite(session: SessionPayload, site: SiteIdentity) {
  return session.role === "admin" ||
    (session.role === "partner" && session.partnerId === site.partnerId);
}

function canManageSite(session: SessionPayload, site: SiteIdentity) {
  return session.role === "admin" ||
    (session.role === "partner" &&
      session.partnerId === site.partnerId &&
      session.membershipRole === "admin");
}

function bearerToken(req: Request) {
  const value = req.header("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export function createCamerasRouter(dependencies: CameraRouteDependencies) {
  const router = Router();

  router.get("/sites/:siteId/cameras", async (req, res) => {
    const session = authenticatedSession(req, res);
    if (!session) return;
    const parsedId = numericId.safeParse(req.params.siteId);
    if (!parsedId.success) return sendError(res, 400, "camera.invalid_site");
    const site = await dependencies.getSite(parsedId.data);
    if (!site) return sendError(res, 404, "camera.site_not_found");
    if (!canReadSite(session, site)) return sendError(res, 403, "auth.forbidden");
    return res.json(await dependencies.listSiteCameras(site.id));
  });

  router.post("/sites/:siteId/camera-gateways", async (req, res) => {
    const session = authenticatedSession(req, res);
    if (!session) return;
    const parsedId = numericId.safeParse(req.params.siteId);
    const body = gatewayBody.safeParse(req.body);
    if (!parsedId.success || !body.success) return sendError(res, 400, "camera.invalid_request");
    const site = await dependencies.getSite(parsedId.data);
    if (!site) return sendError(res, 404, "camera.site_not_found");
    if (!canManageSite(session, site)) return sendError(res, 403, "auth.forbidden");
    return res.status(201).json(
      await dependencies.createGateway({
        siteLocationId: site.id,
        name: body.data.name,
        createdByUserId: session.userId!,
      }),
    );
  });

  router.post("/camera-gateways/:gatewayId/credential-references", async (req, res) => {
    const session = authenticatedSession(req, res);
    if (!session) return;
    const gatewayId = id.safeParse(req.params.gatewayId);
    const body = credentialReferenceBody.safeParse(req.body);
    if (!gatewayId.success || !body.success) return sendError(res, 400, "camera.invalid_request");
    const site = await dependencies.getGatewaySite(gatewayId.data);
    if (!site) return sendError(res, 404, "camera.gateway_not_found");
    if (!canManageSite(session, site)) return sendError(res, 403, "auth.forbidden");
    return res.status(201).json(
      await dependencies.addCredentialReference({
        gatewayId: gatewayId.data,
        ...body.data,
        createdByUserId: session.userId!,
      }),
    );
  });

  router.post("/camera-gateways/:gatewayId/heartbeat", async (req, res) => {
    const gatewayId = id.safeParse(req.params.gatewayId);
    const token = bearerToken(req);
    if (!gatewayId.success) return sendError(res, 400, "camera.invalid_request");
    if (!token || !(await dependencies.authenticateGateway(gatewayId.data, token))) {
      return sendError(res, 401, "camera.gateway_unauthorized");
    }
    const body = heartbeatBody.safeParse(req.body);
    if (!body.success) return sendError(res, 400, "camera.invalid_request");
    await dependencies.heartbeatGateway({ gatewayId: gatewayId.data, ...body.data, seenAt: new Date() });
    return res.sendStatus(204);
  });

  router.post("/camera-gateways/:gatewayId/inventory", async (req, res) => {
    const gatewayId = id.safeParse(req.params.gatewayId);
    const token = bearerToken(req);
    if (!gatewayId.success) return sendError(res, 400, "camera.invalid_request");
    if (!token || !(await dependencies.authenticateGateway(gatewayId.data, token))) {
      return sendError(res, 401, "camera.gateway_unauthorized");
    }
    const body = inventoryBody.safeParse(req.body);
    if (!body.success) return sendError(res, 400, "camera.invalid_request");
    try {
      return res.json(
        await dependencies.reconcileInventory({ gatewayId: gatewayId.data, devices: body.data.devices }),
      );
    } catch (error) {
      return sendError(res, 400, error instanceof Error ? error.message : "camera.invalid_inventory");
    }
  });

  router.post("/camera-channels/:channelId/playback", async (req, res) => {
    const session = authenticatedSession(req, res);
    if (!session) return;
    const channelId = id.safeParse(req.params.channelId);
    const body = playbackBody.safeParse(req.body);
    if (!channelId.success || !body.success) return sendError(res, 400, "camera.invalid_request");
    const site = await dependencies.getChannelSite(channelId.data);
    if (!site) return sendError(res, 404, "camera.channel_not_found");
    if (!canReadSite(session, site)) return sendError(res, 403, "auth.forbidden");
    try {
      return res.json(await dependencies.createPlaybackDescriptor(channelId.data, body.data.protocol));
    } catch (error) {
      const code = error instanceof Error ? error.message : "camera.playback_unavailable";
      return sendError(res, code === "camera.gateway_unavailable" ? 503 : 400, code);
    }
  });

  return router;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashesMatch(left: string, right: string) {
  try {
    return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

const cameraRepository: CameraRepository = {
  async getGateway(gatewayId) {
    const [gateway] = await db.select().from(cameraGatewaysTable).where(eq(cameraGatewaysTable.id, gatewayId)).limit(1);
    return gateway ?? null;
  },
  async touchGateway(gatewayId, seenAt) {
    await db.update(cameraGatewaysTable).set({ status: "online", lastSeenAt: seenAt, updatedAt: seenAt }).where(eq(cameraGatewaysTable.id, gatewayId));
  },
  async resolveCredentialReference(gatewayId, externalRef) {
    const [reference] = await db.select({ id: cameraCredentialReferencesTable.id }).from(cameraCredentialReferencesTable).where(and(eq(cameraCredentialReferencesTable.gatewayId, gatewayId), eq(cameraCredentialReferencesTable.externalRef, externalRef), isNull(cameraCredentialReferencesTable.revokedAt))).limit(1);
    return reference?.id ?? null;
  },
  async upsertDevice(input) {
    const [device] = await db.insert(cameraDevicesTable).values(input).onConflictDoUpdate({
      target: [cameraDevicesTable.gatewayId, cameraDevicesTable.stableKey],
      set: { name: input.name, kind: input.kind, manufacturer: input.manufacturer, model: input.model, adapter: input.adapter, protocols: input.protocols, credentialReferenceId: input.credentialReferenceId, status: "online", lastSeenAt: input.lastSeenAt, updatedAt: input.lastSeenAt },
    }).returning();
    return device!;
  },
  async upsertChannel(input) {
    const [channel] = await db.insert(cameraChannelsTable).values(input).onConflictDoUpdate({
      target: [cameraChannelsTable.deviceId, cameraChannelsTable.stableKey],
      set: { name: input.name, enabled: input.enabled, status: "online", lastSeenAt: input.lastSeenAt, updatedAt: input.lastSeenAt },
    }).returning();
    return channel!;
  },
  async markMissingOffline(input) {
    const deviceCondition = input.activeDeviceStableKeys.length
      ? and(eq(cameraDevicesTable.gatewayId, input.gatewayId), notInArray(cameraDevicesTable.stableKey, input.activeDeviceStableKeys))
      : eq(cameraDevicesTable.gatewayId, input.gatewayId);
    await db.update(cameraDevicesTable).set({ status: "offline", updatedAt: input.seenAt }).where(deviceCondition);
    for (const [deviceId, activeKeys] of Object.entries(input.activeChannelStableKeysByDeviceId)) {
      const condition = activeKeys.length
        ? and(eq(cameraChannelsTable.deviceId, deviceId), notInArray(cameraChannelsTable.stableKey, activeKeys))
        : eq(cameraChannelsTable.deviceId, deviceId);
      await db.update(cameraChannelsTable).set({ status: "offline", updatedAt: input.seenAt }).where(condition);
    }
  },
  async getChannelWithGateway(channelId) {
    const [row] = await db.select({ channel: cameraChannelsTable, device: cameraDevicesTable, gateway: cameraGatewaysTable }).from(cameraChannelsTable).innerJoin(cameraDevicesTable, eq(cameraChannelsTable.deviceId, cameraDevicesTable.id)).innerJoin(cameraGatewaysTable, eq(cameraDevicesTable.gatewayId, cameraGatewaysTable.id)).where(eq(cameraChannelsTable.id, channelId)).limit(1);
    return row ?? null;
  },
};

const cameraService = createCameraService(cameraRepository, {
  async requestPlayback({ gatewayId, channelId, protocol }) {
    const [gateway] = await db.select({ playbackBaseUrl: cameraGatewaysTable.playbackBaseUrl }).from(cameraGatewaysTable).where(eq(cameraGatewaysTable.id, gatewayId)).limit(1);
    const signingSecret = process.env.CAMERA_PLAYBACK_SIGNING_SECRET;
    if (!gateway?.playbackBaseUrl || !signingSecret) throw new Error("camera.gateway_unavailable");
    const body = JSON.stringify({ channelId, protocol, requestedAt: new Date().toISOString() });
    const signature = createHmac("sha256", signingSecret).update(body).digest("hex");
    const response = await fetch(new URL("/v1/playback-sessions", gateway.playbackBaseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-vndrly-signature": signature },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("camera.gateway_unavailable");
    return (await response.json()) as any;
  },
});

const productionDependencies: CameraRouteDependencies = {
  async getSite(siteId) {
    const [site] = await db.select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId }).from(siteLocationsTable).where(eq(siteLocationsTable.id, siteId)).limit(1);
    return site ?? null;
  },
  async getGatewaySite(gatewayId) {
    const [site] = await db.select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId }).from(cameraGatewaysTable).innerJoin(siteLocationsTable, eq(cameraGatewaysTable.siteLocationId, siteLocationsTable.id)).where(eq(cameraGatewaysTable.id, gatewayId)).limit(1);
    return site ?? null;
  },
  async getChannelSite(channelId) {
    const [site] = await db.select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId }).from(cameraChannelsTable).innerJoin(cameraDevicesTable, eq(cameraChannelsTable.deviceId, cameraDevicesTable.id)).innerJoin(cameraGatewaysTable, eq(cameraDevicesTable.gatewayId, cameraGatewaysTable.id)).innerJoin(siteLocationsTable, eq(cameraGatewaysTable.siteLocationId, siteLocationsTable.id)).where(eq(cameraChannelsTable.id, channelId)).limit(1);
    return site ?? null;
  },
  async listSiteCameras(siteId) {
    const gateways = await db.select({ id: cameraGatewaysTable.id, name: cameraGatewaysTable.name, status: cameraGatewaysTable.status, softwareVersion: cameraGatewaysTable.softwareVersion, lastSeenAt: cameraGatewaysTable.lastSeenAt }).from(cameraGatewaysTable).where(eq(cameraGatewaysTable.siteLocationId, siteId));
    if (!gateways.length) return { gateways: [] };
    const gatewayIds = gateways.map((gateway) => gateway.id);
    const devices = await db.select({ id: cameraDevicesTable.id, gatewayId: cameraDevicesTable.gatewayId, stableKey: cameraDevicesTable.stableKey, kind: cameraDevicesTable.kind, name: cameraDevicesTable.name, manufacturer: cameraDevicesTable.manufacturer, model: cameraDevicesTable.model, adapter: cameraDevicesTable.adapter, protocols: cameraDevicesTable.protocols, status: cameraDevicesTable.status, lastSeenAt: cameraDevicesTable.lastSeenAt }).from(cameraDevicesTable).where(inArray(cameraDevicesTable.gatewayId, gatewayIds));
    const channels = devices.length ? await db.select({ id: cameraChannelsTable.id, deviceId: cameraChannelsTable.deviceId, stableKey: cameraChannelsTable.stableKey, name: cameraChannelsTable.name, enabled: cameraChannelsTable.enabled, status: cameraChannelsTable.status, lastSeenAt: cameraChannelsTable.lastSeenAt }).from(cameraChannelsTable).where(inArray(cameraChannelsTable.deviceId, devices.map((device) => device.id))) : [];
    return { gateways: gateways.map((gateway) => ({ ...gateway, devices: devices.filter((device) => device.gatewayId === gateway.id).map((device) => ({ ...device, channels: channels.filter((channel) => channel.deviceId === device.id) })) })) };
  },
  async createGateway(input) {
    const enrollmentToken = randomBytes(32).toString("base64url");
    const [gateway] = await db.insert(cameraGatewaysTable).values({ ...input, tokenHash: tokenHash(enrollmentToken) }).returning({ id: cameraGatewaysTable.id, siteLocationId: cameraGatewaysTable.siteLocationId, name: cameraGatewaysTable.name, status: cameraGatewaysTable.status });
    return { gateway: gateway!, enrollmentToken };
  },
  async addCredentialReference(input) {
    const [reference] = await db.insert(cameraCredentialReferencesTable).values(input).onConflictDoUpdate({ target: [cameraCredentialReferencesTable.gatewayId, cameraCredentialReferencesTable.externalRef], set: { label: input.label, scope: input.scope, revokedAt: null, updatedAt: new Date() } }).returning({ id: cameraCredentialReferencesTable.id, gatewayId: cameraCredentialReferencesTable.gatewayId, externalRef: cameraCredentialReferencesTable.externalRef, label: cameraCredentialReferencesTable.label, scope: cameraCredentialReferencesTable.scope });
    return reference!;
  },
  async authenticateGateway(gatewayId, token) {
    const [gateway] = await db.select({ tokenHash: cameraGatewaysTable.tokenHash, revokedAt: cameraGatewaysTable.revokedAt }).from(cameraGatewaysTable).where(eq(cameraGatewaysTable.id, gatewayId)).limit(1);
    return Boolean(gateway && !gateway.revokedAt && hashesMatch(gateway.tokenHash, tokenHash(token)));
  },
  async heartbeatGateway(input) {
    await db.update(cameraGatewaysTable).set({ status: "online", softwareVersion: input.softwareVersion, playbackBaseUrl: input.playbackBaseUrl, lastSeenAt: input.seenAt, updatedAt: input.seenAt }).where(eq(cameraGatewaysTable.id, input.gatewayId));
  },
  async reconcileInventory(input) {
    return cameraService.reconcileInventory(input as any);
  },
  async createPlaybackDescriptor(channelId, protocol) {
    return cameraService.createPlaybackDescriptor(channelId, protocol);
  },
};

export default createCamerasRouter(productionDependencies);
