import { describe, expect, it } from "vitest";
import { resolveLiveLocationsScope } from "./live-locations-scope";

describe("resolveLiveLocationsScope", () => {
  it("allows partner with partnerId", () => {
    const scope = resolveLiveLocationsScope(
      { role: "partner", vendorId: null, partnerId: 1 },
      null,
    );
    expect(scope).toEqual({ ok: true, scopedVendorId: null, scopedPartnerId: 1 });
  });

  it("rejects partner without partnerId", () => {
    const scope = resolveLiveLocationsScope(
      { role: "partner", vendorId: null, partnerId: null },
      null,
    );
    expect(scope.ok).toBe(false);
  });
});
