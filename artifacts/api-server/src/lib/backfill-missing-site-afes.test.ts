import { describe, expect, it } from "vitest";
import { formatSiteAfe, parseSiteAfe } from "./backfill-missing-site-afes";

describe("formatSiteAfe", () => {
  it("zero-pads the sequence to six digits", () => {
    expect(formatSiteAfe(1, 2026)).toBe("AFE-2026-000001");
    expect(formatSiteAfe(9050, 2026)).toBe("AFE-2026-009050");
  });
});

describe("parseSiteAfe", () => {
  it("parses canonical values", () => {
    expect(parseSiteAfe("AFE-2026-000188")).toEqual({ year: 2026, sequence: 188 });
  });

  it("rejects non-canonical values", () => {
    expect(parseSiteAfe("AFE-123456")).toBeNull();
    expect(parseSiteAfe(null)).toBeNull();
  });
});
