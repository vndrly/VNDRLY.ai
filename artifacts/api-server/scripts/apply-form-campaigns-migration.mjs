import { readFile } from "node:fs/promises";
import pg from "pg";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the form campaigns migration");
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query(await readFile(new URL("../../../lib/db/drizzle/chunk_417_form_campaigns.sql", import.meta.url), "utf8"));
  process.stdout.write("Form campaigns migration passed\n");
} finally { await client.end().catch(() => undefined); }
