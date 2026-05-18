import { describe, expect, it } from "vitest";

import {
  SIDEBAR_BG_RGB,
  contrastRatio,
  getContrastWarningKind,
  getSidebarContrastWarningKind,
  hexToRgb,
} from "./brand-color";

describe("getSidebarContrastWarningKind", () => {
  it("returns null for colors with strong contrast against the dark sidebar", () => {
    expect(getSidebarContrastWarningKind("#ffffff")).toBeNull();
    expect(getSidebarContrastWarningKind("#f59e0b")).toBeNull();
  });

  it("flags very low contrast (<3:1) for colors that blend into the sidebar", () => {
    const result = getSidebarContrastWarningKind("#393E46");
    expect(result?.kind).toBe("veryLowContrastOnSidebar");
  });

  it("flags low contrast (3:1 to 4.5:1) for colors that are visible but weak", () => {
    const candidates = ["#7a7a7a", "#808080", "#888888"];
    const matched = candidates
      .map((c) => getSidebarContrastWarningKind(c))
      .find((w) => w?.kind === "lowContrastOnSidebar");
    expect(matched?.kind).toBe("lowContrastOnSidebar");
  });

  it("returns null for invalid hex input", () => {
    expect(getSidebarContrastWarningKind("not-a-color")).toBeNull();
  });

  it("does not interfere with the existing white-background warning", () => {
    const onWhite = getContrastWarningKind("#000000");
    const onSidebar = getSidebarContrastWarningKind("#000000");
    expect(onWhite).toBeNull();
    expect(onSidebar?.kind).toBe("veryLowContrastOnSidebar");
  });

  it("uses the documented sidebar background reference color", () => {
    expect(SIDEBAR_BG_RGB).toEqual({ r: 57, g: 62, b: 70 });
    const ratio = contrastRatio(hexToRgb("#ffffff")!, SIDEBAR_BG_RGB);
    expect(ratio).toBeGreaterThan(8);
  });
});
