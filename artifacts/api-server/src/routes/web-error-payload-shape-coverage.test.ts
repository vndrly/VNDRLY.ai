import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Lint-style coverage check that flags `res.status(...).json({ error: "..." })`
// payloads in the web-only API route files that would surface raw English
// to a Spanish web user (Task #596).
//
// Background: Task #591 added `web-error-code-i18n-coverage.test.ts`, which
// asserts that every dotted-namespace `code:` literal (e.g.
// `auth.invalid_credentials`) has a matching `errors.<code>` entry in the
// web EN/ES locale catalogs. That catches regressions in the new pipeline,
// but it does NOT catch the older pattern where a route still emits a bare
// `res.status(...).json({ error: "<English>" })` with no `code:` field at
// all — or with a legacy uppercase `code: "DUPLICATE_VENDOR_NAME"` that
// the web client cannot translate. Spanish users still see raw English in
// those cases.
//
// This test walks the same 12 web route files, finds every literal
// `res.status(...).json({...})` payload with a top-level `error:` field,
// and asserts the payload also has a top-level `code:` whose value is a
// dotted-namespace string literal (the only shape the i18n pipeline can
// translate). Anything else — a missing `code:`, a legacy uppercase
// `code:`, or a runtime-computed `code: someVar` — is an offender unless
// it is opted out with the `@allow-english-only-error` comment marker.
//
// The marker is intentional: dynamic codes (e.g. those funneled out of a
// transaction `Outcome` discriminated union) and a small number of legacy
// uppercase codes (DUPLICATE_VENDOR_NAME, EMAIL_TAKEN, DUPLICATE_PARTNER_NAME,
// PARTIAL_CONFLICT) cannot be statically verified and are tracked as the
// transition backlog. Migrating each one means swapping the bespoke
// English string for a namespaced `code:` literal and adding an
// `errors.<code>` entry to en.json + es.json. Once a site is migrated,
// remove its `@allow-english-only-error` comment so future regressions are
// caught.

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const SCANNED_ROUTES = [
  "artifacts/api-server/src/routes/auth.ts",
  "artifacts/api-server/src/routes/vendors.ts",
  "artifacts/api-server/src/routes/partners.ts",
  "artifacts/api-server/src/routes/invoices.ts",
  "artifacts/api-server/src/routes/reports.ts",
  "artifacts/api-server/src/routes/employeeCertifications.ts",
  "artifacts/api-server/src/routes/vendorRatings.ts",
  "artifacts/api-server/src/routes/accountingConnections.ts",
  "artifacts/api-server/src/routes/assistant.ts",
  "artifacts/api-server/src/routes/onboarding.ts",
  "artifacts/api-server/src/routes/orgMembers.ts",
  "artifacts/api-server/src/routes/accountManagement.ts",
];

const ALLOW_MARKER = "@allow-english-only-error";

// Mirrors the regex from `web-error-code-i18n-coverage.test.ts`: a
// dotted-namespace, lowercase snake_case identifier such as
// `auth.invalid_credentials` or `invoice.payment_already_voided`. Anything
// else (uppercase `EMAIL_TAKEN`, bare identifier `code`, runtime
// expression `result.code`) is treated as untranslatable.
const NAMESPACED_CODE_VALUE = /^"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"$/;

// ─────────────────────────────────────────────────────────────────────────
// Tiny TypeScript-aware tokenizer.
//
// We only need enough of a TS lexer to walk past strings, template
// literals, line/block comments, and balanced bracket pairs without being
// fooled by braces inside string contents. A full parser would pull in
// the TypeScript compiler as a devDep just for one lint test, so we keep
// this self-contained.
// ─────────────────────────────────────────────────────────────────────────

function tokenSkip(src: string, start: number): number {
  const ch = src[start];
  if (ch === "/" && src[start + 1] === "/") {
    let i = start + 2;
    while (i < src.length && src[i] !== "\n") i++;
    return i;
  }
  if (ch === "/" && src[start + 1] === "*") {
    let i = start + 2;
    while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
    return Math.min(i + 2, src.length);
  }
  if (ch === "'" || ch === '"') {
    let i = start + 1;
    while (i < src.length) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === ch) return i + 1;
      i++;
    }
    return src.length;
  }
  if (ch === "`") {
    let i = start + 1;
    while (i < src.length) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "`") return i + 1;
      if (src[i] === "$" && src[i + 1] === "{") {
        // Recurse into the ${ ... } expression so nested template
        // literals / strings / braces don't desync us.
        let depth = 1;
        let j = i + 2;
        while (j < src.length && depth > 0) {
          const next = tokenSkip(src, j);
          if (next > j + 1) {
            j = next;
            continue;
          }
          if (src[j] === "{") depth++;
          else if (src[j] === "}") depth--;
          j++;
        }
        i = j;
        continue;
      }
      i++;
    }
    return src.length;
  }
  return start + 1;
}

function findMatchingClose(
  src: string,
  openIdx: number,
  openCh: string,
  closeCh: string,
): number {
  let i = openIdx + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const next = tokenSkip(src, i);
    if (next > i + 1) {
      i = next;
      continue;
    }
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Walk an object-literal body and record every top-level key with the
// trimmed source text of its value. Nested objects, arrays, function
// calls, and strings are stepped over so a `code:` buried inside a nested
// `{...}` doesn't masquerade as a top-level field of the outer payload.
function scanTopLevelKeys(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length) {
      const c = body[i];
      if (c === "," || /\s/.test(c)) {
        i++;
        continue;
      }
      if (c === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) {
        i = tokenSkip(body, i);
        continue;
      }
      break;
    }
    if (i >= body.length) break;
    if (body.slice(i, i + 3) === "...") {
      i += 3;
      i = scanValue(body, i);
      continue;
    }
    let key: string | null = null;
    if (body[i] === '"' || body[i] === "'") {
      const start = i;
      const end = tokenSkip(body, i);
      key = body.slice(start + 1, end - 1);
      i = end;
    } else if (body[i] === "[") {
      const end = findMatchingClose(body, i, "[", "]");
      if (end < 0) break;
      i = end + 1;
    } else if (/[A-Za-z_$]/.test(body[i])) {
      const start = i;
      while (i < body.length && /[\w$]/.test(body[i])) i++;
      key = body.slice(start, i);
    } else {
      i++;
      continue;
    }
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length || body[i] === ",") {
      // Shorthand property: { error } is equivalent to { error: error }.
      if (key) out.set(key, key);
      continue;
    }
    if (body[i] === "(") {
      // Method shorthand `name(...) { ... }` — skip both the parens and
      // any following block. Not used in payload literals, but cheap to
      // be defensive.
      const close = findMatchingClose(body, i, "(", ")");
      i = close + 1;
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] === "{") {
        const bc = findMatchingClose(body, i, "{", "}");
        i = bc + 1;
      }
      continue;
    }
    if (body[i] !== ":") {
      i++;
      continue;
    }
    i++;
    while (i < body.length && /\s/.test(body[i])) i++;
    const valueStart = i;
    i = scanValue(body, i);
    const valueText = body.slice(valueStart, i).trim();
    if (key) out.set(key, valueText);
  }
  return out;
}

function scanValue(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === "," || c === "}" || c === ")" || c === "]") return i;
    if (c === "(" || c === "[" || c === "{") {
      const cl = c === "(" ? ")" : c === "[" ? "]" : "}";
      const close = findMatchingClose(s, i, c, cl);
      if (close < 0) return s.length;
      i = close + 1;
      continue;
    }
    const next = tokenSkip(s, i);
    if (next > i + 1) {
      i = next;
      continue;
    }
    i++;
  }
  return i;
}

function lineOf(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

function lineRange(src: string, startIdx: number, endIdx: number): string {
  // Walk back from the call site through any contiguous comment-only
  // lines so a multi-line `// @allow-english-only-error` justification
  // block on the lines above still opts the site out. This mirrors how
  // `eslint-disable-next-line` works and keeps the marker readable when
  // the explanation needs more than one line of prose.
  let lineStart = startIdx;
  while (lineStart > 0 && src[lineStart - 1] !== "\n") lineStart--;
  let cursor = lineStart;
  while (cursor > 0) {
    let prevLineStart = cursor - 1;
    while (prevLineStart > 0 && src[prevLineStart - 1] !== "\n") {
      prevLineStart--;
    }
    const prevLine = src.slice(prevLineStart, cursor - 1).trim();
    if (prevLine.startsWith("//") || prevLine.startsWith("*") || prevLine === "") {
      cursor = prevLineStart;
      continue;
    }
    break;
  }
  return src.slice(cursor, endIdx);
}

interface CallSite {
  file: string;
  line: number;
  reason: string;
}

function findOffenders(file: string): CallSite[] {
  const src = readFileSync(join(REPO_ROOT, file), "utf-8");
  const offenders: CallSite[] = [];
  const re = /\bres\.status\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const statusOpen = m.index + m[0].length - 1;
    const statusClose = findMatchingClose(src, statusOpen, "(", ")");
    if (statusClose < 0) continue;
    let i = statusClose + 1;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.slice(i, i + 6) !== ".json(") continue;
    const jsonOpen = i + 5;
    const jsonClose = findMatchingClose(src, jsonOpen, "(", ")");
    if (jsonClose < 0) continue;
    const arg = src.slice(jsonOpen + 1, jsonClose);
    // Walk past whitespace / comments to the start of the payload. If the
    // argument isn't a literal object (e.g. `res.json(payload)`), there's
    // nothing for this lint to inspect statically — skip.
    let k = 0;
    while (k < arg.length) {
      if (/\s/.test(arg[k])) {
        k++;
        continue;
      }
      if (arg[k] === "/" && (arg[k + 1] === "/" || arg[k + 1] === "*")) {
        k = tokenSkip(arg, k);
        continue;
      }
      break;
    }
    if (arg[k] !== "{") continue;
    const objClose = findMatchingClose(arg, k, "{", "}");
    if (objClose < 0) continue;
    const body = arg.slice(k + 1, objClose);
    const fields = scanTopLevelKeys(body);
    if (!fields.has("error")) continue;
    const codeValue = fields.get("code");
    const namespaced =
      codeValue != null && NAMESPACED_CODE_VALUE.test(codeValue);
    if (namespaced) continue;
    // Allow opt-out via `// @allow-english-only-error` on the call's
    // own line, the line immediately above it, or anywhere inside the
    // payload object body.
    const surrounding = lineRange(src, m.index, jsonClose + 1);
    if (surrounding.includes(ALLOW_MARKER)) continue;
    const reason =
      codeValue == null
        ? "missing `code:` field"
        : `non-namespaced \`code: ${codeValue}\``;
    offenders.push({
      file,
      line: lineOf(src, m.index),
      reason,
    });
  }
  return offenders;
}

describe("Web API res.status(...).json(...) payload shape → web i18n coverage", () => {
  const allOffenders: CallSite[] = [];
  for (const route of SCANNED_ROUTES) {
    allOffenders.push(...findOffenders(route));
  }

  it("scans at least one res.status(...).json(...) call site (sanity check)", () => {
    // Just make sure the lexer didn't silently break and skip every file.
    // We expect hundreds of call sites across the 12 web routes; pin the
    // floor well below that so meaningful regressions trip the check.
    let total = 0;
    for (const route of SCANNED_ROUTES) {
      const src = readFileSync(join(REPO_ROOT, route), "utf-8");
      total += (src.match(/\bres\.status\(/g) ?? []).length;
    }
    expect(total).toBeGreaterThan(100);
  });

  it("every `error:` payload has a translatable namespaced `code:` (or an @allow-english-only-error marker)", () => {
    allOffenders.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    });
    expect(
      allOffenders,
      "The following res.status(...).json({...}) call sites surface a raw\n" +
        "English `error:` string with no translatable `code:` field, so a\n" +
        "Spanish web user sees English. Migrate each one to the dotted-\n" +
        "namespace pattern (e.g. `code: \"vendor.duplicate_name\"`) and add\n" +
        "the matching `errors.<code>` entry to BOTH\n" +
        "  artifacts/vndrly/src/lib/locales/en.json\n" +
        "  artifacts/vndrly/src/lib/locales/es.json\n" +
        "If the code is computed at runtime (e.g. `code: result.code`) and\n" +
        "you can confirm every branch already produces a namespaced literal,\n" +
        "add a `// " +
        ALLOW_MARKER +
        "` comment on the same line\n" +
        "(or the line above) to opt the call site out.\n\n" +
        "Offenders:\n" +
        allOffenders
          .map((o) => `  - ${o.file}:${o.line}  (${o.reason})`)
          .join("\n"),
    ).toEqual([]);
  });
});
