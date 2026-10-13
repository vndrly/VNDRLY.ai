import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("ALTER TABLE vendors ADD COLUMN IF NOT EXISTS operations_categories text[]");
  console.log("Company operations category column is available; existing selections and records preserved.");
} finally { await client.end(); }
