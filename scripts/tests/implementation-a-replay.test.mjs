import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { provisionFreshLocalTestDatabase, resolveFreshLocalTestDatabaseTarget } from '../fresh-test-database.mjs';

const { Client } = createRequire(new URL('../../lib/db/package.json', import.meta.url))('pg');
const sql = readFileSync(new URL('../../lib/db/drizzle/chunk_411_implementation_a.sql', import.meta.url), 'utf8');
const unguarded = sql.replace(/DO \$replay\$\s+BEGIN\s+IF [\s\S]*? THEN\s+([\s\S]*?)\s+END IF;\s+END \$replay\$;/g, '$1');

test('all historical column and index additions have catalog preflight guards', () => {
  assert.equal([...sql.matchAll(/DO \$replay\$/g)].length,
    [...unguarded.matchAll(/ALTER TABLE "\w+"\s+ADD COLUMN IF NOT EXISTS/g)].length +
    [...unguarded.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)].length);
  assert.equal([...unguarded.matchAll(/ADD COLUMN IF NOT EXISTS/g)].length, 29);
});

test('full migration installs missing objects, then replays without blocking readers or writers',
  { skip: process.env.VNDRLY_TEST_DB_MODE !== 'fresh-local' }, async () => {
    const target = resolveFreshLocalTestDatabaseTarget(process.env);
    const created = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map(m => m[1]));
    const references = new Map([...sql.matchAll(/"\w+" (integer|uuid)(?: NOT NULL)? REFERENCES "(\w+)"\("id"\)/g)]
      .map(m => [m[2], m[1]]));
    const stubs = [...references].filter(([name]) => !created.has(name))
      .map(([name, type]) => `CREATE TABLE public."${name}" (id ${type} PRIMARY KEY)`);
    // Notifications is extended by this migration, rather than created by it.
    stubs.push('CREATE TABLE public.notifications (id integer PRIMARY KEY)');
    await provisionFreshLocalTestDatabase(target, url => new Client({ connectionString: url }),
      async () => ({ hasDataLoss: false, warnings: [], statementsToExecute: stubs }));
    const admin = new Client({ connectionString: target.testUrl });
    const worker = new Client({ connectionString: target.testUrl });
    try {
      await admin.connect();
      await admin.query(sql);
      await admin.query('INSERT INTO notifications(id) VALUES (7)');
      const before = (await admin.query('SELECT * FROM notifications')).rows;
      await worker.connect();
      await worker.query('BEGIN');
      await worker.query('SELECT * FROM notifications');
      await worker.query('LOCK TABLE notifications, site_visits, field_trips, managed_subcontractor_sponsors IN ROW EXCLUSIVE MODE');
      await admin.query("SET lock_timeout='300ms'");
      await assert.rejects(admin.query(unguarded), error => error.code === '55P03');
      await admin.query('BEGIN');
      await admin.query(sql);
      await admin.query('COMMIT');
      assert.deepEqual((await admin.query('SELECT * FROM notifications')).rows, before);
      assert.equal((await admin.query("SELECT column_default FROM information_schema.columns WHERE table_name='notifications' AND column_name='delivery_status'")).rows[0].column_default, "'pending'::text");
    } finally {
      await worker.query('ROLLBACK').catch(() => {});
      await worker.end();
      await admin.query('ROLLBACK').catch(() => {});
      await admin.end();
    }
  });
