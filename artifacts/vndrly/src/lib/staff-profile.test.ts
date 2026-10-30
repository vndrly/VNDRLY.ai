import { describe, expect, it } from "vitest";
import { defaultStaffAccess, staffTypeFor, staffRolesFor, staffAccessFor, staffRoleOptions, staffPrimaryRole, accessForStaffRoles } from "./staff-profile";
describe("staff profiles", () => {
  it('limits position choices to office duties and the company operations',()=>{
    const gate=staffRoleOptions(['gate']).map(role=>role.label);
    expect(gate).toEqual(expect.arrayContaining(['Team Member','Office Staff','Scheduler','Payroll','Purchasing','Invoicing','Gate Supervisor','Gatekeeper','Bookkeeper','Human Resources','Office Manager']));
    expect(gate).not.toContain('Foreman');
    expect(gate).not.toContain('Dispatch');
    expect(staffRoleOptions(['field']).map(role=>role.label)).toContain('Foreman');
    expect(staffRoleOptions(['fleet']).map(role=>role.label)).toContain('Dispatch');
  });
  it('reuses a unique common office catalogue in every operation type without admin membership grants',()=>{
    const office=staffRoleOptions([]);
    expect(office.length).toBeGreaterThan(30);
    expect(new Set(office.map(role=>role.label)).size).toBe(office.length);
    for(const role of office){
      expect(role.access).toEqual(['office']);
      expect(staffRoleOptions(['gate'])).toContainEqual(role);
      expect(staffRoleOptions(['fleet'])).toContainEqual(role);
      expect(staffRoleOptions(['field'])).toContainEqual(role);
    }
    expect(staffRolesFor('Gatekeeper',[],['Gatekeeper','Bookkeeper','Visitor Notifications','Custom site duty'])).toEqual(['Gatekeeper','Visitor Notifications','Custom site duty']);
  });
  it('uses assigned roles for titles and removes only access represented by edited roles',()=>{
    expect(staffPrimaryRole({vendorRole:'gatekeeper',jobTitle:'Gate Attendant'},['gatekeeper'])).toBe('Gatekeeper');
    expect(staffPrimaryRole({vendorRole:'office',jobTitle:'Scheduler'},['office','gate_supervisor'])).toBe('Scheduler');
    expect(accessForStaffRoles(['Gatekeeper'],['Gate Supervisor'],['office','gatekeeper','gate_supervisor'])).toEqual(['office','gatekeeper']);
  });
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
