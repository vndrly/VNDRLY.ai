import { describe, expect, it, vi } from "vitest";

import {
  isBackgroundAudioSessionError,
  isPttComment,
  isRecordingBusyError,
  pttAttachmentPlayUri,
  pttDurationLabel,
} from "./ptt";

vi.mock("./api", () => ({
  getApiBase: () => "https://vndrly.ai",
}));

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

describe("isRecordingBusyError", () => {
  it("detects expo-av single-recording errors", () => {
    expect(
      isRecordingBusyError(
        new Error("Only one Recording object can be prepared at a given time."),
      ),
    ).toBe(true);
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

describe("pttAttachmentPlayUri", () => {
  it("prefixes storage paths with the API base", () => {
    expect(pttAttachmentPlayUri("/api/storage/objects/foo.m4a")).toBe(
      "https://vndrly.ai/api/storage/objects/foo.m4a",
    );
    expect(pttAttachmentPlayUri("https://cdn.example.com/x.m4a")).toBe(
      "https://cdn.example.com/x.m4a",
    );
  });
});
