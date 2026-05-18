import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import es from "./locales/es.json";

// ---------------------------------------------------------------------------
// Task #570: structural parity between en.json and es.json.
//
// New strings get added to `en.json` (the source-of-truth locale) all the
// time. When the matching Spanish copy is forgotten, Spanish-speaking
// dispatchers using the office web app silently see English text — or, in
// the worst case, the raw `errors.foo.bar` translation key — instead of
// the localised copy. Task #553 only locked in coverage for the Task #531
// error codes, so a regression elsewhere in the file would slip through.
//
// This test walks every leaf key in both locale objects and asserts the
// same dotted path exists on the other side. It also catches shape
// mismatches (e.g. a path that is a string in one file but an object in
// the other), which would otherwise silently break i18next lookups.
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

function leafPathsInOrder(paths: Map<string, "leaf" | "object">): string[] {
  // Map preserves insertion order, which mirrors the order keys appear
  // in the source JSON file. Used by the order-parity assertion below.
  const out: string[] = [];
  for (const [path, kind] of paths) {
    if (kind === "leaf") out.push(path);
  }
  return out;
}

const enLeaves = leafPaths(enPaths);
const esLeaves = leafPaths(esPaths);
const enLeavesInOrder = leafPathsInOrder(enPaths);
const esLeavesInOrder = leafPathsInOrder(esPaths);

describe("locale parity (en.json ↔ es.json)", () => {
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

  it("leaf keys appear in the same order in en.json and es.json (Task #637)", () => {
    // The set-equality checks above tolerate keys appearing in different
    // positions across the two files. That makes side-by-side review of
    // locale PRs painful: a translator can add `tickets.foo` at the top
    // of the English block and the matching Spanish copy at the bottom,
    // and every other assertion still passes. Asserting matching key
    // order keeps en.json and es.json visually aligned so a reviewer can
    // diff them line-by-line.
    //
    // To fix a failure here, reorder one side so the dotted leaf paths
    // appear in the same sequence in both files (typically reorder
    // es.json to match en.json, the source-of-truth locale).
    expect(esLeavesInOrder).toEqual(enLeavesInOrder);
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

  it("every leaf value in both locales is a non-empty string (Task #612)", () => {
    // Catches a different drift mode from the missing-key checks above:
    // a translator stub like `"foo": ""` would still pass the parity
    // diff but render an empty string to Spanish-speaking dispatchers.
    function* iterateLeaves(
      paths: Map<string, "leaf" | "object">,
      locale: LocaleNode,
    ): Generator<{ path: string; value: unknown }> {
      for (const [path, kind] of paths) {
        if (kind !== "leaf") continue;
        let cursor: LocaleNode = locale;
        for (const segment of path.split(".")) {
          if (!isPlainObject(cursor)) {
            cursor = "" as LocaleNode;
            break;
          }
          cursor = cursor[segment] ?? ("" as LocaleNode);
        }
        yield { path, value: cursor };
      }
    }

    for (const { path, value } of iterateLeaves(enPaths, en as LocaleNode)) {
      expect(typeof value, `en.json ${path} must be a string`).toBe("string");
      expect(
        (value as string).length,
        `en.json ${path} must be non-empty`,
      ).toBeGreaterThan(0);
    }
    for (const { path, value } of iterateLeaves(esPaths, es as LocaleNode)) {
      expect(typeof value, `es.json ${path} must be a string`).toBe("string");
      expect(
        (value as string).length,
        `es.json ${path} must be non-empty`,
      ).toBeGreaterThan(0);
    }
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
