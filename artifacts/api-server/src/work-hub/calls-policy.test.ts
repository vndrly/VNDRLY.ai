import { describe, expect, it } from "vitest";
import { callCanTransition, validVoicemailAudio } from "./calls-policy";
describe("internal call state and audio validation", () => {
  it("only lets the recipient accept or decline a ringing call", () => {
    expect(callCanTransition("ringing", "accept", false)).toBe(false);
    expect(callCanTransition("ringing", "accept", true)).toBe(true);
    expect(callCanTransition("ended", "accept", true)).toBe(false);
    expect(callCanTransition("active", "decline", true)).toBe(false);
    expect(callCanTransition("active", "end", false)).toBe(true);
  });
  it("rejects empty files, spoofed audio types and oversize audio", () => {
    expect(validVoicemailAudio("audio/webm", Buffer.alloc(10))).toBe(false);
    expect(validVoicemailAudio("audio/mp4", Buffer.alloc(128))).toBe(false);
    const webm = Buffer.alloc(128); Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(webm);
    expect(validVoicemailAudio("audio/webm", webm)).toBe(true);
    expect(validVoicemailAudio("text/html", webm)).toBe(false);
    expect(validVoicemailAudio("audio/webm", Buffer.alloc(4 * 1024 * 1024 + 1))).toBe(false);
  });
});
