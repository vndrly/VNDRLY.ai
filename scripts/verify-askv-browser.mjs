import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Exercises the shipped capture/worklet/worker/model with a synthetic microphone.
// Start the web Vite server first; this never opens a paid conversation.
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(root, 'lib/e2e/package.json'));
const { chromium } = require('@playwright/test');
const origin = process.env.ASKV_TEST_ORIGIN || 'http://127.0.0.1:5193';
const browser = await chromium.launch({
  ...(process.env.ASKV_BROWSER_PATH ? { executablePath: process.env.ASKV_BROWSER_PATH } : { channel: 'msedge' }),
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    `--use-file-for-fake-audio-capture=${path.join(root, 'scripts/fixtures/askv-wake/ask-v-request-david.wav')}`],
});
try {
  const page = await browser.newPage();
  const forbidden = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) {
      forbidden.push(url.href); return route.abort();
    }
    if (url.pathname === '/askv-wake-harness') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>AskV local capture test</title>' });
    return route.continue();
  });
  await page.goto(`${origin}/askv-wake-harness`);
  const result = await page.evaluate(async () => {
    const { startLocalWake } = await import('/src/lib/askv-local-wake.ts');
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const streams = [];
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await original(...args); streams.push(stream); return stream;
    };
    const controller = new AbortController();
    let resolveWake, rejectWake;
    const woke = new Promise((resolve, reject) => { resolveWake = resolve; rejectWake = reject; });
    let count = 0, samples = 0;
    const timer = setTimeout(() => rejectWake(new Error('Real browser wake timed out')), 20000);
    let listener;
    try {
      listener = await startLocalWake({ signal: controller.signal,
        onError: message => rejectWake(new Error(message)),
        onWake: source => {
          count++;
          source.subscribe(frame => { samples += frame.length; });
          // Abort of the wake listener must preserve the transferred stream.
          controller.abort();
          setTimeout(() => { void source.stop().then(resolveWake, rejectWake); }, 200);
        },
      });
      await woke;
      return { count, samples, streams: streams.length, stopped: streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')) };
    } finally { clearTimeout(timer); controller.abort(); await listener?.stop(); }
  });
  assert.equal(result.count, 1);
  assert.equal(result.streams, 1);
  assert.ok(result.samples > 1600, 'Wake handoff must preserve buffered and continuing PCM');
  assert.equal(result.stopped, true);
  assert.deepEqual(forbidden, [], 'Idle wake detection must not contact a service');
  console.log(`PASS real browser capture + local inference + same-microphone handoff + shutdown (${result.samples} PCM samples; no API/network upload)`);
} finally { await browser.close(); }
