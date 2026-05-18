// ---------------------------------------------------------------------------
// Task #139: lint locale files for parity across en.json / es.json.
//
// VNDRLY ships hand-maintained `en.json` and `es.json` files for two
// artifacts:
//
//   - artifacts/vndrly-mobile/lib/locales (mobile app, ~514 keys)
//   - artifacts/vndrly/src/lib/locales    (office web app, ~644 keys)
//
// Vitest already enforces parity (see `parity.test.ts` /
// `locales.parity.test.ts`, etc.) but those checks are buried inside each
// artifact's full unit-test suite. This script gives CI — and a developer
// touching a locale file at the keyboard — a single fast command that
// reports any structural drift (missing keys, extra keys, empty values,
// shape mismatch) without spinning up a full test runner per artifact.
//
// Run with:
//   pnpm lint:i18n
//
// Exits non-zero on any mismatch so it can gate CI.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

interface ArtifactSpec {
  name: string;
  enPath: string;
  esPath: string;
}

const ARTIFACTS: ArtifactSpec[] = [
  {
    name: "vndrly-mobile",
    enPath: "artifacts/vndrly-mobile/lib/locales/en.json",
    esPath: "artifacts/vndrly-mobile/lib/locales/es.json",
  },
  {
    name: "vndrly (web)",
    enPath: "artifacts/vndrly/src/lib/locales/en.json",
    esPath: "artifacts/vndrly/src/lib/locales/es.json",
  },
];

type LocaleNode =
  | string
  | number
  | boolean
  | null
  | { [key: string]: LocaleNode };

function isPlainObject(value: unknown): value is Record<string, LocaleNode> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

type NodeKind = "leaf" | "object";

interface CollectedPath {
  kind: NodeKind;
  value: LocaleNode;
}

/**
 * Walk a locale JSON tree and return every dotted path along with whether it
 * is a leaf (translatable string) or a nested object. Capturing both lets us
 * detect shape mismatches in addition to missing/extra keys.
 *
 * Insertion order mirrors the source JSON so callers can use it for
 * order-sensitive reports if needed.
 */
function collectPaths(
  node: LocaleNode,
  prefix = "",
  out: Map<string, CollectedPath> = new Map(),
): Map<string, CollectedPath> {
  if (isPlainObject(node)) {
    if (prefix !== "") out.set(prefix, { kind: "object", value: node });
    for (const [key, child] of Object.entries(node)) {
      const next = prefix === "" ? key : `${prefix}.${key}`;
      collectPaths(child, next, out);
    }
  } else {
    out.set(prefix, { kind: "leaf", value: node });
  }
  return out;
}

interface ArtifactReport {
  name: string;
  enKeyCount: number;
  esKeyCount: number;
  missingInEs: string[];
  missingInEn: string[];
  shapeMismatches: Array<{ path: string; en: NodeKind; es: NodeKind }>;
  emptyEn: string[];
  emptyEs: string[];
}

function lintArtifact(spec: ArtifactSpec): ArtifactReport {
  const enAbs = join(REPO_ROOT, spec.enPath);
  const esAbs = join(REPO_ROOT, spec.esPath);

  const en = JSON.parse(readFileSync(enAbs, "utf8")) as LocaleNode;
  const es = JSON.parse(readFileSync(esAbs, "utf8")) as LocaleNode;

  const enPaths = collectPaths(en);
  const esPaths = collectPaths(es);

  const enLeaves = new Set<string>();
  const esLeaves = new Set<string>();
  for (const [p, info] of enPaths) if (info.kind === "leaf") enLeaves.add(p);
  for (const [p, info] of esPaths) if (info.kind === "leaf") esLeaves.add(p);

  const missingInEs: string[] = [];
  for (const key of enLeaves) if (!esLeaves.has(key)) missingInEs.push(key);

  const missingInEn: string[] = [];
  for (const key of esLeaves) if (!enLeaves.has(key)) missingInEn.push(key);

  const shapeMismatches: ArtifactReport["shapeMismatches"] = [];
  for (const [path, info] of enPaths) {
    const other = esPaths.get(path);
    if (other && other.kind !== info.kind) {
      shapeMismatches.push({ path, en: info.kind, es: other.kind });
    }
  }

  const emptyEn: string[] = [];
  for (const [path, info] of enPaths) {
    if (info.kind !== "leaf") continue;
    if (typeof info.value !== "string" || info.value.length === 0) {
      emptyEn.push(path);
    }
  }
  const emptyEs: string[] = [];
  for (const [path, info] of esPaths) {
    if (info.kind !== "leaf") continue;
    if (typeof info.value !== "string" || info.value.length === 0) {
      emptyEs.push(path);
    }
  }

  return {
    name: spec.name,
    enKeyCount: enLeaves.size,
    esKeyCount: esLeaves.size,
    missingInEs: missingInEs.sort(),
    missingInEn: missingInEn.sort(),
    shapeMismatches: shapeMismatches.sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
    emptyEn: emptyEn.sort(),
    emptyEs: emptyEs.sort(),
  };
}

function printReport(report: ArtifactReport): boolean {
  const header = `[${report.name}] en=${report.enKeyCount} keys, es=${report.esKeyCount} keys`;
  let ok = true;

  const sections: Array<{ title: string; items: string[] }> = [
    {
      title: "Missing Spanish translations (in en.json, not in es.json)",
      items: report.missingInEs,
    },
    {
      title: "Orphaned Spanish keys (in es.json, not in en.json)",
      items: report.missingInEn,
    },
    {
      title: "Empty values in en.json",
      items: report.emptyEn,
    },
    {
      title: "Empty values in es.json",
      items: report.emptyEs,
    },
  ];

  const shapeStrings = report.shapeMismatches.map(
    (m) => `${m.path} (en: ${m.en}, es: ${m.es})`,
  );
  sections.push({
    title:
      "Shape mismatches (same path is a string in one locale, an object in the other)",
    items: shapeStrings,
  });

  const totalProblems = sections.reduce((sum, s) => sum + s.items.length, 0);
  if (totalProblems === 0) {
    console.log(`${header} — OK`);
    return true;
  }

  console.error(`${header} — ${totalProblems} problem(s):`);
  for (const section of sections) {
    if (section.items.length === 0) continue;
    ok = false;
    console.error(`  ${section.title} (${section.items.length}):`);
    for (const item of section.items) {
      console.error(`    - ${item}`);
    }
  }
  return ok;
}

function main(): void {
  let allOk = true;
  for (const spec of ARTIFACTS) {
    const report = lintArtifact(spec);
    const ok = printReport(report);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.error(
      "\nlint:i18n failed. Fix the listed keys (add the missing " +
        "translation, remove the orphan, or correct the shape) and re-run " +
        "`pnpm lint:i18n`.",
    );
    process.exit(1);
  }

  console.log("\nlint:i18n passed: en.json ↔ es.json are in parity for every artifact.");
}

main();
