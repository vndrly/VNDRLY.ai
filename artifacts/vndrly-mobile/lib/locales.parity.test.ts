import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import es from "./locales/es.json";

// ---------------------------------------------------------------------------
// Task #582: structural parity between en.json and es.json (mobile app).
//
// The Spanish-speaking field crew uses this app every day. New strings get
// added to `en.json` (the source-of-truth locale) all the time, and when the
// matching Spanish copy is forgotten, Spanish-speaking field employees
// silently see English text — or, in the worst case, the raw
// `tickets.foo.bar` translation key — instead of the localised copy.
//
// Task #570 added an equivalent guard for the office web app at
// `artifacts/vndrly/src/lib/locales.parity.test.ts`. This file is the mobile
// twin of that test: it walks every leaf key in both locale objects and
// asserts the same dotted path exists on the other side. It also catches
// shape mismatches (e.g. a path that is a string in one file but an object
// in the other), which would otherwise silently break i18next lookups.
//
// Existing focused tests in `./locales/` (parity.test.ts, etc.) already
// cover key-set equality, ordering, and non-empty values; this file adds
// the explicit shape-mismatch detection and the allow-list mechanism that
// the web-app version uses, so the two stay maintained in parallel.
//
// Genuinely-untranslated strings (brand names etc.) belong in the
// allow-list below — never silently skip them.
// ---------------------------------------------------------------------------

// Dotted leaf paths that are intentionally only present in one locale.
// Add an entry here only when the string truly should not be translated
// (e.g. a brand name) AND keep the comment explaining why.
const ALLOW_ONLY_IN_EN = new Set<string>([
  // (empty — every English leaf currently has a Spanish counterpart)
]);
const ALLOW_ONLY_IN_ES = new Set<string>([
  // (empty — every Spanish leaf currently has an English counterpart)
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

/**
 * Walk every key in the locale tree, returning a map of `dotted.path`
 * to the kind of node found there ("leaf" for translatable strings,
 * "object" for nested namespaces). Capturing both lets us detect shape
 * mismatches as well as missing keys.
 */
function collectPaths(
  node: LocaleNode,
  prefix = "",
  acc: Map<string, "leaf" | "object"> = new Map(),
): Map<string, "leaf" | "object"> {
  if (isPlainObject(node)) {
    if (prefix !== "") acc.set(prefix, "object");
    for (const [key, child] of Object.entries(node)) {
      const next = prefix === "" ? key : `${prefix}.${key}`;
      collectPaths(child, next, acc);
    }
  } else {
    acc.set(prefix, "leaf");
  }
  return acc;
}

const enPaths = collectPaths(en as LocaleNode);
const esPaths = collectPaths(es as LocaleNode);

function leafPaths(paths: Map<string, "leaf" | "object">): string[] {
  const out: string[] = [];
  for (const [path, kind] of paths) {
    if (kind === "leaf") out.push(path);
  }
  return out.sort();
}

const enLeaves = leafPaths(enPaths);
const esLeaves = leafPaths(esPaths);

describe("mobile locale parity (en.json ↔ es.json)", () => {
  it("includes at least one key in each locale (sanity check)", () => {
    expect(enLeaves.length).toBeGreaterThan(0);
    expect(esLeaves.length).toBeGreaterThan(0);
  });

  it("has no English leaf key missing from Spanish (excluding allow-list)", () => {
    const esLeafSet = new Set(esLeaves);
    const missing = enLeaves.filter(
      (path) => !esLeafSet.has(path) && !ALLOW_ONLY_IN_EN.has(path),
    );
    expect(
      missing,
      `es.json is missing ${missing.length} key(s) that exist in en.json:\n` +
        missing.map((p) => `  - ${p}`).join("\n") +
        "\n\nAdd the Spanish copy to es.json, or — only if the string truly " +
        "must not be translated (e.g. a brand name) — add the path to " +
        "ALLOW_ONLY_IN_EN with a comment explaining why.",
    ).toEqual([]);
  });

  it("has no Spanish leaf key missing from English (excluding allow-list)", () => {
    const enLeafSet = new Set(enLeaves);
    const extra = esLeaves.filter(
      (path) => !enLeafSet.has(path) && !ALLOW_ONLY_IN_ES.has(path),
    );
    expect(
      extra,
      `es.json defines ${extra.length} key(s) that no longer exist in en.json:\n` +
        extra.map((p) => `  - ${p}`).join("\n") +
        "\n\nRemove the orphaned Spanish key, restore the matching English " +
        "key, or — if it must legitimately remain Spanish-only — add the " +
        "path to ALLOW_ONLY_IN_ES with a comment explaining why.",
    ).toEqual([]);
  });

  it("has matching node shapes (no path is a string in one locale and an object in the other)", () => {
    const mismatches: Array<{ path: string; en: string; es: string }> = [];
    for (const [path, kind] of enPaths) {
      const other = esPaths.get(path);
      if (other !== undefined && other !== kind) {
        mismatches.push({ path, en: kind, es: other });
      }
    }
    expect(
      mismatches,
      "Locale shape mismatch — the same dotted path resolves to different " +
        "node kinds in en.json vs es.json. i18next lookups will silently " +
        "fail for these keys:\n" +
        mismatches
          .map((m) => `  - ${m.path} (en: ${m.en}, es: ${m.es})`)
          .join("\n"),
    ).toEqual([]);
  });

  it("does not allow-list any path that is actually present in both locales", () => {
    // Catch stale allow-list entries — once a missing key gets filled in
    // we want the allow-list cleaned up so it keeps acting as a tripwire.
    const enLeafSet = new Set(enLeaves);
    const esLeafSet = new Set(esLeaves);
    const staleEn = [...ALLOW_ONLY_IN_EN].filter((p) => esLeafSet.has(p));
    const staleEs = [...ALLOW_ONLY_IN_ES].filter((p) => enLeafSet.has(p));
    expect(
      staleEn,
      `Remove these paths from ALLOW_ONLY_IN_EN — they now exist in es.json: ${staleEn.join(", ")}`,
    ).toEqual([]);
    expect(
      staleEs,
      `Remove these paths from ALLOW_ONLY_IN_ES — they now exist in en.json: ${staleEs.join(", ")}`,
    ).toEqual([]);
  });
});
