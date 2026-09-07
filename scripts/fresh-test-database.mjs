import { randomUUID } from "node:crypto";
import { sanitizePostgresConnectionUrl } from "./e2e-isolation.mjs";

const FRESH_NAME = /^vndrly_[a-f0-9]{32}_test$/u;

/** This mode deliberately ignores inherited development / production URLs. */
export function resolveFreshLocalTestDatabaseTarget(env) {
  if (env.VNDRLY_TEST_DB_MODE !== "fresh-local") {
    throw new Error(
      "Fresh database provisioning requires VNDRLY_TEST_DB_MODE=fresh-local",
    );
  }
  const maintenanceUrl = sanitizePostgresConnectionUrl(
    env.VNDRLY_TEST_DB_MAINTENANCE_URL,
  );
  const maintenance = new URL(maintenanceUrl);
  if (
    maintenance.hostname !== "127.0.0.1" ||
    maintenance.pathname !== "/postgres" ||
    !maintenance.username
  ) {
    throw new Error(
      "VNDRLY_TEST_DB_MAINTENANCE_URL must explicitly name 127.0.0.1:<port>/postgres with a username",
    );
  }
  const testDbName = `vndrly_${randomUUID().replaceAll("-", "")}_test`;
  maintenance.pathname = `/${testDbName}`;
  return {
    maintenanceUrl,
    testUrl: maintenance.href,
    testDbName,
    listenNotifyTestUrl: maintenance.href,
    source: "fresh-local",
  };
}

export function assertFreshLocalTestDatabaseEnvironment(env) {
  const url = new URL(sanitizePostgresConnectionUrl(env.DATABASE_URL));
  if (
    env.VNDRLY_TEST_DB_MODE !== "fresh-local" ||
    env.VNDRLY_ISOLATED_TEST_DB !== "1" ||
    !FRESH_NAME.test(env.VNDRLY_FRESH_TEST_DB_NAME ?? "") ||
    url.hostname !== "127.0.0.1" ||
    !url.username ||
    url.pathname !== `/${env.VNDRLY_FRESH_TEST_DB_NAME}` ||
    sanitizePostgresConnectionUrl(env.TEST_DATABASE_URL) !== url.href ||
    sanitizePostgresConnectionUrl(env.LISTEN_NOTIFY_DATABASE_URL) !==
      url.href ||
    env.VNDRLY_LOAD_ENV_LOCAL !== "0"
  ) {
    throw new Error(
      "Fresh local tests require the wrapper's exact local database, LISTEN/NOTIFY target, and provenance marker",
    );
  }
}

export function freshLocalChildEnvironment(env, target) {
  const clean = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !/^(?:TWILIO|SENDGRID|STRIPE|OPENAI|ANTHROPIC|AI_INTEGRATIONS|SUPABASE|REDIS|UPSTASH|QBO|QUICKBOOKS|OPENACCOUNTANT|APNS|FIREBASE|SMTP|MAIL|GODADDY|DEMO_PASSWORD|PG)/iu.test(
          key,
        ) &&
        !/(?:^|_)(?:REDIS|UPSTASH)(?:_|$)/iu.test(key) &&
        (key === "NODE_ENV" ||
          !/(?:TOKEN|SECRET|PASSWORD|API_KEY|_ENV)$/iu.test(key)),
    ),
  );
  return {
    ...clean,
    DATABASE_URL: target.testUrl,
    TEST_DATABASE_URL: target.testUrl,
    LISTEN_NOTIFY_DATABASE_URL: target.testUrl,
    VNDRLY_TEST_DB_MODE: "fresh-local",
    VNDRLY_ISOLATED_TEST_DB: "1",
    VNDRLY_FRESH_TEST_DB_NAME: target.testDbName,
    VNDRLY_LOAD_ENV_LOCAL: "0",
    SESSION_SECRET: "test-secret",
    // Some route modules construct this client eagerly. Keep its inert test
    // configuration loopback-only; real provider credentials remain stripped.
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: "local-test-disabled",
  };
}

function assertServerIdentity(result, database, port) {
  const row = result.rows[0];
  if (
    !row ||
    row.database !== database ||
    row.address !== "127.0.0.1" ||
    String(row.port) !== port
  ) {
    throw new Error(
      "PostgreSQL server identity does not match the fresh local target",
    );
  }
}

const IDENTITY_SQL =
  "SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port";

/** Validate the complete generated plan before executing any statement. */
export function assertAdditiveSchemaPlan(plan) {
  if (
    plan.hasDataLoss ||
    plan.warnings.length > 0 ||
    !plan.statementsToExecute.length
  ) {
    throw new Error(
      "Fresh database schema plan must be nonempty, additive, and warning-free",
    );
  }
  for (const statement of plan.statementsToExecute) {
    // Strip quoted values/identifiers so keywords in names/default text do not
    // affect the policy, while still catching a destructive second statement.
    const tokens = statement
      .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/gu, "quoted")
      .replace(
        /\bON\s+(?:DELETE|UPDATE)\s+(?:NO\s+ACTION|RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT)\b/giu,
        "referential_action",
      );
    if (
      /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|DO|CALL|EXECUTE|COPY|GRANT|REVOKE)\b/iu.test(
        tokens,
      ) ||
      !/^\s*(?:CREATE\s+(?:TABLE|TYPE|(?:UNIQUE\s+)?INDEX|SEQUENCE|SCHEMA)\b|ALTER\s+TABLE\s+\S+\s+ADD\s+(?:CONSTRAINT|COLUMN)\b)/iu.test(
        tokens,
      ) ||
      /;\s*\S/u.test(tokens)
    ) {
      throw new Error(
        "Refusing a non-additive or multi-command fresh database schema statement",
      );
    }
  }
}

/**
 * Only CREATE DATABASE (never IF NOT EXISTS/reuse) may acquire ownership.
 * A collision aborts before opening that database. Failures retain the new
 * database for inspection; this module intentionally has no reset/cleanup path.
 * Client and schema-plan injection allow behavioral tests without a live DB.
 */
export async function provisionFreshLocalTestDatabase(
  target,
  createClient,
  buildSchemaPlan,
) {
  const maintenance = new URL(target.maintenanceUrl);
  const test = new URL(target.testUrl);
  if (
    !FRESH_NAME.test(target.testDbName) ||
    maintenance.hostname !== "127.0.0.1" ||
    maintenance.pathname !== "/postgres" ||
    test.hostname !== maintenance.hostname ||
    test.port !== maintenance.port ||
    test.pathname !== `/${target.testDbName}` ||
    test.username !== maintenance.username ||
    test.password !== maintenance.password
  ) {
    throw new Error("Invalid fresh database provisioning target");
  }
  const admin = createClient(target.maintenanceUrl);
  await admin.connect();
  try {
    assertServerIdentity(
      await admin.query(IDENTITY_SQL),
      "postgres",
      maintenance.port,
    );
    await admin.query(
      `CREATE DATABASE "${target.testDbName}" TEMPLATE template0`,
    );
  } finally {
    await admin.end();
  }
  const client = createClient(target.testUrl);
  await client.connect();
  try {
    assertServerIdentity(
      await client.query(IDENTITY_SQL),
      target.testDbName,
      test.port,
    );
    const objects = await client.query(
      "SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'",
    );
    if (objects.rows[0]?.count !== 0)
      throw new Error(
        "Fresh database is unexpectedly nonempty; refusing schema work",
      );
    const plan = await buildSchemaPlan(client);
    assertAdditiveSchemaPlan(plan);
    await client.query("BEGIN");
    try {
      for (const statement of plan.statementsToExecute)
        await client.query(statement);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}
