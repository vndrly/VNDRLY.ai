import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAskVRealtimeClient, type AskVRealtimeClient } from './askv-realtime-client';
class FakeChannel {
  readyState = 'open'; bufferedAmount = 0;
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
    peer = new FakePeer(); track = { stop: vi.fn() };
    vi.stubGlobal('RTCPeerConnection', class { constructor() { return peer; } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => 'answer', json: async () => ({ tools: [] }) })));
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
  });
  afterEach(() => { client?.close(); vi.restoreAllMocks(); });
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
      history: [{ role: 'user', content: 'Earlier question' }] });
    await client.connect(); client.sendText('Next question');
    peer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'voice1', transcript: 'Spoken question' });
    peer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'voice1', transcript: 'Spoken question' });
    expect(onTranscript).toHaveBeenCalledTimes(2);
    client.updateContext({ path: '/gatekeeper' }); await vi.waitFor(() => expect(peer.channel.sent).toContainEqual({ type: 'session.update', session: { type: 'realtime', tools: [] } }));
    expect(peer.channel.sent.some(event => event.item?.content?.[0]?.text === 'Earlier question')).toBe(true);
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
  it('does not declare playback finished for cancelled or pending tool responses', async () => {
    const onPlaybackStopped = vi.fn(); client = await createAskVRealtimeClient({ onToolCall: async () => '', onPlaybackStopped }); await client.connect();
    peer.channel.emit({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call' }] } });
    peer.channel.emit({ type: 'response.done', response: { status: 'cancelled', output: [] } });
    expect(onPlaybackStopped).not.toHaveBeenCalled();
    peer.channel.emit({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'text', text: 'Answer' }] }] } });
    expect(onPlaybackStopped).toHaveBeenCalledOnce();
  });
});
