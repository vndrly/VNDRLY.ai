import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createResilientPostgresPool,
  type PostgresConnectionFailure,
} from "../../../../lib/db/src/pool-resilience";

const pools: ReturnType<typeof createResilientPostgresPool>[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

function createPool(report: (failure: PostgresConnectionFailure) => void) {
  const pool = createResilientPostgresPool(
    { connectionString: "postgres://localhost/unused" },
    report,
  );
  pools.push(pool);
  return pool;
}

describe("createResilientPostgresPool", () => {
  it("handles a connection reset emitted while a client is checked out", () => {
    const report = vi.fn();
    const pool = createPool(report);
    const client = new EventEmitter() as unknown as PoolClient;
    const error = new Error("Connection terminated unexpectedly");

    pool.emit("connect", client);

    expect(() => client.emit("error", error)).not.toThrow();
    expect(report).toHaveBeenCalledWith({ scope: "client", error });
  });

  it("handles a connection reset re-emitted by the pool", () => {
    const report = vi.fn();
    const pool = createPool(report);
    const error = new Error("Connection terminated unexpectedly");

    expect(() => pool.emit("error", error)).not.toThrow();
    expect(report).toHaveBeenCalledWith({ scope: "pool", error });
  });
});
