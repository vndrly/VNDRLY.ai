import { describe, expect, it } from "vitest";
import { resolveRecentTripsScope } from "./recent-trips-scope";

describe("resolveRecentTripsScope", () => {
  it("scopes vendors to their own fleet", () => {
    const r = resolveRecentTripsScope(
      { role: "vendor", vendorId: 5, partnerId: null },
      { vendorId: null, siteLocationId: null },
    );
    expect(r).toEqual({
      ok: true,
      vendorId: 5,
      partnerId: null,
      siteLocationId: null,
    });
  });

  it("rejects vendor probing another vendor id", () => {
    const r = resolveRecentTripsScope(
      { role: "vendor", vendorId: 5, partnerId: null },
      { vendorId: 99, siteLocationId: null },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("allows partners only with partner id", () => {
    const r = resolveRecentTripsScope(
      { role: "partner", vendorId: null, partnerId: 12 },
      { vendorId: null, siteLocationId: 3 },
    );
    expect(r).toEqual({
      ok: true,
      vendorId: null,
      partnerId: 12,
      siteLocationId: 3,
    });
  });

  it("allows foreman field employees like vendors", () => {
    const r = resolveRecentTripsScope(
      { role: "field_employee", vendorId: 8, partnerId: null, vendorRole: "foreman" },
      { vendorId: null, siteLocationId: null },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.vendorId).toBe(8);
  });

  it("blocks non-foreman field employees", () => {
    const r = resolveRecentTripsScope(
      { role: "field_employee", vendorId: 8, partnerId: null, vendorRole: "worker" },
      { vendorId: null, siteLocationId: null },
    );
    expect(r.ok).toBe(false);
  });

  it("allows admin with optional filters", () => {
    const r = resolveRecentTripsScope(
      { role: "admin", vendorId: null, partnerId: null },
      { vendorId: 2, siteLocationId: 9 },
    );
    expect(r).toEqual({
      ok: true,
      vendorId: 2,
      partnerId: null,
      siteLocationId: 9,
    });
  });
});
