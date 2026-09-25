import { describe, expect, it } from "vitest";
import { officeMayAccessGateOps, sessionHasGateOpsScope } from "./gate-ops-access.js";

describe("officeMayAccessGateOps", () => {
  it("allows admin, partner, and vendor office/both viewers", () => {
    expect(officeMayAccessGateOps({ role: "admin" })).toBe(true);
    expect(officeMayAccessGateOps({ role: "partner" })).toBe(true);
    expect(officeMayAccessGateOps({ role: "vendor", vendorRole: "office" })).toBe(true);
    expect(officeMayAccessGateOps({ role: "vendor", vendorRole: "both" })).toBe(true);
    expect(officeMayAccessGateOps({ role: "vendor", vendorRole: null })).toBe(true);
    expect(
      officeMayAccessGateOps({
        role: "vendor",
        vendorRole: "gatekeeper",
        membershipRole: "admin",
      }),
    ).toBe(true);
  });

  it("rejects booth operators and field personas", () => {
    expect(officeMayAccessGateOps({ role: "vendor", vendorRole: "gatekeeper" })).toBe(false);
    expect(officeMayAccessGateOps({ role: "vendor", vendorRole: "field" })).toBe(false);
    expect(officeMayAccessGateOps({ role: "field_employee" })).toBe(false);
    expect(officeMayAccessGateOps(null)).toBe(false);
  });
});

describe("sessionHasGateOpsScope", () => {
  it("requires an org id for partner and vendor sessions", () => {
    expect(sessionHasGateOpsScope({ role: "admin", vendorId: null, partnerId: null })).toBe(true);
    expect(sessionHasGateOpsScope({ role: "vendor", vendorId: 12, partnerId: null })).toBe(true);
    expect(sessionHasGateOpsScope({ role: "vendor", vendorId: null, partnerId: null })).toBe(false);
    expect(sessionHasGateOpsScope({ role: "partner", vendorId: null, partnerId: 9 })).toBe(true);
  });
});
