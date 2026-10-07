import { describe, expect, it } from "vitest";
import { assertFieldTripReadAccess, authorizeFieldTripCompletion } from "./field-trip-access";
import type { FieldTripRecord } from "./field-trips";

const trip = {
  id: "00000000-0000-4000-8000-000000000010",
  owner: { type: "vendor", id: 7 },
  driverUserId: 91,
} as FieldTripRecord;

describe("field trip completion authorization", () => {
  it("keeps an organization administrator inside their own organization", () => {
    expect(() => authorizeFieldTripCompletion(trip, { userId: 12, owner: { type: "vendor", id: 8 }, isAdmin: false, isOrgAdmin: true, vendorRole: null })).toThrowError(expect.objectContaining({ code: "trip.not_found" }));
    expect(authorizeFieldTripCompletion(trip, { userId: 12, owner: { type: "vendor", id: 7 }, isAdmin: false, isOrgAdmin: true, vendorRole: null })).toEqual({ actorMayComplete: true });
  });
  it("hides another driver's trip even within the same company", () => {
    expect(() => authorizeFieldTripCompletion(trip, { userId: 12, owner: { type: "vendor", id: 7 }, isAdmin: false, vendorRole: "field_employee", restrictToDriver: true })).toThrowError(expect.objectContaining({ code: "trip.not_found" }));
  });
  it("allows a driver to end their own trip", () => {
    expect(authorizeFieldTripCompletion(trip, { userId: 91, owner: { type: "vendor", id: 7 }, isAdmin: false, vendorRole: "field_employee" })).toEqual({ actorMayComplete: false });
  });

  it("allows an authorized same-organization supervisor", () => {
    expect(authorizeFieldTripCompletion(trip, { userId: 12, owner: { type: "vendor", id: 7 }, isAdmin: false, vendorRole: "gate_supervisor" })).toEqual({ actorMayComplete: true });
  });

  it("hides trips from a different organization", () => {
    expect(() => authorizeFieldTripCompletion(trip, { userId: 12, owner: { type: "vendor", id: 8 }, isAdmin: false, vendorRole: "gate_supervisor" })).toThrowError(expect.objectContaining({ code: "trip.not_found", status: 404 }));
  });

  it("rejects a same-organization user who is neither the driver nor a supervisor", () => {
    expect(() => authorizeFieldTripCompletion(trip, { userId: 12, owner: { type: "vendor", id: 7 }, isAdmin: false, vendorRole: "field_employee" })).toThrowError(expect.objectContaining({ code: "trip.completion_forbidden", status: 403 }));
  });
});

it("separates partner owned-site reads from vendor-trip mutation authority", () => {
 const actor = { userId: 12, owner: { type: "partner" as const, id: 8 }, isAdmin: false, vendorRole: null };
 expect(() => assertFieldTripReadAccess(trip, actor, 8)).not.toThrow();
 expect(() => assertFieldTripReadAccess(trip, actor, 9)).toThrowError(expect.objectContaining({ code: "trip.not_found" }));
 expect(() => authorizeFieldTripCompletion(trip, actor)).toThrowError(expect.objectContaining({ code: "trip.not_found" }));
});

