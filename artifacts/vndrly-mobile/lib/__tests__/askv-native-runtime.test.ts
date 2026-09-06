import { describe, expect, it } from "vitest";
import config from "../../app.json";

describe("AskV native update compatibility", () => {
  it("isolates WebRTC and the wake module from the existing 1.0.0 native runtime", () => {
    expect(config.expo.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(config.expo.version).not.toBe("1.0.0");
    expect(config.expo.plugins).toContain("@config-plugins/react-native-webrtc");
  });
  it("does not opt AskV microphone capture into background audio", () => {
    expect(config.expo.ios.infoPlist.UIBackgroundModes).not.toContain("audio");
  });
});
