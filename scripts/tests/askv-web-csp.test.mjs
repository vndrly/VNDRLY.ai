import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const config=readFileSync(new URL('../server/vndrly.ai.nginx.conf',import.meta.url),'utf8');
test('every served app policy permits the official Realtime SDK signaling endpoint',()=>{
  const policies=[...config.matchAll(/add_header Content-Security-Policy "([^"]+)" always;/g)].map(match=>match[1]);
  assert.equal(policies.length,3);
  for(const policy of policies){
    const connect=policy.split(';').find(part=>part.trim().startsWith('connect-src')).trim().split(/\s+/);
    assert.ok(connect.includes('https://api.openai.com/v1/realtime/calls'));
    assert.ok(!connect.includes('*'));
    assert.ok(policy.includes("script-src 'self';"));
    assert.ok(policy.includes("object-src 'none';"));
  }
  assert.ok(config.includes('microphone=(self)'));
});
