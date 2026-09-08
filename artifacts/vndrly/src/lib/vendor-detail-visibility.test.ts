import { describe, expect, it } from "vitest";
import { canViewVendorOfficeEmployees } from "./vendor-detail-visibility";

describe("vendor detail privacy", () => {
  it.each([
    ["partner", false, false],
    ["vendor", false, false],
    ["vendor", true, true],
    ["admin", false, true],
  ] as const)("role %s, own=%s returns %s", (role, own, expected) => {
    expect(canViewVendorOfficeEmployees(role, own)).toBe(expected);
  });
});
