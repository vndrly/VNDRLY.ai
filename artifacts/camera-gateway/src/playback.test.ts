import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPlaybackSession } from "./playback";

describe("camera gateway playback sessions", () => {
  it("requires a valid VNDRLY signature and maps only configured channels", () => {
    const body = JSON.stringify({
      channelId: "channel-1",
      protocol: "hls",
      requestedAt: "2026-09-23T02:00:00.000Z",
    });
    const secret = "test-playback-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const result = createPlaybackSession({
      body,
      signature,
      signingSecret: secret,
      publicBaseUrl: "https://gateway.example.test",
      channelMediaPaths: { "channel-1": "front-gate" },
      now: new Date("2026-09-23T02:00:10.000Z"),
    });
    expect(result).toEqual({
      protocol: "hls",
      url: "https://gateway.example.test/front-gate/index.m3u8",
      expiresAt: "2026-09-23T02:01:10.000Z",
    });
    expect(() =>
      createPlaybackSession({
        body,
        signature: "0".repeat(64),
        signingSecret: secret,
        publicBaseUrl: "https://gateway.example.test",
        channelMediaPaths: { "channel-1": "front-gate" },
        now: new Date("2026-09-23T02:00:10.000Z"),
      }),
    ).toThrowError("gateway.invalid_signature");
  });
});
