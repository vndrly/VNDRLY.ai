import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "./en.json";

// ---------------------------------------------------------------------------
// Task #618: orphaned translation key guard.
//
// Task #611 added global parity between `en.json` and `es.json`. While doing
// so we found `tickets.afeBilled` was defined in en.json but never used
// anywhere in the mobile app source — we had to invent a Spanish translation
// just to satisfy parity. To stop dead copy from accumulating again, this
// test walks every leaf key in en.json and asserts each one is referenced
// somewhere in the mobile app source (or, for `errors.*` codes, in the
// shared `artifacts/api-server/src` source — codes emitted by the API are
// translated at runtime via `t(`errors.${code}`)`).
//
// If you legitimately need to keep a key that this test flags (e.g. a copy
// you're about to wire up in a follow-up PR), add it to ALLOWED_ORPHANS
// below with a comment explaining why.
// ---------------------------------------------------------------------------

// Repo root resolved from this test file's location:
//   artifacts/vndrly-mobile/lib/locales/noOrphanedKeys.test.ts
// → 4 `..` segments take us out to the workspace root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

// Mobile app source roots scanned for `t("…")` references.
//
// Shared libs that own i18n keys consumed by the mobile app (e.g.
// `@workspace/ticket-status-meta`, which exposes the canonical
// `tickets.*` / `crewTracker.ack*` label keys to both web and
// mobile) are also scanned here — otherwise relocating a literal
// like `"tickets.draft"` from the mobile copy of the status map to
// the shared module would falsely trip the orphan guard.
const MOBILE_SRC_ROOTS = [
  "artifacts/vndrly-mobile/app",
  "artifacts/vndrly-mobile/components",
  "artifacts/vndrly-mobile/hooks",
  "artifacts/vndrly-mobile/lib",
  "artifacts/vndrly-mobile/server",
  "artifacts/vndrly-mobile/scripts",
  "lib/ticket-status-meta/src",
];

// Additional source scanned only to rescue `errors.*` keys whose codes are
// emitted by the API and resolved at runtime via `t(`errors.${code}`)`.
const API_SRC_ROOT = "artifacts/api-server/src";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

// Keys that are intentionally kept despite not appearing in source today.
// Add entries here only with a comment explaining why.
const ALLOWED_ORPHANS = new Set<string>([
  // (empty)
]);

type LocaleNode = string | number | boolean | null | { [key: string]: LocaleNode };

function isPlainObject(value: unknown): value is Record<string, LocaleNode> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function collectLeafKeys(
  node: LocaleNode,
  prefix = "",
  out: string[] = [],
): string[] {
  if (isPlainObject(node)) {
    for (const [key, child] of Object.entries(node)) {
      const next = prefix === "" ? key : `${prefix}.${key}`;
      collectLeafKeys(child, next, out);
    }
  } else {
    out.push(prefix);
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (
      name === "node_modules" ||
      name === "dist" ||
      name === "build" ||
      name.startsWith(".")
    ) {
      continue;
    }
    const fp = join(dir, name);
    let stat;
    try {
      stat = statSync(fp);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(fp, out);
    } else if (SOURCE_EXTENSIONS.some((e) => fp.endsWith(e))) {
      // Skip locale JSONs themselves (we don't import any here).
      out.push(fp);
    }
  }
  return out;
}

type DynamicPattern = { prefix: string; suffix: string };

interface References {
  staticKeys: Set<string>;
  dynamicPatterns: DynamicPattern[];
  rawText: string;
}

// Regex notes
// -----------
// `T_CALL_RE` matches `t(...)` and `i18n.t(...)` when the first argument is
// a string literal or template literal. Captures only the leading literal
// — additional arguments (interpolation values, options) are ignored.
//
// `TPL_LITERAL_RE` catches every backtick template literal in the file so
// we can pick up patterns like
//     const key = `crewMap.lifecycleState.${state}`;
// where the dotted key is built first and then passed to `t(...)`.
const T_CALL_RE =
  /\b(?:i18n\.)?t\s*\(\s*("([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`]*?)`)/g;
const TPL_LITERAL_RE = /`([^`]+)`/g;
// A dotted i18n-key-shaped prefix, e.g. `crewMap.lifecycleState.` or
// `errors.`. Used to filter template-literal prefixes so we don't treat
// every interpolated string in the codebase as a translation reference.
const KEY_PREFIX_SHAPE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*[._]$/;

function extractRefs(source: string, into: References): void {
  into.rawText += "\n" + source;

  let m: RegExpExecArray | null;
  while ((m = T_CALL_RE.exec(source)) !== null) {
    const dq = m[2];
    const sq = m[3];
    const tpl = m[4];
    if (dq !== undefined) {
      into.staticKeys.add(dq);
    } else if (sq !== undefined) {
      into.staticKeys.add(sq);
    } else if (tpl !== undefined) {
      if (tpl.includes("${")) {
        const parts = tpl.split(/\$\{[^}]*\}/);
        const prefix = parts[0];
        const suffix = parts[parts.length - 1];
        if (prefix || suffix) {
          into.dynamicPatterns.push({ prefix, suffix });
        }
      } else {
        into.staticKeys.add(tpl);
      }
    }
  }

  while ((m = TPL_LITERAL_RE.exec(source)) !== null) {
    const tpl = m[1];
    if (!tpl.includes("${") || !/[a-zA-Z]\.[a-zA-Z]/.test(tpl)) continue;
    const parts = tpl.split(/\$\{[^}]*\}/);
    const prefix = parts[0];
    const suffix = parts[parts.length - 1];
    if (prefix && KEY_PREFIX_SHAPE.test(prefix)) {
      into.dynamicPatterns.push({ prefix, suffix });
    }
  }
}

// i18next plural suffixes (modern + legacy). When `t("foo", { count })` is
// called, i18next looks up `foo_one`, `foo_other`, etc. so any plural form
// should be considered referenced if the base key is.
const PLURAL_SUFFIXES = [
  "_one",
  "_other",
  "_zero",
  "_two",
  "_few",
  "_many",
  "_plural",
];

function matchesDynamic(
  key: string,
  patterns: DynamicPattern[],
): boolean {
  for (const { prefix, suffix } of patterns) {
    if (prefix.length + suffix.length < 3) continue;
    const startsOk = prefix ? key.startsWith(prefix) : true;
    const endsOk = suffix ? key.endsWith(suffix) : true;
    if (startsOk && endsOk) return true;
  }
  return false;
}

function literalAppears(key: string, text: string): boolean {
  return (
    text.includes(`"${key}"`) ||
    text.includes(`'${key}'`) ||
    text.includes(`\`${key}\``)
  );
}

function isReferenced(
  key: string,
  refs: References,
  apiText: string,
): boolean {
  if (refs.staticKeys.has(key)) return true;
  for (const suf of PLURAL_SUFFIXES) {
    if (key.endsWith(suf)) {
      const base = key.slice(0, -suf.length);
      if (refs.staticKeys.has(base)) return true;
      if (matchesDynamic(base, refs.dynamicPatterns)) return true;
    }
  }
  if (matchesDynamic(key, refs.dynamicPatterns)) return true;
  if (literalAppears(key, refs.rawText)) return true;
  // `errors.<code>` keys may be referenced solely by codes the API emits.
  if (key.startsWith("errors.")) {
    const code = key.slice("errors.".length);
    if (literalAppears(code, apiText)) return true;
  }
  return false;
}

const refs: References = {
  staticKeys: new Set<string>(),
  dynamicPatterns: [],
  rawText: "",
};

for (const root of MOBILE_SRC_ROOTS) {
  for (const file of walk(join(REPO_ROOT, root))) {
    // Don't scan locale JSON or this test itself; the `.ts` filter already
    // skips JSON, and we exclude this file by content not by name (its only
    // string literals are doc references, not real `t(...)` calls in the app).
    extractRefs(readFileSync(file, "utf8"), refs);
  }
}

let apiText = "";
for (const file of walk(join(REPO_ROOT, API_SRC_ROOT))) {
  apiText += "\n" + readFileSync(file, "utf8");
}

const enLeafKeys = collectLeafKeys(en as LocaleNode);

describe("no orphaned translation keys (Task #618)", () => {
  it("en.json has a non-trivial number of leaf keys (sanity)", () => {
    expect(enLeafKeys.length).toBeGreaterThan(100);
  });

  it("every key in en.json is referenced somewhere in the mobile app", () => {
    const orphans: string[] = [];
    for (const key of enLeafKeys) {
      if (ALLOWED_ORPHANS.has(key)) continue;
      if (!isReferenced(key, refs, apiText)) orphans.push(key);
    }
    expect(
      orphans,
      "Orphaned translation keys (defined in en.json but never used):\n" +
        orphans.map((k) => `  - ${k}`).join("\n") +
        "\n\nRemove these keys from BOTH en.json and es.json, or add them " +
        "to ALLOWED_ORPHANS with a comment explaining why they must stay.",
    ).toEqual([]);
  });

  it("every entry in ALLOWED_ORPHANS is actually still in en.json", () => {
    // Stops the allow-list itself from rotting: if you delete a key, also
    // remove it from ALLOWED_ORPHANS.
    const stale: string[] = [];
    const enKeySet = new Set(enLeafKeys);
    for (const key of ALLOWED_ORPHANS) {
      if (!enKeySet.has(key)) stale.push(key);
    }
    expect(
      stale,
      `ALLOWED_ORPHANS entries that no longer exist in en.json: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
