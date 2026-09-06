import { describe, expect, it, vi } from "vitest";
import {
  allowVoiceMetric,
  estimateVoiceCost,
  parseVoiceMetric,
} from "./voice-metrics";
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn() } }));
const metric = {
  event: "turn",
  sessionId: "s1",
  eventId: "e1",
  clientSurface: "web",
  durationMs: 125,
};
describe("privacy-limited voice metrics", () => {
  it("rejects transcript/audio/error prose and invalid counters rather than logging it", () => {
    expect(parseVoiceMetric(metric)).toEqual(metric);
    for (const property of ["transcript", "audio", "content", "error", "text"])
      expect(parseVoiceMetric({ ...metric, [property]: "private" })).toBeNull();
    expect(
      parseVoiceMetric({ ...metric, event: "arbitrary message" }),
    ).toBeNull();
    expect(parseVoiceMetric({ ...metric, durationMs: -1 })).toBeNull();
    expect(
      parseVoiceMetric({
        ...metric,
        usage: { inputAudioTokens: "private audio" },
      }),
    ).toBeNull();
  });
  it("estimates supported-model token cost with cached tokens subtracted once", () => {
    const usage = {
      inputTextTokens: 1000,
      inputAudioTokens: 1000,
      cachedTextTokens: 500,
      cachedAudioTokens: 500,
      outputTextTokens: 100,
      outputAudioTokens: 100,
    };
    expect(parseVoiceMetric({ ...metric, usage })).not.toBeNull();
    expect(estimateVoiceCost(usage, "gpt-realtime-2.1")).toBeCloseTo(0.0272);
    expect(estimateVoiceCost(usage, "unknown-model")).toBeNull();
    expect(
      parseVoiceMetric({
        ...metric,
        usage: { ...usage, cachedTextTokens: 1001 },
      }),
    ).toBeNull();
  });
  it("bounds per-user ingestion while allowing other users and the next window", () => {
    for (let i = 0; i < 120; i++)
      expect(allowVoiceMetric(900, 1000)).toBe(true);
    expect(allowVoiceMetric(900, 1000)).toBe(false);
    expect(allowVoiceMetric(901, 1000)).toBe(true);
    expect(allowVoiceMetric(900, 61_001)).toBe(true);
  });
});
