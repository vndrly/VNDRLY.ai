import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { assertFreshLocalTestDatabaseEnvironment } from './fresh-test-database.mjs';
import { openAiEnvPath } from './secrets-path.mjs';

// Run only as a child of the additive fresh-local database wrapper. The approved
// provider credential is loaded explicitly after its secret-free child boundary.
assert.equal(process.env.ASKV_AUTHENTICATED_LIVE_TEST, '1', 'Explicit live provider opt-in required');
assertFreshLocalTestDatabaseEnvironment(process.env);
const credentialFile = await readFile(openAiEnvPath(), 'utf8');
const credential = credentialFile.split(/\r?\n/).map(line => line.match(/^\s*OPENAI_API_KEY\s*=\s*(.*?)\s*$/i)).find(Boolean)?.[1];
assert.ok(credential, 'Approved OpenAI server credential missing');
process.env.OPENAI_API_KEY = credential;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.ASKV_NATURAL_VOICE_ENABLED = '1';
process.env.PORT = '5197';
const root = fileURLToPath(new URL('..', import.meta.url));
const apiRequire = createRequire(path.join(root, 'artifacts/api-server/package.json'));
const webRequire = createRequire(path.join(root, 'artifacts/vndrly/package.json'));
const e2eRequire = createRequire(path.join(root, 'lib/e2e/package.json'));
const { chromium } = e2eRequire('@playwright/test');
const bcrypt = apiRequire('bcryptjs');
const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
const { db, pool, usersTable, assistantConversationsTable, assistantMessagesTable } = await import('../lib/db/src/index.ts');
const { eq, asc } = apiRequire('drizzle-orm');
const account = { username: `askv-live-${randomUUID()}@example.test`, password: randomBytes(24).toString('hex') };
const [user] = await db.insert(usersTable).values({ username: account.username, email: account.username,
  passwordHash: await bcrypt.hash(account.password, 10), role: 'admin', displayName: 'Synthetic Operator', preferredLanguage: 'en' }).returning({ id: usersTable.id });
process.env.ASKV_NATURAL_VOICE_USER_IDS = String(user.id);
// The normal API build supplies a createRequire banner. Supply its equivalent
// for this source-level app entry, without running index.ts demo/worker boot.
globalThis.require = createRequire(path.join(root, 'artifacts/api-server/src/app.ts'));
const { default: app } = await import('../artifacts/api-server/src/app.ts');
let apiServer, vite, browser;
const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'askv-authenticated-live-'));
const metrics = { mode: 'authenticated-full-application', database: process.env.VNDRLY_FRESH_TEST_DB_NAME,
  phase: 'startup', apiFailures: [], providerFailures: [], toolRequests: 0, brokerCalls: 0, transcriptSaves: 0, greeted: false };
const safeCode = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) ? value : undefined;
const safeParameter = value => typeof value === 'string' && /^[\w.[\]-]{1,160}$/.test(value) ? value : undefined;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  if (String(input) === 'https://api.openai.com/v1/realtime/calls' && !response.ok) {
    const body = await response.clone().json().catch(() => ({}));
    metrics.providerFailures.push({ status: response.status, code: safeCode(body.error?.code), type: safeCode(body.error?.type), param: safeParameter(body.error?.param) });
  }
  return response;
};
let page;
try {
  apiServer = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject); });
  const apiOrigin = `http://127.0.0.1:${apiServer.address().port}`;
  process.env.VITE_API_PROXY_TARGET = apiOrigin;
  vite = await createServer({ configFile: path.join(root, 'artifacts/vndrly/vite.config.ts'), envFile: false,
    logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: apiOrigin, changeOrigin: true } } } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const speechFile = path.join(tempDirectory, 'synthetic-math.wav');
  const script = `Add-Type -AssemblyName System.Speech\n$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer\n$speaker.SelectVoice('Microsoft David Desktop')\n$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)\n$speaker.SetOutputToWaveFile('${speechFile.replaceAll("'", "''")}', $format)\n$speaker.Speak('What is two plus two?')\n$speaker.Dispose()`;
  const generated = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'pipe', windowsHide: true });
  assert.equal(generated.status, 0, 'Synthetic speech fixture generation failed');
  const wav = await readFile(speechFile);
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') { pcm = wav.subarray(offset + 8, offset + 8 + size); break; }
    offset += 8 + size + size % 2;
  }
  assert.ok(pcm?.length);
  const payload = Buffer.concat([Buffer.alloc(15 * 32000), pcm, Buffer.alloc(120 * 32000)]);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(payload.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(payload.length, 40);
  await writeFile(speechFile, Buffer.concat([header, payload]));
  browser = await chromium.launch({ executablePath: process.env.ASKV_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${speechFile}%noloop`] });
  page = await browser.newPage({ locale: 'en-US', timezoneId: 'America/Chicago' });
  await page.addInitScript(() => {
    window.__askvLive = { pcs: [], streams: [], speechStarts: 0, speechStops: 0, playbackStarts: 0, playbackStops: 0, assistantHistoryAccepted: 0, protocolErrors: [] };
    const state = window.__askvLive;
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) { super(...args); state.pcs.push(this); }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        channel.addEventListener('message', event => {
          let payload; try { payload = JSON.parse(event.data); } catch { return; }
          if (payload.type === 'input_audio_buffer.speech_started') state.speechStarts++;
          if (payload.type === 'input_audio_buffer.speech_stopped') state.speechStops++;
          if (payload.type === 'output_audio_buffer.started') state.playbackStarts++;
          if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(payload.type)) state.playbackStops++;
          if (['conversation.item.added', 'conversation.item.created'].includes(payload.type) && payload.item?.role === 'assistant' && payload.item?.content?.some(content => content.type === 'output_text')) state.assistantHistoryAccepted++;
          if (payload.type === 'error') state.protocolErrors.push({
            code: /^[\w.-]+$/.test(payload.error?.code) ? payload.error.code : 'unknown',
            param: /^[\w.[\]-]{1,160}$/.test(payload.error?.param) ? payload.error.param : undefined,
            limits: payload.error?.code === 'string_above_max_length' ? payload.error.message?.match(/\b\d+\b/g)?.map(Number) : undefined,
          });
        });
        return channel;
      }
    };
    const nativeMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await nativeMedia(...args); state.streams.push(stream); return stream; };
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    // No domain tool is needed for the harmless arithmetic prompts. Refuse any
    // unexpected tool HTTP request before it can reach an application action.
    if (url.pathname === '/api/assistant/realtime/tool-call') { metrics.toolRequests++; return route.abort(); }
    if (url.pathname === '/api/assistant/realtime/call' && ++metrics.brokerCalls > 2) return route.abort();
    return route.continue();
  });
  const responseTasks = [];
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith('/api/')) return;
    responseTasks.push((async () => {
      if (response.status() >= 400) {
        const body = await response.json().catch(() => ({})); metrics.apiFailures.push({ path: pathname, status: response.status(), code: safeCode(body.code) });
      }
      if (pathname === '/api/assistant/voice/greeting' && response.ok()) {
        const body = await response.json(); metrics.greeted ||= body.style === 'full';
      }
      if (pathname === '/api/assistant/voice/transcript' && response.ok()) metrics.transcriptSaves++;
    })().catch(() => undefined));
  });
  const anonymous = await page.request.post(`${origin}/api/assistant/voice/conversation`, { data: {} });
  assert.equal(anonymous.status(), 401); metrics.unauthenticatedRejected = true;
  const login = await page.request.post(`${origin}/api/auth/login`, { data: { username: account.username, password: account.password, clientLocale: 'en-US' } });
  assert.equal(login.status(), 200, 'Actual login route rejected the synthetic account');
  assert.equal((await login.json()).id, user.id); metrics.authenticated = true;
  metrics.phase = 'open_panel';
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-launcher').click({ timeout: 45000 });
  await page.getByTestId('assistant-panel').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__askvLive.playbackStops >= 1 || window.__askvLive.protocolErrors.length > 0, undefined, { timeout: 40000 });
  assert.equal(await page.evaluate(() => window.__askvLive.protocolErrors.length), 0, 'Provider rejected the initial conversation context');
  metrics.phase = 'automatic_voice';
  await page.waitForFunction(() => window.__askvLive.speechStops >= 1 && window.__askvLive.playbackStops >= 2, undefined, { timeout: 45000 });
  await page.getByTestId('assistant-msg-user').first().waitFor();
  metrics.automaticVoicePassed = true;
  const typedPrompt = 'Say exactly: Synthetic typed follow up confirmed.';
  metrics.phase = 'typed_followup';
  await page.getByTestId('assistant-input').fill(typedPrompt);
  await page.getByTestId('assistant-send').click();
  await page.waitForFunction(() => window.__askvLive.playbackStops >= 3, undefined, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-msg-user"]').length >= 2);
  await page.getByTestId('assistant-msg-assistant').filter({ hasText: /synthetic typed follow.?up confirmed/i }).waitFor();
  metrics.typedFollowupPassed = true;
  await page.waitForTimeout(1000);
  await Promise.all(responseTasks);
  const conversations = await db.select().from(assistantConversationsTable).where(eq(assistantConversationsTable.userId, user.id));
  assert.equal(conversations.length, 1, 'Voice and typing must share one persisted conversation');
  const conversationId = conversations[0].id;
  const saved = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.conversationId, conversationId)).orderBy(asc(assistantMessagesTable.id));
  const savedVoice = saved.filter(row => row.role === 'user' && row.content !== typedPrompt);
  assert.ok(savedVoice.length >= 1, 'At least one actual spoken user turn must persist');
  assert.ok(/(?:two|2)\s*(?:plus|\+)\s*(?:two|2)/i.test(savedVoice.map(row => row.content).join(' ')), 'Combined actual speech transcript must contain the synthetic math request');
  assert.equal(saved.filter(row => row.role === 'user' && row.content === typedPrompt).length, 1, 'Typed follow-up must be saved exactly once');
  assert.equal(new Set(saved.map(row => row.id)).size, saved.length, 'Saved message IDs must be unique');
  assert.ok(saved.filter(row => row.role === 'assistant').length >= 3);
  metrics.savedMessages = saved.length; metrics.savedUserMessages = saved.filter(row => row.role === 'user').length;
  metrics.savedVoiceSegments = savedVoice.length; metrics.savedAssistantMessages = saved.filter(row => row.role === 'assistant').length;
  metrics.transport = await page.evaluate(async () => {
    const state = window.__askvLive; let bytes = 0, energy = 0;
    for (const pc of state.pcs) for (const stat of (await pc.getStats()).values()) if (stat.type === 'inbound-rtp' && stat.kind === 'audio') { bytes += stat.bytesReceived || 0; energy += stat.totalAudioEnergy || 0; }
    return { peerConnections: state.pcs.length, microphones: state.streams.length, speechStarts: state.speechStarts, speechStops: state.speechStops,
      playbackStarts: state.playbackStarts, playbackStops: state.playbackStops, protocolErrors: state.protocolErrors, receivedAudioBytes: bytes, receivedAudioEnergy: energy };
  });
  assert.ok(metrics.transport.receivedAudioBytes > 1000 && metrics.transport.receivedAudioEnergy > 0);
  assert.equal(metrics.transport.peerConnections, 1); assert.equal(metrics.transport.microphones, 1);
  assert.ok(metrics.transport.protocolErrors.every(error => error.code === 'response_cancel_not_active'));
  await page.getByTestId('assistant-mute').click();
  await page.waitForFunction(() => window.__askvLive.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')) && window.__askvLive.pcs.every(pc => pc.connectionState === 'closed'));
  metrics.microphoneShutdownPassed = true;
  metrics.firstPeerClosedBeforeResume = true;
  metrics.phase = 'reload_history';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-launcher').click({ timeout: 30000 });
  await page.getByTestId('assistant-msg-user').filter({ hasText: typedPrompt }).waitFor({ timeout: 20000 });
  const loaded = await page.request.get(`${origin}/api/assistant/conversations/${conversationId}`);
  assert.equal(loaded.status(), 200);
  const history = (await loaded.json()).messages;
  const digest = rows => createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, row.role, row.content]))).digest('hex');
  assert.equal(digest(history), digest(saved), 'Authenticated reloaded history must match persisted rows');
  assert.equal(await page.getByTestId('assistant-msg-user').count(), metrics.savedUserMessages);
  assert.equal(await page.getByTestId('assistant-msg-assistant').count(), metrics.savedAssistantMessages);
  metrics.reloadedHistoryPassed = true;
  metrics.mutePersisted = await page.evaluate(id => localStorage.getItem(`askv:muted:${id}`) === '1', user.id);
  metrics.noMicrophoneOnReload = await page.evaluate(() => window.__askvLive.streams.length === 0);
  const [persistedUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  metrics.greetingClaimSaved = typeof persistedUser.askvLastFullGreetingOn === 'string';
  assert.equal(metrics.toolRequests, 0); assert.equal(metrics.brokerCalls, 1);
  assert.equal(metrics.apiFailures.filter(failure => failure.path.startsWith('/api/assistant/')).length, 0);
  assert.equal(metrics.greeted, true); assert.equal(metrics.greetingClaimSaved, true);
  assert.equal(metrics.mutePersisted, true); assert.equal(metrics.noMicrophoneOnReload, true);
  metrics.phase = 'resume_saved_conversation';
  await page.getByTestId('assistant-mute').click();
  await page.waitForFunction(() => window.__askvLive.playbackStops >= 1 || window.__askvLive.protocolErrors.length > 0, undefined, { timeout: 40000 });
  assert.equal(await page.evaluate(() => window.__askvLive.protocolErrors.length), 0, 'Provider rejected restored conversation history');
  metrics.assistantHistoryAccepted = await page.evaluate(() => window.__askvLive.assistantHistoryAccepted);
  assert.ok(metrics.assistantHistoryAccepted >= metrics.savedAssistantMessages, 'Provider must acknowledge every restored assistant message');
  const resumedPrompt = 'What exact confirmation phrase did I ask you to say before this session was reopened? Repeat only that phrase.';
  await page.getByTestId('assistant-input').fill(resumedPrompt);
  await page.getByTestId('assistant-send').click();
  await page.waitForFunction(() => window.__askvLive.playbackStops >= 2, undefined, { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.getByTestId('assistant-mute').click();
  await page.waitForFunction(() => window.__askvLive.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')) && window.__askvLive.pcs.every(pc => pc.connectionState === 'closed'));
  metrics.resumedTransport = await page.evaluate(() => ({ peerConnections: window.__askvLive.pcs.length, microphones: window.__askvLive.streams.length,
    playbackStarts: window.__askvLive.playbackStarts, playbackStops: window.__askvLive.playbackStops, protocolErrors: window.__askvLive.protocolErrors }));
  assert.equal(metrics.resumedTransport.peerConnections, 1); assert.equal(metrics.resumedTransport.microphones, 1);
  assert.ok(metrics.resumedTransport.protocolErrors.every(error => error.code === 'response_cancel_not_active'));
  await Promise.all(responseTasks);
  const resumedConversations = await db.select().from(assistantConversationsTable).where(eq(assistantConversationsTable.userId, user.id));
  assert.equal(resumedConversations.length, 1); assert.equal(resumedConversations[0].id, conversationId);
  const resumedSaved = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.conversationId, conversationId)).orderBy(asc(assistantMessagesTable.id));
  assert.equal(digest(resumedSaved.slice(0, saved.length)), digest(saved), 'Resuming must preserve every existing history row');
  assert.equal(resumedSaved.filter(row => row.role === 'user' && row.content === resumedPrompt).length, 1, 'Resumed typed turn must persist exactly once in the original conversation');
  assert.equal(new Set(resumedSaved.map(row => row.id)).size, resumedSaved.length, 'Resumed message IDs must remain unique');
  assert.ok(resumedSaved.slice(saved.length).some(row => row.role === 'assistant' && /synthetic typed follow.?up confirmed/i.test(row.content)), 'Live resumed answer must recall the earlier synthetic confirmation');
  assert.equal(metrics.toolRequests, 0); assert.equal(metrics.brokerCalls, 2);
  assert.equal(metrics.apiFailures.filter(failure => failure.path.startsWith('/api/assistant/')).length, 0);
  metrics.resumedHistoryPassed = true; metrics.resumedMicrophoneShutdownPassed = true; metrics.finalSavedMessages = resumedSaved.length;
  metrics.phase = 'complete';
  console.log(JSON.stringify(metrics, null, 2));
  console.log('PASS authenticated full-app greeting, automatic live voice, typed follow-up, database persistence, muted reload, and live resumed history');
} catch (error) {
  metrics.failure = error instanceof assert.AssertionError ? 'assertion_failed' : safeCode(error?.name) || 'failed';
  if (error instanceof assert.AssertionError) metrics.assertion = error.message.split('\n')[0];
  if (page) metrics.browser = await page.evaluate(() => ({ path: location.pathname, panel: !!document.querySelector('[data-testid="assistant-panel"]'),
    state: window.__askvLive ? { microphones: window.__askvLive.streams.length, peerConnections: window.__askvLive.pcs.length, speechStarts: window.__askvLive.speechStarts,
      speechStops: window.__askvLive.speechStops, playbackStarts: window.__askvLive.playbackStarts, playbackStops: window.__askvLive.playbackStops, protocolErrors: window.__askvLive.protocolErrors } : null })).catch(() => null);
  console.log(JSON.stringify(metrics, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
  if (apiServer) { apiServer.closeAllConnections(); await new Promise(resolve => apiServer.close(resolve)); }
  await pool.end();
  assert.equal(path.dirname(path.resolve(tempDirectory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(tempDirectory).startsWith('askv-authenticated-live-'));
  await rm(tempDirectory, { recursive: true, force: true });
  globalThis.fetch = nativeFetch;
  console.log(JSON.stringify({ cleanup: { browserClosed: !browser?.isConnected(), viteStopped: !vite?.httpServer?.listening,
    apiStopped: !apiServer?.listening, databasePoolEnded: pool.ended, syntheticAudioRemoved: true, databaseRetained: true } }));
}
