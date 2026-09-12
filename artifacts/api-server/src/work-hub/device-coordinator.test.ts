import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SURFACE_TTL_MS,
  WorkHubDeviceError,
  createDeviceCoordinator,
  type DeviceCoordinatorStore,
  type DeviceActor,
  type DeviceRecord,
  type DeviceConnectionRecord,
  type DurableUserEvent,
} from "./device-coordinator";

const vendorActor = { userId: 7, owner: { type: "vendor" as const, id: 12 } };
const otherOrgActor = { userId: 7, owner: { type: "vendor" as const, id: 13 } };
const otherUserActor = { userId: 8, owner: { type: "vendor" as const, id: 12 } };

function memoryStore(): DeviceCoordinatorStore {
  const devices = new Map<string, DeviceRecord>();
  const connections = new Map<string, DeviceConnectionRecord>();
  const events: DurableUserEvent[] = [];
  let nextEvent = 1;
  let nextDevice = 1;
  return {
    async findDevice(id) { return devices.get(id) ?? null; },
    async createDevice(input) {
      const now = input.now;
      const row: DeviceRecord = { ...input, id: input.id ?? `00000000-0000-4000-8000-${String(nextDevice++).padStart(12, "0")}`, revokedAt: null, createdAt: now, updatedAt: now };
      devices.set(row.id, row); return row;
    },
    async updateDevice(id, patch) {
      const row = devices.get(id); if (!row) return null;
      const next = { ...row, ...patch }; devices.set(id, next); return next;
    },
    async listDevices(actor) {
      return [...devices.values()].filter(d => d.userId === actor.userId && d.owner.type === actor.owner.type && d.owner.id === actor.owner.id);
    },
    async listOrganizationDevices(owner) {
      return [...devices.values()].filter(d => d.owner.type === owner.type && d.owner.id === owner.id);
    },
    async clearConnections(deviceId) { for (const [key, row] of connections) if (row.deviceId === deviceId) connections.delete(key); },
    async upsertConnection(input) {
      const key = `${input.deviceId}:${input.connectionId}`;
      const existing = connections.get(key);
      const row: DeviceConnectionRecord = { ...input, connectedAt: existing?.connectedAt ?? input.now, seenAt: input.now };
      connections.set(key, row); return row;
    },
    async listConnections(deviceIds) { return [...connections.values()].filter(c => deviceIds.includes(c.deviceId)); },
    async appendEvent(input) {
      const row: DurableUserEvent = { ...input, id: `event-${nextEvent}`, sequence: nextEvent++, createdAt: input.now };
      events.push(row); return row;
    },
    async listExpiredEventActors(before, limit) {
      const unique = new Map<string, DeviceActor>();
      for (const event of events) if (event.createdAt < before) unique.set(`${event.userId}:${event.owner.type}:${event.owner.id}`, { userId: event.userId, owner: event.owner });
      return [...unique.values()].slice(0, limit);
    },
    async pruneEvents(actor, before, limit) {
      let pruned = 0;
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]!;
        if (pruned < limit && event.userId === actor.userId && event.owner.type === actor.owner.type && event.owner.id === actor.owner.id && event.createdAt < before) { events.splice(index, 1); pruned += 1; }
      }
    },
    async listEventsAfter(actor, cursor, limit) {
      return events.filter(e => e.userId === actor.userId && e.owner.type === actor.owner.type && e.owner.id === actor.owner.id && e.sequence > cursor).slice(0, limit);
    },
    async eventBounds(actor) {
      const scoped = events.filter(e => e.userId === actor.userId && e.owner.type === actor.owner.type && e.owner.id === actor.owner.id);
      return { earliest: scoped[0]?.sequence ?? null, latest: scoped.at(-1)?.sequence ?? null };
    },
  };
}

describe("Work Hub device coordinator", () => {
  let now: Date;
  let coordinator: ReturnType<typeof createDeviceCoordinator>;
  beforeEach(() => { now = new Date("2026-09-12T12:00:00.000Z"); coordinator = createDeviceCoordinator(memoryStore(), { now: () => now }); });

  it("cannot heartbeat a device through another organization session", async () => {
    const device = await coordinator.registerDevice(vendorActor, { friendlyName: "John's iPhone", deviceClass: "phone", capabilities: { microphone: true } });
    await expect(coordinator.heartbeatDevice(otherOrgActor, device.id, { connectionId: "10000000-0000-4000-8000-000000000001", foreground: true, microphonePermission: "granted", surface: null })).rejects.toMatchObject({ code: "work_hub.not_found" });
  });

  it("cannot use another user's device", async () => {
    const device = await coordinator.registerDevice(vendorActor, { friendlyName: "Desktop", deviceClass: "desktop", capabilities: {} });
    await expect(coordinator.revokeDevice(otherUserActor, device.id)).rejects.toBeInstanceOf(WorkHubDeviceError);
  });

  it("lets an organization administrator boundary revoke only devices in that organization", async () => {
    const own = await coordinator.registerDevice(vendorActor, { friendlyName: "Desktop", deviceClass: "desktop", capabilities: {} });
    const colleague = await coordinator.registerDevice(otherUserActor, { friendlyName: "Phone", deviceClass: "phone", capabilities: {} });
    const foreign = await coordinator.registerDevice(otherOrgActor, { friendlyName: "Other", deviceClass: "desktop", capabilities: {} });
    expect(await coordinator.listOrganizationDevices(vendorActor)).toHaveLength(2);
    await expect(coordinator.revokeOrganizationDevice(vendorActor, colleague.id)).resolves.toMatchObject({ revokedAt: expect.any(Date) });
    await expect(coordinator.revokeOrganizationDevice(vendorActor, foreign.id)).rejects.toMatchObject({ code: "work_hub.not_found" });
    expect((await coordinator.listDevices(vendorActor)).find(device => device.id === own.id)?.revokedAt).toBeNull();
  });

  it("expires stale surface context without revoking the device", async () => {
    const device = await coordinator.registerDevice(vendorActor, { friendlyName: "Desktop", deviceClass: "desktop", capabilities: {} });
    await coordinator.heartbeatDevice(vendorActor, device.id, { connectionId: "10000000-0000-4000-8000-000000000001", foreground: true, microphonePermission: "unknown", surface: { path: "/work-hub/tickets/9", entityType: "ticket", entityId: "9", updatedAt: now.getTime() } });
    now = new Date(now.getTime() + SURFACE_TTL_MS + 1);
    expect(await coordinator.activeSurface(vendorActor, device.id)).toBeNull();
    expect((await coordinator.listDevices(vendorActor))[0]?.revokedAt).toBeNull();
  });

  it("moves the same user's registered device to the active organization and clears old connections", async () => {
    const device = await coordinator.registerDevice(vendorActor, { friendlyName: "iPad", deviceClass: "tablet", capabilities: { microphone: true } });
    await coordinator.heartbeatDevice(vendorActor, device.id, { connectionId: "10000000-0000-4000-8000-000000000001", foreground: true, microphonePermission: "granted", surface: null });
    await coordinator.registerDevice(otherOrgActor, { deviceId: device.id, friendlyName: "iPad", deviceClass: "tablet", capabilities: { microphone: true } });
    expect(await coordinator.listDevices(vendorActor)).toEqual([]);
    expect(await coordinator.eligibleAudioDevices(otherOrgActor)).toEqual([]);
  });

  it("accepts a stable client-generated device identifier on first registration", async () => {
    const id = "20000000-0000-4000-8000-000000000002";
    const device = await coordinator.registerDevice(vendorActor, { deviceId: id, friendlyName: "Browser", deviceClass: "desktop", capabilities: {} });
    expect(device.id).toBe(id);
  });

  it("returns only live, permitted microphone devices", async () => {
    const device = await coordinator.registerDevice(vendorActor, { friendlyName: "Phone", deviceClass: "phone", capabilities: { microphone: true } });
    await coordinator.heartbeatDevice(vendorActor, device.id, { connectionId: "10000000-0000-4000-8000-000000000001", foreground: true, microphonePermission: "granted", surface: null });
    expect(await coordinator.eligibleAudioDevices(vendorActor)).toHaveLength(1);
    now = new Date(now.getTime() + SURFACE_TTL_MS + 1);
    expect(await coordinator.eligibleAudioDevices(vendorActor)).toEqual([]);
  });

  it("requires a live connection owned by the same user and organization", async () => {
    const device = await coordinator.registerDevice(vendorActor, { friendlyName: "Phone", deviceClass: "phone", capabilities: { microphone: true } });
    await coordinator.heartbeatDevice(vendorActor, device.id, { connectionId: "10000000-0000-4000-8000-000000000001", foreground: true, microphonePermission: "granted", surface: null });
    await expect(coordinator.requireDeviceConnection(vendorActor, device.id, "10000000-0000-4000-8000-000000000001")).resolves.toMatchObject({ device: { id: device.id } });
    await expect(coordinator.requireDeviceConnection(otherOrgActor, device.id, "10000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ code: "work_hub.not_found" });
  });

  it("persists bounded organization-scoped events and reports cursor gaps", async () => {
    await coordinator.publishUserEvent(vendorActor, { eventType: "work_hub.workspace.updated", payload: { context: { kind: "ticket", id: "9" }, subject: { type: "ticket", id: "9" } } });
    await coordinator.publishUserEvent(vendorActor, { eventType: "work_hub.workspace.updated", payload: { context: { kind: "ticket", id: "10" }, subject: { type: "ticket", id: "10" } } });
    expect((await coordinator.eventsAfter(vendorActor, 1)).events.map(e => e.sequence)).toEqual([2]);
    expect((await coordinator.eventsAfter(vendorActor, -5)).gap).toBe(true);
    await expect(coordinator.publishUserEvent(vendorActor, { eventType: "work_hub.too_large", payload: { value: "x".repeat(5000) } })).rejects.toMatchObject({ code: "work_hub.invalid_payload" });
    await expect(coordinator.publishUserEvent(vendorActor, { eventType: "invalid event", payload: {} })).rejects.toMatchObject({ code: "work_hub.invalid_payload" });
  });

  it("prunes events after thirty days and reports the resulting cursor gap", async () => {
    await coordinator.publishUserEvent(vendorActor, { eventType: "work_hub.workspace.updated", payload: {} });
    now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000);
    await coordinator.publishUserEvent(vendorActor, { eventType: "work_hub.workspace.updated", payload: {} });
    const replay = await coordinator.eventsAfter(vendorActor, 0);
    expect(replay.gap).toBe(true);
    expect(replay.earliestSequence).toBe(2);
  });

  it("prunes dormant actors through explicit user and organization scopes", async () => {
    await coordinator.publishUserEvent(vendorActor, { eventType: "work_hub.workspace.updated", payload: {} });
    now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000);
    await coordinator.publishUserEvent(otherOrgActor, { eventType: "work_hub.workspace.updated", payload: {} });
    expect((await coordinator.eventsAfter(vendorActor, 0)).events).toEqual([]);
  });

  it("bounds retention work to one actor and one finite event batch per request", async () => {
    const store = memoryStore();
    const actors = vi.spyOn(store, "listExpiredEventActors").mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({ userId: index + 1, owner: { type: "vendor", id: index + 1 } })));
    const prune = vi.spyOn(store, "pruneEvents");
    coordinator = createDeviceCoordinator(store, { now: () => now });
    await coordinator.publishUserEvent(vendorActor, { eventType: "work_hub.workspace.updated", payload: {} });
    expect(actors).toHaveBeenCalledWith(expect.any(Date), 1);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(prune).toHaveBeenCalledWith(expect.anything(), expect.any(Date), 100);
  });
});
