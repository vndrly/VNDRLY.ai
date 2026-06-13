import { describe, expect, it } from "vitest";
import { normalizeHexColor, rgbToHex } from "./extract-logo-colors";

describe("extract-logo-colors helpers", () => {
  it("rgbToHex formats channels", () => {
    expect(rgbToHex(230, 172, 0)).toBe("#e6ac00");
  });

  it("normalizeHexColor accepts with or without hash", () => {
    expect(normalizeHexColor("e6ac00")).toBe("#e6ac00");
    expect(normalizeHexColor("#E6AC00")).toBe("#e6ac00");
    expect(normalizeHexColor("banana")).toBeNull();
  });
});
