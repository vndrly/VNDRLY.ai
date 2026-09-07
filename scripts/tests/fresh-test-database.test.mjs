import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  assertAdditiveSchemaPlan,
  assertFreshLocalTestDatabaseEnvironment,
  freshLocalChildEnvironment,
  provisionFreshLocalTestDatabase,
  resolveFreshLocalTestDatabaseTarget,
} from "../fresh-test-database.mjs";
import { assertIsolatedTestDatabaseEnvironment } from "../e2e-isolation.mjs";

const environment = {
  VNDRLY_TEST_DB_MODE: "fresh-local",
  VNDRLY_TEST_DB_MAINTENANCE_URL:
    "postgresql://tester:local@127.0.0.1:55439/postgres",
  DATABASE_URL: "postgresql://shared:never@production.example:5432/live",
  LISTEN_NOTIFY_DATABASE_URL:
    "postgresql://shared:never@production.example:5432/live",
};
const schemaPlan = {
  hasDataLoss: false,
  warnings: [],
  statementsToExecute: [
    'CREATE TABLE "parent" ("id" integer PRIMARY KEY);',
    'CREATE TABLE "child" ("id" integer, "parent_id" integer);',
    'ALTER TABLE "child" ADD CONSTRAINT "child_fk" FOREIGN KEY ("parent_id") REFERENCES "parent"("id") ON DELETE cascade ON UPDATE no action;',
  ],
};

function databaseHarness(
  target,
  { collision = false, serverAddress = "127.0.0.1", objects = 0 } = {},
) {
  const opened = [];
  const statements = [];
  const closed = [];
  const createClient = (url) => {
    const database = new URL(url).pathname.slice(1);
    opened.push(database);
    return {
      async connect() {},
      async end() {
        closed.push(database);
      },
      async query(sql) {
        statements.push(sql);
        if (sql.startsWith("SELECT current_database()")) {
          return { rows: [{ database, address: serverAddress, port: 55439 }] };
        }
        if (sql.startsWith("CREATE DATABASE") && collision) {
          throw Object.assign(new Error("database already exists"), {
            code: "42P04",
          });
        }
        if (sql.startsWith("SELECT count(*)"))
          return { rows: [{ count: objects }] };
        return { rows: [] };
      },
    };
  };
  return { createClient, opened, statements, closed };
}

test("each resolution creates a distinct local API/E2E target despite inherited production URLs", () => {
  const first = resolveFreshLocalTestDatabaseTarget(environment);
  const second = resolveFreshLocalTestDatabaseTarget(environment);
  assert.notEqual(first.testDbName, second.testDbName);
  assert.match(first.testDbName, /^vndrly_[a-f0-9]{32}_test$/);
  assert.equal(new URL(first.testUrl).hostname, "127.0.0.1");
  assert.equal(first.listenNotifyTestUrl, first.testUrl);
});

test("only an explicit literal loopback maintenance database is accepted", () => {
  for (const url of [
    "postgresql://tester:local@localhost:55439/postgres",
    "postgresql://tester:local@remote.example:55439/postgres",
    "postgresql://tester:local@127.0.0.1:55439/live",
    "postgresql://tester:local@127.0.0.1:55439/postgres?host=remote.example",
    "postgresql://127.0.0.1:55439/postgres",
  ]) {
    assert.throws(() =>
      resolveFreshLocalTestDatabaseTarget({
        ...environment,
        VNDRLY_TEST_DB_MAINTENANCE_URL: url,
      }),
    );
  }
  assert.throws(() =>
    resolveFreshLocalTestDatabaseTarget({
      ...environment,
      VNDRLY_TEST_DB_MODE: undefined,
    }),
  );
});

test("successful provisioning creates once then commits only the reviewed additive plan", async () => {
  const target = resolveFreshLocalTestDatabaseTarget(environment);
  const harness = databaseHarness(target);
  await provisionFreshLocalTestDatabase(
    target,
    harness.createClient,
    async () => schemaPlan,
  );
  assert.deepEqual(harness.opened, ["postgres", target.testDbName]);
  assert.deepEqual(harness.closed, harness.opened);
  assert.equal(
    harness.statements.filter((s) => s.startsWith("CREATE DATABASE")).length,
    1,
  );
  assert.deepEqual(harness.statements.slice(-5), [
    "BEGIN",
    ...schemaPlan.statementsToExecute,
    "COMMIT",
  ]);
});

test("a collision fails without connecting to or altering the existing database", async () => {
  const target = resolveFreshLocalTestDatabaseTarget(environment);
  const harness = databaseHarness(target, { collision: true });
  let introspected = false;
  await assert.rejects(
    provisionFreshLocalTestDatabase(target, harness.createClient, async () => {
      introspected = true;
      return schemaPlan;
    }),
    { code: "42P04" },
  );
  assert.deepEqual(harness.opened, ["postgres"]);
  assert.deepEqual(harness.closed, ["postgres"]);
  assert.equal(introspected, false);
});

test("a remote server identity aborts before CREATE DATABASE", async () => {
  const target = resolveFreshLocalTestDatabaseTarget(environment);
  const harness = databaseHarness(target, { serverAddress: "10.0.0.1" });
  await assert.rejects(
    provisionFreshLocalTestDatabase(
      target,
      harness.createClient,
      async () => schemaPlan,
    ),
    /identity/,
  );
  assert.equal(harness.statements.length, 1);
});

test("unexpected objects abort before schema planning and never trigger a reset", async () => {
  const target = resolveFreshLocalTestDatabaseTarget(environment);
  const harness = databaseHarness(target, { objects: 1 });
  let planned = false;
  await assert.rejects(
    provisionFreshLocalTestDatabase(target, harness.createClient, async () => {
      planned = true;
      return schemaPlan;
    }),
    /nonempty/,
  );
  assert.equal(planned, false);
  assert.equal(
    harness.statements.some((s) => s === "BEGIN"),
    false,
  );
});

test("the complete plan is rejected before any schema write if any statement is unsafe", async () => {
  for (const statement of [
    "DROP SCHEMA public CASCADE;",
    'TRUNCATE "parent";',
    'DELETE FROM "parent";',
    'ALTER TABLE "parent" DROP COLUMN "id";',
    'CREATE TABLE "okay" (id int); DELETE FROM "parent";',
    "DO $$ BEGIN EXECUTE dangerous; END $$;",
  ]) {
    const target = resolveFreshLocalTestDatabaseTarget(environment);
    const harness = databaseHarness(target);
    await assert.rejects(
      provisionFreshLocalTestDatabase(
        target,
        harness.createClient,
        async () => ({
          ...schemaPlan,
          statementsToExecute: [...schemaPlan.statementsToExecute, statement],
        }),
      ),
      /non-additive/,
    );
    assert.equal(
      harness.statements.some((s) => s === "BEGIN"),
      false,
    );
  }
  assert.throws(() =>
    assertAdditiveSchemaPlan({ ...schemaPlan, hasDataLoss: true }),
  );
  assert.throws(() =>
    assertAdditiveSchemaPlan({ ...schemaPlan, warnings: ["review required"] }),
  );
});

test("child guards reject target changes, missing provenance, and local-env override", () => {
  const target = resolveFreshLocalTestDatabaseTarget(environment);
  const child = freshLocalChildEnvironment(environment, target);
  assertFreshLocalTestDatabaseEnvironment(child);
  assertIsolatedTestDatabaseEnvironment(child);
  for (const patch of [
    { DATABASE_URL: environment.DATABASE_URL },
    { LISTEN_NOTIFY_DATABASE_URL: environment.DATABASE_URL },
    { VNDRLY_FRESH_TEST_DB_NAME: undefined },
    { VNDRLY_ISOLATED_TEST_DB: undefined },
    { VNDRLY_LOAD_ENV_LOCAL: "1" },
  ])
    assert.throws(() =>
      assertIsolatedTestDatabaseEnvironment({ ...child, ...patch }),
    );
});

test("passwordless local targets survive URL normalization without accepting different credentials", () => {
  for (const authority of ["tester@", "tester:@"]) {
    const target = resolveFreshLocalTestDatabaseTarget({
      ...environment,
      VNDRLY_TEST_DB_MAINTENANCE_URL:
        `postgresql://${authority}127.0.0.1:55439/postgres`,
    });
    const child = freshLocalChildEnvironment(environment, target);
    assert.doesNotThrow(() => assertFreshLocalTestDatabaseEnvironment(child));
    assert.doesNotThrow(() => assertIsolatedTestDatabaseEnvironment(child));
    for (const key of ["TEST_DATABASE_URL", "LISTEN_NOTIFY_DATABASE_URL"]) {
      const different = new URL(target.testUrl);
      different.password = "different";
      assert.throws(() =>
        assertFreshLocalTestDatabaseEnvironment({ ...child, [key]: different.href }),
      );
    }
  }
});

test("child environment discards inherited outbound credentials and PostgreSQL fallback settings", () => {
  const target = resolveFreshLocalTestDatabaseTarget(environment);
  const child = freshLocalChildEnvironment(
    {
      ...environment,
      PATH: process.env.PATH,
      SENDGRID_API_KEY: "never",
      TWILIO_AUTH_TOKEN: "never",
      OPENAI_API_KEY: "never",
      SUPABASE_SERVICE_ROLE_KEY: "never",
      REDIS_URL: "never",
      PGHOST: "remote.example",
      PGOPTIONS: "-c search_path=shared",
      DEMO_PASSWORD_OVERRIDE: "never",
      OPENAI_ENV: "never",
      VNDRLY_LOAD_ENV_LOCAL: "1",
    },
    target,
  );
  for (const key of [
    "SENDGRID_API_KEY",
    "TWILIO_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "REDIS_URL",
    "PGHOST",
    "PGOPTIONS",
    "DEMO_PASSWORD_OVERRIDE",
    "OPENAI_ENV",
  ]) {
    assert.equal(child[key], undefined, key);
  }
  assert.equal(child.PATH, process.env.PATH);
  assert.equal(child.SESSION_SECRET, "test-secret");
});

test("child imports of the env loader cannot reload machine secrets or database URLs", () => {
  const target = resolveFreshLocalTestDatabaseTarget(environment);
  const child = freshLocalChildEnvironment(process.env, target);
  const loader = new URL("../load-env-local.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    await import(${JSON.stringify(loader)});
    if (process.env.DATABASE_URL !== ${JSON.stringify(target.testUrl)}) process.exit(2);
    for (const key of ['OPENAI_API_KEY', 'TWILIO_ACCOUNT_SID', 'SENDGRID_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (process.env[key]) process.exit(3);
    }
  `,
    ],
    { env: child, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
