import { describe, expect, it } from "vitest";

import askVAmber from "@assets/askv/AskV_VNDRLY_Amber_v3.png";
import askVGrey from "@assets/askv/AskV_VNDRLY_Grey_v2.png";
import askVBaker from "@assets/askv/AskV_VNDRLY_Baker_v1.png";
import askVBlue from "@assets/askv/AskV_VNDRLY_Blue_v1.png";
import askVRed from "@assets/askv/AskV_VNDRLY_Red_v3.png";
import askVWinchester from "@assets/askv/AskV_VNDRLY_Winchester_v2.png";

import { ASKV_DEFAULT_SRC, ASKV_IDLE_SRC, pickAskVLogo, pickAskVLogoIdle } from "./pick-askv-logo";

describe("pickAskVLogo", () => {
  it("uses Baker cutout by org name", () => {
    expect(pickAskVLogo("#149F3D", "Baker Hughes Field Svcs")).toBe(askVBaker);
  });

  it("uses Winchester cutout by org name", () => {
    expect(pickAskVLogo("#1E5BD0", "Winchester")).toBe(askVWinchester);
  });

  it("uses VNDRLY amber v3 by org name", () => {
    expect(pickAskVLogo("#D80B0B", "VNDRLY")).toBe(askVAmber);
  });

  it("hue-matches primary when not a named cutout", () => {
    expect(pickAskVLogo("#1E5BD0", "Mach Energy")).toBe(askVBlue);
  });

  it("uses red v3 bubble for ExxonMobil primary", () => {
    expect(pickAskVLogo("#E1241B", "ExxonMobil")).toBe(askVRed);
    expect(pickAskVLogo("#dd1d21", "Exxon")).toBe(askVRed);
  });

  it("falls back to amber v3 when color is missing", () => {
    expect(pickAskVLogo(null, "VNDRLY")).toBe(ASKV_DEFAULT_SRC);
  });
});

describe("pickAskVLogoIdle", () => {
  it("returns shared grey v2 bubble", () => {
    expect(pickAskVLogoIdle(null, "VNDRLY")).toBe(askVGrey);
    expect(pickAskVLogoIdle("#1E5BD0", "Mach Energy")).toBe(ASKV_IDLE_SRC);
  });
});
