import { describe, expect, it } from "vitest";
import { defaultStaffAccess, staffTypeFor, staffRolesFor, staffAccessFor } from "./staff-profile";
describe("staff profiles", () => {
  it("keeps staff type independent of additional supervision", () => {
    expect(staffTypeFor({ vendorRole: "gate_supervisor", roles: ["Office Staff", "Gate Supervisor"] })).toBe("Office Staff");
    expect(staffTypeFor({ vendorRole: "field", roles: ["Driver", "Dispatch"] })).toBe("Driver");
  });
  it("does not infer privileges or function roles from a job title", () => {
    expect(defaultStaffAccess("Office Staff")).toEqual(["office"]);
    expect(defaultStaffAccess("Gatekeeper")).toEqual(["gatekeeper"]);
    expect(staffAccessFor("Office Staff", ["Payroll", "Scheduler"], ["office"], "Office Staff")).toEqual(["office"]);
  });
  it("preserves unrelated grants when a staff type changes", () => {
    expect(staffAccessFor("Driver", [], ["office", "gate_supervisor"], "Office Staff")).toEqual(["gate_supervisor", "field_employee"]);
  });
  it("retains notification flags and other custom functions", () => {
    expect(staffRolesFor("Driver", ["Dispatch"], ["Field Worker", "Visitor Notifications", "Equipment Buyer"])).toEqual(["Driver", "Visitor Notifications", "Equipment Buyer", "Dispatch"]);
  });
  it("does not leave an old duplicated permission tag after a role is removed", () => {
    expect(staffRolesFor("Gatekeeper", [], ["gate_supervisor", "Visitor Notifications"])).toEqual(["Gatekeeper", "Visitor Notifications"]);
  });
});
