import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAskVRealtimeClient, type AskVRealtimeClient } from './askv-realtime-client';
import { getAskVMicrophoneState } from './askv-microphone';
class FakeChannel {
  readyState = 'open'; bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: Array<Record<string, any>> = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 'closed'; }
  emit(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
class FakePeer {
  channel = new FakeChannel(); connectionState = 'connected';
  addTrack = vi.fn(); addTransceiver = vi.fn(); createDataChannel = () => this.channel;
  createOffer = vi.fn(async () => ({ sdp: 'offer' })); setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {}); close = vi.fn();
}
describe('realtime transport lifecycle', () => {
  let peer: FakePeer, track: { stop: ReturnType<typeof vi.fn> }, client: AskVRealtimeClient;
  beforeEach(() => {
    localStorage.removeItem('askv:microphone-device');
    peer = new FakePeer(); track = { stop: vi.fn() };
    vi.stubGlobal('RTCPeerConnection', class { constructor() { return peer; } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => 'answer', json: async () => ({ tools: [] }) })));
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
  });
  afterEach(() => { client?.close(); vi.restoreAllMocks(); });
  it('waits for the data channel before reporting a ready connection', async () => {
    peer.channel.readyState = 'connecting';
    client = await createAskVRealtimeClient({ onToolCall: async () => '' });
    let ready = false;
    const pending = client.connect().then(() => { ready = true; });
    await vi.waitFor(() => expect(peer.channel.onopen).toBeTypeOf('function'));
    expect(ready).toBe(false);
    peer.channel.readyState = 'open'; peer.channel.onopen?.();
    await pending; expect(ready).toBe(true);
  });
  it.each(['close', 'error'] as const)('rejects a pending channel %s without waiting for timeout', async event => {
    peer.channel.readyState = 'connecting';
    const onError = vi.fn();
    client = await createAskVRealtimeClient({ onToolCall: async () => '', onError });
    const pending = client.connect();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(peer.channel.onopen).toBeTypeOf('function'));
    if (event === 'close') peer.channel.onclose?.(); else peer.channel.onerror?.();
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledOnce();
  });
  it('cancels a pending channel connection and releases the microphone on close', async () => {
    peer.channel.readyState = 'connecting';
    client = await createAskVRealtimeClient({ onToolCall: async () => '' });
    const pending = client.connect();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(peer.channel.onopen).toBeTypeOf('function'));
    client.close(); await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('captures the selected headset instead of the browser default', async () => {
    localStorage.setItem('askv:microphone-device', 'wired-headset');
    client = await createAskVRealtimeClient({ onToolCall: async () => '' });
    await client.connect();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: {
      deviceId: { exact: 'wired-headset' }, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }, video: false });
  });
  it('closes realtime and clears the meter when the active microphone is unplugged', async () => {
    const onError = vi.fn();
    client = await createAskVRealtimeClient({ onToolCall: async () => '', onError });
    await client.connect();
    expect(getAskVMicrophoneState().active).toBe(true);
    (track as unknown as { onended: () => void }).onended();
    expect(peer.close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(getAskVMicrophoneState()).toMatchObject({ active: false, level: 0 });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });
  it('keeps multiple turns open and waits for actual playback, including greeting', async () => {
    const onDone = vi.fn(), onPlaybackStopped = vi.fn(), onAudio = vi.fn();
    client = await createAskVRealtimeClient({ onToolCall: async () => '', onDone, onPlaybackStopped, onAudio, greeting: 'Good morning Brian.' });
    await client.connect();
    expect(peer.channel.sent.some(event => event.type === 'response.create' && event.response.instructions.includes('Brian'))).toBe(true);
    peer.channel.emit({ type: 'output_audio_buffer.started' });
    peer.channel.emit({ type: 'response.done', response: { output: [{ content: [{ type: 'audio' }] }] } });
    expect(onDone).toHaveBeenCalledOnce(); expect(onPlaybackStopped).not.toHaveBeenCalled();
    peer.channel.emit({ type: 'output_audio_buffer.stopped' }); expect(onPlaybackStopped).toHaveBeenCalledOnce();
    client.interrupt(); expect(peer.channel.sent).toContainEqual({ type: 'output_audio_buffer.clear' });
    expect(peer.close).not.toHaveBeenCalled(); expect(onAudio).toHaveBeenCalledOnce();
  });
  it('stops tracks granted after cancellation and never sends SDP', async () => {
    let grant!: (value: any) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => new Promise(resolve => { grant = resolve; }));
    client = await createAskVRealtimeClient({ onToolCall: async () => '' });
    const pending = client.connect(); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(grant).toBeDefined()); client.close(); grant({ getTracks: () => [track] });
    await rejected; expect(track.stop).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it('stops a late SDP answer from reviving a muted session', async () => {
    let answer!: (value: any) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    client = await createAskVRealtimeClient({ onToolCall: async () => '' });
    const pending = client.connect(); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(answer).toBeDefined()); client.setMicEnabled(false);
    answer({ ok: true, text: async () => 'late' }); await rejected;
    expect(peer.setRemoteDescription).not.toHaveBeenCalled(); expect(track.stop).toHaveBeenCalled();
  });
  it('reserves duplicate function events before executing a mutation', async () => {
    let finish!: (result: string) => void;
    const onToolCall = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    client = await createAskVRealtimeClient({ onToolCall }); await client.connect();
    const call = { name: 'close_ticket', call_id: 'same', arguments: '{"id":12}' };
    peer.channel.emit({ type: 'response.function_call_arguments.done', ...call });
    peer.channel.emit({ type: 'response.output_item.done', item: { type: 'function_call', ...call } });
    expect(onToolCall).toHaveBeenCalledOnce(); finish('done'); await Promise.resolve();
    expect(peer.channel.sent.filter(event => event.item?.type === 'function_call_output')).toHaveLength(1);
  });
  it('continues wake PCM with no second microphone and clears the source on close', async () => {
    const stop = vi.fn(), subscribe = vi.fn(callback => { callback(new Float32Array(1600).fill(0.1)); return vi.fn(); });
    client = await createAskVRealtimeClient({ onToolCall: async () => '', audioSource: { stop, subscribe } });
    await client.connect(); expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(peer.addTransceiver).toHaveBeenCalledWith('audio', { direction: 'recvonly' });
    expect(peer.channel.sent.some(event => event.type === 'input_audio_buffer.append' && event.audio.length > 0)).toBe(true);
    client.close(); expect(stop).toHaveBeenCalledOnce();
  });
  it('keeps typed and spoken turns in one history and refreshes tools through the server', async () => {
    const onTranscript = vi.fn();
    client = await createAskVRealtimeClient({ sessionId: 'session', onToolCall: async () => '', onTranscript,
      history: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }] });
    await client.connect(); client.sendText('Next question');
    peer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'voice1', transcript: 'Spoken question' });
    peer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'voice1', transcript: 'Spoken question' });
    expect(onTranscript).toHaveBeenCalledTimes(2);
    client.updateContext({ path: '/gatekeeper' }); await vi.waitFor(() => expect(peer.channel.sent).toContainEqual({ type: 'session.update', session: { type: 'realtime', tools: [] } }));
    expect(peer.channel.sent.some(event => event.item?.content?.[0]?.text === 'Earlier question')).toBe(true);
    expect(peer.channel.sent.find(event => event.item?.role === 'assistant')?.item.content)
      .toEqual([{ type: 'output_text', text: 'Earlier answer' }]);
  });
  it('batches tiny worklet frames without losing PCM order or flooding the data channel', async () => {
    let deliver!: (samples: Float32Array) => void;
    const stop = vi.fn();
    client = await createAskVRealtimeClient({ onToolCall: async () => '', audioSource: {
      stop, subscribe: callback => { deliver = callback; return vi.fn(); },
    } });
    await client.connect();
    // Approximately one second of the small 16 kHz frames emitted by a 48 kHz
    // AudioWorklet. One message per frame floods the real SCTP data channel.
    for (let i = 0; i < 400; i++) {
      if (i === 200) client.interrupt();
      deliver(new Float32Array(40).fill(i < 200 ? 0.25 : -0.25));
    }
    deliver(new Float32Array(1).fill(-0.25)); // Complete the resampler's last interpolation.
    const packets = peer.channel.sent.filter(event => event.type === 'input_audio_buffer.append');
    expect(packets.length).toBeGreaterThanOrEqual(9);
    expect(packets.length).toBeLessThanOrEqual(20);
    const decoded = packets.flatMap(event => {
      const bytes = Uint8Array.from(atob(event.audio), character => character.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      return Array.from({ length: bytes.length / 2 }, (_, index) => view.getInt16(index * 2, true));
    });
    expect(decoded).toHaveLength(24000);
    expect(decoded.slice(0, 11998).every(value => value === 8192)).toBe(true);
    expect(decoded.slice(12002).every(value => value === -8192)).toBe(true);
    deliver(new Float32Array(10).fill(0.25)); // Leave a partial packet to discard on close.
    client.close();
    const count = peer.channel.sent.length; deliver(new Float32Array(1600));
    expect(peer.channel.sent).toHaveLength(count);
  });
  it('retains startup navigation and serializes later context requests without applying stale tools', async () => {
    const contexts: Array<{ path: string; resolve: (response: any) => void }> = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/context')) return new Promise(resolve => contexts.push({ path: JSON.parse(String(init?.body)).path, resolve }));
      return { ok: true, text: async () => 'answer' } as Response;
    });
    client = await createAskVRealtimeClient({ sessionId: 'session', onToolCall: async () => '' });
    client.updateContext({ path: '/tickets/1' });
    const connected = client.connect();
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    client.updateContext({ path: '/tickets/2' }); client.updateContext({ path: '/gatekeeper' });
    expect(contexts).toHaveLength(1);
    contexts[0].resolve({ ok: true, json: async () => ({ tools: [{ name: 'stale' }], context: { path: '/tickets/1' } }) });
    await vi.waitFor(() => expect(contexts).toHaveLength(2));
    expect(contexts[1].path).toBe('/gatekeeper');
    contexts[1].resolve({ ok: true, json: async () => ({ tools: [{ name: 'current' }], context: { path: '/gatekeeper' } }) });
    await connected;
    expect(JSON.stringify(peer.channel.sent)).not.toContain('stale');
    expect(JSON.stringify(peer.channel.sent)).toContain('navigation data');
    expect(JSON.stringify(peer.channel.sent)).toContain('/gatekeeper');
  });
  it('replaces navigation context using unique provider IDs within the 32-character limit', async () => {
    client = await createAskVRealtimeClient({ onToolCall: async () => '' });
    await client.connect();
    client.applyToolContext({ context: { path: '/tickets/1' } });
    client.applyToolContext({ context: { path: '/tickets/2' } });
    const items = peer.channel.sent.filter(event => event.type === 'conversation.item.create');
    expect(items).toHaveLength(2);
    const ids = items.map(event => event.item.id);
    expect(ids.every(id => /^[A-Za-z0-9_-]{1,32}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(2);
    expect(peer.channel.sent.filter(event => event.type === 'conversation.item.delete'))
      .toEqual([{ type: 'conversation.item.delete', item_id: ids[0] }]);
  });
  it('does not declare playback finished for cancelled or pending tool responses', async () => {
    const onPlaybackStopped = vi.fn(); client = await createAskVRealtimeClient({ onToolCall: async () => '', onPlaybackStopped }); await client.connect();
    peer.channel.emit({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call' }] } });
    peer.channel.emit({ type: 'response.done', response: { status: 'cancelled', output: [] } });
    expect(onPlaybackStopped).not.toHaveBeenCalled();
    peer.channel.emit({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'text', text: 'Answer' }] }] } });
    expect(onPlaybackStopped).toHaveBeenCalledOnce();
  });
});
