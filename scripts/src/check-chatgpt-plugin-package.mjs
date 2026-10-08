import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('integrations/chatgpt-plugin');
const identity = 'dev-6ac4f61e0aac8191b7f7b4fbbc5822b0';
const manifests = ['plugin.json', '.codex-plugin/plugin.json', '.codex-plugin/.codex-plugin/plugin.json'].map(p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8')));
for (const manifest of manifests) {
  assert.equal(manifest.name, identity, 'Preserve the existing plugin identity');
  assert.equal(manifest.version, manifests[0].version, 'Manifest versions must agree');
}
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.app.json'),'utf8')).apps['vndrly-assistant'].id,'asdk_app_6ac4f61e0aac8191b7f7b4fbbc5822b0');
const expected = new Map([
  ['vndrly-work-hub','VNDRLY/work hub'], ['vndrly-gate','VNDRLY/gate'],
  ['vndrly-field-ops','VNDRLY/field ops'], ['vndrly-fleet','VNDRLY/fleet'],
  ['vndrly-inventory','VNDRLY/inventory'],
]);
const installed = fs.readdirSync(path.join(root,'skills')).filter(id=>fs.existsSync(path.join(root,'skills',id,'SKILL.md')));
assert.deepEqual(installed.sort(), [...expected.keys()].sort(), 'Exactly the five approved product skills must ship');
for (const [id,label] of expected) {
  const dir = path.join(root,'skills',id);
  const skill = fs.readFileSync(path.join(dir,'SKILL.md'),'utf8');
  const metadata = fs.readFileSync(path.join(dir,'agents/openai.yaml'),'utf8');
  assert(skill.startsWith(`---\nname: ${id}\n`));
  assert(skill.includes(`# ${label}\n`));
  assert(metadata.includes(`display_name: ${JSON.stringify(label)}`), `Exact user label: ${label}`);
  assert(metadata.includes(`$${id}`));
  assert(!skill.includes('V — VNDRLY workday'));
  assert(fs.statSync(path.join(dir,'references/operations.md')).size > 0);
}
console.log(JSON.stringify({version:manifests[0].version,identity,skills:[...expected.values()],result:'passed'}));
