import { describe, expect, it } from "vitest";

import {
  ASKV_DEFAULT_SRC,
  ASKV_IDLE_SRC,
  pickAskVLogo,
  pickAskVLogoIdle,
} from "./pick-askv-logo";

const asset = (filename: string) => expect.stringContaining(filename);

describe("pickAskVLogo", () => {
  it.each([
    ["#149F3D", "Baker Hughes Field Svcs", "AskV_VNDRLY_Baker_v1.png"],
    ["#1E5BD0", "Winchester", "AskV_VNDRLY_Winchester_v2.png"],
    ["#D80B0B", "Flywheel Energy", "AskV_VNDRLY_flywheel_Blue_v1.png"],
    ["#D80B0B", "Midcon Solutions", "AskV_VNDRLY_midcon_Blue_v1.png"],
    ["#1E5BD0", "VNDRLY", "AskV_VNDRLY_Amber_v3.png"],
    ["#E1241B", "ExxonMobil", "AskV_VNDRLY_Red_v3.png"],
    ["#1E5BD0", "Mach Energy", "AskV_VNDRLY_Blue_v1.png"],
    ["#149F3D", "Green Company", "AskV_VNDRLY_Green_v1.png"],
    ["#F97316", "Orange Company", "AskV_VNDRLY_Amber_v3.png"],
    ["#6B1FB8", "Purple Company", "AskV_VNDRLY_Purple_v1.png"],
  ])("selects the expected art for %s / %s", (color, name, filename) => {
    expect(pickAskVLogo(color, name)).toEqual(asset(filename));
  });

  it("falls back to VNDRLY amber for invalid and neutral colors", () => {
    expect(pickAskVLogo("invalid", "Other")).toBe(ASKV_DEFAULT_SRC);
    expect(pickAskVLogo("#777777", "Other")).toBe(ASKV_DEFAULT_SRC);
  });

  it("uses the shared grey image while idle", () => {
    expect(pickAskVLogoIdle()).toBe(ASKV_IDLE_SRC);
  });
});
