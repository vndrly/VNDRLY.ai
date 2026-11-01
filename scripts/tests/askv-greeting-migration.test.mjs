import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAskVGreetingMigration} from '../askv-greeting-migration.mjs';
const sql='ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "askv_last_full_greeting_on" text;';
const correct={data_type:'text',is_nullable:'YES'};
test('an already applied column never attempts DDL even when users DDL would block',async()=>{
 let reads=0;
 await runAskVGreetingMigration({query:async q=>{assert.ok(q.startsWith('SELECT '),'no DDL allowed for an existing column');reads++;return{rows:[correct]};}},sql);
 assert.equal(reads,1);
});
test('a missing column uses only the approved additive statement and verifies it',async()=>{
 const calls=[];
 await runAskVGreetingMigration({query:async q=>{calls.push(q);return{rows:q.startsWith('SELECT')&&calls.length>1?[correct]:[]};}},sql);
 assert.equal(calls.length,3);assert.equal(calls[1],sql.slice(0,-1));
});
test('an incompatible existing column fails without altering it',async()=>{
 await assert.rejects(runAskVGreetingMigration({query:async q=>{assert.ok(q.startsWith('SELECT'));return{rows:[{data_type:'integer',is_nullable:'YES'}]};}},sql),/incompatible/);
});
test('unapproved SQL is rejected before contacting the database',async()=>{
 await assert.rejects(runAskVGreetingMigration({query:async()=>{throw Error('must not query');}},'DROP TABLE users;'),/exactly the approved additive/);
});
