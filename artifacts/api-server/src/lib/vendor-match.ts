// Vendor-name fuzzy matching. Thin back-compat wrapper around the
// generalized helper in `./name-match.ts`, which is also used by
// /partners/match. Keep these aliases so existing call sites
// (routes/vendors.ts, signup-vendor flow, tests, scripts) don't have
// to change when new entity types adopt the same matcher.

import {
  findNameMatches,
  normalizeCompanyName,
  similarity,
  SCORE_THRESHOLD,
  MAX_MATCHES,
  type NameCandidate,
  type NameMatch,
} from "./name-match";

export {
  similarity,
  SCORE_THRESHOLD,
  MAX_MATCHES,
};

export const normalizeVendorName = normalizeCompanyName;

export type VendorLike = NameCandidate;
export type VendorMatch = NameMatch;

export function findVendorMatches(
  query: string,
  candidates: ReadonlyArray<VendorLike>,
  options?: { threshold?: number; limit?: number },
): VendorMatch[] {
  return findNameMatches(query, candidates, options);
}
