import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL?.trim();
if (!url) throw new Error('DATABASE_URL is required');
const statements = (await readFile(new URL('../../../lib/db/drizzle/work_crew_assignments_additive.sql', import.meta.url), 'utf8')).split(';').map(s=>s.trim()).filter(Boolean);
for(const statement of statements) if(!/^ALTER TABLE [a-z_]+ ADD COLUMN IF NOT EXISTS /i.test(statement)||/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i.test(statement)) throw new Error('Unsafe work crew migration');
const client = new pg.Client({connectionString:url});
try { await client.connect(); await client.query('BEGIN'); for(const statement of statements)await client.query(guardAdditiveReplay(statement)); await client.query('COMMIT'); process.stdout.write('Work crew additive migration passed\n'); }
catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
finally { await client.end().catch(()=>{}); }
