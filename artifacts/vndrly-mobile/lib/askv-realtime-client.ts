import { encodePcm16Base64, PcmResampler, type WakeAudioSource } from "@workspace/askv-wake";
import { getApiBase } from "@/lib/api";

export interface AskVRealtimeContext {
  path?: string;
  entityId?: number | null;
  org?: string | null;
  location?: string | null;
  tools?: unknown[];
  workflow?: string;
  role?: string;
  organization?: { vendorId?: number | null; partnerId?: number | null; activeMembershipId?: number | null };
}
export interface AskVTranscript {
  eventId: string;
  role: "user" | "assistant";
  content: string;
}
export interface AskVRealtimeClient {
  connect(): Promise<void>;
  close(): void;
  interrupt(): void;
  setMicEnabled(enabled: boolean): void;
  updateContext(context: AskVRealtimeContext): void;
  /** Returns the provider item ID, or false if no live channel accepted the turn. */
  sendText(text: string): string | false;
}
type Track = { stop(): void; enabled: boolean };
type Stream = { getTracks(): Track[]; getAudioTracks(): Track[] };
type Channel = {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
  readyState: string;
  bufferedAmount?: number;
};
type Peer = {
  addTrack(track: unknown, stream: unknown): void;
  addTransceiver(kind: string, options: { direction: string }): void;
  createDataChannel(name: string): Channel;
  createOffer(): Promise<{ sdp?: string }>;
  setLocalDescription(desc: unknown): Promise<void>;
  setRemoteDescription(desc: unknown): Promise<void>;
  close(): void;
  connectionState?: string;
  onconnectionstatechange: (() => void) | null;
  ontrack: ((event: { streams: Stream[]; track?: Track }) => void) | null;
};
type WebRTCModule = {
  RTCPeerConnection: new (config?: object) => Peer;
  mediaDevices: { getUserMedia(constraints: { audio: boolean; video: boolean }): Promise<Stream> };
};
export interface AskVRealtimeOptions {
  token: string;
  sessionId?: string;
  conversationId?: number;
  seedMessage?: string;
  greeting?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  path?: string;
  signal?: AbortSignal;
  audioSource?: WakeAudioSource;
  onToolCall: (call: { name: string; arguments: unknown; callId: string }) => Promise<string>;
  /** Playback drained (or text-only response completed); generation alone is not completion. */
  onDone?: () => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
  onAudio?: () => void;
  onTranscript?: (transcript: AskVTranscript) => void;
  onUsage?: (usage: unknown) => void;
  onError?: (message: string) => void;
}
function abortError() { return Object.assign(new Error("AskV voice stopped"), { name: "AbortError" }); }

/** Construction never acquires a mic. close() can cancel pending permission/SDP. */
export async function createAskVRealtimeClient(args: AskVRealtimeOptions): Promise<AskVRealtimeClient> {
  let rtc: WebRTCModule;
  try { rtc = await import("react-native-webrtc") as unknown as WebRTCModule; }
  catch { throw new Error("assistant.realtime_unavailable"); }
  let closed = false;
  let stream: Stream | null = null;
  let peer: Peer | null = null;
  let channel: Channel | null = null;
  let connecting: Promise<void> | null = null;
  let unsubscribeAudio: (() => void) | null = null;
  let rejectOpen: ((error: Error) => void) | null = null;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let micEnabled = true;
  let playing = false;
  let itemCounter = 0;
  let latestContext: AskVRealtimeContext | null = null;
  const remoteTracks = new Set<Track>();
  const toolCalls = new Set<string>();
  const transcriptEvents = new Set<string>();
  const abort = new AbortController();
  const resampler = new PcmResampler(16000, 24000);
  // Match web: 50 ms packets avoid flooding SCTP with tiny capture callbacks.
  const audioPacket = new Float32Array(1200);
  let audioPacketLength = 0;
  const live = () => !closed && !args.signal?.aborted;
  const check = () => { if (!live()) throw abortError(); };
  const send = (event: unknown) => {
    if (!live() || channel?.readyState !== "open") return false;
    channel.send(JSON.stringify(event)); return true;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    args.signal?.removeEventListener("abort", close);
    if (openTimer) clearTimeout(openTimer);
    rejectOpen?.(abortError()); rejectOpen = null;
    unsubscribeAudio?.(); unsubscribeAudio = null;
    resampler.clear(); audioPacket.fill(0); audioPacketLength = 0;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    remoteTracks.forEach(track => track.stop()); remoteTracks.clear();
    if (channel) {
      channel.onmessage = null; channel.onopen = null; channel.onclose = null; channel.onerror = null;
      if (channel.readyState !== "closed") channel.close();
    }
    if (peer) { peer.ontrack = null; peer.onconnectionstatechange = null; peer.close(); }
    channel = null; peer = null;
  };
  const fail = (message: string) => { if (!live()) return; close(); args.onError?.(message); };
  args.signal?.addEventListener("abort", close, { once: true });
  if (args.signal?.aborted) close();
  const interrupt = () => {
    send({ type: "response.cancel" });
    send({ type: "output_audio_buffer.clear" });
    playing = false;
  };
  const updateContext = (context: AskVRealtimeContext) => {
    latestContext = context;
    if (context.tools) send({ type: "session.update", session: { type: "realtime", tools: context.tools } });
    const { tools: _tools, ...screenContext } = context;
    send({ type: "conversation.item.create", item: { type: "message", role: "user",
      content: [{ type: "input_text", text: "Application screen context (not a user request): " + JSON.stringify(screenContext) }] } });
  };
  const onMessage = async (event: { data: string }) => {
    if (!live()) return;
    try {
      const payload = JSON.parse(String(event.data));
      switch (payload.type) {
        case "input_audio_buffer.speech_started":
          if (playing) interrupt();
          args.onSpeechStarted?.(); break;
        case "input_audio_buffer.speech_stopped": args.onSpeechStopped?.(); break;
        case "output_audio_buffer.started": playing = true; args.onAudio?.(); break;
        case "output_audio_buffer.stopped": playing = false; args.onDone?.(); break;
        case "output_audio_buffer.cleared": playing = false; break;
        case "conversation.item.input_audio_transcription.completed":
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
        case "response.output_text.done": {
          const user = payload.type === "conversation.item.input_audio_transcription.completed";
          const role = user ? "user" : "assistant";
          const eventId = String(payload.item_id ?? payload.response_id ?? payload.event_id) + ":" + role;
          const content = String(payload.transcript ?? payload.text ?? "").trim();
          if (content && !transcriptEvents.has(eventId)) {
            transcriptEvents.add(eventId); args.onTranscript?.({ eventId, role, content });
          }
          break;
        }
        case "response.done": {
          const response = payload.response ?? {};
          if (response.usage) args.onUsage?.(response.usage);
          if (response.status === "failed") { fail(response.status_details?.error?.message ?? "assistant.realtime_failed"); break; }
          const output: Array<{ type?: string; content?: Array<{ type?: string }> }> = response.output ?? [];
          const hasAudio = output.some(item => item.content?.some(part => part.type === "audio" || part.type === "output_audio"));
          const hasTools = output.some(item => item.type === "function_call");
          if (response.status === "completed" && !playing && !hasAudio && !hasTools) args.onDone?.();
          break;
        }
        case "response.function_call_arguments.done": {
          const callId = String(payload.call_id ?? "");
          if (!callId || toolCalls.has(callId)) break;
          toolCalls.add(callId);
          const output = await args.onToolCall({ name: String(payload.name ?? ""), arguments: payload.arguments, callId });
          if (!live()) break;
          send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } });
          send({ type: "response.create" });
          break;
        }
        case "error":
          if (payload.error?.code !== "response_cancel_not_active" && payload.error?.code !== "output_audio_buffer_clear_empty") {
            fail(payload.error?.message ?? "assistant.realtime_failed");
          }
          break;
      }
    } catch (error) { fail(error instanceof Error ? error.message : "assistant.realtime_failed"); }
  };
  return {
    connect() {
      if (connecting) return connecting;
      connecting = (async () => {
        check();
        if (!args.audioSource) {
          const acquired = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
          if (!live()) { acquired.getTracks().forEach(track => track.stop()); throw abortError(); }
          stream = acquired;
        }
        check();
        const pc = new rtc.RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        peer = pc;
        if (args.audioSource) pc.addTransceiver("audio", { direction: "recvonly" });
        else stream!.getTracks().forEach(track => pc.addTrack(track, stream));
        pc.ontrack = event => { if (event.track) remoteTracks.add(event.track); event.streams.forEach(s => s.getTracks().forEach(t => remoteTracks.add(t))); };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") fail("assistant.realtime_disconnected");
        };
        const dc = pc.createDataChannel("oai-events"); channel = dc;
        dc.onmessage = event => { void onMessage(event); };
        dc.onclose = () => fail("assistant.realtime_disconnected");
        dc.onerror = () => fail("assistant.realtime_failed");
        const opened = new Promise<void>((resolve, reject) => {
          rejectOpen = reject;
          openTimer = setTimeout(() => reject(new Error("assistant.realtime_timeout")), 20_000);
          dc.onopen = () => {
            try {
            if (!live()) { reject(abortError()); return; }
            if (openTimer) clearTimeout(openTimer); openTimer = null; rejectOpen = null;
            for (const item of args.history ?? []) {
              send({ type: "conversation.item.create", item: { type: "message", role: item.role,
                content: [{ type: item.role === "user" ? "input_text" : "text", text: item.content }] } });
            }
            if (latestContext) updateContext(latestContext);
            if (args.greeting) send({ type: "response.create", response: {
              output_modalities: ["audio"], instructions: "Say exactly this greeting, then listen: " + JSON.stringify(args.greeting),
            } });
            if (args.audioSource) unsubscribeAudio = args.audioSource.subscribe(frame => {
              if (!micEnabled || !live()) return;
              const samples = resampler.push(frame);
              try {
                for (let offset = 0; offset < samples.length;) {
                  const count = Math.min(audioPacket.length - audioPacketLength, samples.length - offset);
                  audioPacket.set(samples.subarray(offset, offset + count), audioPacketLength);
                  audioPacketLength += count; offset += count;
                  if (audioPacketLength === audioPacket.length) {
                    if ((dc.bufferedAmount ?? 0) > 1024 * 1024) { fail("assistant.realtime_connection_slow"); return; }
                    send({ type: "input_audio_buffer.append", audio: encodePcm16Base64(audioPacket) });
                    audioPacket.fill(0); audioPacketLength = 0;
                  }
                }
              } finally { samples.fill(0); }
            });
            resolve();
            } catch (error) { reject(error); }
          };
        });
        void opened.catch(() => undefined);
        const offer = await pc.createOffer(); check();
        await pc.setLocalDescription(offer); check();
        const params = new URLSearchParams({ seedMessage: args.seedMessage ?? "voice conversation", clientSurface: "ios" });
        if (args.path) params.set("path", args.path);
        if (args.sessionId) params.set("sessionId", args.sessionId);
        if (args.conversationId) params.set("conversationId", String(args.conversationId));
        const response = await fetch(getApiBase() + "/api/assistant/realtime/call?" + params, {
          method: "POST", headers: { "Content-Type": "application/sdp", Authorization: "Bearer " + args.token },
          body: offer.sdp ?? "", signal: abort.signal,
        });
        check();
        if (!response.ok) throw new Error("assistant.realtime_sdp_failed");
        const sdp = await response.text(); check();
        await pc.setRemoteDescription({ type: "answer", sdp }); check();
        await opened; check();
      })().catch(error => { close(); throw error; });
      return connecting;
    },
    close, interrupt, updateContext,
    setMicEnabled(enabled) { micEnabled = enabled; stream?.getAudioTracks().forEach(track => { track.enabled = enabled; }); },
    sendText(text) {
      if (!text.trim() || !live() || channel?.readyState !== "open") return false;
      interrupt();
      const id = "typed_" + Date.now() + "_" + ++itemCounter;
      send({ type: "conversation.item.create", item: { id, type: "message", role: "user", content: [{ type: "input_text", text: text.trim() }] } });
      send({ type: "response.create" });
      return id;
    },
  };
}
