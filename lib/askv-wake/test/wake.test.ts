import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PcmRingBuffer, PcmResampler, MicrophoneCoordinator, isWakeKeyword, encodePcm16Base64 } from '../src/index.ts';

test('only the complete Ask V phrase activates', () => {
  assert.equal(isWakeKeyword('ASK V'), true);
  assert.equal(isWakeKeyword('AskV'), true);
  for (const text of ['V', 'ask me', 'ask Steve', 'please ask V later', '']) assert.equal(isWakeKeyword(text), false);
});

test('ring keeps newest samples in order and clears private audio', () => {
  const ring = new PcmRingBuffer(5);
  ring.push(new Float32Array([1, 2, 3]));
  ring.push(new Float32Array([4, 5, 6, 7]));
  assert.deepEqual([...ring.snapshot()], [3, 4, 5, 6, 7]);
  ring.clear();
  assert.equal(ring.snapshot().length, 0);
});

test('oversized PCM frame stays bounded', () => {
  const ring = new PcmRingBuffer(3);
  ring.push(new Float32Array([1, 2, 3, 4, 5]));
  assert.deepEqual([...ring.snapshot()], [3, 4, 5]);
});

test('microphone handoff awaits the old owner and stale release cannot stop its successor', async () => {
  const mic = new MicrophoneCoordinator();
  const events: string[] = [];
  const releaseWake = await mic.acquire('wake', async () => { events.push('wake stopped'); });
  const releaseCrew = await mic.acquire('crew', async () => { events.push('crew stopped'); });
  assert.deepEqual(events, ['wake stopped']);
  await releaseWake();
  assert.equal(mic.owner, 'crew');
  await releaseCrew();
  assert.equal(mic.owner, null);
  assert.deepEqual(events, ['wake stopped', 'crew stopped']);
});

test('failed microphone release prevents overlapping new ownership', async () => {
  const mic = new MicrophoneCoordinator();
  await mic.acquire('wake', async () => { throw new Error('capture still active'); });
  await assert.rejects(mic.acquire('crew', async () => {}), /capture still active/);
  assert.equal(mic.owner, 'wake');
});

test('PCM16 encoding clamps samples and uses little endian', () => {
  assert.equal(encodePcm16Base64(new Float32Array([-2, 0, 2])), 'AIAAAP9/');
});

test('resampling preserves waveform continuity across arbitrary capture frame boundaries', () => {
  const signal = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100));
  const whole = new PcmResampler(44100, 16000).push(signal);
  const resampler = new PcmResampler(44100, 16000), chunks: number[] = [];
  for (let i = 0; i < signal.length; i += 128) chunks.push(...resampler.push(signal.subarray(i, i + 128)));
  assert.equal(chunks.length, whole.length);
  for (let i = 0; i < chunks.length; i++) assert.ok(Math.abs(chunks[i] - whole[i]) < 0.00001);
  assert.ok(Math.abs(chunks.length - 1600) <= 1);
});

test('ownership notifications identify the successor and exclude stale cleanup', async () => {
  const mic = new MicrophoneCoordinator(), states: Array<string | null> = [];
  const unsubscribe = mic.subscribe(owner => states.push(owner));
  const old = await mic.acquire('wake', async () => {});
  const next = await mic.acquire('ptt', async () => {});
  await old(); await next(); unsubscribe();
  await mic.acquire('realtime', async () => {});
  assert.deepEqual(states, ['wake', 'ptt', null]);
});
