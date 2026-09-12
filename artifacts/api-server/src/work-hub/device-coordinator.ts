import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  workHubDeviceConnectionsTable,
  workHubDevicesTable,
  workHubUserEventsTable,
  type WorkHubDeviceCapabilities,
} from "@workspace/db";
import { fanOutPersistedWorkHubEvent } from "./events";

export const SURFACE_TTL_MS = 45_000;
export const MAX_EVENT_BYTES = 4_096;
export const MAX_EVENT_PAGE = 250;

export type WorkHubOwner = { type: "vendor" | "partner"; id: number };
export type DeviceActor = { userId: number; owner: WorkHubOwner };
export type DeviceCapabilities = WorkHubDeviceCapabilities;
export type DeviceSurface = { path: string; entityType: string | null; entityId: string | null; updatedAt: number };
export type DeviceRecord = { id: string; userId: number; owner: WorkHubOwner; friendlyName: string; deviceClass: string; capabilities: DeviceCapabilities; revokedAt: Date | null; createdAt: Date; updatedAt: Date };
export type DeviceConnectionRecord = { deviceId: string; connectionId: string; foreground: boolean; microphonePermission: "unknown" | "granted" | "denied"; surface: DeviceSurface | null; connectedAt: Date; seenAt: Date };
export type DurableUserEvent = { id: string; sequence: number; userId: number; owner: WorkHubOwner; eventType: string; payload: Record<string, unknown>; createdAt: Date };

export class WorkHubDeviceError extends Error {
  constructor(readonly code: "work_hub.not_found" | "work_hub.invalid_payload", message: string) { super(message); this.name = "WorkHubDeviceError"; }
}

type CreateDeviceInput = Omit<DeviceRecord, "id" | "revokedAt" | "createdAt" | "updatedAt"> & { now: Date };
type UpdateDeviceInput = Partial<Pick<DeviceRecord, "owner" | "friendlyName" | "deviceClass" | "capabilities" | "revokedAt">> & { updatedAt: Date };
type UpsertConnectionInput = Omit<DeviceConnectionRecord, "connectedAt" | "seenAt"> & { now: Date };
type AppendEventInput = Omit<DurableUserEvent, "id" | "sequence" | "createdAt"> & { now: Date };

export interface DeviceCoordinatorStore {
  findDevice(id: string): Promise<DeviceRecord | null>;
  createDevice(input: CreateDeviceInput): Promise<DeviceRecord>;
  updateDevice(id: string, patch: UpdateDeviceInput): Promise<DeviceRecord | null>;
  listDevices(actor: DeviceActor): Promise<DeviceRecord[]>;
  clearConnections(deviceId: string): Promise<void>;
  upsertConnection(input: UpsertConnectionInput): Promise<DeviceConnectionRecord>;
  listConnections(deviceIds: string[]): Promise<DeviceConnectionRecord[]>;
  appendEvent(input: AppendEventInput): Promise<DurableUserEvent>;
  listEventsAfter(actor: DeviceActor, cursor: number, limit: number): Promise<DurableUserEvent[]>;
  eventBounds(actor: DeviceActor): Promise<{ earliest: number | null; latest: number | null }>;
}

function mapDevice(row: typeof workHubDevicesTable.$inferSelect): DeviceRecord {
  return { id: row.id, userId: row.userId, owner: { type: row.ownerOrgType as WorkHubOwner["type"], id: row.ownerOrgId }, friendlyName: row.friendlyName, deviceClass: row.deviceClass, capabilities: row.capabilities, revokedAt: row.revokedAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function mapConnection(row: typeof workHubDeviceConnectionsTable.$inferSelect): DeviceConnectionRecord {
  return { deviceId: row.deviceId, connectionId: row.connectionId, foreground: row.foreground, microphonePermission: row.microphonePermission as DeviceConnectionRecord["microphonePermission"], surface: row.surface as DeviceSurface | null, connectedAt: row.connectedAt, seenAt: row.seenAt };
}
function mapEvent(row: typeof workHubUserEventsTable.$inferSelect): DurableUserEvent {
  return { id: row.id, sequence: row.sequence, userId: row.userId, owner: { type: row.ownerOrgType as WorkHubOwner["type"], id: row.ownerOrgId }, eventType: row.eventType, payload: row.payload, createdAt: row.createdAt };
}

export const databaseDeviceCoordinatorStore: DeviceCoordinatorStore = {
  async findDevice(id) { const [row] = await db.select().from(workHubDevicesTable).where(eq(workHubDevicesTable.id, id)).limit(1); return row ? mapDevice(row) : null; },
  async createDevice(input) { const [row] = await db.insert(workHubDevicesTable).values({ userId: input.userId, ownerOrgType: input.owner.type, ownerOrgId: input.owner.id, friendlyName: input.friendlyName, deviceClass: input.deviceClass, capabilities: input.capabilities, createdAt: input.now, updatedAt: input.now }).returning(); return mapDevice(row!); },
  async updateDevice(id, patch) {
    const set: Partial<typeof workHubDevicesTable.$inferInsert> = { updatedAt: patch.updatedAt };
    if (patch.owner) { set.ownerOrgType = patch.owner.type; set.ownerOrgId = patch.owner.id; }
    if (patch.friendlyName !== undefined) set.friendlyName = patch.friendlyName;
    if (patch.deviceClass !== undefined) set.deviceClass = patch.deviceClass;
    if (patch.capabilities !== undefined) set.capabilities = patch.capabilities;
    if (patch.revokedAt !== undefined) set.revokedAt = patch.revokedAt;
    const [row] = await db.update(workHubDevicesTable).set(set).where(eq(workHubDevicesTable.id, id)).returning(); return row ? mapDevice(row) : null;
  },
  async listDevices(actor) { return (await db.select().from(workHubDevicesTable).where(and(eq(workHubDevicesTable.userId, actor.userId), eq(workHubDevicesTable.ownerOrgType, actor.owner.type), eq(workHubDevicesTable.ownerOrgId, actor.owner.id))).orderBy(workHubDevicesTable.createdAt)).map(mapDevice); },
  async clearConnections(deviceId) { await db.delete(workHubDeviceConnectionsTable).where(eq(workHubDeviceConnectionsTable.deviceId, deviceId)); },
  async upsertConnection(input) {
    const [row] = await db.insert(workHubDeviceConnectionsTable).values({ deviceId: input.deviceId, connectionId: input.connectionId, foreground: input.foreground, microphonePermission: input.microphonePermission, surface: input.surface ?? {}, connectedAt: input.now, seenAt: input.now }).onConflictDoUpdate({ target: [workHubDeviceConnectionsTable.deviceId, workHubDeviceConnectionsTable.connectionId], set: { foreground: input.foreground, microphonePermission: input.microphonePermission, surface: input.surface ?? {}, seenAt: input.now } }).returning(); return mapConnection(row!);
  },
  async listConnections(deviceIds) { if (!deviceIds.length) return []; return (await db.select().from(workHubDeviceConnectionsTable).where(inArray(workHubDeviceConnectionsTable.deviceId, deviceIds))).map(mapConnection); },
  async appendEvent(input) { const [row] = await db.insert(workHubUserEventsTable).values({ userId: input.userId, ownerOrgType: input.owner.type, ownerOrgId: input.owner.id, eventType: input.eventType, payload: input.payload, createdAt: input.now }).returning(); return mapEvent(row!); },
  async listEventsAfter(actor, cursor, limit) { return (await db.select().from(workHubUserEventsTable).where(and(eq(workHubUserEventsTable.userId, actor.userId), eq(workHubUserEventsTable.ownerOrgType, actor.owner.type), eq(workHubUserEventsTable.ownerOrgId, actor.owner.id), gt(workHubUserEventsTable.sequence, cursor))).orderBy(asc(workHubUserEventsTable.sequence)).limit(limit)).map(mapEvent); },
  async eventBounds(actor) {
    const [row] = await db.select({ earliest: sql<number | null>`min(${workHubUserEventsTable.sequence})`, latest: sql<number | null>`max(${workHubUserEventsTable.sequence})` }).from(workHubUserEventsTable).where(and(eq(workHubUserEventsTable.userId, actor.userId), eq(workHubUserEventsTable.ownerOrgType, actor.owner.type), eq(workHubUserEventsTable.ownerOrgId, actor.owner.id)));
    return { earliest: row?.earliest === null || row?.earliest === undefined ? null : Number(row.earliest), latest: row?.latest === null || row?.latest === undefined ? null : Number(row.latest) };
  },
};

function sameActor(actor: DeviceActor, device: DeviceRecord) { return actor.userId === device.userId && actor.owner.type === device.owner.type && actor.owner.id === device.owner.id; }
function normalizeName(value: string) { const name = value.trim(); if (!name || name.length > 80) throw new WorkHubDeviceError("work_hub.invalid_payload", "Invalid device name"); return name; }
function normalizeClass(value: string) { const deviceClass = value.trim().toLowerCase(); if (!deviceClass || deviceClass.length > 32) throw new WorkHubDeviceError("work_hub.invalid_payload", "Invalid device class"); return deviceClass; }
function compactSurface(surface: DeviceSurface | null | undefined): DeviceSurface | null {
  if (!surface) return null;
  const path = surface.path.trim(); const entityType = surface.entityType?.trim() || null; const entityId = surface.entityId?.trim() || null;
  if (!path || path.length > 512 || (entityType?.length ?? 0) > 80 || (entityId?.length ?? 0) > 160 || !Number.isFinite(surface.updatedAt)) throw new WorkHubDeviceError("work_hub.invalid_payload", "Invalid device surface");
  return { path, entityType, entityId, updatedAt: surface.updatedAt };
}

export function createDeviceCoordinator(store: DeviceCoordinatorStore, options: { now?: () => Date; fanOut?: (event: DurableUserEvent) => void } = {}) {
  const clock = options.now ?? (() => new Date());
  async function requireOwnedDevice(actor: DeviceActor, id: string) { const device = await store.findDevice(id); if (!device || !sameActor(actor, device) || device.revokedAt) throw new WorkHubDeviceError("work_hub.not_found", "Device not found"); return device; }
  return {
    async registerDevice(actor: DeviceActor, input: { deviceId?: string; friendlyName: string; deviceClass: string; capabilities: DeviceCapabilities }) {
      const now = clock(); const friendlyName = normalizeName(input.friendlyName); const deviceClass = normalizeClass(input.deviceClass);
      if (!input.deviceId) return store.createDevice({ userId: actor.userId, owner: actor.owner, friendlyName, deviceClass, capabilities: input.capabilities, now });
      const existing = await store.findDevice(input.deviceId);
      if (!existing || existing.userId !== actor.userId || existing.revokedAt) throw new WorkHubDeviceError("work_hub.not_found", "Device not found");
      if (existing.owner.type !== actor.owner.type || existing.owner.id !== actor.owner.id) await store.clearConnections(existing.id);
      const updated = await store.updateDevice(existing.id, { owner: actor.owner, friendlyName, deviceClass, capabilities: input.capabilities, updatedAt: now });
      if (!updated) throw new WorkHubDeviceError("work_hub.not_found", "Device not found");
      return updated;
    },
    async heartbeatDevice(actor: DeviceActor, deviceId: string, input: { connectionId: string; foreground: boolean; microphonePermission: DeviceConnectionRecord["microphonePermission"]; surface?: DeviceSurface | null }) {
      const device = await requireOwnedDevice(actor, deviceId); const now = clock(); const surface = compactSurface(input.surface);
      return store.upsertConnection({ deviceId: device.id, connectionId: input.connectionId, foreground: input.foreground, microphonePermission: input.microphonePermission, surface, now });
    },
    async revokeDevice(actor: DeviceActor, deviceId: string) { const device = await requireOwnedDevice(actor, deviceId); const now = clock(); await store.clearConnections(device.id); const updated = await store.updateDevice(device.id, { revokedAt: now, updatedAt: now }); if (!updated) throw new WorkHubDeviceError("work_hub.not_found", "Device not found"); return updated; },
    async listDevices(actor: DeviceActor) { return store.listDevices(actor); },
    async activeSurface(actor: DeviceActor, deviceId: string) { const device = await requireOwnedDevice(actor, deviceId); const connections = await store.listConnections([device.id]); const threshold = clock().getTime() - SURFACE_TTL_MS; return connections.filter(c => c.seenAt.getTime() >= threshold && c.surface && c.surface.updatedAt >= threshold).sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime())[0]?.surface ?? null; },
    async eligibleAudioDevices(actor: DeviceActor) { const devices = (await store.listDevices(actor)).filter(d => !d.revokedAt && d.capabilities.microphone); const threshold = clock().getTime() - SURFACE_TTL_MS; const connections = await store.listConnections(devices.map(d => d.id)); return devices.flatMap(device => connections.filter(c => c.deviceId === device.id && c.seenAt.getTime() >= threshold && c.microphonePermission === "granted").map(connection => ({ device, connection }))); },
    async publishUserEvent(actor: DeviceActor, input: { eventType: string; payload: Record<string, unknown> }) { const eventType = input.eventType.trim(); const bytes = Buffer.byteLength(JSON.stringify(input.payload), "utf8"); if (!/^work_hub\.[a-z0-9_.]+$/.test(eventType) || eventType.length > 100 || bytes > MAX_EVENT_BYTES) throw new WorkHubDeviceError("work_hub.invalid_payload", "Invalid event payload"); const event = await store.appendEvent({ userId: actor.userId, owner: actor.owner, eventType, payload: input.payload, now: clock() }); options.fanOut?.(event); return event; },
    async eventsAfter(actor: DeviceActor, cursor: number, limit = MAX_EVENT_PAGE) { const safeCursor = Number.isSafeInteger(cursor) ? cursor : 0; const safeLimit = Math.max(1, Math.min(limit, MAX_EVENT_PAGE)); const bounds = await store.eventBounds(actor); const gap = bounds.earliest !== null && safeCursor < bounds.earliest - 1; return { events: gap ? [] : await store.listEventsAfter(actor, safeCursor, safeLimit), gap, earliestSequence: bounds.earliest, latestSequence: bounds.latest }; },
  };
}

export const deviceCoordinator = createDeviceCoordinator(databaseDeviceCoordinatorStore, { fanOut: fanOutPersistedWorkHubEvent });
export const registerDevice = deviceCoordinator.registerDevice;
export const heartbeatDevice = deviceCoordinator.heartbeatDevice;
export const revokeDevice = deviceCoordinator.revokeDevice;
export const eligibleAudioDevices = deviceCoordinator.eligibleAudioDevices;
export const publishUserEvent = deviceCoordinator.publishUserEvent;
export const eventsAfter = deviceCoordinator.eventsAfter;
