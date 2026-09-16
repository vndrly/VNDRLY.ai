import { describe, expect, it } from "vitest";
import { managedWorkerSiteIds, managedWorkerSiteRole } from "./managed-worker-access";

describe("managed worker site grants", () => {
  it("keeps supervisory authority on the explicitly granted site", () => {
    const session = { managedSubcontractor: { siteGrants: [
      { siteId: 1, role: "gate_supervisor" as const },
      { siteId: 2, role: "gatekeeper" as const },
    ] } };
    expect(managedWorkerSiteRole(session, 1)).toBe("gate_supervisor");
    expect(managedWorkerSiteRole(session, 2)).toBe("gatekeeper");
    expect(managedWorkerSiteRole(session, 3)).toBeNull();
    expect(managedWorkerSiteIds(session)).toEqual([1, 2]);
  });
  it("fails closed without grants", () => {
    expect(managedWorkerSiteRole({}, 1)).toBeNull();
    expect(managedWorkerSiteIds({ managedSubcontractor: { siteGrants: [] } })).toEqual([]);
  });
});
