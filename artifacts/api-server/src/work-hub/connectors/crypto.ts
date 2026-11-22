import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "../../lib/accounting/crypto";

// Shared by API instances serving the same connection database. Login-session
// signing keys remain isolated between localhost and production.
function key() {
  const value = process.env.COMMS_CREDS_KEY?.trim();
  if (!value) return null;
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Invalid COMMS_CREDS_KEY");
  return Buffer.from(value, "hex");
}
export function encryptConnection(value: string) {
  const secret = key();
  if (!secret) return encryptToken(value);
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secret, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data.toString("hex")}`;
}
export function decryptConnection(value: string) {
  const secret = key();
  if (!secret) return decryptToken(value);
  const [iv, tag, data] = value.split(":");
  const cipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([cipher.update(Buffer.from(data, "hex")), cipher.final()]).toString("utf8");
}
