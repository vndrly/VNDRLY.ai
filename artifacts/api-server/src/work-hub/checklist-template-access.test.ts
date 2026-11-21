import { describe, expect, it } from "vitest";
import { canManageChecklistTemplates as allowed } from "./checklist-template-access";
const owner = { type: "vendor", id: 7 };
describe("checklist template management", () => {
  it("allows company admins and office staff", () => {
    expect(allowed({ role: "vendor", vendorId: 7, membershipRole: "admin" }, owner)).toBe(true);
    for (const vendorRole of ["office", "both"]) expect(allowed({ role: "vendor", vendorId: 7, vendorRole }, owner)).toBe(true);
  });
  it("denies field workers and supervisors", () => {
    for (const vendorRole of ["field", "gatekeeper", "gate_supervisor"]) expect(allowed({ role: "vendor", vendorId: 7, vendorRole }, owner)).toBe(false);
  });
  it("denies another company and managed subcontractors", () => {
    expect(allowed({ role: "vendor", vendorId: 8, membershipRole: "admin" }, owner)).toBe(false);
    expect(allowed({ role: "vendor", vendorId: 7, vendorRole: "office", managedSubcontractor: {} }, owner)).toBe(false);
  });
  it("allows platform admins and scoped partner admins", () => {
    expect(allowed({ role: "admin" }, owner)).toBe(true);
    expect(allowed({ role: "partner", partnerId: 3, membershipRole: "admin" }, { type: "partner", id: 3 })).toBe(true);
  });
});
