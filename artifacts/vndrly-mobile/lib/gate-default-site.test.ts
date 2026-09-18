import { describe, expect, it, vi } from "vitest";

import {
  FLYWHEEL_SPUR_SITE_CODE,
  pickDefaultGateHostKey,
  pickPreferredGateDefaultSite,
  resolveAssignedGateSites,
  shouldApplyDefaultGateSite,
  type AssignedGateSite,
} from "./gate-default-site";
import * as gateDefaultSite from "./gate-default-site";

describe("shouldApplyDefaultGateSite", () => {
  it("applies the assigned site when the gate is still empty", () => {
    expect(
      shouldApplyDefaultGateSite({
        confirmedCode: null,
        typedCode: "",
        defaultSiteCode: FLYWHEEL_SPUR_SITE_CODE,
      }),
    ).toBe(true);
  });

  it("does not overwrite a site the gatekeeper already confirmed", () => {
    expect(
      shouldApplyDefaultGateSite({
        confirmedCode: "SITE-OLD",
        typedCode: "",
        defaultSiteCode: FLYWHEEL_SPUR_SITE_CODE,
      }),
    ).toBe(false);
  });

  it("does not steal the field while the gatekeeper is typing a code", () => {
    expect(
      shouldApplyDefaultGateSite({
        confirmedCode: null,
        typedCode: "SITE-",
        defaultSiteCode: FLYWHEEL_SPUR_SITE_CODE,
      }),
    ).toBe(false);
  });
});

describe("pickPreferredGateDefaultSite", () => {
  const spur: AssignedGateSite = {
    id: 309,
    name: "Flywheel Energy Spur",
    address: "34.63951, -97.66194",
    siteCode: FLYWHEEL_SPUR_SITE_CODE,
    latitude: 34.63951,
    longitude: -97.66194,
    assignmentId: 1,
    partnerId: 566,
    partnerName: "Flywheel Energy",
  };
  const older: AssignedGateSite = {
    id: 10,
    name: "Older Pad",
    address: "1 Main St",
    siteCode: "SITE-OLD",
    latitude: 35,
    longitude: -97,
    assignmentId: 99,
    partnerId: 565,
    partnerName: "Warwick Energy Group",
  };

  it("uses the API-selected default rather than a hard-coded customer site", () => {
    expect(pickPreferredGateDefaultSite([older, spur], older)?.siteCode).toBe(
      "SITE-OLD",
    );
  });

  it("uses the API default when Flywheel Spur is not assigned", () => {
    expect(pickPreferredGateDefaultSite([older], older)?.siteCode).toBe("SITE-OLD");
  });
});

describe("location-aware gate site selection", () => {
  const sites = [
    {
      id: 1,
      name: "Far Warwick Pad",
      address: "Wilson County, TX",
      siteCode: "SITE-FAR",
      latitude: 29.5,
      longitude: -97.5,
      assignmentId: 1,
      partnerId: 607,
      partnerName: "Warwick Energy Group",
    },
    {
      id: 2,
      name: "Near Warwick Pad",
      address: "Wilson County, TX",
      siteCode: "SITE-NEAR",
      latitude: 29.001,
      longitude: -98.001,
      assignmentId: 2,
      partnerId: 607,
      partnerName: "Warwick Energy Group",
    },
    {
      id: 3,
      name: "Other Partner Pad",
      address: "Grady County, OK",
      siteCode: "SITE-OTHER",
      latitude: 35,
      longitude: -97.8,
      assignmentId: 3,
      partnerId: 566,
      partnerName: "Flywheel Energy",
    },
  ];

  it("chooses the physically closest authorized site instead of assignment order", () => {
    const pickNearest = (gateDefaultSite as Record<string, unknown>)
      .pickNearestAssignedGateSite as undefined | ((...args: unknown[]) => AssignedGateSite | null);

    expect(pickNearest?.(sites, { latitude: 29, longitude: -98 })?.siteCode).toBe("SITE-NEAR");
  });

  it("groups authorized sites by partner for the two-stage picker", () => {
    const groupSites = (gateDefaultSite as Record<string, unknown>)
      .groupAssignedGateSitesByPartner as undefined | ((sites: unknown[]) => unknown);

    expect(groupSites?.(sites)).toEqual([
      {
        partnerId: 566,
        partnerName: "Flywheel Energy",
        sites: [sites[2]],
      },
      {
        partnerId: 607,
        partnerName: "Warwick Energy Group",
        sites: [sites[0], sites[1]],
      },
    ]);
  });

  it("offers only GPS-local rigs for the locked lease partner", () => {
    const localSites = [
      { ...sites[1], id: 4, siteCode: "LOCAL-A", name: "Local A", latitude: 29, longitude: -98, siteRadiusMeters: 805 },
      { ...sites[1], id: 5, siteCode: "LOCAL-B", name: "Local B", latitude: 29.001, longitude: -98.001, siteRadiusMeters: 805 },
      { ...sites[1], id: 6, siteCode: "FAR", name: "Far", latitude: 30, longitude: -99, siteRadiusMeters: 805 },
      { ...sites[2], id: 7, siteCode: "OTHER", name: "Other lease", latitude: 29, longitude: -98, siteRadiusMeters: 805 },
    ];
    const pickLocal = (gateDefaultSite as Record<string, unknown>)
      .pickLocalAssignedGateSites as undefined | ((sites: AssignedGateSite[], origin: { latitude: number; longitude: number }) => AssignedGateSite[]);
    expect(pickLocal?.(localSites, { latitude: 29, longitude: -98 }).map((site) => site.siteCode)).toEqual(["LOCAL-A", "LOCAL-B"]);
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

  it("does not guess a customer site when the assigned-sites API is missing", async () => {
    const result = await resolveAssignedGateSites({
      vendorId: 1054,
      listAssigned: async () => {
        throw new Error("HTTP 404");
      },
      getSiteContext: async () => spurContext,
    });
    expect(result).toEqual({ sites: [], defaultSite: null });
  });
});
