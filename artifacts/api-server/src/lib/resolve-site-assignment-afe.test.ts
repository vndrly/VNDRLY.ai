import { describe, expect, it } from "vitest";

import { trimAfe } from "./resolve-site-assignment-afe";

describe("trimAfe", () => {
  it("returns trimmed non-empty strings", () => {
    expect(trimAfe("  AFE-2026-000042  ")).toBe("AFE-2026-000042");
  });

  it("returns null for blank values", () => {
    expect(trimAfe("")).toBeNull();
    expect(trimAfe("   ")).toBeNull();
    expect(trimAfe(null)).toBeNull();
    expect(trimAfe(undefined)).toBeNull();
  });
});
