import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(guardAdditiveReplay("BEGIN"));
  await client.query(guardAdditiveReplay("SET LOCAL lock_timeout = '5s'"));
  await client.query(guardAdditiveReplay("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_path text"));
  await client.query(guardAdditiveReplay("COMMIT"));
  console.log("Personal profile photo column ready; existing accounts unchanged.");
} catch (error) {
  await client.query(guardAdditiveReplay("ROLLBACK")).catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
