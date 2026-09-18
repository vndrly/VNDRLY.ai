import { describe, expect, it, vi } from "vitest";

import {
  FLYWHEEL_SPUR_SITE_CODE,
  pickDefaultGateHostKey,
  resolveAssignedGateSites,
  shouldApplyDefaultGateSite,
} from "./gate-default-site";
import * as gateSites from "./gate-default-site";

const assignedSites = [
  { id: 1, name: "North Pad", address: "", siteCode: "NORTH", latitude: 35, longitude: -97, assignmentId: 1, partnerId: 10, partnerName: "Warwick" },
  { id: 2, name: "South Pad", address: "", siteCode: "SOUTH", latitude: 30, longitude: -99, assignmentId: 2, partnerId: 20, partnerName: "Flywheel" },
];

describe("assigned gate site selection", () => {
  it("chooses the assigned site closest to the gate device", () => {
    expect(gateSites.pickNearestAssignedGateSite(assignedSites, { latitude: 30.01, longitude: -99.01 })?.siteCode).toBe("SOUTH");
  });

  it("groups assigned sites by partner for the two-stage selector", () => {
    expect(gateSites.groupAssignedGateSitesByPartner(assignedSites).map((group) => group.partnerName)).toEqual(["Flywheel", "Warwick"]);
  });

  it("offers only GPS-local rigs for the locked lease partner", () => {
    const sites = [
      { ...assignedSites[0], id: 3, siteCode: "LOCAL-A", name: "Local A", latitude: 35, longitude: -97, siteRadiusMeters: 805 },
      { ...assignedSites[0], id: 4, siteCode: "LOCAL-B", name: "Local B", latitude: 35.001, longitude: -97.001, siteRadiusMeters: 805 },
      { ...assignedSites[0], id: 5, siteCode: "FAR", name: "Far", latitude: 36, longitude: -98, siteRadiusMeters: 805 },
      { ...assignedSites[1], id: 6, siteCode: "OTHER", name: "Other lease", latitude: 35, longitude: -97, siteRadiusMeters: 805 },
    ];
    expect(gateSites.pickLocalAssignedGateSites(sites, { latitude: 35, longitude: -97 }).map((site) => site.siteCode)).toEqual(["LOCAL-A", "LOCAL-B"]);
  });
});

describe("shouldApplyDefaultGateSite", () => {
  it("applies the assigned site when the gate is still empty", () => {
    expect(
      shouldApplyDefaultGateSite({
        confirmedCode: null,
        typedCode: "",
        defaultSiteCode: "SITE-B40D77D2",
      }),
    ).toBe(true);
  });

  it("does not overwrite a site the gatekeeper already confirmed", () => {
    expect(
      shouldApplyDefaultGateSite({
        confirmedCode: "SITE-OLD",
        typedCode: "",
        defaultSiteCode: "SITE-B40D77D2",
      }),
    ).toBe(false);
  });

  it("does not steal the field while the gatekeeper is typing a code", () => {
    expect(
      shouldApplyDefaultGateSite({
        confirmedCode: null,
        typedCode: "SITE-",
        defaultSiteCode: "SITE-B40D77D2",
      }),
    ).toBe(false);
  });

  it("does nothing when the vendor has no assigned site", () => {
    expect(
      shouldApplyDefaultGateSite({
        confirmedCode: null,
        typedCode: "",
        defaultSiteCode: null,
      }),
    ).toBe(false);
  });
});

describe("pickDefaultGateHostKey", () => {
  it("prefers the partner host as the current location host", () => {
    expect(
      pickDefaultGateHostKey([
        { key: "vendor:1054", type: "vendor" },
        { key: "partner:566", type: "partner" },
      ]),
    ).toBe("partner:566");
  });

  it("falls back to the first host when no partner is present", () => {
    expect(pickDefaultGateHostKey([{ key: "vendor:1054", type: "vendor" }])).toBe(
      "vendor:1054",
    );
    expect(pickDefaultGateHostKey([])).toBe("");
  });
});

describe("resolveAssignedGateSites", () => {
  const spurContext = {
    site: {
      id: 309,
      name: "Flywheel Energy Spur",
      address: "34.63951, -97.66194",
      siteCode: FLYWHEEL_SPUR_SITE_CODE,
      latitude: 34.63951,
      longitude: -97.66194,
    },
    vendors: [{ id: 1054 }],
  };

  it("uses the assigned-sites API when it is available", async () => {
    const listed = {
      sites: [{ ...spurContext.site, assignmentId: 14819, partnerId: 566, partnerName: "Flywheel" }],
      defaultSite: { ...spurContext.site, assignmentId: 14819, partnerId: 566, partnerName: "Flywheel" },
    };
    const getSiteContext = vi.fn();
    const result = await resolveAssignedGateSites({
      vendorId: 1054,
      listAssigned: async () => listed,
      getSiteContext,
    });
    expect(result).toEqual(listed);
    expect(getSiteContext).not.toHaveBeenCalled();
  });

  it("does not guess a customer site when the assigned-sites API is unavailable", async () => {
    const result = await resolveAssignedGateSites({
      vendorId: 1054,
      listAssigned: async () => {
        throw new Error("HTTP 404");
      },
      getSiteContext: async () => spurContext,
    });
    expect(result).toEqual({ sites: [], defaultSite: null });
  });

  it("does not fall back to Flywheel Spur for a vendor that is not assigned there", async () => {
    const result = await resolveAssignedGateSites({
      vendorId: 2,
      listAssigned: async () => {
        throw new Error("HTTP 404");
      },
      getSiteContext: async () => spurContext,
    });
    expect(result).toEqual({ sites: [], defaultSite: null });
  });
});
