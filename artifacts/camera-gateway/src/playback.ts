import { createHmac, timingSafeEqual } from "node:crypto";

function validSignature(body: string, supplied: string, secret: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
export function createPlaybackSession(input: {
  body: string;
  signature: string;
  signingSecret: string;
  publicBaseUrl: string;
  channelMediaPaths: Record<string, string>;
  now?: Date;
}) {
  if (!validSignature(input.body, input.signature, input.signingSecret)) {
    throw new Error("gateway.invalid_signature");
  }
  const request = JSON.parse(input.body) as {
    channelId?: unknown;
    protocol?: unknown;
    requestedAt?: unknown;
  };
  const now = input.now ?? new Date();
  const requestedAt = new Date(String(request.requestedAt));
  if (!Number.isFinite(requestedAt.getTime()) || Math.abs(now.getTime() - requestedAt.getTime()) > 60_000) {
    throw new Error("gateway.stale_request");
  }
  if (request.protocol !== "hls" && request.protocol !== "webrtc") {
    throw new Error("gateway.unsupported_protocol");
  }
  const mediaPath = input.channelMediaPaths[String(request.channelId)];
  if (!mediaPath || !/^[a-zA-Z0-9_-]+$/.test(mediaPath)) throw new Error("gateway.channel_not_found");
  const base = new URL(input.publicBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("gateway.invalid_public_url");
  }
  const suffix = request.protocol === "hls" ? `${mediaPath}/index.m3u8` : `${mediaPath}/whep`;
  return {
    protocol: request.protocol,
    url: new URL(suffix, base.toString().replace(/\/?$/, "/")).toString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  };
}
