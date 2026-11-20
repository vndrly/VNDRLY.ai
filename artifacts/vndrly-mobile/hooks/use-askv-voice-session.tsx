import { waitForGateCapture } from "@workspace/gate-booth";
import { usePathname } from "expo-router";
import { AppState, Platform } from "react-native";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession, tool, type RealtimeItem } from "@workspace/askv-realtime-sdk";
import { voiceApplicationInstructions, voiceSeedMessage, privateVoiceContext, voiceContextBinding, isQuickShiftNote, voiceQuickNoteInstructions } from "@workspace/askv-realtime-sdk/app-context";
import { readVoicePageContext, subscribeVoicePageContext } from "@workspace/gate-booth";
import { askVMicrophone } from "@workspace/askv-wake";
import { normalizePlateState, parseSpokenPlateState } from "@workspace/plate-state";
import { askVAudioInput, createSilentGateCheckIn, readGateVoiceDraft, subscribeGateVoiceDraft, notifyGateVoiceSaved, fillGateVoiceDraft, cancelGateVoiceDraft, createGateCheckInFocus, gateCheckInFocusAvailable, readGateVoiceGuidance, subscribeGateVoiceGuidance, parseGateSetupProgressHint, parseGateWorkflowOffer, publishGateVoiceWorkflowResult, gateWorkflowToolArguments } from "@workspace/gate-booth";
import { getToken, getCachedToken, subscribeToken, subscribeUser, type StoredUser } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useAssistant, type AssistantMessage } from "@/hooks/use-assistant";
import { openAskVMicrophone, sdkTransport, type AskVMicrophone } from "@/lib/askv-sdk/transport";
import { emitAskVDataChanged, executeAskVClientIntent } from "@/lib/askv-client-tools";
import { withAskVToolLocation, type AskVCoordinates } from "@/lib/askv-tool-location";
import { getApiBase } from "@/lib/api";
import { type AskVVoiceState } from "@/lib/askv-voice-state";
import { readAskVAcrossVndrly, readAskVMuted, writeAskVAcrossVndrly, writeAskVMuted } from "@/lib/askvVoicePreferences";
import { nativeAskVContextPath } from "@/lib/askv-context-path";
import { nativeUuid } from "@/lib/native-uuid";

type Assistant = ReturnType<typeof useAssistant>;
interface AskVVoiceSessionValue {
  state: AskVVoiceState; error: string | null; greeting: string | null;
  muted: boolean; acrossVndrly: boolean; wakeSupported: boolean; preferencesReady: boolean;
  assistant: Assistant;
  startConversation: (seed?: string, path?: string) => Promise<void>;
  stop: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setAcrossVndrly: (enabled: boolean) => void;
  subscribeReplies: (listener: (text: string) => void) => () => void;
}
type WireTool = { name: string; description: string; parameters: Record<string, any> };
type VoiceConfig = {
  clientSecret: string; model: string; voice: string; instructions: string;
  tools: WireTool[]; toolMetadata: { name: string; mutating: boolean }[];
};
type Live = {
  id: string; scope: string; abort: AbortController; stream: AskVMicrophone | null;
  sdk: RealtimeSession | null; release: (() => Promise<void>) | null; ready: boolean;
  token: string | null; config: VoiceConfig | null; starting: Promise<void> | null;
  conversation: Promise<number> | null; saving: Promise<void>; saved: Set<string>;
  queued: Set<string>; lastUser: string | null;
  binding: string; seen: Map<string, string>;
  focus: ReturnType<typeof createGateCheckInFocus>;
  checkIn: ReturnType<typeof createSilentGateCheckIn>;
  audioTurns: Map<string, boolean>;
  gateSpeechItem?: string;
  mutePlayback?: (muted: boolean) => void;
  quickNote?: boolean;
  noteOperationId?: string;
  pending: { name: string; arguments: string; key: string; path: string; coordinates?: AskVCoordinates | null } | null;
};
const Context = createContext<AskVVoiceSessionValue | null>(null);
const scopeOf = (u: StoredUser | null) => u ? [u.id, u.activeMembershipId, u.role, u.partnerId, u.vendorId].join(":") : "";
function stopStream(stream: AskVMicrophone | null) { stream?.getTracks().forEach(track => track.stop()); }
function fingerprint(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(fingerprint).join(",") + "]";
  return "{" + Object.entries(value).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ":" + fingerprint(v)).join(",") + "}";
}
async function post(token: string, path: string, body: unknown, signal?: AbortSignal, toolResult = false): Promise<any> {
  const response = await fetch(getApiBase() + "/api/assistant/" + path, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body), signal,
  });
  const data = await response.json();
  if (!response.ok && (!toolResult || response.status === 401)) throw new Error(data.message ?? data.error ?? "Voice request failed");
  return data;
}

/** OpenAI's SDK owns audio, turn-taking, interruptions, tool execution and replies. */
export function AskVVoiceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const scope = scopeOf(user);
  const [state, setState] = useState<AskVVoiceState>("stopped");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [acrossVndrly, setAcross] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<AssistantMessage[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const mounted = useRef(true), pathRef = useRef(pathname), scopeRef = useRef(scope), userRef = useRef(user);
  pathRef.current = pathname; scopeRef.current = scope; userRef.current = user;
  const liveRef = useRef<Live | null>(null);
  const messagesRef = useRef(new Map<string, AssistantMessage>());
  const mutedRef = useRef(false), acrossRef = useRef(false), preferenceVersion = useRef(0);
  const replies = useRef(new Set<(text: string) => void>());
  const base = useAssistant({
    pagePath: nativeAskVContextPath(pathname),
    onClientIntent: intent => executeAskVClientIntent(intent, pathRef.current),
    onMutation: emitAskVDataChanged,
    onAssistantReply: text => replies.current.forEach(listener => listener(text)),
  });
  const assistantRef = useRef(base); assistantRef.current = base;
  const metadata = useRef<Partial<AssistantMessage>>({});
  const applicationContext = () => {
    const path = nativeAskVContextPath(pathRef.current), draft = readGateVoiceDraft();
    const gateDraft = draft && (typeof draft.pagePath !== "string" || nativeAskVContextPath(draft.pagePath) === path) ? draft : null;
    return { ...assistantRef.current.getApplicationContext?.(), path, page: readVoicePageContext(path) ?? { path, title: typeof gateDraft?.pageTitle === "string" ? gateDraft.pageTitle : path.split("/").at(-1)?.replaceAll("-", " ") }, gateGuidance: readGateVoiceGuidance() ?? null, gateDraft };
  };
  const valid = (live: Live) => mounted.current && liveRef.current === live && !live.abort.signal.aborted && scopeRef.current === live.scope;
  const historyValid = (live: Live) => mounted.current && scopeRef.current === live.scope && getCachedToken() === live.token && live.binding === voiceContextBinding(applicationContext()) && !privateVoiceContext(applicationContext());
  const writeState = (live: Live, next: AskVVoiceState) => { if (valid(live)) setState(next); };
  const upsert = (message: AssistantMessage) => {
    messagesRef.current.set(message.id, { ...messagesRef.current.get(message.id), ...message });
    if (mounted.current) setVoiceMessages([...messagesRef.current.values()]);
  };

  // Close capture synchronously. Storage never participates in microphone shutdown/startup.
  const closeLive = useCallback((live: Live) => {
    live.abort.abort(); live.ready = false;
    try { live.sdk?.close(); } finally { stopStream(live.stream); live.stream = null; }
    const release = live.release; live.release = null;
    void release?.().catch(() => undefined);
  }, []);
  const stop = useCallback(async () => {
    metadata.current = {};
    const live = liveRef.current; liveRef.current = null;
    if (live) closeLive(live);
    if (mounted.current) { setState("stopped"); setActiveTool(null); }
  }, [closeLive]);

  function conversation(live: Live): Promise<number> {
    if (!live.conversation) {
      live.conversation = (async () => {
        if (!historyValid(live) || !live.token) throw new Error("Voice authorization changed");
        const existing = assistantRef.current.getConversationId();
        const result = await post(live.token, "voice/conversation", existing ? { conversationId: existing } : {});
        if (!historyValid(live)) throw new Error("Voice authorization changed");
        if (!assistantRef.current.getConversationId()) assistantRef.current.restoreConversation(result.conversationId, assistantRef.current.messages);
        return result.conversationId as number;
      })();
      void live.conversation.catch(() => { live.conversation = null; });
    }
    return live.conversation;
  }
  function record(live: Live, message: AssistantMessage) {
    if (privateVoiceContext(applicationContext()) || !message.content.trim() || message.pending || live.saved.has(message.id) || live.queued.has(message.id)) return;
    live.queued.add(message.id);
    const operation = live.saving.catch(() => undefined).then(async () => {
      const conversationId = await conversation(live);
      if (!historyValid(live) || !live.token) return;
      const result = await post(live.token, "voice/transcript", {
        conversationId, sessionId: live.id, eventId: message.id, role: message.role,
        content: message.content, clientSurface: "ios",
        gateSetupProgress: message.gateSetupProgress, gateWorkflowOffer: message.gateWorkflowOffer,
        selectedConnection: applicationContext().selectedConnection,
        // SDK function tools own dispatch. This endpoint only persists the transcript.
        spoken: false,
      });
      live.saved.add(message.id);
      if (historyValid(live)) upsert({ ...(messagesRef.current.get(message.id) ?? message), serverId: result.messageId });
    });
    live.saving = operation;
    void operation.finally(() => live.queued.delete(message.id)).catch(() => undefined);
  }
  function acceptHistory(live: Live, history: RealtimeItem[]) {
    if (!valid(live)) return;
    for (const item of history) {
      if (item.type !== "message" || (item.role !== "user" && item.role !== "assistant")) continue;
      if (live.audioTurns.get(item.itemId) || (item.role === "assistant" && live.checkIn.active(applicationContext()))) continue;
      const content = item.content.map(part => "text" in part ? part.text : "transcript" in part ? part.transcript ?? "" : "").join("").trim();
      if (!content) continue;
      const prior = messagesRef.current.get(item.itemId);
      const signature = JSON.stringify([content, item.status]);
      if (live.seen.get(item.itemId) === signature) continue;
      live.seen.set(item.itemId, signature);
      const message: AssistantMessage = { ...prior, ...(item.role === "assistant" ? metadata.current : {}), id: item.itemId, role: item.role, content, pending: item.status === "in_progress" };
      if (item.role === "assistant" && !message.pending) metadata.current = {};
      upsert(message);
      if (message.role === "user") live.lastUser = message.id;
      if (!message.pending) {
        const current = applicationContext(), noteRequested = item.role === "user" && isQuickShiftNote(content);
        if (noteRequested) live.quickNote = true;
        const noteCancelled = live.quickNote && item.role === "user" && /^(?:(?:uh|okay|please)[, ]+)*(?:cancel\b|never\s?mind\b|no[.!]?$)/i.test(content.trim());
        const focus = live.quickNote ? { cancelled: Boolean(noteCancelled), changed: Boolean(noteRequested || noteCancelled) } : live.focus.observe(current, item.role, content);
        if (focus.cancelled) {
          const pending = live.pending; live.pending = null;
          if (live.quickNote) { live.quickNote = false; live.noteOperationId = undefined; } else cancelGateVoiceDraft();
          if (pending && live.token) void post(live.token, "voice/actions", { ...current, name: pending.name, arguments: JSON.parse(pending.arguments), sessionId: live.id, callId: "cancel-" + Date.now(), clientSurface: "ios", utterance: { eventId: message.id, text: content } }, live.abort.signal, true).catch(() => undefined);
        }
        if (focus.changed) refreshContextRef.current();
      }
      if (message.role === "user" && !message.pending) publishGateVoiceWorkflowResult({ question: content });
      if (!message.pending && message.role === "assistant" && (prior?.pending || prior?.content !== content)) replies.current.forEach(listener => listener(content));
      record(live, message);
    }
  }
  function makeAgent(live: Live): RealtimeAgent {
    const config = live.config!;
    return new RealtimeAgent({
      name: "AskV",
      instructions: config.instructions + voiceApplicationInstructions(applicationContext()) + (live.quickNote ? "" : live.focus.instructions(applicationContext())) + voiceQuickNoteInstructions(),
      tools: config.tools.map(definition => tool({
        name: definition.name, description: definition.description, parameters: definition.parameters as any, strict: false,
        execute: async (raw, _context, details) => {
          if (!valid(live) || !live.token) return JSON.stringify({ ok: false, error: "Voice session ended" });
          if (live.checkIn.active(applicationContext())) return JSON.stringify({ ok: false });
          const input = gateWorkflowToolArguments(definition.name, typeof raw === "string" ? JSON.parse(raw) : raw as Record<string, unknown>);
          const { confirmed: _confirmed, confirmationPhrase: _phrase, confirmationEventId: _event, ...args } = input as Record<string, unknown>;
          if (definition.name === "manage_gate_shift" && args.action === "add_shift_note") args.operationId = live.noteOperationId ??= globalThis.crypto?.randomUUID?.() ?? nativeUuid();
          if (definition.name === "confirm_visitor_check_in") await waitForGateCapture();
          const current = applicationContext();
          const focusedArgs = live.focus.input(current, definition.name, args);
          if (gateCheckInFocusAvailable(current) && ["resolve_gate_check_in", "prepare_visitor_check_in", "confirm_visitor_check_in"].includes(definition.name)) fillGateVoiceDraft(focusedArgs);
          const path = nativeAskVContextPath(pathRef.current);
          const callId = details?.toolCall?.callId ?? "sdk-" + Date.now() + "-" + Math.random().toString(36).slice(2);
          if (!valid(live)) return JSON.stringify({ ok: false, error: "Voice session ended" });
          const pending = live.pending?.name === definition.name && live.pending.arguments === fingerprint(args) && live.pending.path === path ? live.pending : null;
          const coordinates = await withAskVToolLocation(definition.name, focusedArgs, pending ? pending.coordinates ?? null : undefined);
          if (!valid(live) || live.checkIn.active(applicationContext())) return JSON.stringify({ ok: false, error: "Voice action interrupted" });
          const result = await post(live.token, "voice/actions", {
            ...applicationContext(),
            name: definition.name, arguments: coordinates, sessionId: live.id, callId,
            idempotencyKey: pending?.key ?? callId, clientSurface: "ios", path,
            gateDraft: readGateVoiceDraft(),
            ...(live.lastUser ? { utterance: { eventId: live.lastUser, text: messagesRef.current.get(live.lastUser)?.content ?? "" } } : {}),
          }, live.abort.signal, true);
          if (!valid(live) || path !== nativeAskVContextPath(pathRef.current)) return JSON.stringify({ ok: false, message: "The screen changed. Review the action again." });
          metadata.current.toolCalls = [...(metadata.current.toolCalls ?? []), { name: definition.name, input: coordinates, output: typeof result.output === "string" ? result.output : JSON.stringify(result) }];
          if (result.recovery) metadata.current.recovery = { ...result.recovery, needed: Array.isArray(result.recovery.needed) ? result.recovery.needed : [result.recovery.needed] };
          live.pending = result.requiresConfirmation ? {
            name: definition.name, arguments: fingerprint(args), key: result.idempotencyKey,
            path, coordinates: typeof coordinates.latitude === "number" && typeof coordinates.longitude === "number"
              ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : null,
          } : null;
          if (result.tools) {
            config.tools = result.tools; config.toolMetadata = result.toolMetadata ?? [];
            await live.sdk?.updateAgent(makeAgent(live));
          }
          let output = live.focus.staged(current, result);
          if (typeof result.output === "string") {
            try { output = JSON.parse(result.output); } catch { return result.output; }
          }
          const hint = definition.name === "query_gate_setup_progress" ? parseGateSetupProgressHint(output) : undefined;
          const offer = definition.name === "offer_gate_workflow" ? parseGateWorkflowOffer(output) : undefined;
          if (hint) metadata.current.gateSetupProgress = hint;
          if (offer) metadata.current.gateWorkflowOffer = offer;
          if (hint || offer) publishGateVoiceWorkflowResult({ question: messagesRef.current.get(live.lastUser ?? "")?.content ?? "Guide this workflow", gateSetupProgress: hint, gateWorkflowOffer: offer });
          if (output?.execution === "client" && output.intent) {
            const clientResult = await executeAskVClientIntent(output.intent, pathRef.current);
            output = { ...output, clientResult };
          }
          if (result.ok && result.mutation) emitAskVDataChanged();
          if (result.ok && definition.name === "manage_gate_shift" && coordinates.action === "add_shift_note") { live.quickNote = false; live.noteOperationId = undefined; refreshContextRef.current(); }
          if (output?.ok && output.action === "visitor_checked_in") { live.focus.completed(); notifyGateVoiceSaved(coordinates); }
          return JSON.stringify(output);
        },
      })),
    });
  }
  const isIPadGate = () => Platform.OS === "ios" && Platform.isPad && nativeAskVContextPath(pathRef.current).replace(/\/$/, "") === "/mobile/gate";
  const syncPlaybackMute = (live: Live) => {
    live.mutePlayback?.((isIPadGate() && live.gateSpeechItem !== undefined) || live.checkIn.active(applicationContext()));
  };
  const collectCheckIn = (live: Live, text: string) => {
    const consumed = live.checkIn.hear(applicationContext(), text);
    syncPlaybackMute(live);
    if (consumed === "start") { live.sdk?.interrupt(); live.pending = null; }
    if (consumed) writeState(live, "listening");
    return Boolean(consumed);
  };
  const startConversation = useCallback((seed?: string, path?: string): Promise<void> => {
    const existing = liveRef.current;
    if (existing) {
      const message = voiceSeedMessage(seed), ready = existing.starting ?? Promise.resolve();
      return message ? ready.then(() => { if (valid(existing) && existing.ready && !collectCheckIn(existing, message)) existing.sdk!.sendMessage(message); }) : ready;
    }
    if (!userRef.current || AppState.currentState === "background") return Promise.resolve();
    ++preferenceVersion.current; mutedRef.current = false; setMutedState(false);
    setError(null); setState("connecting");
    const live: Live = {
      id: "sdk-" + userRef.current.id + "-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      scope: scopeRef.current, abort: new AbortController(), stream: null, sdk: null, release: null,
      ready: false, token: null, config: null, starting: null, conversation: null,
      saving: Promise.resolve(), saved: new Set(), queued: new Set(), lastUser: null, pending: null,
      binding: voiceContextBinding(applicationContext()), seen: new Map(), focus: createGateCheckInFocus(),
      checkIn: createSilentGateCheckIn({ normalizePlateState, parseSpokenPlateState }), audioTurns: new Map(),
    };
    liveRef.current = live;
    const check = () => { if (!valid(live)) throw Object.assign(new Error("Voice stopped"), { name: "AbortError" }); };
    const microphone = askVMicrophone.acquire("askv", async () => {
      if (liveRef.current === live) { liveRef.current = null; closeLive(live); if (mounted.current) setState("stopped"); }
    }).then(async release => {
      if (!valid(live)) { void release(); check(); }
      live.release = release;
      const stream = await openAskVMicrophone();
      if (!valid(live)) { stopStream(stream); check(); }
      live.stream = stream;
      return stream;
    });
    const configuration = (async () => {
      const token = await getToken(); check();
      if (!token) throw new Error("Not authenticated");
      live.token = token;
      return post(token, "voice/session", { path: nativeAskVContextPath(path ?? pathRef.current), manualAudioResponses: true }, live.abort.signal) as Promise<VoiceConfig>;
    })();
    const starting = (async () => {
      try {
        const [stream, config] = await Promise.all([microphone, configuration]); check();
        live.config = config;
        const transport = sdkTransport(stream, config.model);
        live.mutePlayback = muted => transport.setPlaybackMuted(muted);
        const sendEvent = transport.sendEvent.bind(transport);
        transport.sendEvent = event => {
          if (event.type !== "response.create" || !live.checkIn.active(applicationContext())) sendEvent(event);
        };
        const sdk = new RealtimeSession(makeAgent(live), {
          model: config.model, transport, historyStoreAudio: false,
          config: { audio: { input: askVAudioInput, output: { voice: config.voice } } },
        });
        live.sdk = sdk;
        sdk.on("history_updated", history => acceptHistory(live, history));
        sdk.on("audio_start", () => { if (!live.checkIn.active(applicationContext())) writeState(live, "speaking"); });
        sdk.on("audio_stopped", () => writeState(live, "listening"));
        sdk.on("audio_interrupted", () => writeState(live, "listening"));
        sdk.on("transport_event", event => {
          if (!valid(live)) return;
          if (event.type === "input_audio_buffer.speech_started" && typeof event.item_id === "string" && isIPadGate()) {
            // The server interrupts on speech start. Mute locally too so buffered audio cannot play over the command.
            live.gateSpeechItem = event.item_id;
            syncPlaybackMute(live);
          }
          if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.item_id === "string" && typeof event.transcript === "string" && !live.audioTurns.has(event.item_id)) {
            if (live.gateSpeechItem === event.item_id) live.gateSpeechItem = undefined;
            const collected = collectCheckIn(live, event.transcript);
            live.audioTurns.set(event.item_id, collected);
            if (collected) transport.sendEvent({ type: "conversation.item.delete", item_id: event.item_id });
            else if (event.transcript.trim()) transport.sendEvent({ type: "response.create" });
            else writeState(live, "listening");
          }
          if (event.type === "conversation.item.input_audio_transcription.failed" && live.gateSpeechItem !== undefined && live.gateSpeechItem === event.item_id) {
            live.gateSpeechItem = undefined;
            syncPlaybackMute(live);
          }
          if (live.checkIn.active(applicationContext())) {
            if (event.type === "output_audio_buffer.started") sdk.interrupt();
            return;
          }
          if (event.type === "input_audio_buffer.speech_started") writeState(live, "listening");
          if (event.type === "input_audio_buffer.speech_stopped" || event.type === "response.created") writeState(live, "thinking");
          if (event.type === "output_audio_buffer.started") writeState(live, "speaking");
          if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") writeState(live, "listening");
        });
        sdk.on("agent_tool_start", (_ctx, _agent, currentTool) => { if (valid(live)) setActiveTool(currentTool.name); });
        sdk.on("agent_tool_end", () => { if (valid(live)) setActiveTool(null); });
        sdk.on("error", failure => {
          if (!valid(live)) return;
          setError(failure.error instanceof Error ? failure.error.message : "askv.voiceFailed");
          void stop().then(() => { if (mounted.current && scopeRef.current === live.scope && !liveRef.current) setState("error"); });
        });
        transport.on("connection_change", status => {
          if (status === "disconnected" && live.ready && valid(live)) {
            setError("askv.voiceFailed"); void stop().then(() => { if (mounted.current && !liveRef.current) setState("error"); });
          }
        });
        await sdk.connect({ apiKey: config.clientSecret }); check();
        live.ready = true; setState("listening");
        const message = voiceSeedMessage(seed); if (message && !collectCheckIn(live, message)) sdk.sendMessage(message);
      } catch (cause) {
        const current = valid(live);
        if (liveRef.current === live) liveRef.current = null;
        closeLive(live);
        if (current) { setError(cause instanceof Error ? cause.message : "askv.voiceFailed"); setState("error"); }
      } finally { live.starting = null; }
    })();
    live.starting = starting;
    return starting;
  }, [closeLive, stop]);
  const startRef = useRef(startConversation); startRef.current = startConversation;
  const refreshContextRef = useRef(() => {});
  refreshContextRef.current = () => {
    const live = liveRef.current;
    if (live?.ready && valid(live)) {
      live.checkIn.attach(applicationContext());
      syncPlaybackMute(live);
      void live.sdk?.updateAgent(makeAgent(live)).catch(() => undefined);
    }
  };
  useEffect(() => {
    const guidance = subscribeGateVoiceGuidance(() => refreshContextRef.current());
    const draft = subscribeGateVoiceDraft(() => refreshContextRef.current());
    const page = subscribeVoicePageContext(() => refreshContextRef.current());
    return () => { guidance(); draft(); page(); };
  }, []);
  const binding = voiceContextBinding(applicationContext());
  const previousBinding = useRef(binding);
  useEffect(() => {
    if (previousBinding.current === binding) return;
    previousBinding.current = binding;
    const running = liveRef.current?.scope === scopeRef.current;
    void stop().then(() => { if (running && mounted.current && !mutedRef.current) void startRef.current(); });
  }, [binding, stop]);
  const setMuted = useCallback((next: boolean) => {
    ++preferenceVersion.current; mutedRef.current = next; setMutedState(next); setPreferencesReady(true);
    const id = userRef.current?.id;
    if (id) void writeAskVMuted(id, next).catch(() => undefined);
    if (next) void stop(); else void startRef.current();
  }, [stop]);
  const setAcrossVndrly = useCallback((enabled: boolean) => {
    ++preferenceVersion.current; acrossRef.current = enabled; setAcross(enabled);
    const id = userRef.current?.id;
    if (id) void writeAskVAcrossVndrly(id, enabled).catch(() => undefined);
  }, [stop]);
  useEffect(() => {
    const version = ++preferenceVersion.current;
    setPreferencesReady(false);
    if (!user?.id) { setPreferencesReady(true); return; }
    void Promise.all([readAskVMuted(user.id), readAskVAcrossVndrly(user.id)]).then(([savedMute, savedAcross]) => {
      if (!mounted.current || version !== preferenceVersion.current) return;
      mutedRef.current = savedMute; acrossRef.current = savedAcross;
      setMutedState(savedMute); setAcross(savedAcross);
    }).catch(() => undefined).finally(() => { if (mounted.current) setPreferencesReady(true); });
  }, [user?.id]);
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope; void stop();
    messagesRef.current.clear(); setVoiceMessages([]); assistantRef.current.startNew(); setError(null);
  }, [scope, stop]);
  useEffect(() => {
    mounted.current = true;
    const token = subscribeToken(() => { void stop(); });
    const account = subscribeUser(next => { if (scopeOf(next) !== scopeRef.current) void stop(); });
    const subscription = AppState.addEventListener("change", status => {
      if (status === "background" || (status === "inactive" && liveRef.current?.ready)) void stop();
    });
    return () => { mounted.current = false; token(); account(); subscription.remove(); void stop(); };
  }, [stop]);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const changed = previousPath.current !== pathname;
    previousPath.current = pathname;
    const live = liveRef.current;
    if (changed && live?.ready) {
      live.pending = null;
      void live.sdk?.updateAgent(makeAgent(live)).catch(() => undefined);
    }
    if (changed && !acrossRef.current) void stop();
  }, [pathname, stop]);
  const send = useCallback(async (text: string, mode: "ios_text" | "ios_voice" = "ios_text", confirmationReference?: string) => {
    const live = liveRef.current;
    if (live?.ready && !mutedRef.current && !confirmationReference) { live.sdk!.sendMessage(text); return; }
    return assistantRef.current.send(text, mode, confirmationReference);
  }, []);
  const assistant = useMemo<Assistant>(() => {
    const ids = new Set(voiceMessages.map(message => message.id));
    const savedIds = new Set(voiceMessages.map(message => message.serverId).filter(Boolean));
    return {
      ...base, send,
      messages: [...base.messages.filter(message => !ids.has(message.id) && !savedIds.has(message.serverId)), ...voiceMessages],
      streaming: base.streaming || state === "thinking" || state === "speaking",
      activeTool: activeTool ?? base.activeTool,
      stopGeneration: () => { liveRef.current?.sdk?.interrupt(); base.stopGeneration(); },
      startNew: () => { void stop(); messagesRef.current.clear(); setVoiceMessages([]); base.startNew(); },
      clear: async () => { await stop(); messagesRef.current.clear(); setVoiceMessages([]); await base.clear(); },
    };
  }, [base, send, voiceMessages, state, activeTool, stop]);
  const subscribeReplies = useCallback((listener: (text: string) => void) => {
    replies.current.add(listener); return () => { replies.current.delete(listener); };
  }, []);
  const value = useMemo<AskVVoiceSessionValue>(() => ({
    state, error, greeting: null, muted, acrossVndrly, wakeSupported: false, preferencesReady,
    assistant, startConversation, stop, setMuted, setAcrossVndrly, subscribeReplies,
  }), [state, error, muted, acrossVndrly, preferencesReady, assistant, startConversation, stop, setMuted, setAcrossVndrly, subscribeReplies]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAskVVoiceSession(): AskVVoiceSessionValue {
  const value = useContext(Context);
  if (!value) throw new Error("useAskVVoiceSession must be used within AskVVoiceProvider");
  return value;
}
