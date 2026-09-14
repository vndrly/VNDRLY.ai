import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl)
  throw new Error(
    "DATABASE_URL is required for the Implementation A migration",
  );

const migrationPath = fileURLToPath(
  new URL("../../drizzle/chunk_411_implementation_a.sql", import.meta.url),
);
const sql = await readFile(migrationPath, "utf8");
const forbidden =
  /\b(?:DROP|TRUNCATE|VACUUM\s+FULL)\b|\bDELETE\s+FROM\b|ALTER\s+TABLE\s+[^;]+\s+ALTER\s+COLUMN\s+[^;]+\s+TYPE/iu;
if (forbidden.test(sql)) {
  throw new Error(
    "Implementation A migration failed the additive-only safety check",
  );
}

const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [41120260914]);
  await client.query(sql);
  await client.query("COMMIT");
  process.stdout.write("Implementation A additive migration passed\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
