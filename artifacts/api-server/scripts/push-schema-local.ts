/** Push the current @workspace/db schema into a fresh LOCAL database.
 * Refuses anything that is not a loopback host, and refuses the maintenance
 * `postgres` database. Used to stage go-ecosphere data; see docs/go-ecosphere.md.
 *
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/vndrly_go_demo npx tsx scripts/push-schema-local.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import pg from "pg";
import * as schema from "@workspace/db/schema";

const target = new URL(process.env.DATABASE_URL ?? "");
const database = target.pathname.replace(/^\//, "");
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(target.hostname)) throw new Error("push-schema-local only targets a loopback Postgres host");
if (!database || database === "postgres") throw new Error("Name a dedicated local database, not the maintenance database");

const pool = new pg.Pool({ connectionString: target.toString() });
const { rows } = await pool.query("select count(*)::int n from information_schema.tables where table_schema='public'");
if (rows[0].n > 0) {
  await pool.end();
  throw new Error(`${database} already has ${rows[0].n} tables; create a new empty database instead`);
}
const db = drizzle(pool, { schema });
const { apply } = await pushSchema(schema as Record<string, unknown>, db as unknown as PgDatabase<never>);
await apply();
await pool.end();
console.log(`Schema pushed to ${database}`);
