import {
  normalizeCameraInventory,
  sanitizePlaybackDescriptor,
  type CameraPlaybackDescriptor,
  type GatewayInventoryDevice,
} from "./registry";

export type CameraGatewayRecord = {
  id: string;
  siteLocationId: number;
  status: string;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
};

export type CameraDeviceRecord = {
  id: string;
  gatewayId: string;
  stableKey: string;
  name: string;
  kind: string;
  manufacturer?: string | null;
  model?: string | null;
  adapter: string;
  protocols: Array<"onvif" | "rtsp">;
  credentialReferenceId: string | null;
  status: string;
  lastSeenAt: Date;
};

export type CameraChannelRecord = {
  id: string;
  deviceId: string;
  stableKey: string;
  name: string;
  enabled: boolean;
  status: string;
  lastSeenAt: Date;
};

export interface CameraRepository {
  getGateway(id: string): Promise<CameraGatewayRecord | null>;
  touchGateway(id: string, seenAt: Date): Promise<void>;
  resolveCredentialReference(gatewayId: string, externalRef: string): Promise<string | null>;
  upsertDevice(input: Omit<CameraDeviceRecord, "id">): Promise<CameraDeviceRecord>;
  upsertChannel(input: Omit<CameraChannelRecord, "id">): Promise<CameraChannelRecord>;
  markMissingOffline(input: {
    gatewayId: string;
    activeDeviceStableKeys: string[];
    activeChannelStableKeysByDeviceId: Record<string, string[]>;
    seenAt: Date;
  }): Promise<void>;
  getChannelWithGateway(channelId: string): Promise<{
    channel: CameraChannelRecord;
    device: CameraDeviceRecord;
    gateway: CameraGatewayRecord;
  } | null>;
}

type Dependencies = {
  now?: () => Date;
  requestPlayback: (input: {
    gatewayId: string;
    channelId: string;
    protocol: "webrtc" | "hls";
  }) => Promise<CameraPlaybackDescriptor & Record<string, unknown>>;
};

const GATEWAY_STALE_MS = 90_000;
const MAX_PLAYBACK_LIFETIME_MS = 120_000;

export function createCameraService(repository: CameraRepository, dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function reconcileInventory(input: {
    gatewayId: string;
    devices: GatewayInventoryDevice[];
  }) {
    const gateway = await repository.getGateway(input.gatewayId);
    if (!gateway || gateway.revokedAt) throw new Error("camera.gateway_unavailable");
    const seenAt = now();
    const normalized = normalizeCameraInventory(input);
    const result: Array<CameraDeviceRecord & { channels: CameraChannelRecord[] }> = [];
    const activeChannelStableKeysByDeviceId: Record<string, string[]> = {};

    for (const candidate of normalized) {
      const credentialReferenceId = candidate.credentialRef
        ? await repository.resolveCredentialReference(input.gatewayId, candidate.credentialRef)
        : null;
      if (candidate.credentialRef && !credentialReferenceId) {
        throw new Error("camera.credential_reference_missing");
      }
      const device = await repository.upsertDevice({
        gatewayId: input.gatewayId,
        stableKey: candidate.stableKey,
        name: candidate.name,
        kind: candidate.kind,
        manufacturer: candidate.manufacturer ?? null,
        model: candidate.model ?? null,
        adapter: candidate.adapter,
        protocols: candidate.protocols,
        credentialReferenceId,
        status: "online",
        lastSeenAt: seenAt,
      });
      const channels: CameraChannelRecord[] = [];
      for (const candidateChannel of candidate.channels) {
        channels.push(
          await repository.upsertChannel({
            deviceId: device.id,
            stableKey: candidateChannel.stableKey,
            name: candidateChannel.name,
            enabled: true,
            status: "online",
            lastSeenAt: seenAt,
          }),
        );
      }
      activeChannelStableKeysByDeviceId[device.id] = candidate.channels.map(
        (channel) => channel.stableKey,
      );
      result.push({ ...device, channels });
    }

    await repository.markMissingOffline({
      gatewayId: input.gatewayId,
      activeDeviceStableKeys: normalized.map((device) => device.stableKey),
      activeChannelStableKeysByDeviceId,
      seenAt,
    });
    await repository.touchGateway(input.gatewayId, seenAt);
    return { gatewayId: input.gatewayId, reconciledAt: seenAt, devices: result };
  }

  async function createPlaybackDescriptor(
    channelId: string,
    protocol: "webrtc" | "hls",
  ): Promise<CameraPlaybackDescriptor> {
    const record = await repository.getChannelWithGateway(channelId);
    if (!record || !record.channel.enabled || record.channel.status !== "online") {
      throw new Error("camera.channel_unavailable");
    }
    const current = now();
    if (
      record.gateway.revokedAt ||
      record.gateway.status !== "online" ||
      !record.gateway.lastSeenAt ||
      current.getTime() - record.gateway.lastSeenAt.getTime() > GATEWAY_STALE_MS
    ) {
      throw new Error("camera.gateway_unavailable");
    }
    const descriptor = sanitizePlaybackDescriptor(
      await dependencies.requestPlayback({
        gatewayId: record.gateway.id,
        channelId,
        protocol,
      }),
    );
    const expiry = new Date(descriptor.expiresAt).getTime();
    if (
      expiry <= current.getTime() ||
      expiry - current.getTime() > MAX_PLAYBACK_LIFETIME_MS
    ) {
      throw new Error("camera.invalid_playback_expiry");
    }
    return descriptor;
  }

  return { reconcileInventory, createPlaybackDescriptor };
}
