import dgram from "node:dgram";
import { randomUUID } from "node:crypto";

export type DiscoveredOnvifDevice = {
  stableKey: string;
  name: string;
  model: string | null;
  xaddrs: string[];
};

function tag(xml: string, localName: string) {
  return xml.match(new RegExp(`<[^>]*:?${localName}[^>]*>([^<]+)</[^>]*:?${localName}>`, "i"))?.[1]?.trim();
}

function scopeValue(scopes: string, kind: string) {
  const value = scopes
    .split(/\s+/)
    .find((scope) => new RegExp(`(?:www\\.)?onvif\\.org/${kind}/`, "i").test(scope));
  if (!value) return null;
  try {
    return decodeURIComponent(value.slice(value.lastIndexOf("/") + 1)).replace(/\+/g, " ");
  } catch {
    return null;
  }
}

export function parseOnvifProbeResponse(xml: string): DiscoveredOnvifDevice[] {
  const matches = xml.match(/<[^>]*:?ProbeMatch(?:\s[^>]*)?>[\s\S]*?<\/[^>]*:?ProbeMatch>/gi) ?? [];
  return matches.flatMap((match) => {
    const address = tag(match, "Address")?.toLowerCase();
    const xaddrs = (tag(match, "XAddrs") ?? "").split(/\s+/).filter(Boolean);
    if (!address || !xaddrs.length) return [];
    const scopes = tag(match, "Scopes") ?? "";
    return [{
      stableKey: address,
      name: scopeValue(scopes, "name") ?? address,
      model: scopeValue(scopes, "hardware"),
      xaddrs,
    }];
  });
}

export type GatewayConfig = {
  credentials: Record<string, { username: string; password: string }>;
  devices: Array<{
    stableKey: string;
    name: string;
    kind: "recorder" | "camera" | "sensor" | "other";
    manufacturer?: string;
    model?: string;
    protocols: Array<"onvif" | "rtsp">;
    address: string;
    credentialRef?: string;
    channels: Array<{ stableKey: string; name: string; mediaPath: string }>;
  }>;
};

export function buildInventory(config: GatewayConfig) {
  return config.devices.map((device) => {
    if (device.credentialRef && !config.credentials[device.credentialRef]) {
      throw new Error(`gateway.credential_reference_missing:${device.credentialRef}`);
    }
    return {
      stableKey: device.stableKey,
      name: device.name,
      kind: device.kind,
      manufacturer: device.manufacturer,
      model: device.model,
      protocols: device.protocols,
      credentialRef: device.credentialRef,
      channels: device.channels.map((channel) => ({
        stableKey: channel.stableKey,
        name: channel.name,
      })),
    };
  });
}

export async function discoverOnvifDevices(timeoutMs = 3_000): Promise<DiscoveredOnvifDevice[]> {
  const messageId = randomUUID();
  const probe = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
      xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
      xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
      xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
      <e:Header><w:MessageID>uuid:${messageId}</w:MessageID>
      <w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
      <w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
      <e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>
    </e:Envelope>`);
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const discovered = new Map<string, DiscoveredOnvifDevice>();
  socket.on("message", (message) => {
    for (const device of parseOnvifProbeResponse(message.toString("utf8"))) {
      discovered.set(device.stableKey, device);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => socket.send(probe, 3702, "239.255.255.250", (error) => error ? reject(error) : resolve()));
  });
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  socket.close();
  return [...discovered.values()];
}
