import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadNativeArchive } from '../lib/download-native-archive.mjs';

test('retries a cached gateway failure and writes only successful bytes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-download-test-'));
  const file = path.join(dir, 'archive'); const urls = [];
  try {
    await downloadNativeArchive('https://github.com/example/pinned/archive', file, async url => {
      urls.push(String(url));
      return urls.length === 1 ? new Response('gateway', { status: 504 }) : new Response('verified separately');
    });
    assert.equal(await readFile(file, 'utf8'), 'verified separately');
    assert.equal(urls.length, 2); assert.match(urls[1], /\?retry=/);
  } finally { await unlink(file).catch(() => {}); await rmdir(dir); }
});

test('does not retry permanent failures and bounds gateway retries', async () => {
  for (const [status, expected] of [[404, 1], [504, 3]]) {
    let count = 0;
    await assert.rejects(downloadNativeArchive('https://github.com/example/pinned/archive', 'unused', async () => {
      count++; return new Response('error', { status });
    }), new RegExp(String(status)));
    assert.equal(count, expected);
  }
});

test('uses the pinned asset API after repeated gateway errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-download-test-'));
  const file = path.join(dir, 'archive'); const urls=[];
  try {
    await downloadNativeArchive('https://github.com/example/archive', file, async url => {
      urls.push(String(url)); return urls.length < 3 ? new Response('gateway', { status:504 }) : new Response('archive');
    }, 'https://api.github.com/repos/example/releases/assets/1');
    assert.match(urls[2], /^https:\/\/api.github.com\/repos\/example\/releases\/assets\/1/);
    assert.equal(await readFile(file,'utf8'),'archive');
  } finally { await unlink(file).catch(()=>{}); await rmdir(dir); }
});
