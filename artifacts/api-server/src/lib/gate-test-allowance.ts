// Testing allowance requested by John on 2026-11-27: he tests the Longhorn Superior 420 gates from home,
// about a mile from the Outer Circle. For this one user at this one site, "at the gate" reaches this far.
// Nobody else's boundary changes and each gate's saved radius is untouched. Visit records made under it say so.
// Remove the entry when John says testing from home is over.
export const GATE_TEST_ALLOWANCES = [{ userId: 1066, siteId: 414, radiusMeters: 2000, reason: "John's testing from home" }] as const;

/** The gate boundary that applies to this user: the gate's own radius, or their testing allowance when it reaches further. */
export function gateRadiusFor(userId: number | null | undefined, siteId: number | null | undefined, radiusMeters: number): { radiusMeters: number; allowance: boolean } {
  const allowed = GATE_TEST_ALLOWANCES.find(entry => entry.userId === userId && entry.siteId === siteId);
  return allowed && allowed.radiusMeters > radiusMeters ? { radiusMeters: allowed.radiusMeters, allowance: true } : { radiusMeters, allowance: false };
}
