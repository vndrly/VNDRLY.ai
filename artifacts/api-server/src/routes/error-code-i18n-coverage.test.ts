import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Lint-style coverage check for the structured `{ error: <snake_case_code> }`
// payloads emitted by the ticket routes (Tasks #509 / #517 / #527).
//
// If you add a new `res.status(...).json({ error: "..." })` to either of
// the scanned route files, this test will fail until you add a matching
// `errors.<code>` entry to all four locale catalogs. That keeps inline UI
// from silently regressing to a generic toast when the EN/ES copy drift
// out of sync with the API. The full code → message catalog lives in
// `docs/api-error-codes.md`.

// Directory layout: this test sits at
//   artifacts/api-server/src/routes/error-code-i18n-coverage.test.ts
// so three `..` segments take us out to the workspace root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const SCANNED_ROUTES = [
  "artifacts/api-server/src/routes/tickets.ts",
  "artifacts/api-server/src/routes/ticketSchedule.ts",
  "artifacts/api-server/src/routes/locations.ts",
  "artifacts/api-server/src/routes/hotlist.ts",
  "artifacts/api-server/src/routes/field.ts",
];

const LOCALE_FILES = [
  "artifacts/vndrly/src/lib/locales/en.json",
  "artifacts/vndrly/src/lib/locales/es.json",
  "artifacts/vndrly-mobile/lib/locales/en.json",
  "artifacts/vndrly-mobile/lib/locales/es.json",
];

// Match the `error: "snake_case_code"` literal used by Task #527 routes.
// Intentionally narrower than CODE_SHAPE in apiErrors.ts: dot-notation
// codes (e.g. `auth.not_authenticated`) belong to the legacy `code:` field
// that already has nested locale keys.
const ERROR_LITERAL = /error:\s*"([a-z][a-z0-9_]*)"/g;

function extractCodes(filePath: string): Set<string> {
  const src = readFileSync(join(REPO_ROOT, filePath), "utf-8");
  const codes = new Set<string>();
  for (const match of src.matchAll(ERROR_LITERAL)) {
    codes.add(match[1]);
  }
  return codes;
}

function loadLocale(filePath: string): Record<string, unknown> {
  const raw = readFileSync(join(REPO_ROOT, filePath), "utf-8");
  const parsed = JSON.parse(raw) as { errors?: Record<string, unknown> };
  return parsed.errors ?? {};
}

describe("API error code → i18n coverage", () => {
  const allCodes = new Set<string>();
  for (const route of SCANNED_ROUTES) {
    for (const code of extractCodes(route)) allCodes.add(code);
  }

  it("scans at least one structured error code (sanity check)", () => {
    // If this fails, either the regex broke or the routes have been moved.
    expect(allCodes.size).toBeGreaterThan(10);
  });

  for (const localePath of LOCALE_FILES) {
    it(`every code has an errors.<code> entry in ${localePath}`, () => {
      const errors = loadLocale(localePath);
      const missing: string[] = [];
      for (const code of allCodes) {
        const value = errors[code];
        if (typeof value !== "string" || value.length === 0) {
          missing.push(code);
        }
      }
      expect(
        missing,
        `Missing errors.<code> entries in ${localePath}:\n` +
          missing.map(c => `  - ${c}`).join("\n") +
          "\n\nAdd a translation for each missing code (and update " +
          "docs/api-error-codes.md).",
      ).toEqual([]);
    });
  }
});
