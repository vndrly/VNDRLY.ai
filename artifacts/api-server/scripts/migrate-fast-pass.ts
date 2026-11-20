import pg from "pg";
import { guardAdditiveReplay } from "../../../scripts/guard-additive-replay.mjs";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(guardAdditiveReplay("BEGIN"));
  await client.query(guardAdditiveReplay("SET LOCAL lock_timeout='5s'"));
  await client.query(guardAdditiveReplay("ALTER TABLE field_trips ADD COLUMN IF NOT EXISTS fast_pass jsonb"));
  await client.query(guardAdditiveReplay("COMMIT"));
  console.info("Fast Pass trip details column is ready.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
