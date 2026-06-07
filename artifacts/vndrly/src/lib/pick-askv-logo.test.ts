import { describe, expect, it } from "vitest";

import askVBaker from "@assets/askv/AskV_VNDRLY_Baker_v1.png";
import askVBlue from "@assets/askv/AskV_VNDRLY_Blue_v1.png";
import askVWinchester from "@assets/askv/AskV_VNDRLY_Winchester_v2.png";

import { ASKV_DEFAULT_SRC, pickAskVLogo } from "./pick-askv-logo";

describe("pickAskVLogo", () => {
  it("uses Baker cutout by org name", () => {
    expect(pickAskVLogo("#149F3D", "Baker Hughes Field Svcs")).toBe(askVBaker);
  });

  it("uses Winchester cutout by org name", () => {
    expect(pickAskVLogo("#1E5BD0", "Winchester")).toBe(askVWinchester);
  });

  it("hue-matches primary when not a named cutout", () => {
    expect(pickAskVLogo("#1E5BD0", "Mach Energy")).toBe(askVBlue);
  });

  it("falls back to amber when color is missing", () => {
    expect(pickAskVLogo(null, "VNDRLY")).toBe(ASKV_DEFAULT_SRC);
  });
});
