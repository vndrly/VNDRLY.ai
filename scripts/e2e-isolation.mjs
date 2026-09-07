import { assertFreshLocalTestDatabaseEnvironment } from "./fresh-test-database.mjs";

export const LOCAL_E2E_BASE_URL = "http://localhost:23539";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const SAFE_DATABASE_NAME = /^[A-Za-z0-9_]+$/u;
const SAFE_HOSTNAME =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/u;

const LIBPQ_TARGET_ENVIRONMENT_VARIABLES = new Set([
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGPASSFILE",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSYSCONFDIR",
  "PGTARGETSESSIONATTRS",
  "PGLOADBALANCEHOSTS",
  "PGOPTIONS",
]);

function assertNoControlCharacters(value, label) {
  if (CONTROL_CHARACTERS.test(value)) {
    throw new Error(
      `${label} must not contain NUL, C0, or C1 control characters`,
    );
  }
}

function decodeUserInfoComponent(rawValue, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    throw new Error(`${label} must use valid percent-encoding`);
  }
  assertNoControlCharacters(decoded, label);
  return decoded;
}

function encodeUserInfoComponent(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildPostgresConnectionUrl(target, database = target.database) {
  const userInfo = target.hasUserInfo
    ? `${encodeUserInfoComponent(target.username)}:${encodeUserInfoComponent(
        target.password,
      )}@`
    : "";
  return `postgresql://${userInfo}${target.hostname}:${target.port}/${database}`;
}

/**
 * Parse only the explicit PostgreSQL URL shape documented for this repository.
 * This deliberately avoids WHATWG URL defaults and normalization so an omitted
 * target component or encoded delimiter cannot acquire alternate semantics.
 */
function parsePostgresConnectionUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    throw new Error("DATABASE_URL and TEST_DATABASE_URL must both be set");
  }
  assertNoControlCharacters(rawUrl, "PostgreSQL URL");

  if (rawUrl.includes("#")) {
    throw new Error(
      "PostgreSQL URL fragments are forbidden for isolated test database targets",
    );
  }
  if (rawUrl.includes("?")) {
    throw new Error(
      "PostgreSQL URL query parameters are forbidden; target-changing PostgreSQL URL query parameters and all other options must be removed",
    );
  }

  const protocolSeparator = rawUrl.indexOf("://");
  const rawProtocol =
    protocolSeparator === -1 ? "" : rawUrl.slice(0, protocolSeparator);
  const protocol = rawProtocol.toLowerCase();
  if (protocol !== "postgres" && protocol !== "postgresql") {
    throw new Error("E2E database URLs must use postgres or postgresql");
  }

  const remainder = rawUrl.slice(protocolSeparator + 3);
  const pathSeparator = remainder.indexOf("/");
  const rawAuthority =
    pathSeparator === -1 ? remainder : remainder.slice(0, pathSeparator);
  const rawPath =
    pathSeparator === -1 ? "" : remainder.slice(pathSeparator + 1);

  const userInfoSeparator = rawAuthority.lastIndexOf("@");
  const hasUserInfo = userInfoSeparator !== -1;
  const rawUserInfo = hasUserInfo
    ? rawAuthority.slice(0, userInfoSeparator)
    : "";
  const rawHostAndPort = hasUserInfo
    ? rawAuthority.slice(userInfoSeparator + 1)
    : rawAuthority;

  if (rawHostAndPort.length === 0 || rawHostAndPort.startsWith(":")) {
    throw new Error(
      "PostgreSQL URL must contain an explicit nonempty hostname in its raw authority",
    );
  }

  const portSeparator = rawHostAndPort.lastIndexOf(":");
  if (portSeparator <= 0) {
    throw new Error(
      "PostgreSQL URL must contain an explicit numeric port in its raw authority",
    );
  }
  const rawHostname = rawHostAndPort.slice(0, portSeparator);
  const rawPort = rawHostAndPort.slice(portSeparator + 1);

  if (rawHostname.includes("%")) {
    throw new Error(
      "PostgreSQL URL percent-encoding is forbidden in the hostname",
    );
  }
  if (!SAFE_HOSTNAME.test(rawHostname)) {
    throw new Error(
      "PostgreSQL URL hostname must be a nonempty safe ASCII DNS name",
    );
  }
  if (!/^\d+$/u.test(rawPort)) {
    throw new Error(
      "PostgreSQL URL must contain an explicit numeric port in its raw authority",
    );
  }
  const numericPort = Number(rawPort);
  if (
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535
  ) {
    throw new Error("PostgreSQL URL port must be between 1 and 65535");
  }

  if (pathSeparator === -1 || rawPath.length === 0) {
    throw new Error(
      "PostgreSQL URL must contain a safe ASCII database identifier",
    );
  }
  if (rawPath.includes("%")) {
    throw new Error(
      "PostgreSQL URL percent-encoding is forbidden in the database path",
    );
  }
  if (!SAFE_DATABASE_NAME.test(rawPath)) {
    throw new Error(
      "PostgreSQL URL database name must contain only safe ASCII database identifier characters",
    );
  }

  if (hasUserInfo && rawUserInfo.includes("@")) {
    throw new Error(
      "PostgreSQL URL userinfo must percent-encode reserved authority delimiters",
    );
  }
  const passwordSeparator = rawUserInfo.indexOf(":");
  const rawUsername =
    passwordSeparator === -1
      ? rawUserInfo
      : rawUserInfo.slice(0, passwordSeparator);
  const rawPassword =
    passwordSeparator === -1 ? "" : rawUserInfo.slice(passwordSeparator + 1);
  const username = decodeUserInfoComponent(
    rawUsername,
    "PostgreSQL URL username",
  );
  const password = decodeUserInfoComponent(
    rawPassword,
    "PostgreSQL URL password",
  );

  const hostname = rawHostname.toLowerCase();
  const port = String(numericPort);
  assertNoControlCharacters(hostname, "PostgreSQL URL hostname");
  assertNoControlCharacters(port, "PostgreSQL URL port");
  assertNoControlCharacters(rawPath, "PostgreSQL URL database name");

  const target = {
    hostname,
    port,
    database: rawPath,
    username,
    password,
    hasUserInfo,
  };
  return {
    ...target,
    connectionUrl: buildPostgresConnectionUrl(target),
  };
}

export function sanitizePostgresConnectionUrl(rawUrl) {
  return parsePostgresConnectionUrl(rawUrl).connectionUrl;
}

export function stripLibpqTargetEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !LIBPQ_TARGET_ENVIRONMENT_VARIABLES.has(key.toUpperCase()),
    ),
  );
}

function databaseTargetIdentity(target) {
  return JSON.stringify({
    protocol: "postgresql:",
    hostname: target.hostname,
    port: target.port,
    database: target.database,
  });
}

function assertTestDatabaseTarget(target, label) {
  if (!target.database.endsWith("_test")) {
    throw new Error(
      `${label} must identify a database name ending in _test; refusing a shared-looking target`,
    );
  }
  return target.database;
}

function resolveListenNotifyTestUrl(rawUrl, testDbName) {
  if (!rawUrl) return undefined;
  const target = parsePostgresConnectionUrl(rawUrl);
  return buildPostgresConnectionUrl(target, testDbName);
}

export function normalizeDatabaseTarget(rawUrl) {
  return databaseTargetIdentity(parsePostgresConnectionUrl(rawUrl));
}

/**
 * Resolve and validate the target before run-with-test-db performs any
 * connection, CREATE DATABASE, schema reset, or migration work.
 */
export function resolveIsolatedTestDatabaseTarget(environment) {
  const env = stripLibpqTargetEnvironment(environment);
  const explicit = env.TEST_DATABASE_URL;
  const base = env.DATABASE_URL;

  if (!explicit && !base) {
    throw new Error(
      "Neither TEST_DATABASE_URL nor DATABASE_URL is set; cannot bootstrap an isolated test database.",
    );
  }

  if (!explicit && base.includes("test:test@localhost")) {
    throw new Error(
      "DATABASE_URL points at the offline placeholder (test:test@localhost). Set TEST_DATABASE_URL or a real DATABASE_URL to run integration tests.",
    );
  }

  const baseTarget = base ? parsePostgresConnectionUrl(base) : undefined;
  const explicitTarget = explicit
    ? parsePostgresConnectionUrl(explicit)
    : undefined;

  if (
    explicitTarget &&
    baseTarget &&
    databaseTargetIdentity(explicitTarget) ===
      databaseTargetIdentity(baseTarget)
  ) {
    throw new Error(
      "TEST_DATABASE_URL must identify a normalized target distinct from DATABASE_URL before the isolated wrapper rewrites DATABASE_URL",
    );
  }

  let testTarget;
  if (explicitTarget) {
    assertTestDatabaseTarget(explicitTarget, "TEST_DATABASE_URL");
    testTarget = explicitTarget;
  } else {
    const testDbName = baseTarget.database.endsWith("_test")
      ? baseTarget.database
      : `${baseTarget.database}_test`;
    testTarget = { ...baseTarget, database: testDbName };
  }

  const testDbName = assertTestDatabaseTarget(
    testTarget,
    "Resolved test database",
  );
  const testUrl = buildPostgresConnectionUrl(testTarget);
  const maintenanceUrl = buildPostgresConnectionUrl(testTarget, "postgres");
  const listenNotifyTestUrl = resolveListenNotifyTestUrl(
    env.LISTEN_NOTIFY_DATABASE_URL,
    testDbName,
  );

  return {
    testUrl,
    maintenanceUrl,
    testDbName,
    listenNotifyTestUrl,
    source: explicitTarget
      ? "TEST_DATABASE_URL"
      : "derived-from-DATABASE_URL",
  };
}

export function assertIsolatedTestDatabaseEnvironment(environment) {
  const env = stripLibpqTargetEnvironment(environment);
  if (env.VNDRLY_ISOLATED_TEST_DB !== "1") {
    throw new Error(
      "Refusing E2E execution without VNDRLY_ISOLATED_TEST_DB=1 from the isolated test database wrapper",
    );
  }
  const databaseUrl = env.DATABASE_URL;
  const testDatabaseUrl = env.TEST_DATABASE_URL;
  if (!databaseUrl || !testDatabaseUrl) {
    throw new Error(
      "Refusing E2E execution unless DATABASE_URL and TEST_DATABASE_URL are both set",
    );
  }

  const databaseTarget = parsePostgresConnectionUrl(databaseUrl);
  const testDatabaseTarget = parsePostgresConnectionUrl(testDatabaseUrl);
  if (
    databaseTargetIdentity(databaseTarget) !==
    databaseTargetIdentity(testDatabaseTarget)
  ) {
    throw new Error(
      "Refusing E2E execution unless DATABASE_URL and TEST_DATABASE_URL identify the same normalized database target",
    );
  }
  assertTestDatabaseTarget(testDatabaseTarget, "Isolated E2E target");
  if (env.VNDRLY_TEST_DB_MODE === "fresh-local") {
    assertFreshLocalTestDatabaseEnvironment(env);
  }
  return {
    databaseUrl: databaseTarget.connectionUrl,
    testDatabaseUrl: testDatabaseTarget.connectionUrl,
  };
}

export function assertLocalE2EBaseUrl(rawUrl) {
  const candidate = rawUrl === undefined ? LOCAL_E2E_BASE_URL : rawUrl.trim();
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      `E2E_BASE_URL must use the fixed local E2E origin ${LOCAL_E2E_BASE_URL}`,
    );
  }

  const isCanonicalLocalOrigin =
    url.protocol === "http:" &&
    url.hostname.toLowerCase() === "localhost" &&
    url.port === "23539" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";

  if (!isCanonicalLocalOrigin) {
    throw new Error(
      `E2E_BASE_URL must use the fixed local E2E origin ${LOCAL_E2E_BASE_URL}; external and alternate local targets are forbidden`,
    );
  }

  return LOCAL_E2E_BASE_URL;
}
