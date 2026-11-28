import { describe, expect, it } from "vitest";
import {
  VOICE_REFRESH_AFTER_MS, VOICE_REFRESH_BY_MS, VOICE_RETRY_WAITS_MS, VOICE_STEADY_MS,
  createVoiceLinkPulse, createVoiceRetryLadder, voiceLinkReceived, voiceRefreshDue,
} from "./voice-link";

describe("V's reconnects after a drop", () => {
  it("reconnects at once, then waits longer each time, then gives up", () => {
    const ladder = createVoiceRetryLadder();
    expect(VOICE_RETRY_WAITS_MS.map(() => ladder.next(0))).toEqual([0, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000]);
    expect(ladder.next(0)).toBeNull();
    // Giving up is not permanent: the next drop starts over.
    expect(ladder.next(0)).toBe(0);
  });
  it("starts over after a link that held", () => {
    const ladder = createVoiceRetryLadder();
    ladder.next(0); ladder.next(0); ladder.next(0);
    // A link that dropped again within seconds keeps climbing.
    expect(ladder.next(VOICE_STEADY_MS - 1)).toBe(4_000);
    expect(ladder.next(VOICE_STEADY_MS)).toBe(0);
  });
  it("starts over when told to", () => {
    const ladder = createVoiceRetryLadder();
    ladder.next(0); ladder.next(0);
    ladder.reset();
    expect(ladder.next(0)).toBe(0);
  });
});

describe("the dead-link check", () => {
  it("adds up what the far end has sent, and says so when a report counts nothing", () => {
    expect(voiceLinkReceived([
      { type: "inbound-rtp", packetsReceived: 100 },
      { type: "candidate-pair", bytesReceived: 5_000, responsesReceived: 7, requestsReceived: 3 },
      { type: "transport", bytesReceived: 6_000 },
      { type: "data-channel", messagesReceived: 12 },
      { type: "outbound-rtp", packetsSent: 900 },
    ])).toBe(11_122);
    expect(voiceLinkReceived([{ type: "outbound-rtp", packetsSent: 900 }, { type: "candidate-pair", bytesReceived: "many" }])).toBeNull();
  });
  it("calls a link dead after it was receiving and then stops for three readings", () => {
    const dead = createVoiceLinkPulse();
    expect([100, 200, 200, 200].map(dead)).toEqual([false, false, false, false]);
    expect(dead(200)).toBe(true);
  });
  it("leaves a link alone while anything keeps arriving", () => {
    const dead = createVoiceLinkPulse();
    expect([100, 200, 200, 200, 201, 201, 201, 260].map(dead)).toEqual(Array(8).fill(false));
  });
  it("never drops a link it has not seen receiving, or one that reports nothing", () => {
    const quiet = createVoiceLinkPulse();
    expect([50, 50, 50, 50, 50, 50].map(quiet)).toEqual(Array(6).fill(false));
    const unknown = createVoiceLinkPulse();
    expect([null, null, null, null, null].map(unknown)).toEqual(Array(5).fill(false));
  });
});

describe("the fresh session before the 60-minute limit", () => {
  it("waits for a quiet moment from 50 minutes, and stops waiting at 57", () => {
    expect(voiceRefreshDue(VOICE_REFRESH_AFTER_MS - 1, true)).toBe(false);
    expect(voiceRefreshDue(VOICE_REFRESH_AFTER_MS, true)).toBe(true);
    expect(voiceRefreshDue(VOICE_REFRESH_AFTER_MS, false)).toBe(false);
    expect(voiceRefreshDue(VOICE_REFRESH_BY_MS - 1, false)).toBe(false);
    expect(voiceRefreshDue(VOICE_REFRESH_BY_MS, false)).toBe(true);
  });
});
