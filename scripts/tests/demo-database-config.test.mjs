import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveDemoDatabaseUrl} from '../demo-database-config.mjs';
test('demo scripts have no production fallback',()=>{
 assert.throws(()=>resolveDemoDatabaseUrl({DATABASE_URL:'postgresql://user:pass@host/production'}),/not configured/);
 assert.throws(()=>resolveDemoDatabaseUrl({DEMO_DATABASE_URL:'postgresql://user:pass@host/production'}),/Wrong demo database/);
 assert.equal(new URL(resolveDemoDatabaseUrl({DEMO_DATABASE_URL:'postgresql://demo:pass@host/vndrly_prairie_demo'})).pathname,'/vndrly_prairie_demo');
});
