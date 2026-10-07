import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveFreshLocalTestDatabaseTarget, assertFreshLocalTestDatabaseEnvironment, freshLocalChildEnvironment } from '../fresh-test-database.mjs';

const migration=await readFile(new URL('../../artifacts/api-server/scripts/migrate-assistant-plan-execution.ts',import.meta.url),'utf8');
test('private executor migration adds only a nullable JSONB column and is rerunnable',()=>{
 const queries=[...migration.matchAll(/pool\.query\("([^"]+)"\)/g)].map(match=>match[1]);
 assert.deepEqual(queries,['ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_plan_executions jsonb']);
 assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE|DELETE|INSERT|UPDATE)\s+(?:TABLE|SCHEMA|DATABASE|FROM|INTO|users)\b/i);
 assert.doesNotMatch(queries[0],/DEFAULT|NOT NULL/i);
 assert.match(migration,/pool\.end\(\)/);
});
test('private executor state is absent from ordinary user projections',async()=>{
 const users=await readFile(new URL('../../lib/db/src/schema/users.ts',import.meta.url),'utf8');
 assert.doesNotMatch(users,/assistant_plan_executions|assistantPlanExecutions/);
});
test('rehearsal owns a fresh loopback baseline and never resets or loads shared configuration',async()=>{
 const script=await readFile(new URL('../../artifacts/api-server/scripts/rehearse-assistant-plan-execution.ts',import.meta.url),'utf8');
 assert.match(script,/assert\.equal\(process\.env\.VNDRLY_LOAD_ENV_LOCAL, "0"/);
 assert.match(script,/resolveFreshLocalTestDatabaseTarget\(process\.env\)/);
 assert.match(script,/freshLocalChildEnvironment\(process\.env, target\)/);
 assert.match(script,/assertFreshLocalTestDatabaseEnvironment\(childEnvironment\)/);
 assert.match(script,/provisionFreshLocalTestDatabase\(target/);
 assert.match(script,/import\("@workspace\/db\/schema"\)/);
 assert.match(script,/pushSchema\(schema, drizzle\(client, \{ schema \}\)/);
 assert.match(script,/current_database\(\).*inet_server_addr\(\).*inet_server_port\(\)/);
 assert.match(script,/await migrate\(\)/g);
 assert.equal((script.match(/await migrate\(\)/g)??[]).length,2);
 assert.match(script,/spawn\(process\.execPath, \["--import", "tsx", migrationPath\]/);
 assert.match(script,/env: childEnvironment/);
 assert.match(script,/WHERE id = \$1/);
 assert.match(script,/assert\.deepEqual\(replayed\.assistant_plan_executions, sentinel/);
 assert.match(script,/assert\.deepEqual\(replayed\.original, original/);
 assert.doesNotMatch(script,/DROP\s|TRUNCATE\s|DELETE\s+FROM|dotenv|load-env-local|\.env\.(?:local|production)|pushSchema[\s\S]*?\.apply\(/);
});
test('fresh safety helper refuses inherited or non-loopback targets and sanitizes child environment',()=>{
 assert.throws(()=>resolveFreshLocalTestDatabaseTarget({DATABASE_URL:'postgres://shared:private@remote.example:5432/live'}));
 assert.throws(()=>resolveFreshLocalTestDatabaseTarget({VNDRLY_TEST_DB_MODE:'fresh-local',VNDRLY_TEST_DB_MAINTENANCE_URL:'postgres://local:local@remote.example:5432/postgres'}));
 const env={VNDRLY_TEST_DB_MODE:'fresh-local',VNDRLY_TEST_DB_MAINTENANCE_URL:'postgres://local:local@127.0.0.1:5432/postgres',DATABASE_URL:'postgres://shared:private@remote.example:5432/live',TEST_DATABASE_URL:'postgres://shared:private@remote.example:5432/live',PGHOST:'remote.example',SUPABASE_SERVICE_ROLE_KEY:'private',VNDRLY_LOAD_ENV_LOCAL:'0'};
 const target=resolveFreshLocalTestDatabaseTarget(env),child=freshLocalChildEnvironment(env,target);
 assertFreshLocalTestDatabaseEnvironment(child);
 assert.match(target.testDbName,/^vndrly_[a-f0-9]{32}_test$/);
 assert.equal(child.PGHOST,undefined);assert.equal(child.SUPABASE_SERVICE_ROLE_KEY,undefined);
 assert.equal(new URL(child.DATABASE_URL).hostname,'127.0.0.1');
 assert.throws(()=>assertFreshLocalTestDatabaseEnvironment({...child,DATABASE_URL:env.DATABASE_URL}));
});
