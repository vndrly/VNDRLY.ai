import { describe, expect, it } from "vitest";

import en from "./en.json";
import es from "./es.json";

// ---------------------------------------------------------------------------
// Global locale parity (Task #611)
//
// Task #602 added a focused parity test for the awaiting-payment screens, and
// Task #531 added one for `errors.*` API codes. The same silent-drift risk
// exists for every other section of the locale files (`tickets.*`, `crew.*`,
// `schedule.*`, `hotlist.*`, `errors.*`, etc). A single new English key
// shipped without a Spanish translation would silently surface English copy
// — or the raw key — to Spanish-speaking field employees on screens we
// haven't yet hardened.
//
// This test walks both `en.json` and `es.json` recursively and asserts the
// full set of leaf key paths is identical, and that every value is a
// non-empty string. Failure messages quote the exact key path
// (e.g. `tickets.afeBilled`) so the missing/extra translation is obvious.
// ---------------------------------------------------------------------------

type LocaleNode = string | { [key: string]: LocaleNode };
type LocaleObject = { [key: string]: LocaleNode };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Walk a locale JSON tree and return every leaf key path along with its
 * value. A "leaf" is anything that is not a plain object — i.e. the actual
 * translation string. Paths use dot notation (`tickets.awaitingPaymentTitle`).
 */
function collectLeaves(
  node: unknown,
  prefix = "",
  out: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      collectLeaves(value, path, out);
    }
  } else {
    out.set(prefix, node);
  }
  return out;
}

const enLeaves = collectLeaves(en as LocaleObject);
const esLeaves = collectLeaves(es as LocaleObject);

describe("global locale parity (Task #611)", () => {
  it("en.json contains a non-trivial number of translation keys (sanity)", () => {
    // Guards against a refactor that accidentally empties the file and
    // makes every parity assertion below vacuously pass.
    expect(enLeaves.size).toBeGreaterThan(100);
  });

  it("every leaf key in en.json exists in es.json", () => {
    const missing: string[] = [];
    for (const key of enLeaves.keys()) {
      if (!esLeaves.has(key)) missing.push(key);
    }
    expect(
      missing,
      `Missing Spanish translations for keys: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every leaf key in es.json exists in en.json", () => {
    const extra: string[] = [];
    for (const key of esLeaves.keys()) {
      if (!enLeaves.has(key)) extra.push(key);
    }
    expect(
      extra,
      `Spanish-only keys (no English counterpart): ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("the full sorted set of leaf keys matches between en.json and es.json", () => {
    // Belt-and-suspenders: a single readable diff if anything drifts.
    expect([...esLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("leaf keys appear in the same order in en.json and es.json (Task #637)", () => {
    // The set-equality checks above tolerate keys appearing in different
    // positions across the two files. That makes side-by-side review of
    // locale PRs painful: a translator can add `tickets.foo` at the top
    // of the English block and the matching Spanish copy at the bottom,
    // and every other assertion still passes. Asserting matching key
    // order keeps en.json and es.json visually aligned so a reviewer can
    // diff them line-by-line.
    expect([...esLeaves.keys()]).toEqual([...enLeaves.keys()]);
  });

  it("every translation value in en.json is a non-empty string", () => {
    const offenders: string[] = [];
    for (const [key, value] of enLeaves) {
      if (typeof value !== "string" || value.length === 0) {
        offenders.push(`${key} (got ${JSON.stringify(value)})`);
      }
    }
    expect(
      offenders,
      `en.json values that are not non-empty strings: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("every translation value in es.json is a non-empty string", () => {
    const offenders: string[] = [];
    for (const [key, value] of esLeaves) {
      if (typeof value !== "string" || value.length === 0) {
        offenders.push(`${key} (got ${JSON.stringify(value)})`);
      }
    }
    expect(
      offenders,
      `es.json values that are not non-empty strings: ${offenders.join("; ")}`,
    ).toEqual([]);
  });
});
