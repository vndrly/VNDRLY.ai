// Minimal RFC-4180 CSV reader / writer used by the QB account-mapping
// import preview dialog so admins can fix typos in skipped rows in-place
// and re-validate without leaving the page. Mirrors the server-side
// `readCsv` in `artifacts/api-server/src/lib/reports/qb-mapping.ts` so
// what the client serializes round-trips byte-identically through the
// same parser the import endpoint uses.

export function readCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  while (out.length > 0 && out[out.length - 1].every((c) => c.trim() === "")) {
    out.pop();
  }
  return out;
}

/**
 * Quote a single CSV cell when it contains a comma, quote, or newline.
 * Doubled quotes are used to escape literal quotes per RFC 4180.
 */
function quoteCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize a 2D matrix back into CSV text. Always uses `\n` line endings
 * and a trailing newline so the output matches what the typical CSV
 * editor produces.
 */
export function writeCsv(matrix: ReadonlyArray<ReadonlyArray<string>>): string {
  return matrix.map((row) => row.map(quoteCell).join(",")).join("\n") + "\n";
}

// Strip whitespace, punctuation, and case so "line type", "Line_Type",
// and "linetype" all collapse to the same canonical form before fuzzy
// comparison. This lets near-misses on separators and casing score as
// trivial edits rather than dominating the distance.
function normalizeForFuzzy(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Iterative two-row Levenshtein. Allocates O(min(a,b)+1) ints per call
// and runs in O(|a|·|b|), which is fine for the short header strings
// the CSV header editor compares (<= ~32 chars each).
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export interface FuzzyMatch<T extends string> {
  /** The candidate that best matched `input`. */
  name: T;
  /** Similarity in [0, 1]: 1 - dist / max(len). Higher is better. */
  similarity: number;
}

/**
 * Pick the most likely canonical name for an admin-typed CSV header
 * cell using normalized Levenshtein similarity. Returns `null` when no
 * candidate clears `threshold` (default 0.5) or when `input` has no
 * alphanumerics after normalization, so callers can render a neutral
 * UI for genuinely unrelated headers instead of forcing a wrong guess.
 *
 * Used by the QB account-mapping import preview's header editor to
 * pre-pick "Use as line_type" when the admin typed "line type" — a
 * single edit that scores ~0.88 similarity post-normalization — while
 * leaving fully unrelated columns untouched.
 */
export function suggestCanonicalName<T extends string>(
  input: string,
  candidates: ReadonlyArray<T>,
  options: { threshold?: number } = {},
): FuzzyMatch<T> | null {
  const threshold = options.threshold ?? 0.5;
  const normInput = normalizeForFuzzy(input);
  if (normInput.length === 0 || candidates.length === 0) return null;
  let best: FuzzyMatch<T> | null = null;
  for (const candidate of candidates) {
    const normCand = normalizeForFuzzy(candidate);
    const denom = Math.max(normInput.length, normCand.length);
    if (denom === 0) continue;
    const dist = levenshteinDistance(normInput, normCand);
    const sim = 1 - dist / denom;
    if (best === null || sim > best.similarity) {
      best = { name: candidate, similarity: sim };
    }
  }
  if (best === null || best.similarity < threshold) return null;
  return best;
}
