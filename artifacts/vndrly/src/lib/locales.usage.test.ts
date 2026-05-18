import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import en from "./locales/en.json";

// ---------------------------------------------------------------------------
// Task #624: catch typos in translation keys used in the web app code.
//
// Task #570 (`locales.parity.test.ts`) guarantees that every key in
// `en.json` also exists in `es.json`, and Task #618
// (`locales.noOrphanedKeys.test.ts`) guarantees every key in `en.json` is
// referenced somewhere in the code. Neither test catches the inverse
// silent-drift problem: a `t("tickets.afeBiled")` call in a React
// component where the key is misspelled (note the missing "l") or has
// been removed from the locale files. i18next will just render the
// literal `tickets.afeBiled` path on screen.
//
// This test walks every source file under `artifacts/vndrly/src`,
// extracts literal i18n keys from `t(...)`, `i18n.t(...)`, and
// `<Trans i18nKey="..." />` calls, and asserts that each key resolves
// to a string in `en.json` (allowing for i18next plural suffixes such
// as `_one`/`_other`). Calls that pass an inline `defaultValue` —
// either via the positional overload `t(key, "Some Default")` or via
// `t(key, { defaultValue: "Some Default" })` — are NOT flagged: i18next
// renders the default instead of the literal key path, so a typo can't
// leak the bare `tickets.afeBiled` string to users. Dynamic keys
// (template literals containing `${...}`) are skipped because they
// cannot be statically resolved; sanity assertions below make sure the
// skip paths aren't silently swallowing the entire scan.
//
// Failure messages name the file, line, and missing key so the typo is
// easy to find. If you legitimately need to keep a key the regex
// extracted but the locales file does not (e.g. a runtime-only key
// resolved by external logic), add it to ALLOWED_MISSING below with a
// comment explaining why.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const WEB_SRC_ROOT = join(REPO_ROOT, "artifacts/vndrly/src");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

// Keys that the regex will extract but that we know aren't (and
// shouldn't be) in en.json. Add entries here only with a comment
// explaining why a static-looking key can legitimately be missing.
const ALLOWED_MISSING = new Set<string>([
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
  out: Set<string> = new Set(),
): Set<string> {
  if (isPlainObject(node)) {
    for (const [key, child] of Object.entries(node)) {
      const next = prefix === "" ? key : `${prefix}.${key}`;
      collectLeafKeys(child, next, out);
    }
  } else {
    out.add(prefix);
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
      // Skip the locale-checking tests themselves: their source contains
      // example `t("foo")` strings inside comments and regex literals
      // that would be misread as real i18n calls.
      if (/\blocales\.[a-zA-Z0-9_-]+\.test\.[tj]sx?$/.test(fp)) continue;
      out.push(fp);
    }
  }
  return out;
}

// i18next plural suffixes — `t("foo.bar", { count })` looks up
// `foo.bar_one` / `foo.bar_other` (or another CLDR category) at
// runtime, so a static call like `t("tickets.count")` is satisfied by
// `tickets.count_one` + `tickets.count_other` in en.json.
const PLURAL_SUFFIXES = [
  "_one",
  "_other",
  "_zero",
  "_two",
  "_few",
  "_many",
  "_plural",
];

interface Reference {
  key: string;
  file: string;
  line: number;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Find the index of the matching closing bracket for the opening
 * bracket at `source[start]`. Returns -1 if no match is found within
 * `limit` characters. Skips over string and template-literal contents
 * so braces inside strings don't confuse the scan.
 */
function findMatchingBracket(
  source: string,
  start: number,
  open: string,
  close: string,
  limit = 4096,
): number {
  let depth = 0;
  const end = Math.min(source.length, start + limit);
  let i = start;
  while (i < end) {
    const c = source[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < end && source[i] !== quote) {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      while (i < end && source[i] !== "`") {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          const inner = findMatchingBracket(source, i + 1, "{", "}", limit);
          if (inner === -1) return -1;
          i = inner + 1;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Skip whitespace and JS/TS line/block comments starting at `i`.
 * Returns the next non-whitespace, non-comment index.
 */
function skipWhitespace(source: string, i: number): number {
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i + 1 < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    return i;
  }
  return i;
}

/**
 * Parse a string literal starting at `source[start]` if it begins with
 * `"`, `'`, or `` ` ``. Returns `{ value, end }` where `end` is the
 * index just past the closing quote, or `null` for a template literal
 * that contains an interpolation (since the value isn't statically
 * resolvable). Returns `undefined` if the position isn't a string
 * literal at all.
 */
function readStringLiteral(
  source: string,
  start: number,
):
  | { value: string; end: number; dynamic: boolean }
  | undefined {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  let value = "";
  let i = start + 1;
  let dynamic = false;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      value += source[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === quote) {
      return { value, end: i + 1, dynamic };
    }
    if (quote === "`" && c === "$" && source[i + 1] === "{") {
      dynamic = true;
      const close = findMatchingBracket(source, i + 1, "{", "}");
      if (close === -1) return { value, end: source.length, dynamic };
      i = close + 1;
      continue;
    }
    value += c;
    i++;
  }
  return { value, end: source.length, dynamic };
}

interface Extracted {
  staticRefs: Reference[];
  dynamicCount: number;
  defaultValueCount: number;
}

// Locates `<thing>.t(` or bare `t(` (the destructured form returned by
// `useTranslation`) and `<Trans` openings. Anchored with `\b` so we
// don't pick up `myInputDoesNotExist(` etc.
const T_OPEN_RE = /\b(?:[a-zA-Z_$][\w$]*\.)?t\s*\(/g;
const TRANS_OPEN_RE = /<Trans\b/g;

function extractFromFile(file: string, source: string): Extracted {
  const out: Extracted = { staticRefs: [], dynamicCount: 0, defaultValueCount: 0 };

  // -- t(...) and i18n.t(...) -------------------------------------------
  T_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = T_OPEN_RE.exec(source)) !== null) {
    // m.index is the start of the identifier. m[0] ends at "(", so the
    // first argument starts at m.index + m[0].length.
    const callStart = m.index + m[0].length;
    let i = skipWhitespace(source, callStart);
    const lit = readStringLiteral(source, i);
    if (!lit) continue;
    if (lit.dynamic) {
      out.dynamicCount++;
      continue;
    }
    i = skipWhitespace(source, lit.end);
    let hasDefaultValue = false;
    if (source[i] === ",") {
      i = skipWhitespace(source, i + 1);
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        // Positional default value overload: t(key, "Some Default").
        hasDefaultValue = true;
      } else if (ch === "{") {
        const close = findMatchingBracket(source, i, "{", "}");
        if (close !== -1) {
          const opts = source.slice(i, close + 1);
          if (/\bdefaultValue\s*:/.test(opts)) hasDefaultValue = true;
        }
      }
    }
    if (hasDefaultValue) {
      out.defaultValueCount++;
      continue;
    }
    out.staticRefs.push({
      key: lit.value,
      file,
      line: lineOf(source, m.index),
    });
  }

  // -- <Trans i18nKey="..." /> ------------------------------------------
  TRANS_OPEN_RE.lastIndex = 0;
  while ((m = TRANS_OPEN_RE.exec(source)) !== null) {
    const tagStart = m.index;
    // Find the end of the opening tag — the first `>` or `/>` outside
    // any nested braces. Scan up to a generous limit so multi-line
    // <Trans …> tags still work.
    let i = m.index + m[0].length;
    const limit = Math.min(source.length, i + 4096);
    let inBraces = 0;
    let tagEnd = -1;
    while (i < limit) {
      const c = source[i];
      if (c === "{") {
        inBraces++;
      } else if (c === "}") {
        inBraces--;
      } else if (c === ">" && inBraces === 0) {
        tagEnd = i;
        break;
      }
      i++;
    }
    if (tagEnd === -1) continue;
    const tag = source.slice(tagStart, tagEnd);
    const keyMatch = /\bi18nKey\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`]*)`\s*\})/.exec(
      tag,
    );
    if (!keyMatch) continue;
    const dynamicTpl = keyMatch[5];
    const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3] ?? keyMatch[4] ?? dynamicTpl;
    if (key === undefined) continue;
    if (dynamicTpl !== undefined && dynamicTpl.includes("${")) {
      out.dynamicCount++;
      continue;
    }
    out.staticRefs.push({
      key,
      file,
      line: lineOf(source, tagStart),
    });
  }

  return out;
}

function looksLikeI18nKey(key: string): boolean {
  // Anything we'd reasonably expect to resolve through i18next: a
  // dotted path or a single identifier. Skip arbitrary strings (URLs,
  // CSS selectors, format placeholders) that happened to be passed to
  // a function literally named `t`.
  if (key.length === 0) return false;
  return /^[a-zA-Z][\w-]*(\.[\w-]+)*$/.test(key);
}

const enLeaves = collectLeafKeys(en as LocaleNode);

function isKnownKey(key: string): boolean {
  if (enLeaves.has(key)) return true;
  for (const suf of PLURAL_SUFFIXES) {
    if (enLeaves.has(`${key}${suf}`)) return true;
  }
  return false;
}

const allFiles = walk(WEB_SRC_ROOT);
const allStaticRefs: Reference[] = [];
let totalDynamic = 0;
let totalDefaultValue = 0;
let totalSkippedNonKey = 0;

for (const file of allFiles) {
  const source = readFileSync(file, "utf8");
  const extracted = extractFromFile(file, source);
  totalDynamic += extracted.dynamicCount;
  totalDefaultValue += extracted.defaultValueCount;
  for (const ref of extracted.staticRefs) {
    if (!looksLikeI18nKey(ref.key)) {
      totalSkippedNonKey++;
      continue;
    }
    allStaticRefs.push(ref);
  }
}

describe("translation key usage (Task #624)", () => {
  it("scans a non-trivial number of source files (sanity check)", () => {
    expect(allFiles.length).toBeGreaterThan(50);
  });

  it("extracts a non-trivial number of static i18n key references (sanity check)", () => {
    // Guards against the regexes silently breaking — if this drops to
    // zero, the assertion below would pass vacuously and miss every
    // typo. The current codebase has well over 1000 t() calls, so a
    // floor of 500 is generous but still catches a regression.
    expect(allStaticRefs.length).toBeGreaterThan(500);
  });

  it("sees at least some dynamic keys (sanity check on the skip path)", () => {
    // The codebase uses template-literal keys in a handful of places
    // (e.g. `t(\`crewMap.lifecycleState.${state}\`)`). If the dynamic
    // counter ever hits zero it's almost certainly because the
    // template-literal regex has broken, not because every dynamic key
    // was rewritten to a literal.
    expect(totalDynamic).toBeGreaterThan(0);
  });

  it("sees at least some defaultValue calls (sanity check on the skip path)", () => {
    // The codebase uses `t(key, "Default")` and `t(key, { defaultValue:
    // "..." })` deliberately as a way to ship inline English copy that
    // a translator can later promote into the locale files. If this
    // counter hits zero it almost certainly means the defaultValue
    // detection has broken — and we'd start spuriously flagging every
    // such call as a missing-key bug.
    expect(totalDefaultValue).toBeGreaterThan(0);
  });

  it("every static i18n key referenced in source exists in en.json", () => {
    const missing: Reference[] = [];
    for (const ref of allStaticRefs) {
      if (ALLOWED_MISSING.has(ref.key)) continue;
      if (!isKnownKey(ref.key)) missing.push(ref);
    }

    const grouped = new Map<string, Reference[]>();
    for (const ref of missing) {
      const list = grouped.get(ref.key) ?? [];
      list.push(ref);
      grouped.set(ref.key, list);
    }

    const summary = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, refs]) => {
        const locations = refs
          .map((r) => `      ${relative(REPO_ROOT, r.file)}:${r.line}`)
          .join("\n");
        return `  - ${key}\n${locations}`;
      })
      .join("\n");

    expect(
      missing,
      `Found ${missing.length} i18n key reference(s) that do not exist in en.json:\n` +
        summary +
        "\n\nFix the typo in the source, add the missing key to en.json " +
        "(and es.json, per the parity test), supply an inline " +
        '`defaultValue` (`t(key, "...")` or `t(key, { defaultValue: ' +
        '"..." })`) so users never see the literal key path, or — only ' +
        "if the key is intentionally resolved at runtime through some " +
        "other mechanism — add it to ALLOWED_MISSING with a comment " +
        "explaining why.",
    ).toEqual([]);
  });

  it("every entry in ALLOWED_MISSING is still referenced and still missing", () => {
    // Stops the allow-list from rotting. If a key gets added to
    // en.json, or its last usage gets deleted, the corresponding
    // ALLOWED_MISSING entry should be cleaned up so the list keeps
    // acting as a tripwire.
    const referenced = new Set(allStaticRefs.map((r) => r.key));
    const stale: string[] = [];
    for (const key of ALLOWED_MISSING) {
      if (!referenced.has(key) || isKnownKey(key)) stale.push(key);
    }
    expect(
      stale,
      `Remove these stale entries from ALLOWED_MISSING: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("does not silently drop every extracted key as 'not key-shaped'", () => {
    // If the entire extraction stream gets discarded by the
    // `looksLikeI18nKey` filter — e.g. because someone tightened the
    // shape regex too far — the missing-key assertion above would
    // pass vacuously. This guards the filter itself.
    expect(allStaticRefs.length).toBeGreaterThan(totalSkippedNonKey);
  });
});
