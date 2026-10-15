import pg from "pg";
const statements = [
 "ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS check_in_gps_evidence jsonb",
 "ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS check_out_gps_evidence jsonb",
];
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
try {
 await client.connect();
 await client.query("BEGIN");
 await client.query("SET LOCAL lock_timeout = '5s'");
 await client.query("SET LOCAL statement_timeout = '30s'");
 for (const statement of statements) await client.query(statement);
 await client.query("COMMIT");
 console.log("Gate visit GPS additive migration passed");
} finally { await client.end(); }
