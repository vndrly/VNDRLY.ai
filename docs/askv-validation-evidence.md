# Final fresh-local root test evidence

Source: `bd0538fc7f1d4ed69fd4e6a359f1bdf87ddfa931`.
Command: root `pnpm test` via the pinned Corepack pnpm 9.15.9 shim.
Result: **PASS, exit 0**, with no runtime, test, or harness source edits during the uninterrupted run. Concurrent changes were documentation only.
Started: September 6, 2026, 22:23:21.2369834 America/Chicago (-05:00).
Ended: September 6, 2026, 22:33:33.3408358 America/Chicago (-05:00).
Duration: **612.1038524 seconds (10 minutes 12.104 seconds)**.

| Stage | Passing files/packages | Passed tests | Skipped tests |
| --- | ---: | ---: | ---: |
| Shared libraries | 6 packages | 53 | 0 |
| Web | 120 files | 874 | 3 |
| Mobile | 97 files | 646 | 0 |
| API | 258 files; 3 files skipped | 2107 | 53 |
| Browser E2E | 34 scenarios | 34 | 0 |
| Total | | **3714** | **56** |

Zero failed tests. Stage durations: web 125.87 seconds; mobile 71.74 seconds; API 138.89 seconds; E2E 4.1 minutes as reported by Playwright. Browser retries are configured as zero.

API and E2E each created a separate, uniquely named NEW local database. Both mandatory schema-drift checks passed. The per-suite fresh database harness also creates new retained databases. No existing database was reused or reset, and no database was dropped. All local database data was retained. Playwright shut down its own application servers; a read-only check confirmed zero remaining listeners on ports 18080 and 23539. PostgreSQL was subsequently stopped cleanly, with its data retained.

This is the final combined gate for the corrected provider-compatible source. The earlier successful root run on 91a3273 is historical evidence only; its log, exit code, and summary were preserved before starting this run.

## Evidence files

- `node_modules/.validation/askv-root-full-test.log`: complete final root run and all 34 browser results.
- `node_modules/.validation/askv-root-full-test.exit`: `0`.
- `node_modules/.validation/askv-root-full-test-timing.json`: exact source, start/end timestamps, elapsed seconds, and exit code.
- `node_modules/.validation/askv-root-full-test-91a3273.log`: historical baseline root run.
- `node_modules/.validation/askv-root-full-test-91a3273.exit`: historical baseline exit code.
- `node_modules/.validation/askv-root-full-test-91a3273.summary.md`: historical baseline summary.

The root Playwright reporter is list-only, so the final run did not create a JSON browser report. Current unchanged-source API/web/mobile typecheck and production web build evidence was reused from the live validation agent, as instructed, without duplicate runs. Authenticated real-provider acceptance evidence is documented separately; the root tests strip external provider credentials.

## Skip accounting

The 56 skips are unchanged from the earlier root run.

Web's 3 skips are the optional live `/assistant/metrics` probes in `artifacts/vndrly/tests/assistant.spec.ts`, which require a separately running API/admin cookie before the E2E server starts.

API's 53 skips are:

- 14 inactive no-database fallback placeholder cases. Their real-database suites ran; these skips do not indicate unavailable local PostgreSQL.
- 3 legacy schema-reset harness cases disabled in fresh mode; the fresh creation/retention behavior test passed.
- 7 opt-in real Redis tests (`REDIS_TEST_URL` unavailable).
- 25 opt-in worker tests: invoice aging 9, QuickBooks bulk retention cleanup 13, expiry warning 3. Their explicit flags were left at the root command's defaults.
- 2 existing disabled seed-idempotency cases.
- 2 existing explicitly skipped hotlist SSE delivery cases.

## Reproduction contract

Set `VNDRLY_TEST_DB_MODE=fresh-local` and load `VNDRLY_TEST_DB_MAINTENANCE_URL` privately from the dedicated local maintenance-url.txt file. The maintenance URL must use a query-free explicit PostgreSQL URL with literal `127.0.0.1`, an explicit port, credentials, and database `postgres`. Do not print its value. Prepend `node_modules/.validation/bin` to PATH for the existing local pnpm 9 shim; set `VITEST_MAX_WORKERS=3`; run root `pnpm test`.

Fresh mode ignores inherited data URLs, strips outbound/provider credentials, disables env-file imports, checks server/provenance and database emptiness, rejects collisions and nonadditive schema plans, and retains all new databases. No new provider package or dependency version upgrade was introduced. The recorded Drizzle 0.31.9 patch binds existing introspection parameters; its real database regression and offline frozen-lock verification passed.

Legacy destructive code remains available for pre-existing callers and was never invoked by this workflow: the legacy reset branch in `artifacts/api-server/scripts/run-with-test-db.ts`, legacy schema teardown/stale cleanup in `artifacts/api-server/src/test/db-harness.ts`, and the unused `resetAll` helper in `artifacts/api-server/src/lib/signup-assistant-pg-store.ts`. Fresh mode bypasses these paths. The default mode was preserved intentionally; future no-wipe runs must explicitly select fresh-local.

The temporary PostgreSQL cluster was shut down after verification: the postmaster exited, its PID file was removed and port 55439 stopped responding. All local test data remains intact.

## Release-path verification after full-ship authorization

The application/runtime source remains the validated bd0538f tree. Subsequent changes are documentation and release orchestration: the TestFlight workflow verifies the exact completed build/source/project before submitting by ID, and the direct API-deployment fallback now runs the same guarded greeting migration before restart. The combined focused workflow/build-result tests passed (19 cases), and the separate fallback migration-order test passed. App suites were reused because application code was unchanged.

Installed EAS 20.1.0 command definitions were also checked: whoami has no flags and handles authentication noninteractively itself. The unsupported whoami flag was removed from both native and OTA workflows; exact-ID submit flags were confirmed supported. The final focused workflow tests pass.
