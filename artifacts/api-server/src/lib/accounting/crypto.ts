// AES-256-GCM helpers for encrypting accounting-software access /
// refresh tokens at rest. Output format is "iv_hex:authTag_hex:ct_hex"
// so the ciphertext is fully self-describing and we can rotate the key
// without a schema change.
//
// Key resolution:
//   1. ACCOUNTING_CREDS_KEY env var (preferred). 64-hex (256 bits) or
//      a base64 of 32 bytes.
//   2. Fall back to SHA-256(SESSION_SECRET + "::accounting-creds-v1")
//      so dev environments work without an extra secret. We log a one-
//      time warning so this is visible.
//
// Either path produces a 32-byte key.

import crypto from "crypto";
import { logger } from "../logger";

const ALG = "aes-256-gcm";
const IV_BYTES = 12;
let warned = false;

function getKey(): Buffer {
  const explicit = process.env["ACCOUNTING_CREDS_KEY"];
  if (explicit && explicit.trim()) {
    const trimmed = explicit.trim();
    // 64 hex chars → 32 bytes
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, "hex");
    }
    // base64 → 32 bytes
    try {
      const buf = Buffer.from(trimmed, "base64");
      if (buf.byteLength === 32) return buf;
    } catch {
      // fall through
    }
    throw new Error(
      "ACCOUNTING_CREDS_KEY must be 64 hex chars or base64 of 32 bytes",
    );
  }
  if (!warned) {
    warned = true;
    logger.warn(
      "ACCOUNTING_CREDS_KEY not set; deriving accounting-token encryption key from SESSION_SECRET. Set ACCOUNTING_CREDS_KEY in production.",
    );
  }
  const sess = process.env["SESSION_SECRET"];
  if (!sess) {
    throw new Error(
      "SESSION_SECRET is not set. Set ACCOUNTING_CREDS_KEY or SESSION_SECRET before using accounting-token encryption.",
    );
  }
  return crypto
    .createHash("sha256")
    .update(`${sess}::accounting-creds-v1`)
    .digest();
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptToken(envelope: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token envelope");
  }
  const [ivHex, tagHex, ctHex] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    ALG,
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return pt.toString("utf-8");
}

/** Best-effort decrypt that returns `null` on any failure — for read
 *  paths where we'd rather render a stale-token UI than 500 the page. */
export function tryDecryptToken(envelope: string | null): string | null {
  if (!envelope) return null;
  try {
    return decryptToken(envelope);
  } catch (err) {
    logger.error({ err }, "Failed to decrypt accounting token");
    return null;
  }
}
