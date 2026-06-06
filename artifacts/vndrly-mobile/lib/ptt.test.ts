import { describe, expect, it } from "vitest";

import { isBackgroundAudioSessionError, isPttComment, pttDurationLabel } from "./ptt";

describe("isBackgroundAudioSessionError", () => {
  it("detects expo-av background session errors", () => {
    expect(
      isBackgroundAudioSessionError(
        new Error(
          'Prepare encountered an error: Error Domain=EXModulesErrorDomain Code=0 "This experience is currently in the background, so the audio session could not be activated."',
        ),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isBackgroundAudioSessionError(new Error("Upload failed"))).toBe(false);
  });
});

describe("ptt comment helpers", () => {
  it("recognizes ptt comments", () => {
    expect(isPttComment("[ptt:12s]")).toBe(true);
    expect(isPttComment("hello")).toBe(false);
  });

  it("parses duration labels", () => {
    expect(pttDurationLabel("[ptt:12s]")).toBe("12s");
    expect(pttDurationLabel("nope")).toBeNull();
  });
});
