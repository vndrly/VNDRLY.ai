import { describe, expect, it } from "vitest";
import { validateVoiceNoteMetadata } from "./file-policy";

describe("voice note metadata", () => {
  it("accepts bounded durable audio metadata", () => {
    expect(validateVoiceNoteMetadata({ durationMs: 1200, container: "m4a", codec: "aac", waveform: [0, 0.5, 1] }))
      .toEqual({ durationMs: 1200, container: "m4a", codec: "aac", waveform: [0, 0.5, 1] });
  });
  it("rejects unbounded or malformed waveform data", () => {
    expect(() => validateVoiceNoteMetadata({ durationMs: 0, container: "m4a", codec: "aac", waveform: [] })).toThrow();
    expect(() => validateVoiceNoteMetadata({ durationMs: 1, container: "m4a", codec: "aac", waveform: Array(2001).fill(0) })).toThrow();
  });
});
