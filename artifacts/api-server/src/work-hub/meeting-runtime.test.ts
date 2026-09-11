import { describe, expect, it } from "vitest";
import { appendMeetingSignal, captureAllowed, presentUserIds, signalsForParticipant, visibleMeetingActivities, type MeetingRuntime } from "./meeting-runtime";

describe("persisted meeting runtime", () => {
  it("exposes private activity only to its recipient with its scope and expiry intact", () => {
    const runtime: MeetingRuntime = { activity: {
      2: { kind: "typing", recipientUserId: 1, expiresAt: 9000 },
      3: { kind: "file", recipientUserId: null, expiresAt: 9000 },
      4: { kind: "typing", recipientUserId: null, expiresAt: 50 },
      5: { kind: "file", recipientUserId: null, expiresAt: 9000 },
    } };
    expect(visibleMeetingActivities(runtime, 1, [1, 2, 3, 4], 100)).toEqual([
      { userId: 2, kind: "typing", recipientUserId: 1, expiresAt: 9000 },
      { userId: 3, kind: "file", recipientUserId: null, expiresAt: 9000 },
    ]);
    expect(visibleMeetingActivities(runtime, 3, [1, 2, 3, 4], 100)).toEqual([]);
    expect(visibleMeetingActivities(runtime, 1, [1, 2, 3, 4], 9000)).toEqual([]);
  });
  it("delivers simultaneous signals once through monotonically increasing cursors", () => {
    let runtime: MeetingRuntime = {};
    runtime = appendMeetingSignal(runtime, { fromUserId: 1, toUserId: 2, kind: "offer", payload: { sdp: "offer" } }, 100);
    runtime = appendMeetingSignal(runtime, { fromUserId: 1, toUserId: 2, kind: "ice", payload: { candidate: "ice" } }, 100);
    expect(signalsForParticipant(runtime, 2, 1).map((item) => item.kind)).toEqual(["ice"]);
    expect(signalsForParticipant(runtime, 3, 0)).toEqual([]);
    expect(signalsForParticipant(runtime, 2, 2)).toEqual([]);
  });
  it("expires disconnected presence and old signalling without resetting the cursor", () => {
    const runtime = appendMeetingSignal({ sequence: 7, signals: [{ sequence: 7, fromUserId: 1, toUserId: 2, kind: "ice", payload: {}, createdAt: 0 }] }, { fromUserId: 2, toUserId: 1, kind: "answer", payload: {} }, 130_000);
    expect(runtime.signals).toHaveLength(1);
    expect(runtime.sequence).toBe(8);
    expect(presentUserIds({ presence: { 1: { joinedAt: 0, seenAt: 0, speaking: false } } }, 30_001)).toEqual([]);
  });
  it("rejects a signaling burst before its persisted runtime exceeds two megabytes", () => {
    let runtime: MeetingRuntime = {};
    const payload = { candidate: "\u00e9".repeat(30_000) };
    expect(() => {
      for (let index = 0; index < 40; index += 1) {
        runtime = appendMeetingSignal(runtime, { fromUserId: 1, toUserId: 2, kind: "ice", payload }, 100 + index);
      }
    }).toThrow("meeting.signalling_busy");
  });
  it("retains an ordinary bounded signaling burst", () => {
    let runtime: MeetingRuntime = {};
    const payload = { candidate: "x".repeat(8_000) };
    for (let index = 0; index < 32; index += 1) {
      runtime = appendMeetingSignal(runtime, { fromUserId: 1, toUserId: 2, kind: "ice", payload }, 100 + index);
    }
    expect(runtime.signals).toHaveLength(32);
  });
  it("pauses capture when a late attendee has not consented, then resumes after consent", () => {
    const runtime = { presence: { 1: { joinedAt: 1, seenAt: 100, speaking: false }, 2: { joinedAt: 100, seenAt: 100, speaking: false } } };
    expect(captureAllowed(true, runtime, [1, 2], [1], 100)).toBe(false);
    expect(captureAllowed(true, runtime, [1, 2], [1, 2], 100)).toBe(true);
    expect(captureAllowed(false, runtime, [1, 2], [1, 2], 100)).toBe(false);
    expect(captureAllowed(true, {}, [1], [1], 100)).toBe(false);
  });
});
