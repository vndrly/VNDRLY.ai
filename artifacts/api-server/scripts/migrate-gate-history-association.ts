import { pool } from '@workspace/db';
// @ts-ignore Shared operational migration module follows the existing .mjs migration convention.
import { migrateGateHistoryAssociations } from '../../../scripts/gate-history-association-migration.mjs';
const c = await pool.connect();
try {
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='5s'");
  await c.query("SET LOCAL statement_timeout='30s'");
  await migrateGateHistoryAssociations(c);
  await c.query('COMMIT');
  console.log('Gate history association additive migration complete');
} catch (error) { await c.query('ROLLBACK'); throw error; }
finally { c.release(); await pool.end(); }
