import { describe, expect, it } from "vitest";

import type { VisitorRow } from "@/lib/visits-api";
import {
  draftsEqual,
  evaluateGateMemory,
  fillFromVisit,
  mergeGateFill,
  type GateEntryDraft,
} from "./gate-entry-memory";

function visit(overrides: Partial<VisitorRow> = {}): VisitorRow {
  return {
    id: 1,
    firstName: "Jordan",
    lastName: "Hale",
    company: "Peak Energy",
    phone: "555-0142",
    email: "jordan@peak.example",
    vehiclePlate: "OK-4412",
    plateState: "OK",
    platePhotoUrl: null,
    vehiclePhotoUrl: null,
    purpose: "Water haul",
    notes: null,
    checkOutNotes: null,
    admissionStatus: "admitted",
    expectedDurationMinutes: 45,
    hostType: "partner",
    hostPartnerId: 566,
    hostVendorId: null,
    hostPartnerName: "Flywheel Energy",
    hostVendorName: null,
    siteLocationId: 309,
    siteName: "Flywheel Energy Spur",
    siteCode: "SITE-B40D77D2",
    checkInTime: "2026-08-20T10:00:00Z",
    checkOutTime: "2026-08-20T11:00:00Z",
    autoCheckedOut: false,
    checkInLatitude: 34.64,
    checkInLongitude: -97.66,
    ...overrides,
  };
}

function draft(overrides: Partial<GateEntryDraft> = {}): GateEntryDraft {
  return {
    firstName: "",
    lastName: "",
    company: "",
    vehiclePlate: "",
    plateState: null,
    purpose: "",
    notes: "",
    expectedDuration: "60",
    ...overrides,
  };
}

describe("evaluateGateMemory", () => {
  const peakJordan = visit();
  const peakRiley = visit({
    id: 2,
    firstName: "Riley",
    lastName: "Cho",
    phone: "555-0199",
    email: "riley@peak.example",
    vehiclePlate: "TX-8801",
    purpose: "Chemical delivery",
    checkInTime: "2026-08-21T10:00:00Z",
  });
  const summitMaya = visit({
    id: 3,
    firstName: "Maya",
    lastName: "Ortiz",
    company: "Summit Fluids",
    phone: "405-555-0100",
    email: "maya@summit.example",
    vehiclePlate: "OK-2208",
    purpose: "Frac tank",
    checkInTime: "2026-08-22T10:00:00Z",
  });

  it("completes a unique company prefix such as Peak → Peak Energy", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan, peakRiley, summitMaya],
      draft: draft({ company: "Peak" }),
      activeField: "company",
    });
    expect(result.fill?.company).toBe("Peak Energy");
    expect(result.fill?.firstName).toBeUndefined();
    expect(result.suggestions.map((row) => row.label)).toEqual(["Peak Energy"]);
  });

  it("shows distinct prior drivers for an exact known company before a name prefix", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan, peakRiley, summitMaya],
      draft: draft({ company: "Peak Energy" }),
      activeField: "firstName",
    });
    expect(result.fill).toBeNull();
    expect(result.suggestions.map((row) => row.label)).toEqual([
      "Riley Cho",
      "Jordan Hale",
    ]);
  });

  it("uses a newly saved visit as the latest unambiguous plate suggestion", () => {
    const newlySaved = visit({
      id: 99,
      firstName: "Alex",
      lastName: "Nguyen",
      vehiclePlate: "OK-4412",
      purpose: "Updated delivery",
      checkInTime: "2026-08-25T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [peakJordan, newlySaved],
      draft: draft({ vehiclePlate: "OK4412", plateState: "OK" }),
      activeField: "vehiclePlate",
    });
    expect(result.fill).toMatchObject({
      firstName: "Alex",
      lastName: "Nguyen",
      purpose: "Updated delivery",
    });
  });

  it("fills the most recent driver for a tag even when a different person used that plate earlier", () => {
    const older = visit({
      id: 12,
      firstName: "Jordan",
      lastName: "Hale",
      vehiclePlate: "OK-4412",
      checkInTime: "2026-08-01T10:00:00Z",
    });
    const newer = visit({
      id: 13,
      firstName: "Sam",
      lastName: "West",
      company: "Peak Energy",
      phone: "555-0200",
      email: "sam@peak.example",
      vehiclePlate: "OK4412",
      purpose: "Hot oil",
      expectedDurationMinutes: 30,
      checkInTime: "2026-08-22T12:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [older, newer],
      draft: draft({ vehiclePlate: "OK-4412", plateState: "OK" }),
      activeField: "vehiclePlate",
    });
    expect(result.fill).toMatchObject({
      firstName: "Sam",
      lastName: "West",
      company: "Peak Energy",
      vehiclePlate: "OK4412",
      purpose: "Hot oil",
      expectedDuration: "30",
    });
  });

  it("does not exact-match the same plate number from a different state", () => {
    const result = evaluateGateMemory({
      visits: [visit({ vehiclePlate: "4412", plateState: "OK" })],
      draft: draft({ vehiclePlate: "4412", plateState: "TX" }),
      activeField: "vehiclePlate",
    });

    expect(result.fill).toBeNull();
    expect(result.suggestions).toEqual([]);
  });

  it("fills last driver and company from a known plate even without a state", () => {
    const result = evaluateGateMemory({
      visits: [visit({ vehiclePlate: "4412", plateState: "OK" })],
      draft: draft({ vehiclePlate: "4412", plateState: null }),
      activeField: "vehiclePlate",
    });

    expect(result.fill).toMatchObject({
      firstName: "Jordan",
      lastName: "Hale",
      company: "Peak Energy",
    });
    expect(result.suggestions).toHaveLength(1);
  });

  it("suggests company drivers without auto-guessing when replacing the last driver", () => {
    const other = visit({
      id: 41,
      firstName: "Riley",
      lastName: "Cho",
      vehiclePlate: "4412",
      plateState: "OK",
      checkInTime: "2026-08-21T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [visit({ vehiclePlate: "4412", plateState: "OK" }), other],
      draft: draft({
        vehiclePlate: "4412",
        plateState: null,
        company: "Peak Energy",
        firstName: "Ri",
      }),
      activeField: "firstName",
    });

    expect(result.suggestions.map((row) => row.visit.firstName)).toEqual(["Riley"]);
    expect(result.fill).toMatchObject({ firstName: "Riley", lastName: "Cho" });
  });

  it("does not auto-guess a driver when a company prefix matches multiple people", () => {
    const other = visit({
      id: 42,
      firstName: "Riley",
      lastName: "Cho",
      vehiclePlate: "TX-8801",
      plateState: "TX",
      checkInTime: "2026-08-21T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [visit(), other],
      draft: draft({ company: "Peak" }),
      activeField: "company",
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.fill?.firstName).toBeUndefined();
    expect(result.fill?.lastName).toBeUndefined();
    expect(result.fill).toMatchObject({ company: "Peak Energy" });
  });

  it("prioritizes an exact state and number match over newer legacy and different-state rows", () => {
    const exact = visit({
      id: 30,
      firstName: "Exact",
      lastName: "Texas",
      vehiclePlate: "4412",
      plateState: "TX",
      checkInTime: "2026-08-20T10:00:00Z",
    });
    const legacy = visit({
      id: 31,
      firstName: "Legacy",
      lastName: "Driver",
      vehiclePlate: "44-12",
      plateState: null,
      checkInTime: "2026-08-22T10:00:00Z",
    });
    const wrongState = visit({
      id: 32,
      firstName: "Wrong",
      lastName: "State",
      vehiclePlate: "4412",
      plateState: "OK",
      checkInTime: "2026-08-23T10:00:00Z",
    });

    const result = evaluateGateMemory({
      visits: [legacy, wrongState, exact],
      draft: draft({ vehiclePlate: "4412", plateState: "TX" }),
      activeField: "vehiclePlate",
    });

    expect(result.fill).toMatchObject({
      firstName: "Exact",
      lastName: "Texas",
      plateState: "TX",
    });
    expect(result.suggestions.map((suggestion) => suggestion.visit.plateState)).toEqual([
      "TX",
      null,
    ]);
  });

  it("keeps composite plate priority while completing another memory field", () => {
    const exact = visit({
      id: 40,
      firstName: "Exact",
      lastName: "Texas",
      company: "Peak Energy",
      vehiclePlate: "4412",
      plateState: "TX",
      checkInTime: "2026-08-20T10:00:00Z",
    });
    const legacy = visit({
      id: 41,
      firstName: "Legacy",
      lastName: "Driver",
      company: "Peak Energy",
      vehiclePlate: "4412",
      plateState: null,
      checkInTime: "2026-08-22T10:00:00Z",
    });
    const wrongState = visit({
      id: 42,
      firstName: "Wrong",
      lastName: "State",
      company: "Peak Energy",
      vehiclePlate: "4412",
      plateState: "OK",
      checkInTime: "2026-08-23T10:00:00Z",
    });

    const result = evaluateGateMemory({
      visits: [legacy, wrongState, exact],
      draft: draft({ company: "Peak", vehiclePlate: "4412", plateState: "TX" }),
      activeField: "company",
    });

    expect(result.fill).toMatchObject({ firstName: "Exact", lastName: "Texas", plateState: "TX" });
  });

  it("does not complete an ambiguous company prefix", () => {
    const peakPower = visit({
      id: 4,
      company: "Peak Power",
      firstName: "Sam",
      lastName: "West",
      phone: "555-0200",
      email: "sam@peakpower.example",
      vehiclePlate: "OK-7701",
      checkInTime: "2026-08-18T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [peakJordan, peakPower],
      draft: draft({ company: "Peak" }),
      activeField: "company",
    });
    expect(result.fill).toBeNull();
    expect(result.suggestions.map((row) => row.label)).toEqual(["Peak Energy", "Peak Power"]);
  });

  it("fills the rest of the visitor when a plate uniquely matches", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan, peakRiley, summitMaya],
      draft: draft({ vehiclePlate: "ok4412", plateState: "OK" }),
      activeField: "vehiclePlate",
    });
    expect(result.fill).toMatchObject({
      firstName: "Jordan",
      lastName: "Hale",
      company: "Peak Energy",
      vehiclePlate: "OK-4412",
      purpose: "Water haul",
      expectedDuration: "45",
    });
    expect(result.fill).not.toHaveProperty("phone");
    expect(result.fill).not.toHaveProperty("email");
  });

  it("matches plates ignoring punctuation and uses the newest visit", () => {
    const older = visit({ id: 10, purpose: "Old haul", checkInTime: "2026-08-01T10:00:00Z" });
    const newer = visit({
      id: 11,
      vehiclePlate: "OK4412",
      purpose: "Fresh haul",
      phone: "555-7777",
      checkInTime: "2026-08-22T15:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [older, newer],
      draft: draft({ vehiclePlate: "ok-44", plateState: "OK" }),
      activeField: "vehiclePlate",
    });
    expect(result.fill?.purpose).toBe("Fresh haul");
    expect(result.fill).not.toHaveProperty("phone");
    expect(result.fill).not.toHaveProperty("email");
  });

  it("fills a unique person from a first-name prefix", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan, peakRiley, summitMaya],
      draft: draft({ firstName: "May" }),
      activeField: "firstName",
    });
    expect(result.fill).toMatchObject({
      firstName: "Maya",
      lastName: "Ortiz",
      company: "Summit Fluids",
      vehiclePlate: "OK-2208",
    });
  });

  it("suggests a different company driver even when the truck prefilled the last driver", () => {
    const bobVilla = visit({
      id: 20,
      firstName: "Bob",
      lastName: "Villa",
      company: "Peak Energy",
      vehiclePlate: "OK-4412",
    });
    const bonnieWest = visit({
      id: 21,
      firstName: "Bonnie",
      lastName: "West",
      company: "Peak Energy",
      vehiclePlate: "TX-9911",
      checkInTime: "2026-08-23T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [bobVilla, bonnieWest],
      draft: draft({ firstName: "Bo", company: "Peak Energy", vehiclePlate: "OK-4412" }),
      activeField: "firstName",
    });
    expect(result.suggestions.map((row) => row.label)).toEqual(["Bonnie West", "Bob Villa"]);
  });

  it("ignores the prefilled last name while replacing a driver by first name", () => {
    const bobVilla = visit({
      id: 20,
      firstName: "Bob",
      lastName: "Villa",
      company: "Peak Energy",
      vehiclePlate: "OK-4412",
    });
    const bonnieWest = visit({
      id: 21,
      firstName: "Bonnie",
      lastName: "West",
      company: "Peak Energy",
      vehiclePlate: "TX-9911",
      checkInTime: "2026-08-23T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [bobVilla, bonnieWest],
      draft: draft({
        firstName: "Bon",
        lastName: "Villa",
        company: "Peak Energy",
        vehiclePlate: "OK-4412",
      }),
      activeField: "firstName",
      isDeleting: true,
    });
    expect(result.suggestions.map((row) => row.label)).toEqual(["Bonnie West"]);
  });

  it("ignores the prefilled first name while replacing a driver by last name", () => {
    const bobVilla = visit({
      id: 20,
      firstName: "Bob",
      lastName: "Villa",
      company: "Peak Energy",
      vehiclePlate: "OK-4412",
    });
    const aliceVillanueva = visit({
      id: 22,
      firstName: "Alice",
      lastName: "Villanueva",
      company: "Peak Energy",
      vehiclePlate: "TX-2288",
      checkInTime: "2026-08-24T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [bobVilla, aliceVillanueva],
      draft: draft({
        firstName: "Bob",
        lastName: "Villan",
        company: "Peak Energy",
        vehiclePlate: "OK-4412",
      }),
      activeField: "lastName",
      isDeleting: true,
    });
    expect(result.suggestions.map((row) => row.label)).toEqual(["Alice Villanueva"]);
  });

  it("limits replacement-driver suggestions to the exact known company", () => {
    const peakBonnie = visit({
      id: 21,
      firstName: "Bonnie",
      lastName: "West",
      company: "Peak Energy",
      vehiclePlate: "TX-9911",
      checkInTime: "2026-08-23T10:00:00Z",
    });
    const servicesBonnie = visit({
      id: 22,
      firstName: "Bonnie",
      lastName: "Smith",
      company: "Peak Energy Services",
      vehiclePlate: "TX-2288",
      checkInTime: "2026-08-24T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [peakBonnie, servicesBonnie],
      draft: draft({ firstName: "Bon", company: "Peak Energy", vehiclePlate: "OK-4412" }),
      activeField: "firstName",
      isDeleting: true,
    });
    expect(result.suggestions.map((row) => row.label)).toEqual(["Bonnie West"]);
  });

  it("does not fill a person when the name prefix is ambiguous", () => {
    const jordanLee = visit({
      id: 5,
      firstName: "Jordan",
      lastName: "Lee",
      company: "Summit Fluids",
      vehiclePlate: "OK-9999",
    });
    const result = evaluateGateMemory({
      visits: [peakJordan, jordanLee],
      draft: draft({ firstName: "Jor" }),
      activeField: "firstName",
    });
    expect(result.fill?.firstName).toBe("Jordan");
    expect(result.fill?.lastName).toBeUndefined();
    expect(result.fill?.company).toBeUndefined();
    expect(result.suggestions).toHaveLength(2);
  });

  it("uses other draft fields to disambiguate, then fills the rest", () => {
    const jordanLee = visit({
      id: 5,
      firstName: "Jordan",
      lastName: "Lee",
      company: "Summit Fluids",
      vehiclePlate: "OK-9999",
    });
    const result = evaluateGateMemory({
      visits: [peakJordan, jordanLee],
      draft: draft({ firstName: "Jordan", company: "Peak" }),
      activeField: "company",
    });
    expect(result.fill).toMatchObject({
      firstName: "Jordan",
      lastName: "Hale",
      company: "Peak Energy",
      vehiclePlate: "OK-4412",
    });
  });

  it("fills a shared company when every matching person is from that company", () => {
    const jamie = visit({
      id: 8,
      firstName: "Jamie",
      lastName: "Cole",
      company: "Peak Energy",
      vehiclePlate: "OK-3300",
      checkInTime: "2026-08-19T10:00:00Z",
    });
    const result = evaluateGateMemory({
      visits: [peakJordan, jamie],
      draft: draft({ firstName: "J" }),
      activeField: "firstName",
      minAutoFillLength: 1,
    });
    expect(result.fill?.company).toBe("Peak Energy");
    expect(result.fill?.firstName).toBeUndefined();
    expect(result.fill?.lastName).toBeUndefined();
  });

  it("does not auto-fill while the gatekeeper is deleting", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan],
      draft: draft({ company: "Pea" }),
      activeField: "company",
      isDeleting: true,
    });
    expect(result.fill).toBeNull();
    expect(result.suggestions).toHaveLength(1);
  });

  it("does not auto-fill a 1-character query", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan],
      draft: draft({ company: "P" }),
      activeField: "company",
    });
    expect(result.fill).toBeNull();
    expect(result.suggestions[0]?.label).toBe("Peak Energy");
  });

  it("returns no suggestions for an empty active field", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan],
      draft: draft(),
      activeField: "company",
    });
    expect(result.suggestions).toEqual([]);
    expect(result.fill).toBeNull();
  });

  it("does not fill phone or email from historical visits", () => {
    const result = evaluateGateMemory({
      visits: [peakJordan],
      draft: draft({ vehiclePlate: "OK-4412", plateState: "OK" }),
      activeField: "vehiclePlate",
    });
    expect(result.fill?.firstName).toBe("Jordan");
    expect(result.fill).not.toHaveProperty("phone");
    expect(result.fill).not.toHaveProperty("email");
  });
});

describe("mergeGateFill", () => {
  it("completes a typed prefix and leaves conflicting fields alone", () => {
    const current = draft({ firstName: "Jor", lastName: "Smith", company: "Peak", expectedDuration: "60" });
    const merged = mergeGateFill(
      current,
      fillFromVisit(visit({ lastName: "Hale", company: "Peak Energy", expectedDurationMinutes: 45 })),
    );
    expect(merged.firstName).toBe("Jordan");
    expect(merged.lastName).toBe("Smith");
    expect(merged.company).toBe("Peak Energy");
    expect(merged.expectedDuration).toBe("45");
    expect(merged.purpose).toBe("Water haul");
  });

  it("keeps a different driver name after a plate fill", () => {
    const current = draft({
      firstName: "Alex",
      lastName: "Nguyen",
      company: "Peak Energy",
      vehiclePlate: "OK-4412",
      expectedDuration: "45",
    });
    const merged = mergeGateFill(current, fillFromVisit(visit()));
    expect(merged.firstName).toBe("Alex");
    expect(merged.lastName).toBe("Nguyen");
    expect(merged.company).toBe("Peak Energy");
    expect(merged.vehiclePlate).toBe("OK-4412");
  });

  it("does not treat two drafts as equal when only duration still has the default", () => {
    expect(draftsEqual(draft({ firstName: "A" }), draft({ firstName: "A", lastName: "B" }))).toBe(false);
    expect(draftsEqual(draft({ firstName: "A" }), draft({ firstName: "A" }))).toBe(true);
  });
});
