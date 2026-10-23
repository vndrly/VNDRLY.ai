import { describe, expect, it } from "vitest";
import type { VisitorRow } from "@/lib/visits-api";
import {
  GATE_HISTORY_DAYS,
  gateDeparturesForSite,
  filterGateHistory,
  gateHistoryFromIso,
  visitMatchesHistorySearch,
} from "./gate-history";

function visit(over: Partial<VisitorRow> & Pick<VisitorRow, "id" | "firstName" | "lastName" | "checkInTime">): VisitorRow {
  return {
    company: null,
    phone: null,
    email: null,
    vehiclePlate: null,
    plateState: null,
    platePhotoUrl: null,
    vehiclePhotoUrl: null,
    purpose: null,
    expectedDurationMinutes: null,
    hostType: "vendor",
    hostPartnerId: null,
    hostVendorId: 1054,
    hostPartnerName: null,
    hostVendorName: "MidCon",
    siteLocationId: 309,
    siteName: "Energy Spur",
    checkOutTime: null,
    autoCheckedOut: false,
    checkInLatitude: null,
    checkInLongitude: null,
    ...over,
  };
}

describe("gate history window", () => {
  it("asks the API for the last 30 days", () => {
    expect(GATE_HISTORY_DAYS).toBe(30);
    const from = gateHistoryFromIso(new Date("2026-08-23T17:00:00.000Z"));
    expect(from).toBe("2026-07-24T17:00:00.000Z");
  });
});

describe("gate history search", () => {
  const rows = [
    visit({
      id: 1,
      firstName: "Pat",
      lastName: "Reyes",
      company: "Acme Wireline",
      vehiclePlate: "ABC1234",
      plateState: "TX",
      checkInTime: "2026-08-23T17:00:00.000Z",
    }),
    visit({
      id: 2,
      firstName: "Sam",
      lastName: "Ortiz",
      company: "Cactus",
      vehiclePlate: "TX-991",
      plateState: "OK",
      purpose: "Delivery",
      checkInTime: "2026-08-22T08:00:00.000Z",
    }),
  ];

  it("matches name, plate, company, and purpose", () => {
    expect(visitMatchesHistorySearch(rows[0], "reyes")).toBe(true);
    expect(visitMatchesHistorySearch(rows[0], "abc1234")).toBe(true);
    expect(visitMatchesHistorySearch(rows[0], "wireline")).toBe(true);
    expect(visitMatchesHistorySearch(rows[1], "delivery")).toBe(true);
    expect(visitMatchesHistorySearch(rows[0], "cactus")).toBe(false);
  });

  it("returns newest check-ins first", () => {
    const filtered = filterGateHistory(
      [rows[1], rows[0]],
      "",
    );
    expect(filtered.map((row) => row.id)).toEqual([1, 2]);
  });

  it("matches state-qualified plates by code or full name despite punctuation", () => {
    expect(visitMatchesHistorySearch(rows[0], "TX ABC-1234")).toBe(true);
    expect(visitMatchesHistorySearch(rows[0], "Texas ABC 1234")).toBe(true);
    expect(visitMatchesHistorySearch(rows[1], "TX 991")).toBe(false);
    expect(visitMatchesHistorySearch(rows[1], "Oklahoma TX991")).toBe(true);
  });

  it("filters then keeps newest first", () => {
    const extra = visit({
      id: 3,
      firstName: "Pat",
      lastName: "Nguyen",
      vehiclePlate: "PAT-9",
      plateState: null,
      checkInTime: "2026-08-21T12:00:00.000Z",
    });
    expect(filterGateHistory([...rows, extra], "pat").map((row) => row.id)).toEqual([1, 3]);
  });
});

describe("selected-site recent departures", () => {
  it("uses checkout order, excluding active, invalid, and other-site entries", () => {
    const older = visit({ id: 1, firstName: "Earlier", lastName: "Departure", checkInTime: "2026-10-22T10:00:00Z", checkOutTime: "2026-10-22T12:00:00Z" });
    const latest = visit({ id: 2, firstName: "Latest", lastName: "Departure", checkInTime: "2026-10-20T10:00:00Z", checkOutTime: "2026-10-22T14:00:00Z" });
    const active = visit({ id: 3, firstName: "Still", lastName: "Here", checkInTime: "2026-10-22T15:00:00Z" });
    const elsewhere = { ...latest, id: 4, siteLocationId: 999 };
    const invalid = { ...latest, id: 5, checkOutTime: "invalid" };
    const rows = [older, active, elsewhere, invalid, latest];
    expect(gateDeparturesForSite(rows, 309).map(row => row.id)).toEqual([2, 1]);
    expect(rows.map(row => row.id)).toEqual([1, 3, 4, 5, 2]);
    expect(gateDeparturesForSite(rows, undefined)).toEqual([]);
  });
});
