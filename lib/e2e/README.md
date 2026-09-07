# @workspace/e2e

End-to-end browser tests (Playwright) that drive test-owned web and API
servers against an isolated test database. The suite must never run against
the shared development or production database.

## Prerequisites

For validation under the repository's no-wipe rule, use **fresh-local mode**:

```powershell
$env:VNDRLY_TEST_DB_MODE = 'fresh-local'
$env:VNDRLY_TEST_DB_MAINTENANCE_URL = 'postgresql://LOCAL_ROLE:LOCAL_PASSWORD@127.0.0.1:55439/postgres'
pnpm run test:api
pnpm run test:e2e
# The same environment also supports the complete root pnpm test chain.
```

Supply credentials for a newly provisioned local PostgreSQL instance. The URL
must use the literal `127.0.0.1`, an explicit port, a username, and `/postgres`,
with no query string or fragment. The wrapper verifies the server's actual
address and database before creating anything. Each invocation creates a
different `vndrly_<uuid>_test` database using `TEMPLATE template0`. A name
collision fails; no existing database is opened for reuse. The complete schema
plan must be additive and warning-free before any schema statement is applied.
Schema drift verification still runs; the legacy skip flag is ignored.

Fresh databases are retained after both success and failure. There is no
automatic database cleanup. Only test-owned fixture rows are cleaned up with
narrow predicates; counters use unique test namespaces. Fresh mode skips all
machine env/secret files and removes inherited outbound-service credentials,
database fallback settings, and demo password overrides before spawning tests.
The database, LISTEN/NOTIFY URL, and provenance marker are checked again in the
shared database module, API test setup, and E2E guards.

Per-file integration isolation uses additional new databases in fresh mode and
retains them at teardown; it does not use `pg_dump`, schema replacement, or the
legacy stale-schema sweep. A narrow recorded patch to the existing
`drizzle-kit@0.31.9` dependency preserves SQL bind values during composite
primary-key introspection. `src/test/drizzle-parameter-binding.test.ts` in the
API package verifies the fix against an actual fresh local PostgreSQL database.

Run the provisioning safety tests without any database connection:

```powershell
node --test scripts/tests/fresh-test-database.test.mjs
```

The legacy URL behavior described below remains available for compatibility.
It resets a schema and must not be used for the no-wipe validation workflow.

- No API or web workflow may already own the dedicated E2E ports 18080 or
  23539. Playwright deliberately refuses to reuse servers whose database
  provenance is unknown; the normal development API on port 8080 may continue
  running independently.
- Set `TEST_DATABASE_URL` to a database dedicated to tests whose database name
  ends in `_test` and whose normalized host/port/database differs from
  `DATABASE_URL`, or omit it so the wrapper derives a separate `_test` database
  on the same server. Credentials do not make the same physical database a
  distinct target.
- `DATABASE_URL`, `TEST_DATABASE_URL`, and `LISTEN_NOTIFY_DATABASE_URL` must use
  the documented `postgresql://user:password@host:port/database` (or
  `postgres://...`) shape with an explicit DNS hostname, explicit numeric port,
  and an ASCII database identifier. Percent-encoding is forbidden in the host
  and database path; decoded credentials may not contain NUL, C0, or C1 control
  characters. All query strings and fragments are rejected before any
  connection or schema work.
- The wrapper reconstructs canonical connection URLs from the validated
  components and passes only those URLs to setup, schema, LISTEN/NOTIFY, and
  child processes. It also removes libpq target fallbacks such as `PGHOST`,
  `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSERVICE` from setup and
  child environments, so they cannot supply or redirect an omitted component.
- Chromium has been installed for Playwright:

  ```
  pnpm --filter @workspace/e2e run test:install
  ```

## Run

```powershell
pnpm run test:e2e
```

The root command is the only supported entry point. It starts
`run-with-test-db.ts`, which prepares the isolated schema and passes the same
normalized target in `DATABASE_URL` and `TEST_DATABASE_URL` together with
`VNDRLY_ISOLATED_TEST_DB=1`. Playwright configuration, global setup, local API
startup, and destructive fixture routes all fail closed without that
provenance and an `_test` database name. The wrapper validates the target before
opening a connection or creating/resetting a schema, and the API fixture guard
applies the same strict parser before entering a route action. Running the
Playwright package directly is expected to refuse.

The isolated API is fixed at `http://localhost:18080`, and the browser base URL
is fixed at `http://localhost:23539`. `E2E_BASE_URL` may be
unset or spell that exact local origin; external hosts, alternate loopback
addresses, ports, paths, credentials, query strings, and fragments are
rejected. Playwright also refuses to reuse either server, so global setup's
development-only `POST /api/auth/seed` can reach only the wrapper-owned local
web/API pair. The manual development seed route itself remains available for
intentional local recovery and still uses the canonical credentials verbatim.

## What is covered

- `tests/visit-public.spec.ts` — public visitor sign-in page
  (`/visit/:siteCode`): seeds a partner, vendor, work type, site, and
  site work assignment; drives the guest sign-in form; mocks geolocation
  to verify both the off-geofence error path and the happy-path check-in
  - check-out flow; cleans up its seed data.
- `tests/bulk-1099-recategorize.spec.ts` — bulk 1099 income-category
  controls: signs in with the canonical demo admin account, seeds a
  deterministic vendor + draft invoice + paid invoice via the isolated-only
  `POST /api/auth/seed-1099-fixture` endpoint, then exercises both the
  multi-select bulk-apply toolbar on `/invoices/:id` and the per-vendor
  "Recategorize draft lines" dropdown on the 1099 dashboard at
  `/reports`. Demo logins use the fixed values in
  `docs/canonical-credentials.md`; the isolated seed reapplies those values
  verbatim and never changes the shared database.
