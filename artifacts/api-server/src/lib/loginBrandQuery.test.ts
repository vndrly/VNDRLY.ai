import { describe, expect, it } from "vitest";
import { loginBrandQueryFromContext, parseLoginBrandQuery } from "./loginBrandQuery";

describe("loginBrandQuery", () => {
  it("prefers partner over vendor for the logout redirect query", () => {
    expect(
      loginBrandQueryFromContext({ partnerId: 1, vendorId: 3 }),
    ).toBe("partnerId=1");
  });

  it("builds vendor query when only vendorId is set", () => {
    expect(
      loginBrandQueryFromContext({ partnerId: null, vendorId: 3 }),
    ).toBe("vendorId=3");
  });

  it("parses vendorId from request query", () => {
    expect(parseLoginBrandQuery({ vendorId: "3" })).toEqual({
      orgType: "vendor",
      orgId: 3,
    });
  });

  it("parses partnerId from request query", () => {
    expect(parseLoginBrandQuery({ partnerId: "2" })).toEqual({
      orgType: "partner",
      orgId: 2,
    });
  });

  it("returns null for missing or invalid ids", () => {
    expect(parseLoginBrandQuery({})).toBeNull();
    expect(parseLoginBrandQuery({ vendorId: "0" })).toBeNull();
  });
});
