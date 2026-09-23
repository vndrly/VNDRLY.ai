import { describe, expect, it } from "vitest";
import { createCameraService, type CameraRepository } from "./service";

function setup() {
  const gateways = new Map<string, any>([
    [
      "gateway-1",
      {
        id: "gateway-1",
        siteLocationId: 11,
        status: "online",
        revokedAt: null,
        lastSeenAt: new Date("2026-09-23T02:00:00.000Z"),
      },
    ],
  ]);
  const devices = new Map<string, any>();
  const channels = new Map<string, any>();
  const repository: CameraRepository = {
    async getGateway(id) {
      return gateways.get(id) ?? null;
    },
    async touchGateway() {},
    async resolveCredentialReference(_gatewayId, externalRef) {
      return externalRef === "shared-readonly" ? "credential-1" : null;
    },
    async upsertDevice(input) {
      const key = `${input.gatewayId}:${input.stableKey}`;
      const existing = devices.get(key);
      const record = { ...input, id: existing?.id ?? `device-${devices.size + 1}` };
      devices.set(key, record);
      return record;
    },
    async upsertChannel(input) {
      const key = `${input.deviceId}:${input.stableKey}`;
      const existing = channels.get(key);
      const record = { ...input, id: existing?.id ?? `channel-${channels.size + 1}` };
      channels.set(key, record);
      return record;
    },
    async markMissingOffline() {},
    async getChannelWithGateway(channelId) {
      const channel = [...channels.values()].find((item) => item.id === channelId);
      if (!channel) return null;
      const device = [...devices.values()].find((item) => item.id === channel.deviceId);
      return { channel, device, gateway: gateways.get(device.gatewayId) };
    },
  };
  const service = createCameraService(repository, {
    now: () => new Date("2026-09-23T02:00:30.000Z"),
    requestPlayback: async ({ channelId, protocol }) => ({
      protocol,
      url:
        protocol === "webrtc"
          ? `wss://gateway.example.test/play/${channelId}`
          : `https://gateway.example.test/play/${channelId}.m3u8`,
      expiresAt: "2026-09-23T02:01:30.000Z",
      upstreamUrl: "rtsp://admin:secret@10.0.0.5/stream",
    }),
  });
  return { service, devices, channels, gateways };
}

describe("camera service", () => {
  it("reconciles repeated gateway inventory without duplicating hardware", async () => {
    const state = setup();
    const inventory = {
      gatewayId: "gateway-1",
      devices: [
        {
          stableKey: "nvr-1",
          name: "Main NVR",
          kind: "recorder" as const,
          manufacturer: "Montavue",
          model: "MNR8208",
          protocols: ["onvif", "rtsp"],
          credentialRef: "shared-readonly",
          channels: [{ stableKey: "1", name: "Front Gate" }],
        },
      ],
    };

    const first = await state.service.reconcileInventory(inventory);
    const second = await state.service.reconcileInventory({
      ...inventory,
      devices: [{ ...inventory.devices[0]!, name: "Main recorder" }],
    });

    expect(first.devices[0]?.id).toBe(second.devices[0]?.id);
    expect(state.devices).toHaveLength(1);
    expect(state.channels).toHaveLength(1);
    expect(state.devices.values().next().value).toMatchObject({
      name: "Main recorder",
      credentialReferenceId: "credential-1",
    });
  });

  it("refuses inventory that names a missing gateway credential reference", async () => {
    const state = setup();
    await expect(
      state.service.reconcileInventory({
        gatewayId: "gateway-1",
        devices: [
          {
            stableKey: "nvr-1",
            name: "Main NVR",
            kind: "recorder",
            protocols: ["rtsp"],
            credentialRef: "unknown",
          },
        ],
      }),
    ).rejects.toThrowError("camera.credential_reference_missing");
  });

  it("issues a redacted short-lived WebRTC descriptor for an online gateway", async () => {
    const state = setup();
    const result = await state.service.reconcileInventory({
      gatewayId: "gateway-1",
      devices: [
        {
          stableKey: "camera-1",
          name: "Front Gate",
          kind: "camera",
          protocols: ["onvif"],
          channels: [{ stableKey: "main", name: "Main stream" }],
        },
      ],
    });
    const descriptor = await state.service.createPlaybackDescriptor(
      result.devices[0]!.channels[0]!.id,
      "webrtc",
    );
    expect(descriptor).toEqual({
      protocol: "webrtc",
      url: `wss://gateway.example.test/play/${result.devices[0]!.channels[0]!.id}`,
      expiresAt: "2026-09-23T02:01:30.000Z",
    });
    expect(JSON.stringify(descriptor)).not.toContain("secret");
  });

  it.each([
    ["revoked", { revokedAt: new Date("2026-09-23T02:00:20.000Z") }],
    ["offline", { lastSeenAt: new Date("2026-09-23T01:55:00.000Z") }],
  ])("rejects playback when the gateway is %s", async (_name, gatewayPatch) => {
    const state = setup();
    const result = await state.service.reconcileInventory({
      gatewayId: "gateway-1",
      devices: [
        {
          stableKey: "camera-1",
          name: "Front Gate",
          kind: "camera",
          protocols: ["rtsp"],
          channels: [{ stableKey: "main", name: "Main" }],
        },
      ],
    });
    Object.assign(state.gateways.get("gateway-1"), gatewayPatch);
    await expect(
      state.service.createPlaybackDescriptor(result.devices[0]!.channels[0]!.id, "hls"),
    ).rejects.toThrowError("camera.gateway_unavailable");
  });
});
