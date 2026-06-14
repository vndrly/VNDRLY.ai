import { describe, expect, it } from "vitest";

import { quickActionsForUser } from "@/lib/assistant-quick-actions";

describe("quickActionsForUser", () => {
  it("returns field-employee chips for crew", () => {
    const chips = quickActionsForUser({
      id: 1,
      username: "joe",
      role: "field_employee",
      displayName: "Joe",
      partnerId: null,
      vendorId: 7,
      vendorRole: "field",
      vendorPeopleId: 1,
      preferredLanguage: "en",
      activeMembershipId: 1,
      availableMemberships: [],
      requiresContextChoice: false,
    });
    expect(chips).toHaveLength(3);
    expect(chips[0].labelKey).toBe("askv.quickActions.fieldStatus");
  });

  it("returns foreman chips when vendorRole is foreman", () => {
    const chips = quickActionsForUser({
      id: 1,
      username: "sam",
      role: "field_employee",
      displayName: "Sam",
      partnerId: null,
      vendorId: 7,
      vendorRole: "foreman",
      vendorPeopleId: 2,
      preferredLanguage: "en",
      activeMembershipId: 1,
      availableMemberships: [],
      requiresContextChoice: false,
    });
    expect(chips[0].labelKey).toBe("askv.quickActions.foremanCrew");
  });

  it("returns vendor chips for vendor office login", () => {
    const chips = quickActionsForUser({
      id: 1,
      username: "admin",
      role: "vendor",
      displayName: "Admin",
      partnerId: null,
      vendorId: 7,
      vendorRole: null,
      vendorPeopleId: null,
      preferredLanguage: "en",
      activeMembershipId: 1,
      availableMemberships: [],
      requiresContextChoice: false,
    });
    expect(chips[0].labelKey).toBe("askv.quickActions.vendorOnboarding");
  });
});
