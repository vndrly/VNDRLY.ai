import { describe, expect, it } from "vitest";
import { audioIceServers, captureAllowed, SignalMailbox } from "./internal-audio";

describe("internal audio", () => {
  it("does not require an external calling service", () => {
    expect(audioIceServers({}, 7, 100)).toEqual([]);
    const servers = audioIceServers({ WORK_HUB_TURN_URLS: "turn:relay.example.test:3478", WORK_HUB_TURN_SECRET: "test-only" }, 7, 100);
    expect(servers[0].username).toBe("3700:7");
    expect(servers[0].credential).not.toContain("test-only");
  });
  it("requires host activation, meeting permission, and current consent from everyone present", () => {
    const people = [{ userId: 1, policyVersion: 2, response: "accepted" }];
    expect(captureAllowed({ role: "participant", recordingAllowed: true, policyVersion: 2, consents: people, present: [1] })).toBe(false);
    expect(captureAllowed({ role: "host", recordingAllowed: true, policyVersion: 2, consents: people, present: [1, 2] })).toBe(false);
    expect(captureAllowed({ role: "host", recordingAllowed: true, policyVersion: 2, consents: people, present: [1] })).toBe(true);
  });
  it("retains same-timestamp signals with ordered cursors and isolates recipients", () => {
    const box = new SignalMailbox();
    const first = box.append("room", 1, 2, "offer", {}, 100);
    const second = box.append("room", 1, 2, "ice", {}, 100);
    expect(box.read("room", 2, first.sequence, 101).map(x => x.id)).toEqual([second.id]);
    expect(box.read("room", 3, 0, 101)).toEqual([]);
    expect(box.read("room", 2, 0, 400_000)).toEqual([]);
  });
});
