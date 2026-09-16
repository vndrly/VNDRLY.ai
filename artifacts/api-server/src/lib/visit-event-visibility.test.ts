import { describe, expect, it } from "vitest";
import type { VisitEvent } from "./visit-events";
import { visitEventVisibleToSession } from "./visit-event-visibility";

const checkedInAtSite = (siteLocationId: number, hostVendorId: number | null): VisitEvent => ({
  type: "visit.checked_in",
  visit: {
    id: 11,
    firstName: "Pat",
    lastName: "Reyes",
    company: "Acme Wireline",
    vehiclePlate: "ABC1234",
    plateState: "TX",
    platePhotoUrl: "/plates/abc.jpg",
    vehiclePhotoUrl: null,
    purpose: "Delivery",
    hostType: hostVendorId ? "vendor" : "partner",
    hostPartnerId: hostVendorId ? null : 7,
    hostVendorId,
    hostPartnerName: hostVendorId ? null : "Flywheel",
    hostVendorName: hostVendorId ? "MidCon" : null,
    siteLocationId,
    sitePartnerId: 7,
    siteName: "Energy Spur",
    checkInTime: "2026-08-23T17:00:00.000Z",
    checkInLatitude: 32.1,
    checkInLongitude: -102.2,
  },
});

const checkedOutAtSite = (siteLocationId: number, hostVendorId: number | null): VisitEvent => ({
  type: "visit.checked_out",
  visitId: 11,
  siteLocationId,
  sitePartnerId: 7,
  hostVendorId,
  checkOutTime: "2026-08-23T18:00:00.000Z",
  autoCheckedOut: false,
});

const gatekeeper = {
  role: "vendor",
  vendorId: 1054,
  partnerId: null,
  vendorRole: "gatekeeper",
};

describe("visitEventVisibleToSession", () => {
  it("lets a gatekeeper see a partner-hosted check-in at an assigned site", () => {
    expect(
      visitEventVisibleToSession(gatekeeper, checkedInAtSite(309, null), new Set([309, 410])),
    ).toBe(true);
  });

  it("lets a gatekeeper see check-out at an assigned site even when hostVendorId is null", () => {
    expect(
      visitEventVisibleToSession(gatekeeper, checkedOutAtSite(309, null), new Set([309])),
    ).toBe(true);
  });

  it("hides visits at sites the gatekeeper is not assigned to", () => {
    expect(
      visitEventVisibleToSession(gatekeeper, checkedInAtSite(999, 1054), new Set([309])),
    ).toBe(false);
  });

  it("keeps ordinary vendor users scoped to visits they host", () => {
    const vendor = { role: "vendor", vendorId: 1054, partnerId: null, vendorRole: "member" };
    expect(visitEventVisibleToSession(vendor, checkedInAtSite(309, 1054))).toBe(true);
    expect(visitEventVisibleToSession(vendor, checkedInAtSite(309, null))).toBe(false);
  });
});

it("managed gate workers see only granted assigned sites", () => {
  const session = { ...gatekeeper, role: "field_employee", vendorRole: "gate_supervisor", managedSubcontractor: { siteGrants: [{ siteId: 309, role: "gate_supervisor" as const }] } };
  expect(visitEventVisibleToSession(session, checkedInAtSite(309, null), new Set([309]))).toBe(true);
  expect(visitEventVisibleToSession(session, checkedInAtSite(999, 1054), new Set([309]))).toBe(false);
  expect(visitEventVisibleToSession(session, checkedInAtSite(309, null), null)).toBe(false);
});
