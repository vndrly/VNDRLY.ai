import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Lint-style coverage check for the structured `{ error: "<English>", code:
// "<dotted.code>" }` payloads emitted by the web-only API route files
// (Task #591).
//
// Background: Task #543 / Task #531 added a coverage test
// (`code-literal-mobile-i18n-coverage.test.ts`) for the routes that the
// MOBILE app consumes (ticketSchedule, crew). It walks those route files,
// extracts every `code: "..."` literal, and asserts a matching key exists
// in the mobile EN/ES catalogs.
//
// The web routes use the same `{ error: "<English>", code: "<dotted.code>" }`
// payload shape (consumed by the WEB app), but they were never under
// coverage. So adding a brand new endpoint that forgets `code:` — or adds a
// `code:` literal but no matching translation in `en.json` / `es.json` —
// would slip through unnoticed and Spanish users would see raw English.
//
// This test walks the 12 web route source files, extracts every `code: "..."`
// literal that follows the dotted-namespaced convention, and asserts that
// `errors.<code>` exists in BOTH the EN and ES web locale catalogs. If you
// add a new code, this test fails until you add the matching keys to BOTH
// locale files.
//
// Note: the regex intentionally requires a dot in the code (e.g.
// `auth.invalid_credentials`). The legacy uppercase codes that used to
// live here (`DUPLICATE_VENDOR_NAME`, `DUPLICATE_PARTNER_NAME`,
// `EMAIL_TAKEN`) were migrated to dotted-namespace equivalents
// (`vendor.duplicate_name`, `partner.duplicate_name`, `auth.email_taken`)
// in Task #597 so they are now picked up by this coverage check. The
// dot-required regex still guards against unrelated `code:` properties
// (HTTP status codes, county codes, OAuth flow codes, etc.).

// Directory layout: this test sits at
//   artifacts/api-server/src/routes/web-error-code-i18n-coverage.test.ts
// so four `..` segments take us out to the workspace root.
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

const LOCALE_FILES = [
  "artifacts/vndrly/src/lib/locales/en.json",
  "artifacts/vndrly/src/lib/locales/es.json",
];

// Match the `code: "dotted.snake_case"` literal used by the web routes.
// The dot separator is required so we don't accidentally pick up unrelated
// `code:` properties (e.g. HTTP status codes, county codes, OAuth flow
// codes, etc.).
const CODE_LITERAL = /\bcode:\s*"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"/g;

function extractCodes(filePath: string): Set<string> {
  const src = readFileSync(join(REPO_ROOT, filePath), "utf-8");
  const codes = new Set<string>();
  for (const match of src.matchAll(CODE_LITERAL)) {
    codes.add(match[1]);
  }
  return codes;
}

function loadLocale(filePath: string): Record<string, unknown> {
  const raw = readFileSync(join(REPO_ROOT, filePath), "utf-8");
  const parsed = JSON.parse(raw) as { errors?: Record<string, unknown> };
  return parsed.errors ?? {};
}

// Resolve a dotted path (e.g. "auth.invalid_credentials") against a nested
// object. Returns the leaf string if found, otherwise undefined. Mirrors
// how i18next resolves nested keys at runtime.
function lookupNested(
  errors: Record<string, unknown>,
  dotted: string,
): string | undefined {
  const parts = dotted.split(".");
  let cur: unknown = errors;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" && cur.length > 0 ? cur : undefined;
}

describe("Web API code literal → web i18n coverage", () => {
  const allCodes = new Set<string>();
  for (const route of SCANNED_ROUTES) {
    for (const code of extractCodes(route)) allCodes.add(code);
  }

  it("scans at least one structured code literal (sanity check)", () => {
    // If this fails, either the regex broke or the routes have been moved.
    // Task #591 added ~400 `code:` fields across the 12 web route files,
    // yielding well over a hundred unique dotted codes; pin the floor at 50
    // so meaningful coverage loss trips the sanity check.
    expect(allCodes.size).toBeGreaterThan(50);
  });

  for (const localePath of LOCALE_FILES) {
    it(`every code: "..." has an errors.<code> entry in ${localePath}`, () => {
      const errors = loadLocale(localePath);
      const missing: string[] = [];
      for (const code of allCodes) {
        if (lookupNested(errors, code) == null) {
          missing.push(code);
        }
      }
      missing.sort();
      expect(
        missing,
        `Missing errors.<code> entries in ${localePath}:\n` +
          missing.map((c) => `  - ${c}`).join("\n") +
          "\n\nAdd a translation for each missing code to BOTH " +
          "artifacts/vndrly/src/lib/locales/en.json and es.json.",
      ).toEqual([]);
    });
  }
});
