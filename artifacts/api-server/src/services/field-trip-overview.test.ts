import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { fieldTripOverviewPosition, fieldTripOverviewScope } from "./field-trip-overview";
const now = Date.parse("2026-10-05T12:00:00Z");
const point = { lastLatitude: 35, lastLongitude: -97, lastAccuracyMeters: 10, lastRecordedAt: new Date(now - 60_000), lastPointReliable: true, trackingState: "active" };
describe("field trip overview boundaries", () => {
  it("scopes vendor administrators to their company and drivers to themselves", () => {
    const dialect = new PgDialect();
    const vendor = dialect.sqlToQuery(fieldTripOverviewScope({ userId: 5, role: "vendor", vendorId: 7, membershipRole: "admin" })!);
    expect(vendor.params).toEqual(["vendor", 7]);
    const driver = dialect.sqlToQuery(fieldTripOverviewScope({ userId: 5, role: "field_employee", vendorId: 7 })!);
    expect(driver.params).toEqual(["vendor", 7, 5]);
    expect(() => fieldTripOverviewScope({ userId: 5, role: "vendor", membershipRole: "admin" })).toThrow();
  });
  it("uses the partner's site boundary rather than all vendors", () => {
    const query = new PgDialect().sqlToQuery(fieldTripOverviewScope({ userId: 5, role: "partner", partnerId: 9 })!);
    expect(query.sql).toContain('"site_locations"."partner_id"');
    expect(query.params).toEqual([9]);
  });
  it("labels stale, paused and missing positions without claiming a current ETA", () => {
    expect(fieldTripOverviewPosition(point, now)).toMatchObject({ freshness: "recent", ageSeconds: 60 });
    expect(fieldTripOverviewPosition({ ...point, lastRecordedAt: new Date(now - 901_000) }, now).freshness).toBe("stale");
    expect(fieldTripOverviewPosition({ ...point, trackingState: "paused" }, now).freshness).toBe("paused");
    expect(fieldTripOverviewPosition({ ...point, lastPointReliable: false }, now).location).toBeNull();
    expect(fieldTripOverviewPosition({ ...point, lastRecordedAt: new Date(now + 120_000) }, now).location).toBeNull();
  });
});
