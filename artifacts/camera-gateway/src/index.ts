import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { buildInventory, discoverOnvifDevices, type GatewayConfig } from "./discovery";
import { createPlaybackSession } from "./playback";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const apiBaseUrl = required("VNDRLY_API_URL").replace(/\/$/, "");
const gatewayId = required("VNDRLY_CAMERA_GATEWAY_ID");
const gatewayToken = required("VNDRLY_CAMERA_GATEWAY_TOKEN");
const signingSecret = required("CAMERA_PLAYBACK_SIGNING_SECRET");
const publicBaseUrl = required("CAMERA_GATEWAY_PUBLIC_URL");
const configPath = process.env.CAMERA_GATEWAY_CONFIG ?? "camera-gateway.json";
const port = Number.parseInt(process.env.CAMERA_GATEWAY_PORT ?? "8788", 10);
const config = JSON.parse(await readFile(configPath, "utf8")) as GatewayConfig;
const configuredInventory = buildInventory(config);
let channelMediaPaths: Record<string, string> = {};

async function post(path: string, body: unknown) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gatewayToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`VNDRLY gateway request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

async function synchronize() {
  const discovered = process.env.CAMERA_ONVIF_DISCOVERY === "0"
    ? []
    : await discoverOnvifDevices(2_000).catch(() => []);
  const configuredKeys = new Set(configuredInventory.map((device) => device.stableKey.trim().toLowerCase()));
  const inventory = [
    ...configuredInventory,
    ...discovered
      .filter((device) => !configuredKeys.has(device.stableKey))
      .map((device) => ({
        stableKey: device.stableKey,
        name: device.name,
        kind: "camera" as const,
        manufacturer: undefined,
        model: device.model ?? undefined,
        protocols: ["onvif" as const],
        credentialRef: undefined,
        channels: [],
      })),
  ];
  await post(`/api/camera-gateways/${gatewayId}/heartbeat`, {
    softwareVersion: "0.1.0",
    playbackBaseUrl: publicBaseUrl,
  });
  const result = (await post(`/api/camera-gateways/${gatewayId}/inventory`, { devices: inventory })) as any;
  const nextPaths: Record<string, string> = {};
  for (const device of result?.devices ?? []) {
    const configuredDevice = config.devices.find((candidate) => candidate.stableKey.trim().toLowerCase() === device.stableKey);
    for (const channel of device.channels ?? []) {
      const configuredChannel = configuredDevice?.channels.find((candidate) => candidate.stableKey.trim().toLowerCase() === channel.stableKey);
      if (configuredChannel) nextPaths[channel.id] = configuredChannel.mediaPath;
    }
  }
  channelMediaPaths = nextPaths;
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/playback-sessions") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) {
      response.writeHead(413).end();
      return;
    }
  }
  try {
    const descriptor = createPlaybackSession({
      body,
      signature: String(request.headers["x-vndrly-signature"] ?? ""),
      signingSecret,
      publicBaseUrl,
      channelMediaPaths,
    });
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(descriptor));
  } catch {
    response.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ code: "gateway.playback_denied" }));
  }
});

await synchronize();
setInterval(() => void synchronize().catch((error) => console.error("camera gateway sync failed", error)), 30_000).unref();
server.listen(port, "0.0.0.0", () => console.log(`VNDRLY camera gateway listening on ${port}`));
