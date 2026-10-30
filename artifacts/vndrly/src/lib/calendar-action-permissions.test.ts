import { describe, expect, it } from "vitest";
import { canAdministerCalendar } from "./calendar-action-permissions";
describe("calendar administrative actions", () => {
  it("allows administrators and office staff", () => {
    expect(canAdministerCalendar({ role: "vendor", vendorId: 1115, partnerId: null, membershipRole: "admin" })).toBe(true);
    expect(canAdministerCalendar({ role: "vendor", vendorId: 1115, partnerId: null, vendorRole: "office" })).toBe(true);
  });
  it("keeps task creation and shift definitions off staff and gatekeeper calendars", () => {
    for (const vendorRole of ["gatekeeper", "gate_supervisor", "field", "fleet"]) expect(canAdministerCalendar({ role: "vendor", vendorId: 1115, partnerId: null, vendorRole })).toBe(false);
    expect(canAdministerCalendar({ role: "vendor", vendorId: 1115, partnerId: null, membershipRole: "admin", managedSubcontractor: {} })).toBe(false);
  });
});
