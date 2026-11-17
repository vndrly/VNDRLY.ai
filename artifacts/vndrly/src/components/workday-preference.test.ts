import { expect, it } from "vitest";
import { workdayPreferenceForRole } from "@workspace/api-zod";
it.each(["gatekeeper","field","driver","employee"])("shows Pickup Shifts for line role %s",vendorRole=>{
  expect(workdayPreferenceForRole({role:"field_employee",vendorRole,membershipRole:"field_employee"})).toBe("pickup-shifts");
});
it.each(["office","staff","both","gate_supervisor","foreman","supervisor"])("shows On Call for staff/supervisory role %s",vendorRole=>{
  expect(workdayPreferenceForRole({role:"field_employee",vendorRole})).toBe("on-call");
});
it("gives the active company administrator precedence over a line role",()=>{
  expect(workdayPreferenceForRole({role:"vendor",membershipRole:"admin",vendorRole:"gatekeeper"})).toBe("on-call");
});
