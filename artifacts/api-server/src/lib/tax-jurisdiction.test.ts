import { describe, expect, it } from "vitest";

import { lookupCountyPrimaryTaxZip } from "./county-primary-tax-zips";

describe("tax-jurisdiction", () => {
  it("lookupCountyPrimaryTaxZip resolves county anchor addresses", () => {
    const geo = lookupCountyPrimaryTaxZip("Reeves County, TX", "TX");
    expect(geo?.postalCode).toBe("79772");
    expect(geo?.county).toBe("Reeves County");
  });
});
