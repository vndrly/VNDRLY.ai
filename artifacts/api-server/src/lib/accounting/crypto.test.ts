import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

describe("accounting token crypto", () => {
  const KEY_ENV = "ACCOUNTING_CREDS_KEY";
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[KEY_ENV];
    // 64 hex characters → 32 bytes (256 bits)
    process.env[KEY_ENV] =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = prev;
  });

  it("round-trips a typical OAuth access token", () => {
    const token =
      "eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.payload.signature-data-here";
    const env = encryptToken(token);
    expect(env.split(":")).toHaveLength(3);
    expect(decryptToken(env)).toBe(token);
  });

  it("produces different ciphertexts on each call (random IV)", () => {
    const a = encryptToken("hello");
    const b = encryptToken("hello");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("hello");
    expect(decryptToken(b)).toBe("hello");
  });

  it("throws on a tampered authentication tag", () => {
    const env = encryptToken("secret");
    const [iv, _tag, ct] = env.split(":");
    const broken = `${iv}:00000000000000000000000000000000:${ct}`;
    expect(() => decryptToken(broken)).toThrow();
  });

  it("rejects malformed envelopes", () => {
    expect(() => decryptToken("not-an-envelope")).toThrow();
  });

  it("rejects an obviously wrong key length", () => {
    process.env[KEY_ENV] = "tooshort";
    expect(() => encryptToken("x")).toThrow(
      /ACCOUNTING_CREDS_KEY/,
    );
  });
});
