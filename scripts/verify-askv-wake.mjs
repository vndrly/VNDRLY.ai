/**
 * Execute the exact shipped worker, WASM engine and ONNX model against offline
 * synthetic speech. No recognition mocks, network service or microphone used.
 *
 * node scripts/verify-askv-wake.mjs
 * node scripts/verify-askv-wake.mjs --generate-fixtures   (Windows only)
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsArg = process.argv.indexOf('--assets');
const assets = assetsArg >= 0 ? path.resolve(process.argv[assetsArg + 1]) : path.join(repoRoot, 'artifacts/vndrly/public/askv-wake');
const fixtures = path.join(repoRoot, 'scripts/fixtures/askv-wake');
const origin = 'https://askv-fixture.invalid';
const workerUrl = origin + '/askv-wake/worker.js';
const rate = 16_000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function generateFixtures() {
  assert.equal(process.platform, 'win32', 'Generate fixtures with offline Windows System.Speech.');
  await mkdir(fixtures, { recursive: true });
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Speech',
    '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    '$phrases = @(',
    '  @{ name="ask-v"; text="Ask V."; shouldWake=$true },',
    '  @{ name="ask-v-request"; text="Ask V, show me my tickets."; shouldWake=$true },',
    '  @{ name="v-only"; text="V."; shouldWake=$false },',
    '  @{ name="unrelated"; text="The crew is on location and the ticket is ready."; shouldWake=$false }',
    ')',
    '$metadata = @()',
    'foreach ($voice in @("Microsoft David Desktop", "Microsoft Zira Desktop")) {',
    '  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '  try {',
    '    $synth.SelectVoice($voice)',
    '    $synth.Rate = 0',
    '    foreach ($phrase in $phrases) {',
    '      $file = $phrase.name + "-" + $voice.Split(" ")[1].ToLowerInvariant() + ".wav"',
    '      $destination = Join-Path $env:ASKV_FIXTURE_DIR $file',
    '      $synth.SetOutputToWaveFile($destination, $format)',
    '      $synth.Speak($phrase.text)',
    '      $synth.SetOutputToNull()',
    '      $metadata += @{ file=$file; text=$phrase.text; voice=$voice; shouldWake=$phrase.shouldWake }',
    '    }',
    '  } finally { $synth.Dispose() }',
    '}',
    '$json = ConvertTo-Json -InputObject $metadata -Depth 5',
    '[System.IO.File]::WriteAllText((Join-Path $env:ASKV_FIXTURE_DIR "fixtures.json"), $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, ASKV_FIXTURE_DIR: fixtures }, stdio: 'inherit', windowsHide: true });
  assert.equal(result.status, 0, 'Offline fixture synthesis failed.');
  const manifest = path.join(fixtures, 'fixtures.json');
  const metadata = JSON.parse(await readFile(manifest, 'utf8'));
  for (const fixture of metadata) fixture.sha256 = sha256(await readFile(path.join(fixtures, fixture.file)));
  await writeFile(manifest, JSON.stringify(metadata, null, 2) + '\n');
}

function pcmFromWav(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let audio;
  let format;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert(start + length <= bytes.length, 'Truncated WAV fixture.');
    if (name === 'fmt ') format = bytes.subarray(start, start + length);
    if (name === 'data') audio = bytes.subarray(start, start + length);
    offset = start + length + length % 2;
  }
  assert(format && audio, 'WAV fixture is missing format or sample data.');
  assert.equal(format.readUInt16LE(0), 1, 'Fixture must contain PCM.');
  assert.equal(format.readUInt16LE(2), 1, 'Fixture must be mono.');
  assert.equal(format.readUInt32LE(4), rate);
  assert.equal(format.readUInt16LE(14), 16, 'Fixture must contain 16-bit samples.');
  const samples = new Float32Array(audio.length / 2 + rate * 2);
  // Include half a second of room silence and 1.5 seconds of trailing silence.
  for (let index = 0; index < audio.length / 2; index++) {
    samples[index + rate / 2] = audio.readInt16LE(index * 2) / 32768;
  }
  return samples;
}

async function verifyAssets() {
  const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.equal(sha256(await readFile(path.join(assets, name))), expected, 'Asset hash changed: ' + name);
    if (assetsArg < 0 && name.startsWith('model/')) {
      const nativeCopy = path.join(repoRoot, 'artifacts/vndrly-mobile/assets/askv-wake', path.basename(name));
      assert.equal(sha256(await readFile(nativeCopy)), expected, 'Web/mobile model drift: ' + name);
    }
  }
  return manifest;
}

async function loadShippedWorker() {
  const messages = [];
  const requested = [];
  const diagnostics = [];
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error('Shipped worker did not become ready.')), 30_000);
  const localFile = (value) => {
    const url = new URL(value, workerUrl);
    assert.equal(url.origin, origin, 'Unexpected network request.');
    assert(url.pathname.startsWith('/askv-wake/'), 'Unexpected worker asset location.');
    const destination = path.resolve(assets, decodeURIComponent(url.pathname.slice('/askv-wake/'.length)));
    assert(destination.startsWith(path.resolve(assets) + path.sep), 'Worker asset escaped its local directory.');
    return destination;
  };
  const sandbox = {
    URL, TextDecoder, TextEncoder, Response, performance, setTimeout, clearTimeout,
    WorkerGlobalScope: class WorkerGlobalScope {},
    location: { href: workerUrl },
    console: {
      log: (...args) => diagnostics.push(args.join(' ')),
      warn: (...args) => diagnostics.push(args.join(' ')),
      error: (...args) => diagnostics.push(args.join(' ')),
    },
    fetch: async (url) => {
      requested.push(String(url));
      const bytes = await readFile(localFile(url));
      return new Response(bytes, {
        status: 200,
        headers: { 'Content-Type': String(url).endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
      });
    },
    postMessage: (message) => {
      messages.push(message);
      if (message.type === 'ready') resolveReady();
      if (message.type === 'error') rejectReady(new Error(message.message + ' ' + diagnostics.join('\n')));
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...urls) => {
    for (const url of urls) {
      const filename = localFile(url);
      vm.runInContext(readFileSync(filename, 'utf8'), context, { filename, timeout: 30_000 });
    }
  };
  try {
    // Do not provide "window", "global", Node's "process", or any KWS stubs.
    // The shipped worker must establish its own worker-compatible runtime globals.
    vm.runInContext(await readFile(path.join(assets, 'worker.js'), 'utf8'), context,
      { filename: 'shipped-askv-worker.js', timeout: 30_000 });
    await ready;
  } catch (error) {
    throw new Error('Shipped worker bootstrap failed: ' + error.message);
  } finally {
    clearTimeout(timer);
  }
  return {
    messages, requested, diagnostics,
    feed(samples) {
      sandbox.__testSamples = samples;
      vm.runInContext('self.onmessage({ data: { type: "audio", samples: __testSamples } })',
        context, { timeout: 30_000 });
      delete sandbox.__testSamples;
    },
    dispose() {
      vm.runInContext('stream?.free(); spotter?.free(); stream = undefined; spotter = undefined;', context);
    },
  };
}

async function testCase(name, samples, shouldWake) {
  const worker = await loadShippedWorker();
  try {
    const started = performance.now();
    for (let offset = 0; offset < samples.length; offset += 512) {
      const frame = samples.slice(offset, Math.min(samples.length, offset + 512));
      worker.feed(frame);
      assert(frame.every((sample) => sample === 0), 'Worker did not clear consumed PCM.');
      if (worker.messages.some((message) => message.type === 'wake')) break;
      const failure = worker.messages.find((message) => message.type === 'error');
      assert(!failure, 'Worker inference failed: ' + failure?.message + ' ' + worker.diagnostics.join('\n'));
    }
    const wakes = worker.messages.filter((message) => message.type === 'wake');
    assert.equal(wakes.length, shouldWake ? 1 : 0, name + ': unexpected wake count.');
    if (shouldWake) assert.equal(wakes[0].keyword, 'ASKV', name + ': unexpected keyword.');
    const milliseconds = Math.round(performance.now() - started);
    console.log('PASS ' + name + ': ' + (wakes[0]?.keyword ?? 'no wake') + ' (' + milliseconds + ' ms inference)');
    return { name, expectedWake: shouldWake, detectedKeyword: wakes[0]?.keyword ?? null, inferenceMs: milliseconds };
  } finally {
    worker.dispose();
  }
}

async function main() {
  if (process.argv.includes('--generate-fixtures')) await generateFixtures();
  const manifest = await verifyAssets();
  const metadata = JSON.parse(await readFile(path.join(fixtures, 'fixtures.json'), 'utf8'));
  const results = [];
  for (const fixture of metadata) {
    const bytes = await readFile(path.join(fixtures, fixture.file));
    assert.equal(sha256(bytes), fixture.sha256, 'Fixture changed: ' + fixture.file);
    results.push(await testCase(fixture.file, pcmFromWav(bytes), fixture.shouldWake));
  }
  results.push(await testCase('silence-5-seconds', new Float32Array(rate * 5), false));
  console.log(JSON.stringify({
    runtime: manifest.runtime, model: manifest.model,
    fixtures: 'Offline Windows System.Speech, synthetic voices; no external audio service or microphone.',
    limitation: 'Real microphone, browser audio capture, accents, noise, and iOS hardware are not covered.',
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
