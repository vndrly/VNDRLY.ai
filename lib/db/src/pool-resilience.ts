import pg, { type PoolConfig } from "pg";

const { Pool } = pg;

export type PostgresConnectionFailure = {
  scope: "client" | "pool";
  error: Error;
};

export function createResilientPostgresPool(
  config: PoolConfig,
  report: (failure: PostgresConnectionFailure) => void,
): pg.Pool {
  const pool = new Pool(config);

  pool.on("connect", (client) => {
    client.on("error", (error) => report({ scope: "client", error }));
  });
  pool.on("error", (error) => report({ scope: "pool", error }));

  return pool;
}
