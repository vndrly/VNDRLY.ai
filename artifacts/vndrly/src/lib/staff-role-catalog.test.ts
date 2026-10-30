import { expect, it } from "vitest";
import { catalogStaffRoles, companyRoleOptions, currentRoleLabel } from "./staff-role-catalog";
import { accessForStaffRoles, staffRolesFor } from "./staff-profile";
it("includes common staffing positions plus only the company operational areas", () => {
  expect(catalogStaffRoles().length).toBeGreaterThan(30);
  const roles = companyRoleOptions(["gate"]);
  expect(roles.some(role => role.label === "Payroll")).toBe(true);
  expect(roles.some(role => role.label === "Gatekeeper")).toBe(true);
  expect(roles.some(role => role.label === "Driver")).toBe(false);
});
it("resolves renamed titles and custom positions without admin access", () => {
  const catalog = { version: 1, canEdit: true, entries: [{ id: "common:Payroll", label: "Payroll Coordinator", group: "Accounting", aliases: ["Payroll"] }, { id: "new", label: "Travel Coordinator", group: "Office" }] };
  expect(currentRoleLabel("Payroll", catalog)).toBe("Payroll Coordinator");
  const roles = companyRoleOptions(["gate"], catalog);
  expect(accessForStaffRoles(["Travel Coordinator"], [], ["gatekeeper"], roles)).toEqual(["gatekeeper", "office"]);
  expect(roles.find(role => role.label === "Travel Coordinator")?.access).toEqual(["office"]);
  expect(staffRolesFor("Office Staff", ["Payroll Coordinator"], ["Payroll", "Visitor Notifications"], ["Payroll", "Payroll Coordinator"])).toEqual(["Office Staff", "Visitor Notifications", "Payroll Coordinator"]);
});
