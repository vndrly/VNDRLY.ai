import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLocalSecret } from '../parse-local-secret.mjs';
const jwt = (ref,role) => 'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({ref,role})).toString('base64url')+'.synthetic';
test('env quotes and comments',()=>assert.equal(parseLocalSecret('OPENAI_API_KEY="example" # note').OPENAI_API_KEY,'example'));
test('legacy Supabase notes select matching service role',()=>{
 const good=jwt('example','service_role');
 assert.equal(parseLocalSecret(`https://example.supabase.co\n${jwt('other','service_role')}\n${jwt('example','anon')}\n${good}`).SUPABASE_SERVICE_ROLE_KEY,good);
});
test('unrelated project is rejected',()=>assert.equal(parseLocalSecret(`https://example.supabase.co\n${jwt('other','service_role')}`).SUPABASE_SERVICE_ROLE_KEY,undefined));
test('explicit credential wins',()=>assert.equal(parseLocalSecret(`SUPABASE_SERVICE_ROLE_KEY=explicit\nhttps://example.supabase.co\n${jwt('example','service_role')}`).SUPABASE_SERVICE_ROLE_KEY,'explicit'));
import { spawnSync } from 'node:child_process';
test('fresh-local skips machine-owned files and raw fallbacks',()=>{
 const env={...process.env,VNDRLY_TEST_DB_MODE:'fresh-local',SUPABASE_ENV:process.cwd(),ANTHROPIC_ENV:process.cwd()};
 for(const k of ['DATABASE_URL','ANTHROPIC_API_KEY','AI_INTEGRATIONS_ANTHROPIC_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])delete env[k];
 const r=spawnSync(process.execPath,['--input-type=module','-e',`await import('./scripts/load-env-local.mjs'); if(process.env.DATABASE_URL || process.env.ANTHROPIC_API_KEY || process.env.SUPABASE_URL) process.exit(1);`],{env,encoding:'utf8'});
 assert.equal(r.status,0,'isolated validation must not read external secret files');
});
