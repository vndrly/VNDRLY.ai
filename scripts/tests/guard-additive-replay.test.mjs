import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { guardAdditiveReplay } from '../guard-additive-replay.mjs';
import { provisionFreshLocalTestDatabase, resolveFreshLocalTestDatabaseTarget } from '../fresh-test-database.mjs';
const { Client } = createRequire(new URL('../../lib/db/package.json', import.meta.url))('pg');

test('opaque SQL and parameters remain unchanged', () => {
  for (const sql of [
    'BEGIN', 'COMMIT', 'SELECT id FROM vendors WHERE id=$1 FOR UPDATE',
    "DO $$ BEGIN PERFORM 'ALTER TABLE example;'; END $$;",
    "DO $body$ BEGIN PERFORM ';'; END $body$; -- trailing comment",
    "SELECT 'a;''b', \"quoted;identifier\"; /* ; */ SELECT 2;",
  ]) assert.equal(guardAdditiveReplay(sql), sql);
  assert.throws(() => guardAdditiveReplay('DO $$ unclosed'), /Unterminated/);
});

test('single and multi-statement additions get stable guards without changing DDL', () => {
  const original = '-- comment\nALTER TABLE "public"."probe"\nADD COLUMN IF NOT EXISTS "note" text DEFAULT \'a;b\';\nCREATE UNIQUE INDEX IF NOT EXISTS "probe_id_idx" ON probe(id);';
  const guarded = guardAdditiveReplay(original);
  assert.ok(guarded.includes(original.split(';\n')[0]));
  assert.match(guarded, /attrelid='public.probe'::regclass AND attname='note'/);
  assert.match(guarded, /to_regclass\('public.probe_id_idx'\) IS NULL/);
  assert.equal(guardAdditiveReplay(guarded), guarded);
});

test('missing objects install, existing columns/indexes replay under live read/write locks',
  { skip: process.env.VNDRLY_TEST_DB_MODE !== 'fresh-local' }, async () => {
    const target = resolveFreshLocalTestDatabaseTarget(process.env);
    await provisionFreshLocalTestDatabase(target, url => new Client({ connectionString: url }),
      async () => ({ hasDataLoss: false, warnings: [], statementsToExecute: ['CREATE TABLE probe(id integer PRIMARY KEY)'] }));
    const admin = new Client({ connectionString: target.testUrl });
    const worker = new Client({ connectionString: target.testUrl });
    const sql = `ALTER TABLE probe ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT 'keep;me'; CREATE INDEX IF NOT EXISTS probe_note_idx ON probe(note);`;
    try {
      await admin.connect(); await worker.connect();
      await admin.query(guardAdditiveReplay(sql));
      await admin.query('INSERT INTO probe(id) VALUES(7)');
      await worker.query('BEGIN');
      await worker.query('SELECT * FROM probe');
      await worker.query('LOCK TABLE probe IN ROW EXCLUSIVE MODE');
      await admin.query("SET lock_timeout='300ms'");
      await assert.rejects(admin.query(sql), e => e.code === '55P03');
      await admin.query(guardAdditiveReplay(sql));
      assert.deepEqual((await admin.query('SELECT * FROM probe')).rows, [{ id: 7, note: 'keep;me' }]);
    } finally {
      await worker.query('ROLLBACK').catch(() => {}); await worker.end(); await admin.end();
    }
  });
