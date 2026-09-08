import { describe, expect, it } from "vitest";
import type { VisitorRow } from "./visits-api";
import {
  buildGateOpsAnalytics,
  buildGateStaffHours,
  dwellMinutes,
} from "./gate-ops-analytics";

function visit(overrides: Partial<VisitorRow> & Pick<VisitorRow, "id" | "checkInTime">): VisitorRow {
  return {
    firstName: "Pat",
    lastName: "Visitor",
    company: "Acme Pump",
    phone: null,
    email: null,
    vehiclePlate: "OK-GATE1",
    plateState: "OK",
    platePhotoUrl: null,
    vehiclePhotoUrl: null,
    purpose: "Delivery",
    expectedDurationMinutes: 60,
    hostType: "partner",
    hostPartnerId: 1,
    hostVendorId: null,
    hostPartnerName: "Flywheel Energy",
    hostVendorName: null,
    siteLocationId: 10,
    siteName: "Flywheel Energy Spur",
    siteCode: "SITE-B40D77D2",
    checkOutTime: null,
    autoCheckedOut: false,
    checkInLatitude: null,
    checkInLongitude: null,
    ...overrides,
  };
}

describe("dwellMinutes", () => {
  it("uses checkout when present and now when the visitor is still on site", () => {
    const now = new Date("2026-08-25T15:00:00.000Z");
    expect(
      dwellMinutes(
        visit({
          id: 1,
          checkInTime: "2026-08-25T14:00:00.000Z",
          checkOutTime: "2026-08-25T14:30:00.000Z",
        }),
        now,
      ),
    ).toBe(30);
    expect(
      dwellMinutes(visit({ id: 2, checkInTime: "2026-08-25T14:00:00.000Z" }), now),
    ).toBe(60);
  });
});

describe("buildGateOpsAnalytics", () => {
  it("does not count pending admission as on-site or overdue", () => {
    const stats = buildGateOpsAnalytics([
      visit({ id: 20, admissionStatus: "pending", expectedDurationMinutes: 1, checkInTime: "2026-08-25T10:00:00.000Z" }),
    ], new Date("2026-08-25T18:00:00.000Z"));
    expect(stats.onSiteNow).toBe(0);
    expect(stats.overdueNow).toBe(0);
  });
  it("rolls live counts, dwell, daily volume, peak hour, and overdue visits", () => {
    const now = new Date("2026-08-25T18:00:00.000Z");
    const stats = buildGateOpsAnalytics(
      [
        visit({
          id: 1,
          checkInTime: "2026-08-25T14:00:00.000Z",
          checkOutTime: "2026-08-25T15:00:00.000Z",
          company: "Acme Pump",
        }),
        visit({
          id: 2,
          firstName: "Sam",
          company: "Solo Trucking",
          checkInTime: "2026-08-25T14:10:00.000Z",
          expectedDurationMinutes: 30,
        }),
        visit({
          id: 3,
          company: "Acme Pump",
          vehiclePlate: "OK-GATE2",
          checkInTime: "2026-08-24T20:00:00.000Z",
          checkOutTime: "2026-08-24T21:00:00.000Z",
          autoCheckedOut: true,
        }),
      ],
      now,
    );

    expect(stats.onSiteNow).toBe(1);
    expect(stats.overdueNow).toBe(1);
    expect(stats.autoCheckedOut).toBe(1);
    expect(stats.uniquePlates).toBe(2);
    expect(stats.topCompanies[0]).toEqual({ name: "Acme Pump", count: 2 });
    expect(stats.visitsByDay.find((d) => d.day === "2026-08-25")?.checkIns).toBe(2);
    expect(stats.visitsByHour.find((h) => h.hour === 14)?.count).toBe(2);
    expect(stats.avgDwellMinutes).toBe(60);
  });

  it("counts confirmed states separately and keeps legacy plates in their own stable bucket", () => {
    const stats = buildGateOpsAnalytics(
      [
        visit({ id: 10, vehiclePlate: "ABC123", plateState: "TX", checkInTime: "2026-08-25T10:00:00.000Z" }),
        visit({ id: 11, vehiclePlate: "ABC123", plateState: "OK", checkInTime: "2026-08-25T11:00:00.000Z" }),
        visit({ id: 12, vehiclePlate: "abc123", plateState: null, checkInTime: "2026-08-25T12:00:00.000Z" }),
        visit({ id: 13, vehiclePlate: "ABC123", plateState: null, checkInTime: "2026-08-25T13:00:00.000Z" }),
      ],
      new Date("2026-08-25T18:00:00.000Z"),
    );

    expect(stats.uniquePlates).toBe(3);
  });
});

describe("buildGateStaffHours", () => {
  it("counts booth days/hours from recorded visits and clocked hours from check-ins", () => {
    const now = new Date("2026-08-25T18:00:00.000Z");
    const rows = buildGateStaffHours({
      now,
      staff: [
        {
          employeeId: 7,
          userId: 70,
          firstName: "Riley",
          lastName: "Gate",
          vendorName: "Winchester",
        },
      ],
      visits: [
        {
          recordedByUserId: 70,
          checkInTime: "2026-08-25T13:00:00.000Z",
          checkOutTime: "2026-08-25T17:00:00.000Z",
        },
        {
          recordedByUserId: 70,
          checkInTime: "2026-08-24T14:00:00.000Z",
          checkOutTime: "2026-08-24T16:00:00.000Z",
        },
      ],
      checkIns: [
        {
          employeeId: 7,
          checkInAt: "2026-08-25T12:00:00.000Z",
          checkOutAt: "2026-08-25T18:00:00.000Z",
        },
      ],
    });

    expect(rows).toEqual([
      {
        employeeId: 7,
        userId: 70,
        name: "Riley Gate",
        vendorName: "Winchester",
        daysWorked: 2,
        visitsProcessed: 2,
        hoursWorked: 6,
        hoursClocked: 6,
        hoursOnBooth: 6,
        lastSeenAt: "2026-08-25T18:00:00.000Z",
      },
    ]);
  });
});
