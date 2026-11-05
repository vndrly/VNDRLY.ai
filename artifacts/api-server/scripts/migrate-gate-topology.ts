import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';
import pg from 'pg';
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
try {
  await client.connect();
  await client.query(guardAdditiveReplay('BEGIN'));
  await client.query(guardAdditiveReplay("SET LOCAL lock_timeout='5s'"));
  await client.query(guardAdditiveReplay('ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS topology jsonb'));
  await client.query(guardAdditiveReplay("ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_movements jsonb NOT NULL DEFAULT '[]'::jsonb"));
  await client.query(guardAdditiveReplay('COMMIT'));
  console.log('Gate topology and internal movement history ready; existing visits preserved.');
} catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
finally { await client.end(); }
