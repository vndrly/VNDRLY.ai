import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

export type DatabaseTimings = { queries: number; waitMs: number; sqlMs: number; maxWaitMs: number; maxSqlMs: number; maxWaiting: number; stages: Record<string, number> };
const requests = new AsyncLocalStorage<DatabaseTimings>();
const queries = new AsyncLocalStorage<{ waitMs: number }>();

/** Opt-in numeric diagnostics only. SQL, parameters and user data are never retained. */
export async function withDatabaseTimings<T>(action: () => Promise<T>) {
  const timings: DatabaseTimings = { queries: 0, waitMs: 0, sqlMs: 0, maxWaitMs: 0, maxSqlMs: 0, maxWaiting: 0, stages: {} };
  const started = performance.now();
  const value = await requests.run(timings, action);
  return { value, timings, elapsedMs: performance.now() - started };
}

export async function timeDatabaseStage<T>(name: string, action: () => Promise<T>) {
  const timings = requests.getStore();
  if (!timings) return action();
  const started = performance.now();
  try { return await action(); }
  finally { timings.stages[name] = (timings.stages[name] ?? 0) + performance.now() - started; }
}

export function startDatabaseStage(name: string) {
  const timings = requests.getStore(), started = performance.now();
  return () => { if (timings) timings.stages[name] = (timings.stages[name] ?? 0) + performance.now() - started; };
}

export function instrumentPoolTimings(pool: pg.Pool) {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  pool.connect = function (...args: any[]) {
    const span = queries.getStore();
    if (!span) return (originalConnect as any)(...args);
    const started = performance.now();
    if (typeof args[0] === "function") {
      const callback = args[0];
      return (originalConnect as any)((...result: any[]) => {
        span.waitMs += performance.now() - started;
        callback(...result);
      });
    }
    return (originalConnect as any)(...args).then((client: unknown) => {
      span.waitMs += performance.now() - started;
      return client;
    });
  } as pg.Pool["connect"];
  pool.query = function (...args: any[]) {
    const timings = requests.getStore();
    if (!timings) return (originalQuery as any)(...args);
    const started = performance.now(), span = { waitMs: 0 };
    timings.maxWaiting = Math.max(timings.maxWaiting, pool.waitingCount);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const sqlMs = Math.max(0, performance.now() - started - span.waitMs);
      timings.queries++;
      timings.waitMs += span.waitMs;
      timings.sqlMs += sqlMs;
      timings.maxWaitMs = Math.max(timings.maxWaitMs, span.waitMs);
      timings.maxSqlMs = Math.max(timings.maxSqlMs, sqlMs);
    };
    const last = args.length - 1;
    if (typeof args[last] === "function") {
      const callback = args[last];
      args[last] = (...result: any[]) => { finish(); callback(...result); };
      return queries.run(span, () => (originalQuery as any)(...args));
    }
    try {
      return queries.run(span, () => (originalQuery as any)(...args)).then(
        (value: unknown) => { finish(); return value; },
        (error: unknown) => { finish(); throw error; },
      );
    } catch (error) { finish(); throw error; }
  } as pg.Pool["query"];
}
