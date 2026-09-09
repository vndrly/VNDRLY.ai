import { readFile } from "node:fs/promises";
import pg from "pg";
if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(await readFile(new URL("../../../lib/db/drizzle/chunk_407_work_hub_scheduling.sql", import.meta.url), "utf8"));
  process.stdout.write("Work Hub scheduling migration passed\n");
} finally { await client.end().catch(() => undefined); }
