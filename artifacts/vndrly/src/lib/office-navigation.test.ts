import { expect, it } from "vitest";
import { canUseOfficeNavigation } from "./office-navigation";
it("allows office/admin and excludes field roles", () => {
 for (const vendorRole of ["office", "both"]) expect(canUseOfficeNavigation({role:"vendor",vendorRole})).toBe(true);
 for (const vendorRole of ["gatekeeper", "gate_supervisor", "foreman"]) expect(canUseOfficeNavigation({role:"vendor",vendorRole})).toBe(false);
 expect(canUseOfficeNavigation({role:"admin"})).toBe(true);
 expect(canUseOfficeNavigation({role:"field_employee"})).toBe(false);
 expect(canUseOfficeNavigation({role:"vendor",vendorRole:"gatekeeper",activeMembershipId:2,availableMemberships:[{id:2,role:"admin"}]})).toBe(true);
});