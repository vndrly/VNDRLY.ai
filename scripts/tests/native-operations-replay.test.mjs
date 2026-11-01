import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { provisionFreshLocalTestDatabase, resolveFreshLocalTestDatabaseTarget } from '../fresh-test-database.mjs';
const require = createRequire(new URL('../../lib/db/package.json', import.meta.url));
const { Client } = require('pg');
const runner = new URL('../../artifacts/api-server/scripts/migrate-native-operations.ts', import.meta.url);
const source = readFileSync(runner, 'utf8');
const statements = [...source.matchAll(/^  ("ALTER TABLE .*"),$/gm)].map(m => JSON.parse(m[1]));

test('native operations initially installs columns and repeats while all target tables are in use',
  { skip: process.env.VNDRLY_TEST_DB_MODE !== 'fresh-local' }, async () => {
    assert.equal(statements.length, 6);
    const target = resolveFreshLocalTestDatabaseTarget(process.env);
    const tables = statements.map(s => s.match(/^ALTER TABLE (\w+)/)[1]);
    await provisionFreshLocalTestDatabase(target, url => new Client({ connectionString: url }),
      async () => ({ hasDataLoss: false, warnings: [], statementsToExecute: tables.map(t => `CREATE TABLE ${t}(id integer PRIMARY KEY)`) }));
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [require.resolve('tsx/cli'), runner.pathname.replace(/^\/([A-Za-z]:)/, '$1')],
        { env: { ...process.env, DATABASE_URL: target.testUrl, PGOPTIONS: '-c lock_timeout=300ms' } });
      let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(output)));
    });
    await run();
    const reader = new Client({ connectionString: target.testUrl });
    const admin = new Client({ connectionString: target.testUrl });
    try {
      await reader.connect(); await admin.connect();
      await admin.query('INSERT INTO vendors(id) VALUES(7)');
      await reader.query('BEGIN');
      await reader.query(`LOCK TABLE ${tables.join(',')} IN ROW EXCLUSIVE MODE`);
      await admin.query("SET lock_timeout='300ms'");
      await assert.rejects(admin.query(statements[1]), e => e.code === '55P03');
      await run();
      assert.deepEqual((await admin.query('SELECT * FROM vendors')).rows, [{ id: 7, native_operations_policy: {} }]);
    } finally {
      await reader.query('ROLLBACK').catch(() => {}); await reader.end(); await admin.end();
    }
  });
