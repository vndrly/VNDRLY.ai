import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as e2eIsolation from "./e2e-isolation.mjs";
import { shouldLoadLocalEnvironment } from "./run-api-local-config.mjs";
import {
  buildApiMigrationAndRestartCommands,
  parsePlateStateMigration,
  runPlateStateMigration,
} from "./plate-state-migration.mjs";
import {
  parseNotesAdmissionMigration,
  runNotesAdmissionMigration,
} from "./notes-admission-migration.mjs";

const repoRoot = new URL("../", import.meta.url);
const { assertIsolatedTestDatabaseEnvironment, normalizeDatabaseTarget } =
  e2eIsolation;

test("root test:e2e enters the isolated database wrapper before Playwright", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("package.json", repoRoot), "utf8"),
  );
  const command = pkg.scripts["test:e2e"];

  assert.match(command, /run-with-test-db/);
  assert.match(command, /playwright test/);
  assert.ok(
    command.indexOf("run-with-test-db") < command.indexOf("playwright test"),
    "the isolated wrapper must own the Playwright child process",
  );
});

test("the test database wrapper validates its target before every database operation", async () => {
  const wrapper = await readFile(
    new URL("artifacts/api-server/scripts/run-with-test-db.ts", repoRoot),
    "utf8",
  );
  const resolution = wrapper.indexOf("const resolved = resolveTestDbUrl()");
  const firstDatabaseOperation = wrapper.indexOf(
    "await ensureDatabaseExists(resolved.maintenanceUrl",
  );
  const environmentSanitization = wrapper.indexOf(
    "stripLibpqTargetEnvironment(process.env)",
  );
  const setupEnvironmentCleanup = wrapper.indexOf(
    "delete process.env[key]",
  );
  const setupDatabaseRewrite = wrapper.indexOf(
    "process.env.DATABASE_URL = resolved.testUrl",
  );
  const setupTestDatabaseRewrite = wrapper.indexOf(
    "process.env.TEST_DATABASE_URL = resolved.testUrl",
  );

  assert.ok(
    environmentSanitization >= 0,
    "wrapper must remove libpq target fallbacks from setup and child environments",
  );
  assert.ok(
    setupEnvironmentCleanup > environmentSanitization,
    "wrapper must clear setup-process libpq target fallbacks",
  );
  assert.ok(resolution >= 0, "wrapper must resolve the validated target");
  assert.ok(
    firstDatabaseOperation > resolution && resolution > setupEnvironmentCleanup,
    "environment cleanup and target validation must finish before create/reset/connect work begins",
  );
  assert.ok(
    setupDatabaseRewrite > resolution &&
      setupDatabaseRewrite < firstDatabaseOperation &&
      setupTestDatabaseRewrite > resolution &&
      setupTestDatabaseRewrite < firstDatabaseOperation,
    "the setup process must replace raw database URLs with canonical resolved URLs before database work",
  );
  assert.match(
    wrapper,
    /const env: NodeJS\.ProcessEnv = \{\s*\.\.\.setupEnvironment,\s*DATABASE_URL: resolved\.testUrl,\s*TEST_DATABASE_URL: resolved\.testUrl,/s,
    "the child must inherit the stripped environment and canonical resolved URLs",
  );
  assert.doesNotMatch(
    wrapper,
    /new pg\.(?:Client|Pool)\(\{[^}]*connectionString:\s*process\.env/s,
    "setup clients must never receive a raw environment URL",
  );
});

test("isolated E2E provenance requires the marker and the same normalized database target", () => {
  const databaseUrl =
    "postgresql://test%20user:password@isolated.example.test:5432/e2e_database_test";

  assert.throws(
    () =>
      assertIsolatedTestDatabaseEnvironment({
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: databaseUrl,
      }),
    /VNDRLY_ISOLATED_TEST_DB=1/,
  );
  assert.throws(
    () =>
      assertIsolatedTestDatabaseEnvironment({
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL:
          "postgresql://test%20user:password@other.example.test:5432/e2e_database_test",
        VNDRLY_ISOLATED_TEST_DB: "1",
      }),
    /same normalized database target/,
  );
  assert.equal(
    assertIsolatedTestDatabaseEnvironment({
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL:
        "postgresql://test%20user:different@isolated.example.test:5432/e2e_database_test",
      VNDRLY_ISOLATED_TEST_DB: "1",
    }).databaseUrl,
    "postgresql://test%20user:password@isolated.example.test:5432/e2e_database_test",
  );

  assert.throws(
    () =>
      assertIsolatedTestDatabaseEnvironment({
        DATABASE_URL:
          "postgresql://runner:secret@isolated.example.test:5432/vndrly",
        TEST_DATABASE_URL:
          "postgresql://runner:secret@isolated.example.test:5432/vndrly",
        VNDRLY_ISOLATED_TEST_DB: "1",
      }),
    /database name ending in _test/,
  );
});

test("test database resolution rejects shared-looking explicit targets before setup", () => {
  const resolve = e2eIsolation.resolveIsolatedTestDatabaseTarget;
  const shared =
    "postgresql://runner:secret@db.example.test:5432/vndrly";

  assert.throws(
    () =>
      resolve({
        DATABASE_URL: shared,
        TEST_DATABASE_URL: shared,
      }),
    /distinct from DATABASE_URL/,
  );
  assert.throws(
    () =>
      resolve({
        DATABASE_URL: shared,
        TEST_DATABASE_URL:
          "postgresql://runner:secret@isolated.example.test:5432/vndrly",
      }),
    /database name ending in _test/,
  );
  assert.throws(
    () =>
      resolve({
        DATABASE_URL:
          "postgresql://runner:first@isolated.example.test:5432/vndrly_test",
        TEST_DATABASE_URL:
          "postgresql://alternate:second@ISOLATED.EXAMPLE.TEST:5432/vndrly_test",
      }),
    /distinct from DATABASE_URL/,
  );
});

test("test database resolution preserves safe derived and explicit _test targets", () => {
  const resolve = e2eIsolation.resolveIsolatedTestDatabaseTarget;
  const base =
    "postgresql://runner:secret@db.example.test:6543/vndrly";
  const derived = resolve({
    DATABASE_URL: base,
    LISTEN_NOTIFY_DATABASE_URL:
      "postgresql://listener:notify@direct.example.test:5432/postgres",
  });

  assert.equal(derived.testDbName, "vndrly_test");
  assert.equal(derived.source, "derived-from-DATABASE_URL");
  assert.equal(new URL(derived.testUrl).hostname, "db.example.test");
  assert.equal(new URL(derived.testUrl).port, "6543");
  assert.equal(new URL(derived.testUrl).username, "runner");
  assert.equal(new URL(derived.testUrl).password, "secret");
  assert.equal(new URL(derived.testUrl).search, "");
  assert.equal(
    derived.listenNotifyTestUrl,
    "postgresql://listener:notify@direct.example.test:5432/vndrly_test",
  );

  const explicit = resolve({
    DATABASE_URL:
      "postgresql://runner:secret@shared.example.test:5432/vndrly_test",
    TEST_DATABASE_URL:
      "postgresql://runner:secret@isolated.example.test:5432/vndrly_test",
  });
  assert.equal(explicit.testDbName, "vndrly_test");
  assert.equal(explicit.source, "TEST_DATABASE_URL");
  assert.equal(new URL(explicit.testUrl).hostname, "isolated.example.test");
});

test("the wrapper rejects target-changing options on every database URL before setup", () => {
  const resolve = e2eIsolation.resolveIsolatedTestDatabaseTarget;
  const base =
    "postgresql://runner:secret@shared.example.test:5432/vndrly";

  assert.throws(
    () =>
      resolve({
        DATABASE_URL:
          "postgresql://runner:secret@isolated.example.test:5432/vndrly?host=shared.example.test",
      }),
    /target-changing PostgreSQL URL query parameter/i,
  );
  assert.throws(
    () =>
      resolve({
        DATABASE_URL: base,
        TEST_DATABASE_URL:
          "postgresql://runner:secret@isolated.example.test/vndrly_test?PORT=5432",
      }),
    /target-changing PostgreSQL URL query parameter/i,
  );
  assert.throws(
    () =>
      resolve({
        DATABASE_URL: base,
        LISTEN_NOTIFY_DATABASE_URL:
          "postgresql://runner:secret@isolated.example.test:5432/vndrly?host=shared.example.test",
      }),
    /target-changing PostgreSQL URL query parameter/i,
  );
});

test("same _test database name on a different host is a distinct explicit target", () => {
  const resolved = e2eIsolation.resolveIsolatedTestDatabaseTarget({
    DATABASE_URL:
      "postgresql://runner:secret@shared.example.test:5432/vndrly_test",
    TEST_DATABASE_URL:
      "postgresql://runner:secret@isolated.example.test:5432/vndrly_test",
  });

  assert.equal(resolved.testDbName, "vndrly_test");
  assert.equal(new URL(resolved.testUrl).hostname, "isolated.example.test");
});

test("E2E web requests are pinned to the wrapper-owned localhost server", () => {
  const assertLocal = e2eIsolation.assertLocalE2EBaseUrl;

  assert.equal(assertLocal(undefined), "http://localhost:23539");
  assert.equal(
    assertLocal("http://LOCALHOST:23539/"),
    "http://localhost:23539",
  );

  for (const unsafe of [
    "https://example.com",
    "http://10.0.0.5:23539",
    "http://127.0.0.1:23539",
    "http://localhost:9999",
    "http://localhost:23539/proxy",
  ]) {
    assert.throws(() => assertLocal(unsafe), /fixed local E2E origin/);
  }
});

test("Playwright config and global setup validate the local origin before use", async () => {
  const [config, globalSetup] = await Promise.all([
    readFile(new URL("lib/e2e/playwright.config.ts", repoRoot), "utf8"),
    readFile(new URL("lib/e2e/global-setup.ts", repoRoot), "utf8"),
  ]);

  assert.match(config, /baseURL\s*=\s*assertLocalE2EBaseUrl/);
  assert.doesNotMatch(config, /process\.env\.E2E_BASE_URL\s*\?\?/);
  assert.equal([...config.matchAll(/reuseExistingServer:\s*false/g)].length, 2);
  assert.doesNotMatch(config, /reuseExistingServer:\s*true/);

  const isolationAssertion = globalSetup.indexOf(
    "assertIsolatedTestDatabaseEnvironment(process.env)",
  );
  const localAssertion = globalSetup.indexOf("assertLocalE2EBaseUrl(");
  const seedRequest = globalSetup.indexOf("fetch(");
  assert.ok(
    isolationAssertion >= 0,
    "global setup must validate the isolated database target",
  );
  assert.ok(localAssertion >= 0, "global setup must validate the E2E origin");
  assert.ok(
    seedRequest > isolationAssertion && seedRequest > localAssertion,
    "global setup must validate the database and origin before POST /auth/seed",
  );
});

test("Playwright pins its isolated API server and web proxy to a dedicated local port", async () => {
  const config = await readFile(
    new URL("lib/e2e/playwright.config.ts", repoRoot),
    "utf8",
  );

  assert.match(
    config,
    /url:\s*"http:\/\/localhost:18080\/api\/healthz"/,
  );
  assert.match(config, /PORT:\s*"18080"/);
  assert.match(
    config,
    /VITE_API_PROXY_TARGET:\s*"http:\/\/localhost:18080"/,
  );
  assert.equal(
    [...config.matchAll(/localhost:18080/g)].length,
    2,
    "the API health check and Vite proxy must share the dedicated origin",
  );
  assert.doesNotMatch(config, /localhost:8080|PORT:\s*"8080"/);
  assert.doesNotMatch(
    config,
    /process\.env\.(?:PORT|API_PORT|E2E_API_PORT|VITE_API_PROXY_TARGET)/,
    "the dedicated E2E API port must not accept an external override",
  );
});

test("production demo recovery uses canonical Joe and Baker credentials with natural identities", async () => {
  const source = await readFile(
    new URL("artifacts/api-server/src/routes/demoProdSeed.ts", repoRoot),
    "utf8",
  );

  assert.doesNotMatch(source, /\b(?:joe123|baker1)\b/);
  assert.match(
    source,
    /username:\s*"joe\.boggs@winchester\.com",\s*password:\s*"winchester2"/s,
  );
  assert.match(
    source,
    /username:\s*"baker@vndrly\.com",\s*email:\s*"baker@vndrly\.com",\s*password:\s*"baker123"/s,
  );
  assert.ok(
    [...source.matchAll(/lower\(coalesce\(\$\{usersTable\.email\}, \$\{usersTable\.username\}\)\)/g)]
      .length >= 2,
    "Joe and Baker recovery queries must match LOWER(COALESCE(email, username))",
  );
});

test("strict sanitizer canonicalizes the documented Supabase direct and pooler URL shapes", () => {
  const sanitize = e2eIsolation.sanitizePostgresConnectionUrl;
  const direct = sanitize?.(
    "postgres://postgres:P%40ss%3Aword@DB.bihjmgbdzbhcnsuhzzwo.supabase.co:5432/postgres",
  );
  const pooler = sanitize?.(
    "postgresql://postgres.bihjmgbdzbhcnsuhzzwo:secret@AWS-1-US-WEST-2.pooler.supabase.com:6543/postgres_test",
  );

  assert.equal(
    direct,
    "postgresql://postgres:P%40ss%3Aword@db.bihjmgbdzbhcnsuhzzwo.supabase.co:5432/postgres",
  );
  assert.equal(
    pooler,
    "postgresql://postgres.bihjmgbdzbhcnsuhzzwo:secret@aws-1-us-west-2.pooler.supabase.com:6543/postgres_test",
  );

  const resolved = e2eIsolation.resolveIsolatedTestDatabaseTarget({
    DATABASE_URL: direct,
    TEST_DATABASE_URL:
      "postgres://postgres.bihjmgbdzbhcnsuhzzwo:secret@AWS-1-US-WEST-2.pooler.supabase.com:6543/postgres_test",
  });
  assert.equal(resolved.testUrl, pooler);
  assert.equal(
    resolved.maintenanceUrl,
    "postgresql://postgres.bihjmgbdzbhcnsuhzzwo:secret@aws-1-us-west-2.pooler.supabase.com:6543/postgres",
  );
});

test("database target normalization ignores sanitized credentials, not physical identity", () => {
  const left = normalizeDatabaseTarget(
    "postgres://runner:secret@DB.EXAMPLE.test:5432/e2e",
  );
  const sameTarget = normalizeDatabaseTarget(
    "postgresql://runner:other@db.example.test:5432/e2e",
  );
  const sameTargetOtherUser = normalizeDatabaseTarget(
    "postgresql://different%3Fhost%3Dshared:secret%23dbname%3Dprod%40value@db.example.test:5432/e2e",
  );
  const otherDatabase = normalizeDatabaseTarget(
    "postgresql://runner:secret@db.example.test:5432/other_test",
  );

  assert.equal(left, sameTarget);
  assert.equal(left, sameTargetOtherUser);
  assert.notEqual(left, otherDatabase);
});

test("strict database URLs reject every query parameter including NUL injection", () => {
  const target =
    "postgresql://runner:secret@isolated.example.test:5432/safe_test";
  for (const query of [
    "application_name=%00evil",
    "application_name=e2e",
    "sslmode=require",
    "host=shared.supabase.test&dbname=postgres&port=5432",
    "HOST=one.example.test&host=two.example.test",
  ]) {
    assert.throws(
      () => normalizeDatabaseTarget(`${target}?${query}`),
      /PostgreSQL URL query parameters are forbidden/i,
    );
  }
});

test("strict database URLs reject ambiguous authorities and database paths", () => {
  const invalid = [
    {
      url: "postgresql://runner:secret@exa%6dple.test:5432/safe_test",
      pattern: /percent-encoding.*hostname/i,
    },
    {
      url: "postgresql://runner:secret@isolated.example.test:5432/safe%2F_test",
      pattern: /percent-encoding.*database path/i,
    },
    {
      url: "postgresql://runner:secret@isolated.example.test:5432/safe%252F_test",
      pattern: /percent-encoding.*database path/i,
    },
    {
      url: "postgresql:///safe_test",
      pattern: /explicit nonempty hostname/i,
    },
    {
      url: "postgresql://runner:secret@isolated.example.test/safe_test",
      pattern: /explicit numeric port/i,
    },
    {
      url: "postgresql://runner:secret@isolated.example.test:5432/safe-test_test",
      pattern: /safe ASCII database identifier/i,
    },
  ];

  for (const { url, pattern } of invalid) {
    assert.throws(() => normalizeDatabaseTarget(url), pattern, url);
  }

  assert.throws(
    () =>
      e2eIsolation.resolveIsolatedTestDatabaseTarget({
        DATABASE_URL:
          "postgresql://runner:secret@isolated.example.test/postgres",
        PGPORT: "5432",
      }),
    /explicit numeric port/i,
  );
});

test("strict database URLs reject decoded C0/C1 controls in credentials and raw components", () => {
  for (const url of [
    "postgresql://run%00ner:secret@isolated.example.test:5432/safe_test",
    "postgresql://run%1Fner:secret@isolated.example.test:5432/safe_test",
    "postgresql://runner:sec%0Aret@isolated.example.test:5432/safe_test",
    "postgresql://runner:sec%7Fret@isolated.example.test:5432/safe_test",
    "postgresql://runner:sec%C2%80ret@isolated.example.test:5432/safe_test",
    "postgresql://runner:sec%C2%9Fret@isolated.example.test:5432/safe_test",
    "postgresql://run\nner:secret@isolated.example.test:5432/safe_test",
  ]) {
    assert.throws(
      () => normalizeDatabaseTarget(url),
      /control characters/i,
      url,
    );
  }
});

test("strict database URLs reject fragments", () => {
  const target =
    "postgresql://runner:secret@isolated.example.test:5432/safe_test";

  assert.throws(
    () => normalizeDatabaseTarget(`${target}#?host=shared&dbname=postgres`),
    /PostgreSQL URL fragments are forbidden/i,
  );
  assert.throws(
    () => normalizeDatabaseTarget(`${target}#`),
    /PostgreSQL URL fragments are forbidden/i,
  );
});

test("libpq target fallback variables are removed case-insensitively", () => {
  const stripped = e2eIsolation.stripLibpqTargetEnvironment?.({
    PATH: "tools",
    PGHOST: "shared.example.test",
    pgport: "6543",
    PGHOSTADDR: "10.0.0.1",
    PGDATABASE: "postgres",
    PGUSER: "shared-user",
    PGPASSWORD: "shared-password",
    PGPASSFILE: "shared.pgpass",
    PGSERVICE: "shared",
    PGSERVICEFILE: "services.conf",
    PGSYSCONFDIR: "pgconfig",
    PGTARGETSESSIONATTRS: "read-write",
    PGLOADBALANCEHOSTS: "random",
    PGSSLMODE: "require",
  });

  assert.deepEqual(stripped, {
    PATH: "tools",
    PGSSLMODE: "require",
  });
});

test("the local API launcher never loads .env.local inside the isolated wrapper", () => {
  assert.equal(
    shouldLoadLocalEnvironment({ VNDRLY_ISOLATED_TEST_DB: "1" }),
    false,
  );
  assert.equal(shouldLoadLocalEnvironment({}), true);
});

test("the plate-state migration accepts only the two checked-in additive statements", () => {
  const sql = [
    'ALTER TABLE "guest_sessions" ADD COLUMN IF NOT EXISTS "plate_state" text;',
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "plate_state" text;',
  ].join("\n");

  assert.deepEqual(parsePlateStateMigration(sql), [
    'ALTER TABLE "guest_sessions" ADD COLUMN IF NOT EXISTS "plate_state" text',
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "plate_state" text',
  ]);
  assert.throws(
    () => parsePlateStateMigration(`${sql}\nDROP TABLE site_visits;`),
    /exactly the approved additive plate_state statements/,
  );
});

test("migration execution is idempotent, narrow, and verifies nullable text columns", async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (/information_schema\.columns/.test(text)) {
        return {
          rows: [
            {
              table_name: "guest_sessions",
              data_type: "text",
              is_nullable: "YES",
            },
            {
              table_name: "site_visits",
              data_type: "text",
              is_nullable: "YES",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await runPlateStateMigration(
    client,
    [
      'ALTER TABLE "guest_sessions" ADD COLUMN IF NOT EXISTS "plate_state" text;',
      'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "plate_state" text;',
    ].join("\n"),
  );

  assert.equal(queries.length, 3);
  assert.match(
    queries[0],
    /^ALTER TABLE "guest_sessions" ADD COLUMN IF NOT EXISTS/,
  );
  assert.match(
    queries[1],
    /^ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS/,
  );
  assert.match(queries[2], /information_schema\.columns/);
  assert.doesNotMatch(
    queries.join("\n"),
    /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i,
  );
});

test("the notes-admission migration accepts only the three checked-in additive statements", () => {
  const sql = [
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "notes" text;',
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "check_out_notes" text;',
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "admission_status" text;',
  ].join("\n");

  assert.deepEqual(parseNotesAdmissionMigration(sql), [
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "notes" text',
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "check_out_notes" text',
    'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "admission_status" text',
  ]);
  assert.throws(
    () => parseNotesAdmissionMigration(`${sql}\nDROP TABLE site_visits;`),
    /exactly the approved additive notes and admission statements/,
  );
});

test("notes-admission execution is idempotent, narrow, and verifies nullable text columns", async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (/information_schema\.columns/.test(text)) {
        return {
          rows: [
            {
              column_name: "admission_status",
              data_type: "text",
              is_nullable: "YES",
            },
            {
              column_name: "check_out_notes",
              data_type: "text",
              is_nullable: "YES",
            },
            {
              column_name: "notes",
              data_type: "text",
              is_nullable: "YES",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await runNotesAdmissionMigration(
    client,
    [
      'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "notes" text;',
      'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "check_out_notes" text;',
      'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "admission_status" text;',
    ].join("\n"),
  );

  assert.equal(queries.length, 4);
  assert.match(queries[0], /^ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "notes"/);
  assert.match(
    queries[1],
    /^ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "check_out_notes"/,
  );
  assert.match(
    queries[2],
    /^ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "admission_status"/,
  );
  assert.match(queries[3], /information_schema\.columns/);
  assert.doesNotMatch(
    queries.join("\n"),
    /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i,
  );
});

test("deployment migrates and verifies before the API restart without blind schema push", () => {
  const commands = buildApiMigrationAndRestartCommands();
  const plateState = commands.indexOf("migrate:plate-state");
  const notesAdmission = commands.indexOf("migrate:notes-admission");
  const askvGreeting = commands.indexOf("migrate:askv-greeting");
  const restart = commands.indexOf("systemctl restart vndrly-api");

  assert.ok(plateState >= 0, "deployment must invoke the plate-state migration");
  assert.ok(
    notesAdmission >= 0,
    "deployment must invoke the notes-admission migration",
  );
  assert.ok(
    askvGreeting >= 0,
    "deployment must invoke the guarded AskV greeting migration",
  );
  assert.ok(
    restart > plateState && restart > notesAdmission && restart > askvGreeting,
    "restart must happen only after all guarded migrations succeed",
  );
  assert.doesNotMatch(commands, /drizzle(?:-kit)?\s+push|DROP|TRUNCATE/i);
});

test("destructive E2E fixture routes are guarded by isolated-database provenance", async () => {
  const authRoutes = await readFile(
    new URL("artifacts/api-server/src/routes/auth.ts", repoRoot),
    "utf8",
  );

  for (const route of [
    "/auth/seed-1099-fixture",
    "/auth/seed-audit-pagination-fixture",
  ]) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      authRoutes,
      new RegExp(
        `router\\.post\\(\\s*["']${escapedRoute}["']\\s*,\\s*requireIsolatedFixtureContext\\s*,`,
      ),
      `${route} must reject requests before its destructive database work`,
    );
  }
});
