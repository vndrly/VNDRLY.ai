import { describe, expect, it } from "vitest";
import { complianceBucket } from "../field-compliance";

const NOW = new Date("2026-05-11T12:00:00.000Z");

describe("complianceBucket", () => {
  it("returns 'noExpiration' when expiration date is null", () => {
    expect(complianceBucket(null, NOW)).toBe("noExpiration");
  });

  it("returns 'expired' when expiration is in the past", () => {
    expect(complianceBucket("2025-01-01", NOW)).toBe("expired");
    expect(complianceBucket("2026-05-10", NOW)).toBe("expired");
  });

  it("returns 'expiringSoon' when expiration is within 60 days (inclusive)", () => {
    expect(complianceBucket("2026-05-15", NOW)).toBe("expiringSoon");
    expect(complianceBucket("2026-07-09", NOW)).toBe("expiringSoon");
  });

  it("returns 'active' when expiration is more than 60 days away", () => {
    expect(complianceBucket("2026-08-01", NOW)).toBe("active");
    expect(complianceBucket("2030-01-01", NOW)).toBe("active");
  });
});
