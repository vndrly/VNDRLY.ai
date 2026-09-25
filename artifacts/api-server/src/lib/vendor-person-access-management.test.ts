import { describe, expect, it } from "vitest";
import { prepareAccessReplacement } from "./vendor-person-access-management.js";

describe("prepareAccessReplacement", () => {
  it("deduplicates valid operational roles and selected sites", () => {
    expect(
      prepareAccessReplacement(
        {
          operationalRoles: ["office", "gatekeeper", "gatekeeper", "gate_supervisor"],
          siteLocationIds: [44, 22, 44],
        },
        { isAdmin: false, authorizedSiteIds: [22, 44] },
      ),
    ).toEqual({
      operationalRoles: ["office", "gatekeeper", "gate_supervisor"],
      siteLocationIds: [22, 44],
      siteAccessMode: "selected",
    });
  });

  it("uses inherited site scope for admins", () => {
    expect(
      prepareAccessReplacement(
        { operationalRoles: ["gatekeeper"], siteLocationIds: [22] },
        { isAdmin: true, authorizedSiteIds: [22, 44] },
      ),
    ).toEqual({
      operationalRoles: ["gatekeeper"],
      siteLocationIds: [],
      siteAccessMode: "all_authorized",
    });
  });

  it("rejects unknown roles and unauthorized sites", () => {
    expect(() =>
      prepareAccessReplacement(
        { operationalRoles: ["owner"], siteLocationIds: [] },
        { isAdmin: false, authorizedSiteIds: [22] },
      ),
    ).toThrow("Invalid operational role");
    expect(() =>
      prepareAccessReplacement(
        { operationalRoles: ["gatekeeper"], siteLocationIds: [55] },
        { isAdmin: false, authorizedSiteIds: [22] },
      ),
    ).toThrow("Site access is not authorized for this vendor");
  });
});
