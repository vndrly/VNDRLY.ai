import { describe, expect, it } from "vitest";
import { workforceCategories, workforceDisplayRoles, WORKFORCE_GROUPS, isAdministrativeMembership } from "./vendor-workforce-groups";
describe("vendor workforce cards", () => {
  it("uses the operation's actual role names and includes dispatch", () => {
    expect(workforceDisplayRoles("field", { vendorRole: "foreman" })).toEqual(["foreman"]);
    expect(workforceDisplayRoles("field", { vendorRole: "field" })).toEqual(["field_employee"]);
    expect(workforceDisplayRoles("gate", { vendorRole: "gatekeeper" })).toEqual(["gate"]);
    expect(workforceDisplayRoles("gate", { vendorRole: "office" }, ["gate_supervisor"])).toEqual(["gate_supervisor"]);
    expect(workforceCategories({ vendorRole: "office", roles: ["Dispatch"] })).toEqual(["fleet"]);
    expect(workforceDisplayRoles("fleet", { roles: ["Dispatch", "Driver"] })).toEqual(["dispatch", "driver"]);
  });
  it("keeps field-only logins out of the administrative card for every operation", () => {
    for (const category of ["field", "fleet", "gate"]) {
      expect(isAdministrativeMembership({ role: "field_employee" }), category).toBe(false);
      for (const role of ["admin", "member", "ap"]) expect(isAdministrativeMembership({ role }), category).toBe(true);
    }
  });
  it("shows only cards enabled by company operations", () => {
    expect(WORKFORCE_GROUPS.filter(g => ["field", "fleet"].includes(g.category)).map(g => g.title)).toEqual(["Field Crew", "Drivers"]);
  });
  it("includes gatekeepers and supervisors without classifying office staff", () => {
    expect(workforceCategories({ vendorRole: "gatekeeper" })).toEqual(["gate"]);
    expect(workforceCategories({ vendorRole: "office" }, ["gate_supervisor"])).toEqual(["gate"]);
    expect(workforceCategories({ vendorRole: "office" })).toEqual([]);
  });
  it("supports a single person assigned to field and driving duties", () => {
    expect(workforceCategories({ vendorRole: "field", roles: ["Driver", "Field Worker"] })).toEqual(["field", "fleet"]);
    expect(workforceCategories({ vendorRole: "field", roles: ["Driver"] })).toEqual(["fleet"]);
    expect(workforceCategories({ vendorRole: "foreman" })).toEqual(["field"]);
  });
});
