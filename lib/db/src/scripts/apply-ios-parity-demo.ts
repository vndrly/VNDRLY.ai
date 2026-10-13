import pg from "pg";

// The isolated demo receives the same additive columns, never a reseed/restore.
if (!process.env.DATABASE_URL || !process.env.DEMO_DATABASE_URL) throw Error("Both production and isolated demo database configuration are required");
const production = new pg.Client({ connectionString: process.env.DATABASE_URL });
const demo = new pg.Client({ connectionString: process.env.DEMO_DATABASE_URL });
try {
  await Promise.all([production.connect(), demo.connect()]);
  const identity = "select current_database() name, host(inet_server_addr()) address, inet_server_port() port";
  const [a, b] = await Promise.all([production.query(identity), demo.query(identity)]);
  if (b.rows[0].name !== "vndrly_prairie_demo" || JSON.stringify(a.rows[0]) === JSON.stringify(b.rows[0])) throw Error("Demo migration requires a verified separate demo database");
  await demo.query("BEGIN");
  for (const statement of [
    "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS operations_categories text[]",
    "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fleet_commercial_settings jsonb",
    "ALTER TABLE partners ADD COLUMN IF NOT EXISTS fleet_commercial_settings jsonb",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fleet_plan jsonb",
    "ALTER TABLE site_locations ADD COLUMN IF NOT EXISTS fleet_ticket_policy jsonb",
    "ALTER TABLE gate_duty_sessions ADD COLUMN IF NOT EXISTS post_coverage jsonb NOT NULL DEFAULT '{}'::jsonb",
  ]) await demo.query(statement);
  await demo.query("COMMIT");
  console.log("Isolated demo parity columns available; rows and credentials preserved.");
} catch (error) {
  await demo.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await Promise.all([production.end(), demo.end()]);
}
