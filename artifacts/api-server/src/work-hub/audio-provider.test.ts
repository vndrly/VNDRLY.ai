import { describe, expect, it } from "vitest";
import { disabledAudioProvider, resolveVndrlyIceServers } from "./audio-provider";
describe("disabled Work Hub audio provider", () => { it("never issues credentials or starts capture", async () => { await expect(disabledAudioProvider.createJoinLease()).rejects.toMatchObject({ code: "work_hub.provider_unavailable" }); await expect(disabledAudioProvider.startRecording()).rejects.toMatchObject({ code: "work_hub.provider_unavailable" }); }); });

describe("VNDRLY first-party ICE configuration", () => {
  it("uses only explicitly configured VNDRLY STUN and TURN services", () => {
    expect(resolveVndrlyIceServers({ VNDRLY_STUN_URL: "stun:rtc.vndrly.ai:3478", VNDRLY_TURN_URL: "turns:rtc.vndrly.ai:5349", VNDRLY_TURN_USERNAME: "meeting", VNDRLY_TURN_CREDENTIAL: "secret" })).toEqual([
      { urls: ["stun:rtc.vndrly.ai:3478"] },
      { urls: ["turns:rtc.vndrly.ai:5349"], username: "meeting", credential: "secret" },
    ]);
  });
  it("fails closed without configured infrastructure", () => expect(resolveVndrlyIceServers({})).toEqual([]));
});
