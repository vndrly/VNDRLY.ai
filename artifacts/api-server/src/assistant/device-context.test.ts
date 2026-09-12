import { describe, expect, it } from "vitest";
import { createAuthorizedDeviceContextResolver } from "./device-context";

const now = new Date("2026-09-12T18:00:00Z");
const actor = { userId: 7, owner: { type: "vendor" as const, id: 12 } };
const phone = { id: "10000000-0000-4000-8000-000000000001", userId: 7, owner: actor.owner, friendlyName: "John's iPhone", deviceClass: "phone", capabilities: {}, revokedAt: null, createdAt: now, updatedAt: now };
const desktop = { ...phone, id: "10000000-0000-4000-8000-000000000002", friendlyName: "Office desktop", deviceClass: "desktop" };
const store = {
  listDevices: async () => [phone, desktop],
  listConnections: async () => [
    { deviceId: phone.id, connectionId: "20000000-0000-4000-8000-000000000001", foreground: true, microphonePermission: "granted" as const, surface: { path: "/work-hub/meetings/9", entityType: "meeting", entityId: "9", updatedAt: now.getTime() }, connectedAt: now, seenAt: now },
    { deviceId: desktop.id, connectionId: "20000000-0000-4000-8000-000000000002", foreground: true, microphonePermission: "granted" as const, surface: { path: "/tickets/42", entityType: "ticket", entityId: "42", updatedAt: now.getTime() }, connectedAt: now, seenAt: now },
  ],
};

describe("Ask V cross-device context", () => {
  it("uses an authorized desktop ticket from phone voice without moving audio", async () => {
    const resolve = createAuthorizedDeviceContextResolver(store, () => now);
    await expect(resolve(actor, 19, { sourceDeviceId: phone.id, reference: "this ticket" })).resolves.toMatchObject({
      status: "resolved", deviceId: desktop.id, entityType: "ticket", entityId: "42", path: "/tickets/42",
    });
  });

  it("requires disambiguation rather than guessing between equally fresh matching screens", async () => {
    const third = { ...desktop, id: "10000000-0000-4000-8000-000000000003", friendlyName: "Tablet" };
    const resolve = createAuthorizedDeviceContextResolver({
      listDevices: async () => [phone, desktop, third],
      listConnections: async () => [
        ...(await store.listConnections()),
        { deviceId: third.id, connectionId: "20000000-0000-4000-8000-000000000003", foreground: true, microphonePermission: "granted" as const, surface: { path: "/tickets/43", entityType: "ticket", entityId: "43", updatedAt: now.getTime() }, connectedAt: now, seenAt: now },
      ],
    }, () => now);
    await expect(resolve(actor, 19, { sourceDeviceId: phone.id, reference: "this ticket" })).resolves.toMatchObject({ status: "ambiguous", choices: expect.arrayContaining([expect.objectContaining({ entityId: "42" }), expect.objectContaining({ entityId: "43" })]) });
  });

  it("does not expose stale, revoked, or another-company device context", async () => {
    const resolve = createAuthorizedDeviceContextResolver({
      listDevices: async () => [{ ...desktop, owner: { type: "vendor" as const, id: 99 } }, { ...phone, revokedAt: now }],
      listConnections: store.listConnections,
    }, () => now);
    await expect(resolve(actor, 19, { reference: "this ticket" })).resolves.toEqual({ status: "none" });
  });
});
