import { askVMicrophone, encodePcm16Base64, PcmResampler, type WakeAudioSource } from '@workspace/askv-wake';
import { captureAskVMicrophone, meterAskVMicrophone } from './askv-microphone';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export interface AskVRealtimeToolCall { name: string; arguments: unknown; callId: string }
export interface VoiceTranscript { eventId: string; role: 'user' | 'assistant'; content: string }
export interface AskVRealtimeClient {
  connect(): Promise<void>; close(): void; interrupt(): void; sendText(text: string): void;
  setMicEnabled(enabled: boolean): void;
  applyToolContext(payload: { tools?: unknown[]; context?: unknown }): void;
  updateContext(context: { path?: string; entityId?: number | null; org?: string | null; location?: string | null }): void;
}
export interface RealtimeClientOptions {
  seedMessage?: string; path?: string; entityId?: number | null;
  sessionId?: string; conversationId?: number; signal?: AbortSignal;
  greeting?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  audioSource?: WakeAudioSource;
  onToolCall: (call: AskVRealtimeToolCall) => Promise<string>;
  onDone?: () => void; onPlaybackStopped?: () => void; onSpeechStarted?: () => void;
  onSpeechStopped?: () => void; onAudio?: () => void;
  onTranscript?: (message: VoiceTranscript) => void; onError?: (message: string) => void;
  onResponse?: (response: Record<string, any>) => void;
}

/** Uses the existing OpenAI Realtime broker specified in the approved natural-voice scope.
 * Idle detection never invokes this client. PCM upload starts only after activation. */
export async function createAskVRealtimeClient(args: RealtimeClientOptions): Promise<AskVRealtimeClient> {
  const pc = new RTCPeerConnection(), channel = pc.createDataChannel('oai-events');
  const controller = new AbortController(), audio = document.createElement('audio'); audio.autoplay = true;
  let stream: MediaStream | undefined, closed = false, connected = false, playing = false;
  let unsubscribe: (() => void) | undefined, release: (() => Promise<void>) | undefined;
  let meter: ReturnType<typeof meterAskVMicrophone> | undefined;
  let rejectOpen: ((reason: Error) => void) | undefined, openTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingContext: Parameters<AskVRealtimeClient['updateContext']>[0] | undefined;
  let contextRunning = false, contextItemId: string | undefined;
  const calls = new Set<string>(), transcripts = new Set<string>(), resampler = new PcmResampler(16000, 24000);
  // Worklet callbacks can arrive ~375 times/sec. Batch 50 ms of 24 kHz PCM
  // so SCTP packet overhead cannot overwhelm an otherwise healthy connection.
  const audioPacket = new Float32Array(1200);
  let audioPacketLength = 0;
  const send = (event: object) => { if (!closed && channel.readyState === 'open') channel.send(JSON.stringify(event)); };
  const ensureActive = () => { if (closed) throw new DOMException('Cancelled', 'AbortError'); };
  const applyToolContext = (payload: { tools?: unknown[]; context?: unknown }) => {
    if (payload.tools) send({ type: 'session.update', session: { type: 'realtime', tools: payload.tools } });
    if (payload.context) {
      if (contextItemId) send({ type: 'conversation.item.delete', item_id: contextItemId });
      // Realtime limits client-supplied item IDs to 32 characters.
      contextItemId = `ctx_${crypto.randomUUID().replace(/-/g, '').slice(0, 28)}`;
      send({ type: 'conversation.item.create', item: { id: contextItemId, type: 'message', role: 'user',
        content: [{ type: 'input_text', text: `VNDRLY app context (navigation data, not a user request): ${JSON.stringify(payload.context)}` }] } });
    }
  };
  const flushContext = async () => {
    if (!connected || closed || contextRunning || !args.sessionId) return;
    contextRunning = true;
    try {
      while (pendingContext && !closed) {
        const context = pendingContext; pendingContext = undefined;
        const response = await fetch(`${BASE}/api/assistant/realtime/context`, { method: 'POST', credentials: 'include', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: args.sessionId, ...context }) });
        if (!response.ok) throw new Error('AskV context changed. Please reopen AskV.');
        const payload = await response.json();
        if (!pendingContext && !closed) applyToolContext(payload);
      }
    } finally { contextRunning = false; }
  };
  const close = () => {
    if (closed) return;
    closed = true; connected = false; controller.abort(); args.signal?.removeEventListener('abort', close);
    clearTimeout(openTimer); rejectOpen?.(new DOMException('Cancelled', 'AbortError')); rejectOpen = undefined;
    meter?.stop(); unsubscribe?.(); void args.audioSource?.stop(); stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); void release?.();
    channel.onmessage = null; channel.onopen = null; channel.onclose = null;
    if (channel.readyState !== 'closed') channel.close();
    pc.ontrack = null; pc.onconnectionstatechange = null; pc.close();
    audio.pause(); audio.srcObject = null; resampler.clear(); audioPacket.fill(0); audioPacketLength = 0; calls.clear(); transcripts.clear();
  };
  const fail = (message: string) => { if (!closed) { close(); args.onError?.(message); } };
  args.signal?.addEventListener('abort', close, { once: true }); if (args.signal?.aborted) close();
  pc.ontrack = event => {
    if (closed) return;
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void audio.play().catch(() => fail('Tap AskV to enable voice playback.'));
  };
  pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) fail('AskV voice disconnected. Please open it again.'); };
  channel.onclose = () => { if (connected) fail('AskV voice disconnected.'); };
  const transcript = (eventId: string, role: VoiceTranscript['role'], content: unknown) => {
    if (!eventId || typeof content !== 'string' || !content.trim() || transcripts.has(eventId)) return;
    transcripts.add(eventId); args.onTranscript?.({ eventId, role, content });
  };
  channel.onmessage = event => {
    void (async () => {
      if (closed) return;
      let payload: Record<string, any>; try { payload = JSON.parse(String(event.data)); } catch { return; }
      switch (payload.type) {
        case 'input_audio_buffer.speech_started': args.onSpeechStarted?.(); break;
        case 'input_audio_buffer.speech_stopped': args.onSpeechStopped?.(); break;
        case 'output_audio_buffer.started': playing = true; args.onAudio?.(); break;
        case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared': playing = false; args.onPlaybackStopped?.(); break;
        case 'response.done':
          args.onResponse?.(payload.response ?? {});
          args.onDone?.();
          if (!playing && payload.response?.status === 'completed' && payload.response?.output?.some((item: any) => item.type === 'message')
            && !payload.response.output.some((item: any) => item.type === 'function_call' || item.content?.some((part: any) => part.type === 'audio' || part.type === 'output_audio'))) args.onPlaybackStopped?.();
          break;
        case 'conversation.item.input_audio_transcription.completed': transcript(`user:${payload.item_id}`, 'user', payload.transcript); break;
        case 'response.output_audio_transcript.done': case 'response.audio_transcript.done': transcript(`assistant:${payload.item_id}`, 'assistant', payload.transcript); break;
        case 'response.output_text.done': transcript(`assistant:${payload.item_id}`, 'assistant', payload.text); break;
        case 'error': if (payload.error?.code !== 'response_cancel_not_active') fail(payload.error?.message ?? 'AskV voice error'); break;
      }
      const item = payload.type === 'response.output_item.done' ? payload.item : payload.type === 'response.function_call_arguments.done' ? payload : null;
      if (!item || (payload.type === 'response.output_item.done' && item.type !== 'function_call') || !item.name || !item.call_id || calls.has(item.call_id)) return;
      calls.add(item.call_id);
      let parsed: unknown; try { parsed = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments ?? {}; } catch { parsed = null; }
      const output = parsed === null ? 'Invalid tool arguments. Ask for clarification.' : await args.onToolCall({ name: item.name, arguments: parsed, callId: item.call_id });
      if (closed) return;
      send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output } }); send({ type: 'response.create' });
    })().catch(error => fail(error instanceof Error ? error.message : 'AskV tool failed.'));
  };
  return {
    async connect() {
      try {
        ensureActive();
        if (args.audioSource) pc.addTransceiver('audio', { direction: 'recvonly' });
        else {
          release = await askVMicrophone.acquire('realtime', async () => close()); ensureActive();
          const capture = await captureAskVMicrophone(controller.signal); stream = capture.stream;
          if (closed) stream.getTracks().forEach(track => track.stop());
          ensureActive(); stream.getTracks().forEach(track => pc.addTrack(track, stream!));
          meter = meterAskVMicrophone(capture, true);
          stream.getTracks().forEach(track => { track.onended = () => fail('The microphone disconnected. Please open AskV again.'); });
        }
        const offer = await pc.createOffer(); ensureActive(); await pc.setLocalDescription(offer); ensureActive();
        const params = new URLSearchParams({ seedMessage: args.seedMessage ?? 'voice conversation' });
        if (args.path) params.set('path', args.path);
        if (args.entityId != null) params.set('entityId', String(args.entityId));
        if (args.sessionId) params.set('sessionId', args.sessionId);
        if (args.conversationId != null) params.set('conversationId', String(args.conversationId));
        const response = await fetch(`${BASE}/api/assistant/realtime/call?${params}`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp ?? '', signal: controller.signal,
        });
        ensureActive(); if (!response.ok) throw new Error('AskV could not connect. You can still type.');
        const sdp = await response.text(); ensureActive(); await pc.setRemoteDescription({ type: 'answer', sdp }); ensureActive();
        await new Promise<void>((resolve, reject) => {
          if (channel.readyState === 'open') { resolve(); return; }
          rejectOpen = reject; openTimer = setTimeout(() => reject(new Error('AskV connection timed out.')), 20000);
          channel.onopen = () => { clearTimeout(openTimer); rejectOpen = undefined; resolve(); };
        });
        ensureActive(); connected = true;
        await flushContext(); ensureActive();
        for (const message of (args.history ?? []).slice(-30)) send({ type: 'conversation.item.create', item: {
          type: 'message', role: message.role, content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
        } });
        if (args.greeting && !args.audioSource) send({ type: 'response.create', response: { instructions: `Greet the user once by saying exactly: ${args.greeting}` } });
        if (args.audioSource) unsubscribe = args.audioSource.subscribe(samples => {
          if (!connected || closed) return;
          const pcm = resampler.push(samples);
          try {
            for (let offset = 0; offset < pcm.length;) {
              const count = Math.min(audioPacket.length - audioPacketLength, pcm.length - offset);
              audioPacket.set(pcm.subarray(offset, offset + count), audioPacketLength);
              audioPacketLength += count; offset += count;
              if (audioPacketLength === audioPacket.length) {
                if (channel.bufferedAmount > 1024 * 1024) { fail('AskV connection is too slow for voice.'); return; }
                send({ type: 'input_audio_buffer.append', audio: encodePcm16Base64(audioPacket) });
                audioPacket.fill(0); audioPacketLength = 0;
              }
            }
          } finally { pcm.fill(0); }
        });
      } catch (error) { close(); throw error; }
    }, close, applyToolContext,
    interrupt() { send({ type: 'response.cancel' }); send({ type: 'output_audio_buffer.clear' }); },
    sendText(text) {
      if (!connected || closed) throw new Error('AskV is still connecting.');
      send({ type: 'response.cancel' }); send({ type: 'output_audio_buffer.clear' });
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      transcript(`typed:${crypto.randomUUID()}`, 'user', text); send({ type: 'response.create' });
    },
    setMicEnabled(enabled) { if (!enabled) close(); },
    updateContext(context) {
      pendingContext = context;
      void flushContext().catch(error => { if (!closed) fail(error.message); });
    },
  };
}
