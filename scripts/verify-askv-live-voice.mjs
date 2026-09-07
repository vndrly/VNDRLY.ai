import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './load-env-local.mjs';
import { createAskVRealtimeCall, DEFAULT_ASKV_REALTIME_MODEL } from '../artifacts/api-server/src/assistant/realtime-session.ts';

// Opt-in paid provider acceptance check. Uses only synthetic fixture speech and
// harmless text, a loopback-only broker, and the actual production WebRTC client.
// Does not touch a database, invoke domain tools, or print credentials/SDP/audio.
assert.equal(process.env.ASKV_LIVE_VOICE_TEST, '1', 'Set ASKV_LIVE_VOICE_TEST=1 to run the live provider check');
assert.ok(process.env.OPENAI_API_KEY, 'The configured server OpenAI credential is required');
const root = fileURLToPath(new URL('..', import.meta.url));
const webRequire = createRequire(path.join(root, 'artifacts/vndrly/package.json'));
const e2eRequire = createRequire(path.join(root, 'lib/e2e/package.json'));
const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
const { chromium } = e2eRequire('@playwright/test');
const token = randomBytes(32).toString('hex');
const providerFailures = [];
let callCount = 0, origin;
const boundedLabel = value => typeof value === 'string' && /^[\w.:[\]-]{1,100}$/.test(value) ? value : undefined;
const server = await createServer({
  configFile: false,
  root: path.join(root, 'artifacts/vndrly'),
  envFile: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: '127.0.0.1', port: 0, fs: { strict: true, deny: ['**/.*'] } },
  plugins: [{ name: 'askv-live-provider-check', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, origin || 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/')) return next();
      if (url.pathname !== '/api/assistant/realtime/call' || req.method !== 'POST' || req.headers['x-askv-test-token'] !== token
        || req.headers.origin !== origin || ++callCount > 2) {
        res.writeHead(403); res.end(); return;
      }
      try {
        let sdp = '';
        for await (const chunk of req) {
          sdp += chunk.toString();
          if (sdp.length > 100_000) throw new Error('offer_too_large');
        }
        const answer = await createAskVRealtimeCall({
          apiKey: process.env.OPENAI_API_KEY,
          userId: 0,
          model: process.env.ASKV_REALTIME_MODEL || DEFAULT_ASKV_REALTIME_MODEL,
          voice: process.env.ASKV_REALTIME_VOICE || 'marin',
          instructions: 'This is an automated synthetic voice acceptance check. No user or business data is available. Respond to ordinary speech with one short friendly sentence. If asked to show tickets, say that the synthetic ticket request was heard. Do not invent data or perform any action. Follow harmless exact speech or counting requests.',
          tools: [], sdp,
          fetchImpl: async (input, init) => {
            const response = await fetch(input, { ...init, signal: AbortSignal.timeout(30000) });
            if (!response.ok) {
              const body = await response.clone().json().catch(() => ({}));
              providerFailures.push({ status: response.status, code: boundedLabel(body.error?.code), type: boundedLabel(body.error?.type), param: boundedLabel(body.error?.param) });
            }
            return response;
          },
        });
        res.writeHead(200, { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' }); res.end(answer);
      } catch {
        res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"live_provider_call_failed"}');
      }
    });
  } }],
});
const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'askv-synthetic-voice-'));
let browser;
try {
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  // The fake microphone starts when acquired. Leave time for the real handshake
  // and greeting, then send one fixture followed by silence (no looping speech).
  const wav = await readFile(path.join(root, 'scripts/fixtures/askv-wake/ask-v-request-david.wav'));
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const length = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') { pcm = wav.subarray(offset + 8, offset + 8 + length); break; }
    offset += 8 + length + (length % 2);
  }
  assert.ok(pcm?.length, 'Synthetic WAV has no PCM data');
  const payload = Buffer.concat([Buffer.alloc(12 * 16000 * 2), pcm, Buffer.alloc(120 * 16000 * 2)]);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(payload.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(payload.length, 40);
  const microphoneFile = path.join(tempDirectory, 'synthetic-microphone.wav');
  await writeFile(microphoneFile, Buffer.concat([header, payload]));
  const launchBrowser = microphonePath => chromium.launch({
    ...(process.env.ASKV_BROWSER_PATH ? { executablePath: process.env.ASKV_BROWSER_PATH } : { channel: 'msedge' }),
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${microphonePath}%noloop`],
  });
  browser = await launchBrowser(microphoneFile);
  if (!process.argv.includes('--wake-only')) {
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/askv-live-harness') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic AskV live voice check</title>' });
    return route.continue();
  });
  await page.goto(`${origin}/askv-live-harness`);
  const result = await page.evaluate(async ({ token }) => {
    const startedAt = performance.now();
    const metrics = { phase: 'connect', peerConnections: 0, microphoneStreams: 0, speechStarts: 0, speechStops: 0,
      playbackStarts: 0, playbackStops: 0, spokenTranscripts: 0, assistantTranscripts: 0, typedTranscripts: 0,
      completedResponses: 0, cancelledResponses: 0, protocolErrors: [], clientErrors: 0, toolCalls: 0,
      events: [], receivedAudioBytes: 0, receivedAudioEnergy: 0 };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url).startsWith('/api/assistant/realtime/call')) {
        options = { ...options, headers: { ...options.headers, 'x-askv-test-token': token } };
      }
      return nativeFetch(url, options);
    };
    const pcs = [], streams = [], audios = [];
    const NativePC = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePC {
      constructor(...args) { super(...args); pcs.push(this); metrics.peerConnections++; }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        channel.addEventListener('message', event => {
          let payload; try { payload = JSON.parse(event.data); } catch { return; }
          if (['session.created', 'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'output_audio_buffer.started', 'output_audio_buffer.stopped', 'output_audio_buffer.cleared', 'response.done'].includes(payload.type)) {
            metrics.events.push({ type: payload.type, ms: Math.round(performance.now() - startedAt), phase: metrics.phase });
          }
          if (payload.type === 'error') metrics.protocolErrors.push({ code: /^[\w.-]+$/.test(payload.error?.code) ? payload.error.code : 'unknown', param: /^[\w.[\]-]+$/.test(payload.error?.param) ? payload.error.param : undefined });
          if (payload.type === 'session.created') metrics.sessionAccepted = payload.session?.audio?.input?.turn_detection?.create_response === true;
        });
        return channel;
      }
    };
    const nativeMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await nativeMedia(...args); streams.push(stream); metrics.microphoneStreams++; return stream;
    };
    const nativeCreate = document.createElement.bind(document);
    document.createElement = (...args) => { const element = nativeCreate(...args); if (args[0] === 'audio') audios.push(element); return element; };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (condition, label, timeout = 30000) => {
      const limit = performance.now() + timeout;
      while (!condition()) {
        if (metrics.clientErrors) throw new Error('client_error');
        if (performance.now() > limit) throw new Error(`${label}_timeout`);
        await sleep(50);
      }
    };
    const sampleAudio = async () => {
      for (const pc of pcs) for (const stat of (await pc.getStats()).values()) {
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          metrics.receivedAudioBytes = Math.max(metrics.receivedAudioBytes, stat.bytesReceived || 0);
          metrics.receivedAudioEnergy = Math.max(metrics.receivedAudioEnergy, stat.totalAudioEnergy || 0);
        }
      }
    };
    const { createAskVRealtimeClient } = await import('/src/lib/askv-realtime-client.ts');
    const client = await createAskVRealtimeClient({
      greeting: 'Hello. I am ready.',
      onToolCall: async () => { metrics.toolCalls++; throw new Error('unexpected_domain_tool'); },
      onSpeechStarted: () => metrics.speechStarts++, onSpeechStopped: () => metrics.speechStops++,
      onAudio: () => metrics.playbackStarts++, onPlaybackStopped: () => metrics.playbackStops++,
      onTranscript: message => {
        if (message.role === 'assistant') metrics.assistantTranscripts++;
        else if (message.eventId.startsWith('typed:')) metrics.typedTranscripts++;
        else { metrics.spokenTranscripts++; metrics.fixtureRecognized = /ticket/i.test(message.content); }
      },
      onResponse: response => { if (response.status === 'completed') metrics.completedResponses++; if (response.status === 'cancelled') metrics.cancelledResponses++; },
      onError: () => metrics.clientErrors++,
    });
    try {
      await client.connect();
      metrics.connectedMs = Math.round(performance.now() - startedAt);
      metrics.phase = 'greeting';
      await waitFor(() => metrics.playbackStarts >= 1 && metrics.playbackStops >= 1 && metrics.assistantTranscripts >= 1, 'greeting');
      metrics.greetingPassed = true; metrics.phase = 'automatic_voice';
      await waitFor(() => metrics.spokenTranscripts >= 1 && metrics.speechStops >= 1 && metrics.assistantTranscripts >= 2 && metrics.playbackStops >= 2, 'automatic_voice', 45000);
      metrics.automaticVoicePassed = true;
      await sampleAudio();
      metrics.audioPlaying = audios.some(audio => audio.srcObject && !audio.paused);
      metrics.phase = 'typed_followup';
      const beforeTyped = { replies: metrics.assistantTranscripts, stops: metrics.playbackStops };
      client.sendText('Say exactly: Synthetic typed follow up confirmed.');
      await waitFor(() => metrics.assistantTranscripts > beforeTyped.replies && metrics.playbackStops > beforeTyped.stops, 'typed_followup');
      metrics.typedFollowupPassed = metrics.typedTranscripts === 1;
      metrics.phase = 'interruption';
      const beforeInterrupt = metrics.playbackStarts;
      client.sendText('Count from one to thirty slowly with a brief pause between numbers.');
      await waitFor(() => metrics.playbackStarts > beforeInterrupt, 'long_response_start');
      await sleep(250);
      const beforeClear = metrics.events.filter(event => event.type === 'output_audio_buffer.cleared').length;
      client.interrupt();
      await waitFor(() => metrics.events.filter(event => event.type === 'output_audio_buffer.cleared').length > beforeClear, 'active_playback_clear', 10000);
      metrics.interruptionPassed = true;
      metrics.phase = 'after_interruption';
      const beforeResume = { replies: metrics.assistantTranscripts, stops: metrics.playbackStops };
      client.sendText('Say exactly: Synthetic conversation continued.');
      await waitFor(() => metrics.assistantTranscripts > beforeResume.replies && metrics.playbackStops > beforeResume.stops, 'after_interruption');
      metrics.continuedAfterInterruption = true;
      await sampleAudio();
    } catch (error) { metrics.failure = /^[\w_]+$/.test(error.message) ? error.message : 'connection_failed'; }
    finally {
      client.close(); await sleep(100);
      metrics.microphonesStopped = streams.length > 0 && streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'));
      metrics.peerConnectionsClosed = pcs.every(pc => pc.connectionState === 'closed');
      metrics.audioDetached = audios.every(audio => audio.srcObject === null && audio.paused);
      metrics.elapsedMs = Math.round(performance.now() - startedAt);
    }
    return metrics;
  }, { token });
  console.log(JSON.stringify({ mode: 'loopback-production-broker-and-client', model: process.env.ASKV_REALTIME_MODEL || DEFAULT_ASKV_REALTIME_MODEL, calls: callCount, providerFailures, ...result }, null, 2));
  assert.equal(result.failure, undefined, 'Live voice acceptance failed');
  for (const key of ['sessionAccepted', 'greetingPassed', 'automaticVoicePassed', 'fixtureRecognized', 'audioPlaying', 'typedFollowupPassed', 'interruptionPassed', 'continuedAfterInterruption', 'microphonesStopped', 'peerConnectionsClosed', 'audioDetached']) assert.equal(result[key], true, key);
  assert.equal(result.peerConnections, 1); assert.equal(result.microphoneStreams, 1);
  assert.equal(result.clientErrors, 0); assert.equal(result.toolCalls, 0);
  assert.ok(result.receivedAudioBytes > 1000); assert.ok(result.receivedAudioEnergy > 0);
  assert.ok(result.protocolErrors.every(error => error.code === 'response_cancel_not_active'));
  console.log('PASS live greeting, automatic spoken response, same-session typing, playback interruption, continuation, and microphone shutdown');
  }

  // A second, separate fake microphone repeats the fixture once after 15 seconds
  // of silence. The second utterance tests real VAD barge-in during a long reply.
  await browser.close();
  const wakePayload = Buffer.concat([Buffer.alloc(16000), pcm, Buffer.alloc(15 * 16000 * 2), pcm, Buffer.alloc(90 * 16000 * 2)]);
  const wakeHeader = Buffer.from(header);
  wakeHeader.writeUInt32LE(wakePayload.length + 36, 4); wakeHeader.writeUInt32LE(wakePayload.length, 40);
  const wakeMicrophoneFile = path.join(tempDirectory, 'synthetic-wake-microphone.wav');
  await writeFile(wakeMicrophoneFile, Buffer.concat([wakeHeader, wakePayload]));
  browser = await launchBrowser(wakeMicrophoneFile);
  const wakePage = await browser.newPage();
  await wakePage.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/askv-live-harness') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic AskV wake voice check</title>' });
    return route.continue();
  });
  await wakePage.goto(`${origin}/askv-live-harness`);
  const wakeResult = await wakePage.evaluate(async ({ token }) => {
    const startedAt = performance.now();
    const metrics = { phase: 'local_wake', wakes: 0, microphoneStreams: 0, peerConnections: 0, brokerRequests: 0, brokerRequestsBeforeWake: 0,
      speechStarts: 0, speechStops: 0, assistantTranscripts: 0, spokenTranscripts: 0, playbackStarts: 0, playbackStops: 0,
      toolCalls: 0, clientErrors: 0, protocolErrors: [], events: [], receivedAudioBytes: 0, receivedAudioEnergy: 0, initialBufferedSamples: 0 };
    metrics.errorCategories = []; metrics.peakBufferedBytes = 0; metrics.audioAppends = 0; metrics.connectionStates = [];
    const recordError = message => {
      metrics.clientErrors++;
      const knownMessages = ['AskV connection is too slow for voice.', 'AskV voice disconnected. Please open it again.', 'AskV voice disconnected.', 'Tap AskV to enable voice playback.', 'Voice paused because audio was interrupted.', 'The microphone disconnected.', 'Voice took too long to connect. Please open AskV and try again.'];
      metrics.errorCategories.push(knownMessages.includes(message) ? message : 'unclassified_error');
    };
    const pcs = [], streams = [], channels = [];
    const NativePC = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePC {
      constructor(...args) { super(...args); pcs.push(this); metrics.peerConnections++; this.addEventListener('connectionstatechange', () => metrics.connectionStates.push(this.connectionState)); }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        channels.push(channel);
        const nativeSend = channel.send.bind(channel);
        channel.send = value => { nativeSend(value); metrics.peakBufferedBytes = Math.max(metrics.peakBufferedBytes, channel.bufferedAmount); if (JSON.parse(value).type === 'input_audio_buffer.append') metrics.audioAppends++; };
        channel.addEventListener('message', event => {
          let payload; try { payload = JSON.parse(event.data); } catch { return; }
          if (['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'output_audio_buffer.started', 'output_audio_buffer.stopped', 'output_audio_buffer.cleared', 'response.done'].includes(payload.type)) {
            metrics.events.push({ type: payload.type, ms: Math.round(performance.now() - startedAt), phase: metrics.phase });
          }
          if (payload.type === 'error') metrics.protocolErrors.push({ code: /^[\w.-]+$/.test(payload.error?.code) ? payload.error.code : 'unknown' });
        });
        return channel;
      }
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url).startsWith('/api/assistant/realtime/call')) {
        metrics.brokerRequests++; if (!metrics.wakes) metrics.brokerRequestsBeforeWake++;
        options = { ...options, headers: { ...options.headers, 'x-askv-test-token': token } };
      }
      return nativeFetch(url, options);
    };
    const nativeMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await nativeMedia(...args); streams.push(stream); metrics.microphoneStreams++; return stream;
    };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (condition, label, timeout = 45000) => {
      const limit = performance.now() + timeout;
      while (!condition()) {
        if (metrics.clientErrors) throw new Error('client_error');
        if (performance.now() > limit) throw new Error(`${label}_timeout`);
        await sleep(50);
      }
    };
    const { startLocalWake } = await import('/src/lib/askv-local-wake.ts');
    const { createAskVRealtimeClient } = await import('/src/lib/askv-realtime-client.ts');
    const controller = new AbortController();
    let listener, client, connection;
    try {
      listener = await startLocalWake({ signal: controller.signal,
        onError: recordError,
        onWake: source => {
          metrics.wakes++; metrics.wakeMs = Math.round(performance.now() - startedAt);
          controller.abort();
          // Observe, without changing, the real pre-roll/connecting-audio delivery.
          const subscribe = source.subscribe.bind(source);
          source.subscribe = callback => {
            let first = true;
            return subscribe(samples => { if (first) { metrics.initialBufferedSamples = samples.length; first = false; } callback(samples); });
          };
          connection = (async () => {
            client = await createAskVRealtimeClient({ audioSource: source,
              onToolCall: async () => { metrics.toolCalls++; throw new Error('unexpected_domain_tool'); },
              onSpeechStarted: () => metrics.speechStarts++, onSpeechStopped: () => metrics.speechStops++,
              onAudio: () => metrics.playbackStarts++, onPlaybackStopped: () => metrics.playbackStops++,
              onTranscript: message => {
                if (message.role === 'assistant') metrics.assistantTranscripts++;
                else if (!message.eventId.startsWith('typed:')) { metrics.spokenTranscripts++; metrics.fixtureRecognized = /ticket/i.test(message.content); }
              },
              onError: recordError,
            });
            await client.connect(); metrics.connectedMs = Math.round(performance.now() - startedAt);
          })().catch(() => { metrics.clientErrors++; });
        },
      });
      await waitFor(() => metrics.connectedMs, 'wake_connection');
      metrics.phase = 'wake_automatic_voice';
      await waitFor(() => metrics.spokenTranscripts >= 1 && metrics.assistantTranscripts >= 1 && metrics.playbackStops >= 1, 'wake_automatic_voice');
      metrics.wakeVoicePassed = true;
      metrics.phase = 'spoken_barge_in';
      const beforeLong = metrics.playbackStarts;
      client.sendText('Count slowly from one to one hundred with a pause between numbers. Continue counting until interrupted.');
      await waitFor(() => metrics.playbackStarts > beforeLong, 'long_response_start');
      const beforeSpeech = metrics.speechStarts;
      await waitFor(() => metrics.speechStarts > beforeSpeech && metrics.events.some(event => event.type === 'output_audio_buffer.cleared' && event.phase === 'spoken_barge_in'), 'spoken_barge_in', 35000);
      metrics.spokenBargeInPassed = true;
      await waitFor(() => metrics.spokenTranscripts >= 2 && metrics.speechStops >= 2 && metrics.playbackStarts >= 3 && metrics.playbackStops >= 3, 'barge_in_reply');
      metrics.bargeInReplyPassed = true;
      metrics.phase = 'sustained_listening';
      metrics.queuedBytesWhileListening = [channels[0].bufferedAmount];
      for (let i = 0; i < 8; i++) {
        await sleep(5000);
        if (metrics.clientErrors) throw new Error('client_error');
        metrics.queuedBytesWhileListening.push(channels[0].bufferedAmount);
      }
      metrics.sustainedListeningPassed = true;
      for (const pc of pcs) for (const stat of (await pc.getStats()).values()) {
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          metrics.receivedAudioBytes = Math.max(metrics.receivedAudioBytes, stat.bytesReceived || 0);
          metrics.receivedAudioEnergy = Math.max(metrics.receivedAudioEnergy, stat.totalAudioEnergy || 0);
        }
      }
    } catch (error) { metrics.failure = /^[\w_]+$/.test(error.message) ? error.message : 'wake_connection_failed'; }
    finally {
      controller.abort(); await connection; client?.close(); await listener?.stop(); await sleep(100);
      metrics.microphonesStopped = streams.length > 0 && streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'));
      metrics.peerConnectionsClosed = pcs.every(pc => pc.connectionState === 'closed');
      metrics.elapsedMs = Math.round(performance.now() - startedAt);
    }
    return metrics;
  }, { token });
  console.log(JSON.stringify({ mode: 'local-wake-to-live-provider', model: process.env.ASKV_REALTIME_MODEL || DEFAULT_ASKV_REALTIME_MODEL, providerFailures, ...wakeResult }, null, 2));
  assert.equal(wakeResult.failure, undefined, 'Live local-wake acceptance failed');
  for (const key of ['wakeVoicePassed', 'fixtureRecognized', 'spokenBargeInPassed', 'bargeInReplyPassed', 'sustainedListeningPassed', 'microphonesStopped', 'peerConnectionsClosed']) assert.equal(wakeResult[key], true, key);
  assert.equal(wakeResult.wakes, 1); assert.equal(wakeResult.microphoneStreams, 1); assert.equal(wakeResult.peerConnections, 1);
  assert.equal(wakeResult.brokerRequests, 1); assert.equal(wakeResult.brokerRequestsBeforeWake, 0);
  assert.equal(wakeResult.clientErrors, 0); assert.equal(wakeResult.toolCalls, 0);
  assert.ok(wakeResult.initialBufferedSamples > 1600);
  assert.ok(wakeResult.receivedAudioBytes > 1000); assert.ok(wakeResult.receivedAudioEnergy > 0);
  assert.ok(wakeResult.protocolErrors.every(error => error.code === 'response_cancel_not_active'));
  console.log('PASS shipped local wake, preserved spoken request, automatic live answer, spoken barge-in, reply, and same-microphone shutdown');
} finally {
  await browser?.close();
  await server.close();
  assert.equal(path.dirname(path.resolve(tempDirectory)), path.resolve(os.tmpdir()), 'Cleanup must stay in the temporary directory');
  assert.ok(path.basename(tempDirectory).startsWith('askv-synthetic-voice-'), 'Cleanup must target this verifier run');
  await rm(tempDirectory, { recursive: true, force: true });
}
