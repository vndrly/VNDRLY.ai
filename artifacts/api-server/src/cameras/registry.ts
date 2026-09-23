export type CameraProtocol = "onvif" | "rtsp";
export type CameraAdapter = "montavue-onvif" | "onvif" | "rtsp";
export type CameraDeviceKind = "recorder" | "camera" | "sensor" | "other";

export type GatewayInventoryChannel = {
  stableKey: string;
  name: string;
};

export type GatewayInventoryDevice = {
  stableKey: string;
  name: string;
  kind: CameraDeviceKind;
  manufacturer?: string | null;
  model?: string | null;
  protocols: string[];
  credentialRef?: string | null;
  channels?: GatewayInventoryChannel[];
};

export type NormalizedCameraDevice = Omit<GatewayInventoryDevice, "protocols" | "channels"> & {
  stableKey: string;
  protocols: CameraProtocol[];
  adapter: CameraAdapter;
  channels: GatewayInventoryChannel[];
};

function normalizeKey(value: string, code: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 200) throw new Error(code);
  return normalized;
}

function normalizeProtocols(protocols: string[]): CameraProtocol[] {
  return [...new Set(protocols.map((protocol) => protocol.trim().toLowerCase()))].filter(
    (protocol): protocol is CameraProtocol => protocol === "onvif" || protocol === "rtsp",
  );
}

export function selectCameraAdapter(input: {
  manufacturer?: string | null;
  model?: string | null;
  protocols: string[];
}): CameraAdapter {
  const protocols = normalizeProtocols(input.protocols);
  const identity = `${input.manufacturer ?? ""} ${input.model ?? ""}`.toLowerCase();
  if (protocols.includes("onvif") && identity.includes("montavue")) return "montavue-onvif";
  if (protocols.includes("onvif")) return "onvif";
  if (protocols.includes("rtsp")) return "rtsp";
  throw new Error("camera.unsupported_protocol");
}

export function normalizeCameraInventory(input: {
  gatewayId: string;
  devices: GatewayInventoryDevice[];
}): NormalizedCameraDevice[] {
  if (!input.gatewayId.trim()) throw new Error("camera.gateway_required");
  const seen = new Set<string>();
  return input.devices.map((device) => {
    const stableKey = normalizeKey(device.stableKey, "camera.invalid_stable_key");
    if (seen.has(stableKey)) throw new Error("camera.duplicate_stable_key");
    seen.add(stableKey);
    const protocols = normalizeProtocols(device.protocols);
    const channelKeys = new Set<string>();
    const channels = (device.channels ?? []).map((channel) => {
      const channelStableKey = normalizeKey(channel.stableKey, "camera.invalid_channel_key");
      if (channelKeys.has(channelStableKey)) throw new Error("camera.duplicate_channel_key");
      channelKeys.add(channelStableKey);
      return { stableKey: channelStableKey, name: channel.name.trim() };
    });
    return {
      ...device,
      stableKey,
      name: device.name.trim(),
      protocols,
      adapter: selectCameraAdapter({ ...device, protocols }),
      credentialRef: device.credentialRef?.trim() || null,
      channels,
    };
  });
}

export type CameraPlaybackDescriptor = {
  protocol: "webrtc" | "hls";
  url: string;
  expiresAt: string;
};

export function sanitizePlaybackDescriptor(
  input: CameraPlaybackDescriptor & Record<string, unknown>,
): CameraPlaybackDescriptor {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error("camera.unsafe_playback_url");
  }
  const permittedScheme =
    (input.protocol === "hls" && parsed.protocol === "https:") ||
    (input.protocol === "webrtc" && (parsed.protocol === "https:" || parsed.protocol === "wss:"));
  if (!permittedScheme || parsed.username || parsed.password) {
    throw new Error("camera.unsafe_playback_url");
  }
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) throw new Error("camera.invalid_playback_expiry");
  return { protocol: input.protocol, url: parsed.toString(), expiresAt: expiresAt.toISOString() };
}
