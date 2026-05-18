// Tiny convenience wrapper around node:crypto SHA-256. Lives in its
// own file so importing it doesn't drag the rest of crypto into the
// bundle of any consumer that only needs a hex digest.

import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
