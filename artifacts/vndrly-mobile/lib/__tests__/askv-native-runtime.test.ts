import { describe, expect, it } from "vitest";
import config from "../../app.json";
import { nativeAskVContextPath } from "../askv-context-path";

describe("AskV native update compatibility", () => {
  it("isolates WebRTC and the wake module from the existing 1.0.0 native runtime", () => {
    expect(config.expo.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(config.expo.version).not.toBe("1.0.0");
    expect(config.expo.plugins).toContain("@config-plugins/react-native-webrtc");
  });
  it("does not opt AskV microphone capture into background audio", () => {
    expect(config.expo.ios.infoPlist.UIBackgroundModes).not.toContain("audio");
  });

  it("uses the complete Work Hub toolbox on either native Ask V route", () => {
    expect(nativeAskVContextPath("/askv")).toBe("/mobile/work-hub/askv");
    expect(nativeAskVContextPath("/work-hub/askv")).toBe("/mobile/work-hub/askv");
  });

  it("does not double-prefix an already normalized native context", () => {
    expect(nativeAskVContextPath("/mobile/work-hub/askv")).toBe("/mobile/work-hub/askv");
    expect(nativeAskVContextPath("/mobile/ticket/42")).toBe("/mobile/ticket/42");
  });

  it("preserves page-aware context outside the dedicated Ask V screen", () => {
    expect(nativeAskVContextPath("/(tabs)/gate")).toBe("/mobile/gate");
    expect(nativeAskVContextPath("/work-hub/calendar")).toBe("/mobile/work-hub/calendar");
  });
});
