export interface IsolatedDatabaseEnvironment {
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
  LISTEN_NOTIFY_DATABASE_URL?: string;
  VNDRLY_ISOLATED_TEST_DB?: string;
  VNDRLY_TEST_DB_MODE?: string;
  VNDRLY_FRESH_TEST_DB_NAME?: string;
  VNDRLY_LOAD_ENV_LOCAL?: string;
}

export interface ResolvedIsolatedTestDatabaseTarget {
  testUrl: string;
  maintenanceUrl: string;
  testDbName: string;
  listenNotifyTestUrl?: string;
  source: "TEST_DATABASE_URL" | "derived-from-DATABASE_URL";
}

export const LOCAL_E2E_BASE_URL: "http://localhost:23539";

export function sanitizePostgresConnectionUrl(rawUrl: string): string;
export function stripLibpqTargetEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string | undefined>;
export function normalizeDatabaseTarget(rawUrl: string): string;
export function resolveIsolatedTestDatabaseTarget(
  env: IsolatedDatabaseEnvironment,
): ResolvedIsolatedTestDatabaseTarget;
export function assertIsolatedTestDatabaseEnvironment(
  env: IsolatedDatabaseEnvironment,
): { databaseUrl: string; testDatabaseUrl: string };
export function assertLocalE2EBaseUrl(rawUrl?: string): string;
