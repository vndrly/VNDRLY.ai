import { describe, expect, it } from "vitest";

import en from "./en.json";
import es from "./es.json";

// ---------------------------------------------------------------------------
// Task #627: interpolation placeholder parity between en.json and es.json.
//
// The existing leaf-key parity tests in this directory (`parity.test.ts`,
// etc.) confirm every English key has a non-empty Spanish counterpart, but
// they look only at the *presence* of a string — not at what's inside it.
// That leaves a silent failure mode: an English string like
// "Ticket assigned to {{name}}" can ship with a Spanish translation of
// "Ticket asignado a" (placeholder dropped) or "Ticket asignado a {{nombre}}"
// (placeholder renamed). i18next would render the literal text "Ticket
// asignado a " or "Ticket asignado a {{nombre}}" to Spanish-speaking field
// employees at runtime, while every parity assertion still passes.
//
// This test extracts the multiset of `{{placeholder}}` tokens from each
// English value and asserts the Spanish translation contains exactly the
// same set. Pluralised keys (`foo_one`, `foo_other`) are checked the same
// way as any other key — i18next pluralisation in this codebase always
// reuses the same `{{count}}` placeholder, so the equality check holds.
//
// We intentionally only support the i18next double-brace syntax
// (`{{name}}`); a scan of both locale files at the time this test was
// added showed zero usage of the alternative single-brace `{name}` form.
// If single-brace usage is ever introduced, extend `extractPlaceholders`
// to recognise it.
// ---------------------------------------------------------------------------

type LocaleNode = string | number | boolean | null | { [key: string]: LocaleNode };

function isPlainObject(value: unknown): value is Record<string, LocaleNode> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function collectLeaves(
  node: LocaleNode,
  prefix = "",
  out: Map<string, string> = new Map(),
): Map<string, string> {
  if (isPlainObject(node)) {
    for (const [key, child] of Object.entries(node)) {
      const next = prefix === "" ? key : `${prefix}.${key}`;
      collectLeaves(child, next, out);
    }
  } else if (typeof node === "string") {
    out.set(prefix, node);
  }
  return out;
}

/**
 * Extract the set of i18next interpolation placeholder names from a
 * translation string. Matches `{{name}}`, `{{ name }}`, and the
 * formatter syntax `{{count, number}}` (returning just `count`).
 */
function extractPlaceholders(value: string): Set<string> {
  const out = new Set<string>();
  const re = /\{\{\s*([a-zA-Z_][\w]*)\s*(?:,[^{}]*)?\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    out.add(match[1]);
  }
  return out;
}

function sortedList(set: Set<string>): string[] {
  return [...set].sort();
}

const enLeaves = collectLeaves(en as LocaleNode);
const esLeaves = collectLeaves(es as LocaleNode);

describe("locale placeholder parity (Task #627, mobile)", () => {
  it("every {{placeholder}} in en.json appears in the matching es.json value", () => {
    const offenders: string[] = [];
    for (const [key, enValue] of enLeaves) {
      const esValue = esLeaves.get(key);
      if (esValue === undefined) continue; // covered by leaf-key parity test
      const enPlaceholders = extractPlaceholders(enValue);
      const esPlaceholders = extractPlaceholders(esValue);
      const enList = sortedList(enPlaceholders);
      const esList = sortedList(esPlaceholders);
      if (enList.join(",") !== esList.join(",")) {
        offenders.push(
          `${key}: en uses {${enList.join(", ")}}, es uses {${esList.join(", ")}}\n` +
            `    en: ${JSON.stringify(enValue)}\n` +
            `    es: ${JSON.stringify(esValue)}`,
        );
      }
    }
    expect(
      offenders,
      "Spanish translations whose interpolation placeholders do not match " +
        "their English source. The Spanish copy must contain exactly the " +
        "same set of {{name}} tokens — dropping or renaming a placeholder " +
        "(e.g. {{name}} → {{nombre}}) leaves Spanish-speaking field " +
        "employees with a broken sentence at runtime:\n" +
        offenders.map((line) => `  - ${line}`).join("\n"),
    ).toEqual([]);
  });
});
