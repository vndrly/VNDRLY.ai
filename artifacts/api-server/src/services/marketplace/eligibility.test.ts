import { describe, expect, it } from "vitest";
import { distanceMiles } from "./distance";
import {
  evaluateMarketplaceEligibility,
  mappingMatchesSavedSubject,
  type EligibilityInput,
} from "./eligibility";
import { subjectFingerprint } from "../service-matching/candidates";

const now = new Date("2026-10-18T12:00:00Z");
const area = {
  vendorId: 3,
  vendorCapabilityId: null,
  latitude: 35,
  longitude: -97,
  radiusMiles: 500,
  active: true,
  verifiedAt: now,
  effectiveFrom: now,
  effectiveUntil: null,
};
const input = (): EligibilityInput => ({
  vendorId: 3,
  partnerId: 9,
  workTypeId: 21,
  authorized: true,
  companyActive: true,
  now,
  capability: { id: 7, vendorId: 3, active: true, capacity: 2 },
  capabilityMapping: {
    canonicalServiceId: 5,
    status: "active",
    supersededAt: null,
  },
  demandMapping: {
    canonicalServiceId: 5,
    status: "active",
    supersededAt: null,
  },
  canonicalServiceActive: true,
  offer: {
    id: 8,
    vendorCapabilityId: 7,
    partnerId: 9,
    workTypeId: 21,
    active: true,
    capacity: 2,
    effectiveFrom: now,
    effectiveUntil: null,
  },
  serviceAreas: [area],
  site: { latitude: 35, longitude: -97 },
  complianceCurrent: true,
  requiredCredentials: ["H2S"],
  currentCredentials: ["H2S"],
  requestedCapacity: 1,
  available: true,
});

describe("marketplace distance", () => {
  it("uses great-circle miles for known coordinates and identical points", () => {
    expect(
      distanceMiles(
        { latitude: 40.7128, longitude: -74.006 },
        { latitude: 34.0522, longitude: -118.2437 },
      ),
    ).toBeCloseTo(2445.56, 1);
    expect(
      distanceMiles(
        { latitude: 35, longitude: -97 },
        { latitude: 35, longitude: -97 },
      ),
    ).toBe(0);
  });
  it.each([
    { latitude: -97, longitude: 35 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: 0 },
    { latitude: NaN, longitude: -97 },
    { longitude: -97 },
  ])("rejects invalid or reversed coordinates %j", (point) => {
    expect(() =>
      distanceMiles(point as never, { latitude: 35, longitude: -97 }),
    ).toThrow();
  });
  it("accepts a real point on the equator", () => {
    expect(
      distanceMiles(
        { latitude: 0, longitude: 10 },
        { latitude: 0, longitude: 10 },
      ),
    ).toBe(0);
  });
});

describe("marketplace eligibility", () => {
  it("rejects mappings for edited wording or without a saved subject snapshot", () => {
    const subject = {
      subjectType: "partner_work_type" as const,
      subjectId: 21,
      name: "Pressure test",
      description: "Only pressure > 5000 psi",
      category: "Testing",
    };
    const mapping = {
      evidence: {
        serviceMatching: { subjectFingerprint: subjectFingerprint(subject) },
      },
    };
    expect(mappingMatchesSavedSubject(mapping, subject)).toBe(true);
    expect(
      mappingMatchesSavedSubject(mapping, {
        ...subject,
        description: "Only pressure < 5000 psi",
      }),
    ).toBe(false);
    expect(mappingMatchesSavedSubject({ evidence: {} }, subject)).toBe(false);
  });
  it("uses inclusive coverage without rounding distances before comparison", async () => {
    // Equatorial arc using the documented mean earth radius, 3958.7613 miles.
    const base = { ...area, latitude: 0, longitude: 10 };
    const fixture = input();
    fixture.serviceAreas = [base];
    fixture.site = { latitude: 0, longitude: 17.23657921899488 }; // mathematically 500 miles
    const boundary = await evaluateMarketplaceEligibility(fixture);
    expect(boundary.eligible).toBe(true);
    // Also exercise exact numeric equality, rather than letting floating-point
    // representation just below 500 conceal an accidental strict '<' comparison.
    fixture.serviceAreas = [{ ...base, radiusMiles: 499.99999999999994 }];
    expect((await evaluateMarketplaceEligibility(fixture)).eligible).toBe(true);
    fixture.serviceAreas = [base];
    fixture.site = { latitude: 0, longitude: 17.23659369215332 }; // 500.001 miles
    const outside = await evaluateMarketplaceEligibility(fixture);
    expect(outside).toMatchObject({
      eligible: false,
      reasonCodes: ["OUT_OF_SERVICE_AREA"],
      facts: { radiusMiles: 500 },
    });
    expect(outside.facts.distanceMiles).toBeCloseTo(500.001, 6);
  });
  it("uses company default and capability override but ignores another vendor or capability", async () => {
    const fixture = input();
    fixture.site = { latitude: 36, longitude: -97 };
    expect((await evaluateMarketplaceEligibility(fixture)).eligible).toBe(true);
    fixture.serviceAreas = [
      area,
      { ...area, vendorCapabilityId: 7, radiusMiles: 10 },
      { ...area, vendorId: 99, vendorCapabilityId: 7, radiusMiles: 1000 },
    ];
    expect((await evaluateMarketplaceEligibility(fixture)).reasonCodes).toEqual(
      ["OUT_OF_SERVICE_AREA"],
    );
    fixture.serviceAreas = [{ ...area, vendorCapabilityId: 8 }];
    expect(
      (await evaluateMarketplaceEligibility(fixture)).reasonCodes,
    ).toContain("SERVICE_AREA_MISSING");
  });
  it.each([
    [
      "inactive capability",
      (x: EligibilityInput) => {
        x.capability!.active = false;
      },
      "CAPABILITY_INACTIVE",
    ],
    [
      "missing offer",
      (x: EligibilityInput) => {
        x.offer = null;
      },
      "OFFER_INACTIVE",
    ],
    [
      "expired offer",
      (x: EligibilityInput) => {
        x.offer!.effectiveUntil = now;
      },
      "OFFER_INACTIVE",
    ],
    [
      "stale compliance",
      (x: EligibilityInput) => {
        x.complianceCurrent = false;
      },
      "COMPLIANCE_STALE",
    ],
    [
      "missing credential",
      (x: EligibilityInput) => {
        x.currentCredentials = [];
      },
      "CREDENTIAL_MISSING",
    ],
    [
      "insufficient capacity",
      (x: EligibilityInput) => {
        x.requestedCapacity = 3;
      },
      "INSUFFICIENT_CAPACITY",
    ],
    [
      "unavailable",
      (x: EligibilityInput) => {
        x.available = false;
      },
      "UNAVAILABLE",
    ],
    [
      "pending mapping",
      (x: EligibilityInput) => {
        x.capabilityMapping!.status = "review_required";
      },
      "SERVICE_MATCH_INACTIVE",
    ],
    [
      "archived concept",
      (x: EligibilityInput) => {
        x.canonicalServiceActive = false;
      },
      "SERVICE_MATCH_INACTIVE",
    ],
    [
      "wrong commercial scope",
      (x: EligibilityInput) => {
        x.offer!.partnerId = 99;
      },
      "OFFER_INACTIVE",
    ],
    [
      "missing site",
      (x: EligibilityInput) => {
        x.site = null;
      },
      "SITE_COORDINATES_INVALID",
    ],
    [
      "invalid service base",
      (x: EligibilityInput) => {
        x.serviceAreas = [{ ...area, latitude: 0, longitude: 0 }];
      },
      "SERVICE_AREA_INVALID",
    ],
    [
      "ambiguous service base",
      (x: EligibilityInput) => {
        x.serviceAreas = [area, area];
      },
      "SERVICE_AREA_AMBIGUOUS",
    ],
    [
      "unauthorized tenant",
      (x: EligibilityInput) => {
        x.authorized = false;
      },
      "UNAUTHORIZED",
    ],
  ])("fails closed for %s", async (_name, mutate, code) => {
    const fixture = input();
    mutate(fixture);
    const result = await evaluateMarketplaceEligibility(fixture);
    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain(code);
  });
  it("does not expose internal evidence in display-safe facts", async () => {
    const fixture = input();
    fixture.internalEvidence = { privateNotes: "secret" };
    const result = await evaluateMarketplaceEligibility(fixture);
    expect(result.internalEvidence).toEqual({ privateNotes: "secret" });
    expect(JSON.stringify(result.facts)).not.toContain("secret");
  });
});
