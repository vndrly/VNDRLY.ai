import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_SECRET } from "../lib/session";
export interface HandoffProof {
  outgoingId: number;
  outgoingVersion: number;
  incomingId: number;
  incomingVersion: number;
  membershipId: number | null;
  stationId: string;
  preparationId: string;
  revision: string;
}
export function issueHandoffProof(claims: HandoffProof, now = Date.now()) {
  const body = Buffer.from(
    JSON.stringify({
      ...claims,
      purpose: "gate-change-over",
      expires: now + 300000,
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", SESSION_SECRET).update(body).digest("hex")}`;
}
export function readHandoffProof(
  value: string,
  now = Date.now(),
): HandoffProof | null {
  try {
    if (value.length > 4096) return null;
    const [body, signature, extra] = value.split(".");
    if (!body || !signature || !/^[a-f0-9]{64}$/.test(signature) || extra)
      return null;
    const expected = createHmac("sha256", SESSION_SECRET).update(body).digest();
    const actual = Buffer.from(signature, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return claims.purpose === "gate-change-over" && claims.expires > now
      ? claims
      : null;
  } catch {
    return null;
  }
}
