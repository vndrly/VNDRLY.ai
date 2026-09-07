import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openAiEnvPath } from './secrets-path.mjs';
import { createAskVRealtimeClientSecret, DEFAULT_ASKV_REALTIME_MODEL } from '../artifacts/api-server/src/assistant/realtime-session.ts';
import { toRealtimeTools } from '../artifacts/api-server/src/assistant/tool-registry.ts';

assert.equal(process.env.ASKV_AUTHENTICATED_LIVE_TEST, '1', 'Explicit provider check opt-in required');
const credentialFile = await readFile(openAiEnvPath(), 'utf8');
const apiKey = credentialFile.split(/\r?\n/).map(line => line.match(/^\s*OPENAI_API_KEY\s*=\s*(.*?)\s*$/i)).find(Boolean)?.[1];
assert.ok(apiKey, 'Approved server credential missing');
const tool = toRealtimeTools([{ name: 'synthetic_read_only_probe', description: 'Synthetic schema validation only. Never invoked.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, roles: ['admin'], mutating: false, confirmation: 'none' }])[0];
const safe = value => typeof value === 'string' && /^[\w.[\]-]{1,160}$/.test(value) ? value : undefined;
for (const [label, candidate, accepted] of [['unsupported_tool_strict', { ...tool, strict: true }, false], ['production_tool_shape', tool, true]]) {
  const result = { shape: label, accepted: false };
  try {
    await createAskVRealtimeClientSecret({ apiKey, userId: 0, model: DEFAULT_ASKV_REALTIME_MODEL, voice: 'marin',
      instructions: 'Synthetic schema validation. No conversation will be opened.', tools: [candidate], fetchImpl: async (input, init) => {
        const response = await fetch(input, { ...init, signal: AbortSignal.timeout(30000) });
        result.status = response.status;
        if (!response.ok) { const body = await response.clone().json(); result.error = { code: safe(body.error?.code), param: safe(body.error?.param), type: safe(body.error?.type) }; }
        return response;
      } });
    result.accepted = true;
  } catch { /* Report only allowlisted provider metadata, never the credential. */ }
  console.log(JSON.stringify(result));
  assert.equal(result.accepted, accepted, `Unexpected provider contract for ${label}`);
  if (!accepted) {
    assert.equal(result.error?.code, 'unknown_parameter');
    assert.equal(result.error?.param, 'session.tools[0].strict');
  }
}
