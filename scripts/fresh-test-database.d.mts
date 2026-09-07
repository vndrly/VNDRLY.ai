import type { ResolvedIsolatedTestDatabaseTarget } from "./e2e-isolation.mjs";

export type FreshLocalTarget = Omit<
  ResolvedIsolatedTestDatabaseTarget,
  "source"
> & { source: "fresh-local" };
export interface FreshSchemaPlan {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
}
export interface FreshDatabaseClient {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}
export function resolveFreshLocalTestDatabaseTarget(
  env: Record<string, string | undefined>,
): FreshLocalTarget;
export function assertFreshLocalTestDatabaseEnvironment(
  env: Record<string, string | undefined>,
): void;
export function freshLocalChildEnvironment(
  env: Record<string, string | undefined>,
  target: FreshLocalTarget,
): Record<string, string | undefined>;
export function assertAdditiveSchemaPlan(plan: FreshSchemaPlan): void;
export function provisionFreshLocalTestDatabase<T extends FreshDatabaseClient>(
  target: FreshLocalTarget,
  createClient: (url: string) => T,
  buildSchemaPlan: (client: T) => Promise<FreshSchemaPlan>,
): Promise<void>;
