import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect(); await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("ALTER TABLE workforce_staffing_requirements ADD COLUMN IF NOT EXISTS gate_definition jsonb");
  await client.query("ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS gate_definition_id uuid");
  await client.query("COMMIT");
  console.log("Gate shift definition columns ready; no schedules or assignments changed.");
} catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
finally { await client.end(); }
