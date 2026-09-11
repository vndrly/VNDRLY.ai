import { describe, expect, it } from "vitest";
import { canManageCrew, canReadCollaborationChannel } from "./collaboration-policy";

describe("collaboration role and tenant boundaries", () => {
  it("requires ownership or matching company administrator", () => {
    expect(canManageCrew({ ownerMatch: false, companyAdmin: true, crewRole: null })).toBe(false);
    expect(canManageCrew({ ownerMatch: true, companyAdmin: false, crewRole: "member" })).toBe(false);
    expect(canManageCrew({ ownerMatch: true, companyAdmin: true, crewRole: null })).toBe(true);
    expect(canManageCrew({ ownerMatch: false, companyAdmin: false, crewRole: "owner" })).toBe(true);
  });
  it("private channels and chats require explicit membership even for company admins", () => {
    expect(canReadCollaborationChannel("private", false, true)).toBe(false);
    expect(canReadCollaborationChannel("chat", false, true)).toBe(false);
    expect(canReadCollaborationChannel("crew", false, true)).toBe(true);
    expect(canReadCollaborationChannel("shared", true, false)).toBe(true);
  });
});
