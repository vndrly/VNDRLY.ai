import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolConfig } from "pg";

const trainingWorkerContext = new AsyncLocalStorage<true>();

/** Explicit worker opt-in, scoped to this async chain and its descendants. */
export function runWithTrainingWorkerDatabase<T>(action: () => T): T {
  return trainingWorkerContext.run(true, action);
}

/** Fixed limits keep background projections off the ordinary request pool. */
export function trainingWorkerPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: 2,
    application_name: "vndrly-training-projections",
    statement_timeout: 60_000,
    connectionTimeoutMillis: 10_000,
  };
}

/** The supplied dispatchers retain their own production/demo realm selection. */
export function createTrainingWorkerDispatcher<T extends object>(
  requestDatabase: T,
  workerDatabase: () => T,
): T {
  return new Proxy(requestDatabase, {
    get(_target, property) {
      const target = trainingWorkerContext.getStore()
        ? workerDatabase()
        : requestDatabase;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
