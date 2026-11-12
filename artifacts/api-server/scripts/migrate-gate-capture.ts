import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(guardAdditiveReplay('BEGIN'));
  await client.query(guardAdditiveReplay("SET LOCAL lock_timeout = '5s'"));
  await client.query(guardAdditiveReplay("SET LOCAL statement_timeout = '30s'"));
  await client.query(guardAdditiveReplay('ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_capture jsonb'));
  await client.query(guardAdditiveReplay('COMMIT'));
  console.log('Gate capture additive migration passed');
} finally { await client.end(); }
