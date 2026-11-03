import { expect, it } from "vitest";
import { instrumentPoolTimings, withDatabaseTimings } from "../../../../lib/db/src/query-timings";

function fakePool() {
  const pool: any = {
    waitingCount: 1,
    connect(callback: (...args: any[]) => void) { setTimeout(() => callback(null, {}, () => {}), 8); },
    query(...args: any[]) {
      const callback = typeof args.at(-1) === "function" ? args.at(-1) : undefined;
      const execute = (done: (...args: any[]) => void) => pool.connect((error: Error | null) => {
        if (error) return done(error);
        setTimeout(() => done(args[0] === "fail" ? new Error("query failed") : null, { rows: [1] }), 8);
      });
      if (callback) return execute(callback);
      return new Promise((resolve, reject) => execute((error, value) => error ? reject(error) : resolve(value)));
    },
  };
  instrumentPoolTimings(pool);
  return pool;
}
it("separates connection acquisition from execution without retaining SQL or values", async () => {
  const pool = fakePool();
  const result = await withDatabaseTimings(() => pool.query("SELECT confidential", ["private"]));
  expect(result.value).toEqual({ rows: [1] });
  expect(result.timings.queries).toBe(1);
  expect(result.timings.waitMs).toBeGreaterThan(3);
  expect(result.timings.sqlMs).toBeGreaterThan(3);
  expect(result.timings.maxWaiting).toBe(1);
  expect(JSON.stringify(result.timings)).not.toMatch(/confidential|private/);
});
it("preserves callback and failure behavior", async () => {
  const pool = fakePool();
  const result = await withDatabaseTimings(() => new Promise(resolve => pool.query("ok", (_error: unknown, value: unknown) => resolve(value))));
  expect(result.value).toEqual({ rows: [1] });
  expect(result.timings.queries).toBe(1);
  await expect(withDatabaseTimings(() => pool.query("fail"))).rejects.toThrow("query failed");
  expect(await pool.query("ok")).toEqual({ rows: [1] });
});
it("keeps overlapping request counters isolated", async () => {
  const pool = fakePool();
  const [one, two] = await Promise.all([
    withDatabaseTimings(() => pool.query("one")),
    withDatabaseTimings(() => Promise.all([pool.query("two"), pool.query("three")])) ,
  ]);
  expect(one.timings.queries).toBe(1);
  expect(two.timings.queries).toBe(2);
});
