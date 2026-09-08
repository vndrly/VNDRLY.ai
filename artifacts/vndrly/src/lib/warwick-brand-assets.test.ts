import { describe, expect, it } from "vitest";
import { pillPurple } from "@/lib/pill-palette-assets";
import { pickTogglePillSrc } from "@/lib/pick-toggle-pill";
import { brandImagePillSrc } from "@/components/png-pill-rollover";

describe("Warwick brand assets", () => {
  it("uses the purple pill for Warwick's primary brand color", () => {
    expect(pickTogglePillSrc("#441e5b", "Warwick Energy Group")).toBe(
      pillPurple,
    );
  });

  it("uses the same purple pill for Warwick action-button hover states", () => {
    expect(brandImagePillSrc("#441e5b", "Warwick Energy Group")).toBe(
      pillPurple,
    );
  });
});
