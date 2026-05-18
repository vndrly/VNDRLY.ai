// Fuzzy matching for company names (vendors, partners, etc.).
// Score = max(exact, containment, Levenshtein ratio, token overlap)
// over normalized strings (NFKD, punctuation stripped, generic
// corporate suffixes dropped). Used by /vendors/match and
// /partners/match to warn admins before they create a near-duplicate.

const SUFFIX_TOKENS = new Set([
  "inc",
  "incorporated",
  "llc",
  "lp",
  "llp",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "holdings",
  "holding",
  "group",
  "intl",
  "international",
  "services",
  "service",
  "svcs",
  "svc",
  "field",
  "the",
]);

export const SCORE_THRESHOLD = 0.65;
export const MAX_MATCHES = 5;

export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !SUFFIX_TOKENS.has(t))
    .join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

export function similarity(a: string, b: string): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const lev = maxLen > 0 ? 1 - dist / maxLen : 0;

  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const minSize = Math.min(ta.size, tb.size);
  const overlap = minSize > 0 ? inter / minSize : 0;

  // Containment is a strong signal but capped at 0.9 so an exact match
  // always wins over "X is contained in Y".
  const contain =
    na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))
      ? 0.9
      : 0;

  return Math.max(lev, overlap, contain);
}

export type NameCandidate = { id: number; name: string };
export type NameMatch = { id: number; name: string; score: number };

/**
 * Score `query` against every candidate, return the best matches above
 * the configured threshold. Candidates whose normalized name is empty
 * are skipped (they could only match the empty string and would noise
 * the results).
 */
export function findNameMatches(
  query: string,
  candidates: ReadonlyArray<NameCandidate>,
  options?: { threshold?: number; limit?: number },
): NameMatch[] {
  const threshold = options?.threshold ?? SCORE_THRESHOLD;
  const limit = options?.limit ?? MAX_MATCHES;
  const normalizedQuery = normalizeCompanyName(query);
  if (!normalizedQuery) return [];

  const scored: NameMatch[] = [];
  for (const c of candidates) {
    const score = similarity(query, c.name);
    if (score >= threshold) {
      scored.push({ id: c.id, name: c.name, score });
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable secondary sort by name for deterministic output.
    return a.name.localeCompare(b.name);
  });
  return scored.slice(0, limit);
}
