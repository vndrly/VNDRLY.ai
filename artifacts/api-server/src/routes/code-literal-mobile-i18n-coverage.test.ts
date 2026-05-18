import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Lint-style coverage check for the structured `{ code: "<dotted.code>" }`
// payloads emitted by *every* server route file (Task #566 widened from
// Task #531's narrow ticketSchedule + crew scan).
//
// Task #543 added a mobile-side test that asserts each Task #531 code
// translates to Spanish on the mobile app. That guards the *mobile* side:
// if someone removes a Spanish key, the test fails. But it does NOT catch
// drift in the other direction — when the server adds a *new* `code: "..."`
// literal in *any* route (not just the schedule and crew routes Task #531
// originally wired up) and nobody adds the matching translation to en.json
// or es.json, a Spanish field employee would silently see the English
// fallback.
//
// This test walks every non-test `*.ts` file under
// `artifacts/api-server/src/routes/` (Task #566 widened from the original
// schedule + crew scan), extracts every `code: "..."` literal, and asserts
// that `errors.<code>` exists in both the EN and ES locale catalogs for
// BOTH the field-employee mobile app AND the office web app (Task #567).
// The schedule/crew routes are also called from the office web app — for
// example when a dispatcher edits a schedule or when office staff manage
// crew rosters — and the rest of the route layer is also reachable from
// either client, so the same drift hazard applies on both sides. If you
// add a new code anywhere in the route layer this test fails until you
// add the matching keys to ALL FOUR locale files. Add a translation even
// for codes that look "admin only" — defense in depth, in case either
// client ever surfaces them through an unexpected flow (e.g. a shared
// hook reused on a future screen). When the new code is also part of the
// schedule or crew-tracker mobile flows, additionally update the
// TASK_531_CODES list in `apiErrors.test.ts` so the runtime translation
// behaviour is also covered.

// Directory layout: this test sits at
//   artifacts/api-server/src/routes/code-literal-mobile-i18n-coverage.test.ts
// so four `..` segments take us out to the workspace root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const ROUTES_DIR = "artifacts/api-server/src/routes";

// Discover every non-test route file at test time. Using fs.readdirSync
// (rather than a hard-coded list) means a newly-added route file is
// automatically scanned without having to remember to register it here —
// closing the gap that motivated Task #566.
function discoverRouteFiles(): string[] {
  const entries = readdirSync(join(REPO_ROOT, ROUTES_DIR));
  return entries
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort()
    .map((name) => `${ROUTES_DIR}/${name}`);
}

const SCANNED_ROUTES = discoverRouteFiles();

const LOCALE_FILES = [
  "artifacts/vndrly-mobile/lib/locales/en.json",
  "artifacts/vndrly-mobile/lib/locales/es.json",
  "artifacts/vndrly/src/lib/locales/en.json",
  "artifacts/vndrly/src/lib/locales/es.json",
];

// Match the `code: "dotted.snake_case"` literal used by Task #531 routes.
// The dot separator is required so we don't accidentally pick up unrelated
// `code:` properties (e.g. HTTP status codes, county codes, etc.) that
// happen to live in these files.
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

// Resolve a dotted path (e.g. "schedule.start_required") against a nested
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

describe("API code literal → mobile i18n coverage", () => {
  const allCodes = new Set<string>();
  for (const route of SCANNED_ROUTES) {
    for (const code of extractCodes(route)) allCodes.add(code);
  }

  it("scans at least one structured code literal (sanity check)", () => {
    // If this fails, either the regex broke or the routes have been moved.
    expect(allCodes.size).toBeGreaterThan(10);
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
      expect(
        missing,
        `Missing errors.<code> entries in ${localePath}:\n` +
          missing.map((c) => `  - ${c}`).join("\n") +
          "\n\nAdd a translation for each missing code to BOTH the " +
          "mobile (artifacts/vndrly-mobile/lib/locales/) AND web " +
          "(artifacts/vndrly/src/lib/locales/) en.json and es.json " +
          "catalogs so neither Spanish field employees nor Spanish " +
          "office staff see the English fallback. If a new code is also " +
          "part of the schedule or crew-tracker mobile flows, also add " +
          "it to TASK_531_CODES in " +
          "artifacts/vndrly-mobile/lib/apiErrors.test.ts to lock in the " +
          "runtime translation behaviour.",
      ).toEqual([]);
    });
  }
});
