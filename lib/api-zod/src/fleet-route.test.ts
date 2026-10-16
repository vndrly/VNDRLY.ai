import { describe, expect, it } from "vitest";
import { FleetDestinationSchema } from "./fleet-commercial";
import * as contracts from "./index";
import type { ZodType } from "zod/v4";
function schema(name: string): ZodType<any> {
  const contract = (contracts as unknown as Record<string, ZodType<any>>)[name];
  expect(contract, name).toBeDefined();
  return contract;
}

const origin = { id: "11111111-1111-4111-8111-111111111111", revision: 1, name: "Lease tank", kind: "pickup", address: "1 Lease Rd", latitude: 35.4, longitude: -97.4, ownerType: "vendor", ownerId: 11 };
const drop = { ...origin, id: "22222222-2222-4222-8222-222222222222", name: "Collection terminal", kind: "delivery" };
const route = { origin: { type: "canonical", location: origin }, stops: [{ id: "33333333-3333-4333-8333-333333333333", kind: "delivery", sequence: 0, cycleId: "44444444-4444-4444-8444-444444444444", location: { type: "canonical", location: drop } }], returnPolicy: "delivery_only", base: null, plannedWindow: { startAt: "2026-10-16T12:00:00Z", endAt: "2026-10-16T15:00:00Z", timeZone: "America/Chicago" } };

describe("physical Fleet routes", () => {
  it("continues to accept an existing destination without new properties", () => {
    expect(FleetDestinationSchema.parse(origin)).toMatchObject({ id: origin.id, revision: 1, ownerId: 11 });
  });
  it("requires an explicit base for return-required work", () => {
    expect(schema("FleetRoutePlanSchema").safeParse({ ...route, returnPolicy: "return_required" }).success).toBe(false);
    expect(schema("FleetRoutePlanSchema").safeParse({ ...route, returnPolicy: "return_required", base: { type: "canonical", location: { ...origin, kind: "yard" } } }).success).toBe(true);
  });
  it("does not invent a billing site from the chosen physical destination", () => {
    const parsed = schema("FleetRoutePlanSchema").parse(route);
    expect(parsed).not.toHaveProperty("billingSiteId");
    expect(parsed.stops[0].location).toMatchObject({ type: "canonical", location: { id: drop.id } });
    expect(schema("FleetRoutePlanSchema").safeParse({ ...route, billingSiteId: 123 }).success).toBe(false);
  });
  it("retains a provisional location without fabricating canonical identity or coordinates", () => {
    const provisional = { type: "provisional", localId: "55555555-5555-4555-8555-555555555555", name: "Temporary pickup", address: "Tank west of lease road", latitude: null, longitude: null, capturedAt: "2026-10-16T12:00:00Z" };
    expect(schema("FleetRoutePlanSchema").parse({ ...route, origin: provisional }).origin).toEqual(provisional);
  });
  it("rejects duplicate stop order and mismatched coordinates", () => {
    expect(schema("FleetRoutePlanSchema").safeParse({ ...route, stops: [route.stops[0], { ...route.stops[0], id: "66666666-6666-4666-8666-666666666666" }] }).success).toBe(false);
    expect(FleetDestinationSchema.safeParse({ ...origin, latitude: null, longitude: -97 }).success).toBe(false);
  });
});
