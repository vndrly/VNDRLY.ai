import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect(); await client.query(guardAdditiveReplay("BEGIN")); await client.query(guardAdditiveReplay("SET LOCAL lock_timeout='5s'"));
  await client.query(guardAdditiveReplay("ALTER TABLE workforce_staffing_requirements ADD COLUMN IF NOT EXISTS gate_definition jsonb"));
  await client.query(guardAdditiveReplay("ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS gate_definition_id uuid"));
  await client.query(guardAdditiveReplay("COMMIT"));
  console.log("Gate shift definition columns ready; no schedules or assignments changed.");
} catch (error) { await client.query(guardAdditiveReplay("ROLLBACK")).catch(() => undefined); throw error; }
finally { await client.end(); }
