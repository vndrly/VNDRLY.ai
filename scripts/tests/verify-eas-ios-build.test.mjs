import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyIosBuild } from '../verify-eas-ios-build.mjs';

const sha = 'bd0538fc7f1d4ed69fd4e6a359f1bdf87ddfa931';
const projectId = 'fb31fa50-83aa-4bf1-8d60-d79a538dc290';
const id = '1cfd7f1c-4e1c-49ce-9033-25b4e5fac9f7';
const build = () => ({ id, status: 'FINISHED', platform: 'IOS', distribution: 'STORE',
  buildProfile: 'production', gitCommitHash: sha, project: { id: projectId },
  artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/example.ipa' } });

test('accepts one successful production iOS build for the exact release source and project', () => {
  assert.equal(verifyIosBuild([build()], { sha, projectId }), id);
  assert.equal(verifyIosBuild(build(), { sha, projectId, expectedId: id }), id);
});

for (const [name, patch, error] of [
  ['unfinished', { status: 'IN_PROGRESS' }, /FINISHED/],
  ['failed', { status: 'ERRORED' }, /FINISHED/],
  ['wrong platform', { platform: 'ANDROID' }, /IOS/],
  ['internal distribution', { distribution: 'INTERNAL' }, /STORE/],
  ['wrong profile', { buildProfile: 'preview' }, /production/],
  ['stale source', { gitCommitHash: '0'.repeat(40) }, /release commit/],
  ['missing VCS source', { gitCommitHash: null, message: sha }, /release commit/],
  ['wrong project', { project: { id: 'another-project' } }, /project/],
  ['missing IPA', { artifacts: {} }, /artifact/],
  ['invalid artifact URL', { artifacts: { buildUrl: 'file:///tmp/a.ipa' } }, /artifact/],
  ['unsafe build ID', { id: 'id\nforged=true' }, /build ID/],
]) {
  test(`rejects ${name}`, () => assert.throws(() => verifyIosBuild({ ...build(), ...patch }, { sha, projectId }), error));
}

test('rejects ambiguous results, malformed source and a mismatched independently fetched ID', () => {
  assert.throws(() => verifyIosBuild([], { sha, projectId }), /exactly one/);
  assert.throws(() => verifyIosBuild([build(), build()], { sha, projectId }), /exactly one/);
  assert.throws(() => verifyIosBuild(build(), { sha: 'main', projectId }), /release SHA/);
  assert.throws(() => verifyIosBuild(build(), { sha, projectId, expectedId: '00000000-0000-0000-0000-000000000000' }), /requested build ID/);
});

test('CLI emits only a validated build ID and fails closed on a stale result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eas-ios-proof-'));
  const file = path.join(dir, 'build.json');
  const script = fileURLToPath(new URL('../verify-eas-ios-build.mjs', import.meta.url));
  const app = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../artifacts/vndrly-mobile/app.json', import.meta.url), 'utf8'));
  await writeFile(file, JSON.stringify([{ ...build(), project: { id: app.expo.extra.eas.projectId } }]));
  const result = spawnSync(process.execPath, [script, file, sha, id], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), id);
  const stale = spawnSync(process.execPath, [script, file, '0'.repeat(40)], { encoding: 'utf8' });
  assert.equal(stale.status, 2);
  assert.equal(stale.stdout, '');
  assert.match(stale.stderr, /release commit/);
});
