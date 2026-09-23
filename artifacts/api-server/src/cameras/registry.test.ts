import { describe, expect, it } from "vitest";
import {
  normalizeCameraInventory,
  sanitizePlaybackDescriptor,
  selectCameraAdapter,
} from "./registry";

describe("camera registry normalization", () => {
  it("selects Montavue as an ONVIF adapter rather than a product-specific registry", () => {
    expect(
      selectCameraAdapter({
        manufacturer: "Montavue",
        model: "MNR8208",
        protocols: ["rtsp", "onvif"],
      }),
    ).toBe("montavue-onvif");
    expect(
      selectCameraAdapter({
        manufacturer: "Axis",
        model: "P3265-LVE",
        protocols: ["onvif", "rtsp"],
      }),
    ).toBe("onvif");
  });

  it("falls back to RTSP and rejects unsupported hardware", () => {
    expect(
      selectCameraAdapter({
        manufacturer: "Generic",
        model: "NVR",
        protocols: ["rtsp"],
      }),
    ).toBe("rtsp");
    expect(() =>
      selectCameraAdapter({
        manufacturer: "Legacy",
        model: "Analog",
        protocols: ["coax"],
      }),
    ).toThrowError("camera.unsupported_protocol");
  });

  it("normalizes repeated stable hardware keys and preserves shared credential references", () => {
    const inventory = normalizeCameraInventory({
      gatewayId: "6ad3ca9f-17a5-4a55-b91f-bd61992dc786",
      devices: [
        {
          stableKey: " NVR-01 ",
          name: "Front recorder",
          kind: "recorder",
          manufacturer: "Montavue",
          model: "MNR8208",
          protocols: ["ONVIF", "RTSP"],
          credentialRef: "site-main-readonly",
          channels: [{ stableKey: "CH-1", name: "Front gate" }],
        },
        {
          stableKey: "nvr-02",
          name: "Back recorder",
          kind: "recorder",
          manufacturer: "Montavue",
          model: "MNR8208",
          protocols: ["rtsp"],
          credentialRef: "site-main-readonly",
          channels: [{ stableKey: "CH-1", name: "Back gate" }],
        },
      ],
    });

    expect(inventory.map((device) => device.stableKey)).toEqual(["nvr-01", "nvr-02"]);
    expect(inventory.map((device) => device.credentialRef)).toEqual([
      "site-main-readonly",
      "site-main-readonly",
    ]);
    expect(inventory[0]?.channels[0]?.stableKey).toBe("ch-1");
  });

  it("rejects credential-bearing playback URLs and returns only client-safe fields", () => {
    expect(() =>
      sanitizePlaybackDescriptor({
        protocol: "hls",
        url: "https://viewer:secret@example.test/live.m3u8",
        expiresAt: "2026-09-23T03:00:00.000Z",
      }),
    ).toThrowError("camera.unsafe_playback_url");

    expect(
      sanitizePlaybackDescriptor({
        protocol: "webrtc",
        url: "wss://gateway.example.test/camera/session-1",
        expiresAt: "2026-09-23T03:00:00.000Z",
        upstreamUrl: "rtsp://admin:secret@10.0.0.5/stream1",
      }),
    ).toEqual({
      protocol: "webrtc",
      url: "wss://gateway.example.test/camera/session-1",
      expiresAt: "2026-09-23T03:00:00.000Z",
    });
  });
});
