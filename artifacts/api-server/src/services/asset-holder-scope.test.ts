import { describe, expect, it } from "vitest";
import { isAssetHolderInScope } from "./asset-holder-scope";

describe("isAssetHolderInScope", () => {
  it("accepts a direct organization member", () => {
    expect(
      isAssetHolderInScope(
        { type: "vendor", id: 7 },
        [{ orgType: "vendor", vendorId: 7, partnerId: null }],
        [],
      ),
    ).toBe(true);
  });

  it("accepts an actively sponsored worker for the responsible vendor", () => {
    expect(
      isAssetHolderInScope(
        { type: "vendor", id: 7 },
        [],
        [{ sponsorVendorId: 7, status: "active" }],
      ),
    ).toBe(true);
  });

  it("rejects members and sponsorships from another organization", () => {
    expect(
      isAssetHolderInScope(
        { type: "vendor", id: 7 },
        [{ orgType: "vendor", vendorId: 9, partnerId: null }],
        [{ sponsorVendorId: 9, status: "active" }],
      ),
    ).toBe(false);
  });

  it("does not let a vendor sponsorship grant access to partner inventory", () => {
    expect(
      isAssetHolderInScope(
        { type: "partner", id: 4 },
        [],
        [{ sponsorVendorId: 4, status: "active" }],
      ),
    ).toBe(false);
  });
});
