import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

/** Bind a durable retry to the original authorized command, including its room. */
export function liveMeetingFingerprint(
  userId: number,
  kind: string,
  occurrenceId: string,
  envelope: unknown,
): string {
  return createHash("sha256")
    .update(canonical({ userId, kind, occurrenceId, envelope }))
    .digest("hex");
}

export function verifyLiveMeetingReplay(
  result: unknown,
  fingerprint: string,
): void {
  const resource = (result as { resource?: { commandFingerprint?: unknown } })
    ?.resource;
  if (resource?.commandFingerprint !== fingerprint) {
    throw Object.assign(
      new Error("This retry does not match the original meeting command"),
      { status: 409 },
    );
  }
}
