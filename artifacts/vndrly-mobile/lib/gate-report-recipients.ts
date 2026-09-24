export type GateReportRecipient = {
  userId: number;
  name: string;
  role?: string;
};

/**
 * Defensive client boundary for older API releases. The server is the source
 * of truth, but a stale deployment must never expose test, platform, or
 * unrelated administrative accounts in a gate worker's recipient picker.
 */
export function isVisibleGateReportRecipient(recipient: GateReportRecipient) {
  const name = recipient.name.trim().toLowerCase();
  if (/\b(?:e2e|test)\b/.test(name)) return false;
  if (name === "admin" || name === "vndrly admin" || name === "warwick admin") return false;
  return true;
}
