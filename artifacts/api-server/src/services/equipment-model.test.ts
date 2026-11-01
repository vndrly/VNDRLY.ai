import { describe, expect, it } from "vitest";
import { EquipmentOperationSchema, EquipmentItemSchema } from "@workspace/api-zod";
import { equipmentProfile, projectEquipmentLocation, droppedEquipmentLocation, assertEquipmentConnection, newestEquipmentLocation } from "./equipment-model";

describe("shared equipment location and connection rules", () => {
  const now = new Date("2026-10-31T16:00:00Z"), a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
  it("preserves inventory defaults and does not advertise live GPS from a recent manual location", () => {
    expect(equipmentProfile(null, "trailer")).toMatchObject({ equipmentType: "trailer", trackOnMap: false, assignedUserId: null });
    expect(projectEquipmentLocation({ latitude: 35, longitude: -97, observedAt: now.toISOString(), source: "manual" }, now)).toMatchObject({ source: "manual", freshness: "last_known" });
  });
  it("ages actual device observations and rejects impossible future timestamps", () => {
    const raw = { latitude: 35, longitude: -97, observedAt: now.toISOString(), source: "device" as const };
    expect(projectEquipmentLocation(raw, now)?.freshness).toBe("fresh");
    expect(projectEquipmentLocation(raw, new Date(now.getTime() + 180000))?.freshness).toBe("last_known");
    expect(projectEquipmentLocation(raw, new Date(now.getTime() - 60000))).toBeNull();
  });
  it("freezes a disconnected component at its original observation time", () => {
    const dropped = droppedEquipmentLocation({ latitude: 35, longitude: -97, observedAt: now.toISOString(), source: "holder_phone", freshness: "fresh", holderUserId: 7 });
    expect(dropped).toMatchObject({ observedAt: now.toISOString(), source: "manual", label: "Last known at drop (holder phone)" });
    expect(projectEquipmentLocation(dropped, new Date(now.getTime() + 3600000))?.freshness).toBe("last_known");
    expect(droppedEquipmentLocation(null)).toBeNull();
  });
  it("keeps a newer manual yard report ahead of older phone or connected-transport positions", () => {
    const manual = { latitude: 35, longitude: -97, observedAt: now.toISOString(), source: "manual" as const, freshness: "last_known" as const };
    const phone = { ...manual, latitude: 36, source: "holder_phone" as const, freshness: "fresh" as const, observedAt: new Date(now.getTime() - 30000).toISOString() };
    expect(newestEquipmentLocation(manual, phone)).toEqual(manual);
    expect(newestEquipmentLocation(manual, { ...phone, source: "connected_equipment" })).toEqual(manual);
    expect(newestEquipmentLocation(manual, { ...phone, observedAt: new Date(now.getTime() + 1000).toISOString() })).toMatchObject({ source: "holder_phone", latitude: 36 });
  });
  it("rejects direct and indirect attachment cycles and missing parents", () => {
    const profiles = new Map([[a, equipmentProfile(null)], [b, { ...equipmentProfile(null), parentAssetId: a }]]);
    expect(() => assertEquipmentConnection(a, a, profiles)).toThrow("equipment.connection_cycle");
    expect(() => assertEquipmentConnection(a, b, profiles)).toThrow("equipment.connection_cycle");
    expect(() => assertEquipmentConnection(b, "missing", profiles)).toThrow("equipment.parent_not_found");
    expect(() => assertEquipmentConnection(b, a, profiles)).not.toThrow();
  });
  it("requires explicit connection identity and validated geographic coordinates", () => {
    const base = { operationId: a, expectedVersion: 1 };
    expect(EquipmentOperationSchema.safeParse({ ...base, action: "connect" }).success).toBe(false);
    expect(EquipmentOperationSchema.safeParse({ ...base, action: "location", location: { latitude: 91, longitude: 0, source: "manual", observedAt: now.toISOString() } }).success).toBe(false);
    expect(EquipmentOperationSchema.parse({ ...base, action: "checkout" })).toMatchObject({ condition: "good", photos: [] });
    expect(EquipmentItemSchema.safeParse({}).success).toBe(false);
  });
});
