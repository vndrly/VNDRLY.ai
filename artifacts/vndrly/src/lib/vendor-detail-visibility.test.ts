import { describe, expect, it } from "vitest";
import { canManageVendorSubcontractors, canViewVendorOfficeEmployees } from "./vendor-detail-visibility";

describe("vendor detail privacy", () => {
  it.each([
    ["partner", false, false],
    ["vendor", false, false],
    ["vendor", true, true],
    ["admin", false, true],
  ] as const)("role %s, own=%s returns %s", (role, own, expected) => {
    expect(canViewVendorOfficeEmployees(role, own)).toBe(expected);
  });
});

describe("managed subcontractor controls", () => {
  const admin = { role: "vendor", vendorId: 4, activeMembershipId: 7, availableMemberships: [{ id: 7, orgType: "vendor", orgId: 4, role: "admin" }, { id: 8, orgType: "vendor", orgId: 4, role: "member" }] };
  it("allows the active administrator of the displayed vendor", () => {
    expect(canManageVendorSubcontractors(admin, 4)).toBe(true);
  });
  it("rejects another vendor, platform admin, and inactive admin memberships", () => {
    expect(canManageVendorSubcontractors(admin, 5)).toBe(false);
    expect(canManageVendorSubcontractors({ ...admin, role: "admin" }, 4)).toBe(false);
    expect(canManageVendorSubcontractors({ ...admin, activeMembershipId: 8 }, 4)).toBe(false);
    expect(canManageVendorSubcontractors({ ...admin, activeMembershipId: null }, 4)).toBe(false);
  });
});
