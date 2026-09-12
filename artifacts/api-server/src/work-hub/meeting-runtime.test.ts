import { describe, expect, it } from "vitest";
import { appendMeetingSignal, captureAllowed, presentUserIds, removeDevicePresence, signalsForConnection, signalsForParticipant, upsertDevicePresence, visibleMeetingActivities, type MeetingRuntime } from "./meeting-runtime";

describe("persisted meeting runtime", () => {
  it("keeps a user present when one of two devices leaves", () => {
    let runtime: MeetingRuntime = {};
    runtime = upsertDevicePresence(runtime, { userId: 7, deviceId: "phone", connectionId: "phone-connection", joinedAt: 10, seenAt: 100, speaking: true });
    runtime = upsertDevicePresence(runtime, { userId: 7, deviceId: "desktop", connectionId: "desktop-connection", joinedAt: 20, seenAt: 100, speaking: false });
    const next = removeDevicePresence(runtime, "phone-connection");
    expect(presentUserIds(next, 100)).toEqual([7]);
    expect(next.connections).toHaveProperty("desktop-connection");
    expect(next.connections).not.toHaveProperty("phone-connection");
  });

  it("delivers an offer only to the addressed device", () => {
    let runtime: MeetingRuntime = {};
    runtime = appendMeetingSignal(runtime, { fromUserId: 1, fromDeviceId: "phone", toUserId: 2, toDeviceId: "desktop", kind: "offer", payload: { sdp: "offer" } }, 100);
    expect(signalsForConnection(runtime, "desktop", 0)).toHaveLength(1);
    expect(signalsForConnection(runtime, "tablet", 0)).toEqual([]);
  });

  it("reads legacy presence as synthetic connections", () => {
    const runtime: MeetingRuntime = { presence: { 7: { joinedAt: 10, seenAt: 100, speaking: false } } };
    expect(presentUserIds(runtime, 100)).toEqual([7]);
    expect(removeDevicePresence(runtime, "legacy:7").connections).toEqual({});
  });
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
