import { describe, expect, it } from "vitest";
import { credentialHealth, requiredCredentialsForRoles } from "./role-compliance";

describe("role-aware credential compliance", () => {
  it.each([
    [["Driver"], ["CDL"]],
    [["Field Worker"], ["PEC"]],
    [["Driver", "Field Worker"], ["CDL", "PEC"]],
  ])("derives requirements for %j", (roles, expected) => {
    expect(requiredCredentialsForRoles(roles)).toEqual(expected);
  });

  it("uses only required credentials and warns within 90 days", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    expect(credentialHealth(["CDL"], [{ name: "CDL", expiresOn: "2026-12-07" }], now)).toBe("amber");
    expect(credentialHealth(["CDL"], [{ name: "CDL", expiresOn: "2026-12-08" }], now)).toBe("green");
    expect(credentialHealth(["CDL"], [{ name: "PEC", expiresOn: "2028-01-01" }], now)).toBe("red");
  });
});
