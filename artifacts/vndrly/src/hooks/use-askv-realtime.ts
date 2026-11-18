import { useCallback, useEffect, useRef, useState } from "react";
import { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession, tool, type RealtimeItem } from "@workspace/askv-realtime-sdk";
import { voiceApplicationInstructions, voiceSeedMessage, type VoiceApplicationContext } from "@workspace/askv-realtime-sdk/app-context";
import { askVMicrophone } from "@workspace/askv-wake";
import { readGateVoiceDraft, subscribeGateVoiceDraft, notifyGateVoiceSaved, fillGateVoiceDraft, cancelGateVoiceDraft, createGateCheckInFocus, gateCheckInFocusAvailable, parseGateSetupProgressHint, parseGateWorkflowOffer, gateWorkflowToolArguments, type GateSetupProgressHint, type GateWorkflowOffer } from "@workspace/gate-booth";
import { applyAskVClientIntentVerified, parseAskVClientIntent } from "@/lib/askv-client-intents";
import { addAskVToolLocation } from "@/lib/askv-tool-location";
import type { AskVVoiceState } from "@/lib/askv-voice-state";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type WireTool = { name: string; description: string; parameters: Record<string, any> };
type VoiceConfig = { clientSecret: string; model: string; voice: string; instructions: string; tools: WireTool[] };
export type VoiceTranscript = { eventId: string; role: "user" | "assistant"; content: string; pending?: boolean };
type Live = {
  id: string; abort: AbortController; sdk: RealtimeSession | null; stream: MediaStream | null;
  release?: () => Promise<void>; config: VoiceConfig | null; starting?: Promise<void>; ready: boolean;
  lastUser?: VoiceTranscript; pending?: { name: string; args: string; key: string; path: string; input: unknown };
  seen: Map<string, string>;
  focus: ReturnType<typeof createGateCheckInFocus>;
};
type Options = {
  readApplicationContext?: () => VoiceApplicationContext;
  onTranscript?: (message: VoiceTranscript, sessionId: string) => void;
  onMutation?: (mutation: { name: string; refresh: string[] }) => void;
  onGateSetupProgress?: (hint: GateSetupProgressHint) => void;
  onGateWorkflowOffer?: (offer: GateWorkflowOffer) => void;
  onToolResult?: (result: { name: string; input: unknown; output: string; recovery?: any }) => void;
};
async function post(path: string, body: unknown, signal: AbortSignal, toolResult = false) {
  const response = await fetch(`${BASE}/api/assistant/${path}`, { method: "POST", credentials: "include", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok && (!toolResult || response.status === 401)) throw new Error(data.message ?? data.error ?? "Voice request failed");
  return data;
}

/** The same official Realtime SDK as iPhone, using its built-in browser WebRTC transport. */
export function useAskVRealtime(options?: Options) {
  const latest = useRef(options); latest.current = options;
  const [state, setState] = useState<AskVVoiceState>("stopped"), [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const context = useRef<VoiceApplicationContext>({});
  const liveRef = useRef<Live | null>(null), mounted = useRef(true);
  const valid = (live: Live) => mounted.current && liveRef.current === live && !live.abort.signal.aborted;
  const snapshot = (): VoiceApplicationContext => {
    const current = { ...context.current, ...latest.current?.readApplicationContext?.() };
    return { ...current, page: { path: current.path ?? window.location.pathname, title: document.querySelector("h1")?.textContent?.trim().slice(0, 160) }, gateDraft: readGateVoiceDraft() ?? null };
  };
  const close = (live: Live) => {
    live.abort.abort(); live.ready = false;
    try { live.sdk?.close(); } finally { live.stream?.getTracks().forEach(track => track.stop()); live.stream = null; }
    void live.release?.().catch(() => undefined); live.release = undefined;
  };
  const stop = useCallback(() => {
    const live = liveRef.current; liveRef.current = null;
    if (live) close(live);
    if (mounted.current) { setState("stopped"); setActiveTool(null); setFocusMode(false); }
  }, []);
  const fail = (live: Live, cause: unknown) => {
    if (!valid(live)) return;
    stop();
    setError(cause instanceof Error && cause.name === "NotAllowedError"
      ? "Microphone access is blocked for vndrly.ai. Allow it in your browser settings, then reopen AskV."
      : cause instanceof Error ? cause.message : "AskV voice could not start.");
    setState("error");
  };
  function agent(live: Live): RealtimeAgent {
    const config = live.config!;
    return new RealtimeAgent({ name: "AskV", instructions: config.instructions + voiceApplicationInstructions(snapshot()) + live.focus.instructions(snapshot()),
      tools: config.tools.map(definition => tool({
        name: definition.name, description: definition.description, parameters: definition.parameters as any, strict: false,
        execute: async (raw, _ctx, details) => {
          if (!valid(live)) return JSON.stringify({ ok: false, message: "Voice session ended" });
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          const { confirmed: _confirmed, confirmationPhrase: _phrase, confirmationEventId: _event, ...args } = parsed as Record<string, unknown>;
          const current = snapshot(), path = current.path ?? "";
          const callId = details?.toolCall?.callId ?? crypto.randomUUID();
          const pending = live.pending?.name === definition.name && live.pending.args === JSON.stringify(args) && live.pending.path === path ? live.pending : undefined;
          const focusedArgs = live.focus.input(current, definition.name, args);
          if (gateCheckInFocusAvailable(current) && ["resolve_gate_check_in", "prepare_visitor_check_in", "confirm_visitor_check_in"].includes(definition.name)) fillGateVoiceDraft(focusedArgs);
          const input = gateWorkflowToolArguments(definition.name, await addAskVToolLocation(definition.name, focusedArgs, pending?.input));
          if (!valid(live)) return JSON.stringify({ ok: false, message: "Voice session ended" });
          const result = await post("voice/actions", { ...current, name: definition.name, arguments: input, sessionId: live.id,
            callId, idempotencyKey: pending?.key ?? callId, clientSurface: "web",
            ...(live.lastUser ? { utterance: { eventId: live.lastUser.eventId, text: live.lastUser.content } } : {}),
          }, live.abort.signal, true);
          if (!valid(live)) return JSON.stringify({ ok: false, message: "Voice session ended" });
          live.pending = result.requiresConfirmation ? { name: definition.name, args: JSON.stringify(args), key: result.idempotencyKey, path, input } : undefined;
          if (result.tools) { config.tools = result.tools; await live.sdk?.updateAgent(agent(live)); }
          const output = result.output ?? live.focus.staged(current, result);
          let value: any; try { value = typeof output === "string" ? JSON.parse(output) : output; } catch { value = null; }
          const hint = definition.name === "query_gate_setup_progress" ? parseGateSetupProgressHint(value) : undefined;
          const offer = definition.name === "offer_gate_workflow" ? parseGateWorkflowOffer(value) : undefined;
          if (hint) latest.current?.onGateSetupProgress?.(hint);
          if (offer) latest.current?.onGateWorkflowOffer?.(offer);
          latest.current?.onToolResult?.({ name: definition.name, input, output: typeof output === "string" ? output : JSON.stringify(output), recovery: result.recovery });
          if (result.ok && result.mutation) latest.current?.onMutation?.(result.mutation);
          if (value?.ok && value.action === "visitor_checked_in") { live.focus.completed(); notifyGateVoiceSaved(input); }
          const intent = parseAskVClientIntent(output);
          if (intent) {
            const clientResult = await applyAskVClientIntentVerified(intent);
            return JSON.stringify({ ...value, clientResult });
          }
          return typeof output === "string" ? output : JSON.stringify(output);
        },
      })),
    });
  }
  const updateAgent = () => {
    const live = liveRef.current;
    setFocusMode(Boolean(live && gateCheckInFocusAvailable(snapshot())));
    if (live?.sdk && live.config && valid(live)) void live.sdk.updateAgent(agent(live)).catch(cause => fail(live, cause));
  };
  const updateRef = useRef(updateAgent); updateRef.current = updateAgent;
  const updateContext = useCallback((value: VoiceApplicationContext) => { context.current = value; updateRef.current(); }, []);
  useEffect(() => subscribeGateVoiceDraft(() => updateRef.current()), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop(); }; }, [stop]);
  const startConversation = useCallback((seed?: string, path?: string): Promise<void> => {
    const existing = liveRef.current;
    if (existing) {
      if (path) { context.current = { ...context.current, path }; updateRef.current(); }
      const message = voiceSeedMessage(seed);
      const ready = existing.starting ?? Promise.resolve();
      return message ? ready.then(() => { if (valid(existing) && existing.ready) { existing.sdk!.sendMessage(message); setState("thinking"); } }) : ready;
    }
    const live: Live = { id: crypto.randomUUID(), abort: new AbortController(), sdk: null, stream: null, config: null, ready: false, seen: new Map(), focus: createGateCheckInFocus() };
    liveRef.current = live; context.current = { ...context.current, ...(path ? { path } : {}) };
    setFocusMode(gateCheckInFocusAvailable(snapshot()));
    setError(null); setState("connecting");
    const check = () => { if (!valid(live)) throw new DOMException("Voice stopped", "AbortError"); };
    const microphone = askVMicrophone.acquire("askv", async () => { if (valid(live)) stop(); }).then(async release => {
      if (!valid(live)) { void release(); check(); }
      live.release = release;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!valid(live)) { stream.getTracks().forEach(track => track.stop()); check(); }
      live.stream = stream; return stream;
    });
    const configuration = post("voice/session", { path: path ?? context.current.path }, live.abort.signal);
    const starting = (async () => {
      try {
        const [stream, config] = await Promise.all([microphone, configuration]); check(); live.config = config;
        const transport = new OpenAIRealtimeWebRTC({ mediaStream: stream });
        const sdk = new RealtimeSession(agent(live), { model: config.model, transport, historyStoreAudio: false, config: { audio: { output: { voice: config.voice } } } });
        live.sdk = sdk;
        const transition = (next: AskVVoiceState) => { if (valid(live)) setState(next); };
        sdk.on("history_updated", (history: RealtimeItem[]) => {
          if (!valid(live)) return;
          for (const item of history) {
            if (item.type !== "message" || (item.role !== "user" && item.role !== "assistant")) continue;
            const content = item.content.map(part => "text" in part ? part.text : "transcript" in part ? part.transcript ?? "" : "").join("").trim();
            if (!content) continue;
            const message: VoiceTranscript = { eventId: item.itemId, role: item.role, content, pending: item.status === "in_progress" };
            const signature = JSON.stringify([content, message.pending]);
            if (live.seen.get(item.itemId) === signature) continue;
            live.seen.set(item.itemId, signature);
            if (item.role === "user") live.lastUser = message;
            if (!message.pending) {
              const current = snapshot(), focus = live.focus.observe(current, item.role, content);
              if (focus.cancelled) {
                const pending = live.pending; live.pending = undefined;
                cancelGateVoiceDraft();
                if (pending) void post("voice/actions", { ...current, name: pending.name, arguments: pending.input, sessionId: live.id, callId: crypto.randomUUID(), clientSurface: "web", utterance: { eventId: message.eventId, text: content } }, live.abort.signal, true).catch(() => undefined);
              }
              if (focus.changed) updateRef.current();
            }
            latest.current?.onTranscript?.(message, live.id);
          }
        });
        sdk.on("audio_start", () => transition("speaking")); sdk.on("audio_stopped", () => transition("listening")); sdk.on("audio_interrupted", () => transition("listening"));
        sdk.on("transport_event", event => {
          if (event.type === "input_audio_buffer.speech_started") transition("listening");
          if (event.type === "input_audio_buffer.speech_stopped" || event.type === "response.created") transition("thinking");
          if (event.type === "output_audio_buffer.started") transition("speaking");
          if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") transition("listening");
        });
        sdk.on("agent_tool_start", (_ctx, _agent, currentTool) => { if (valid(live)) setActiveTool(currentTool.name); });
        sdk.on("agent_tool_end", () => { if (valid(live)) setActiveTool(null); });
        sdk.on("error", failure => fail(live, failure.error));
        transport.on("connection_change", status => { if (status === "disconnected" && live.ready) fail(live, new Error("Voice connection ended. Please retry.")); });
        await sdk.connect({ apiKey: config.clientSecret }); check();
        live.ready = true; setState("listening");
        const message = voiceSeedMessage(seed); if (message) sdk.sendMessage(message);
      } catch (cause) { if (valid(live)) fail(live, cause); }
      finally { live.starting = undefined; }
    })();
    live.starting = starting; return starting;
  }, [stop]);
  const sendText = useCallback((text: string) => {
    const live = liveRef.current; if (!live?.ready || !valid(live)) return false;
    live.sdk!.sendMessage(text); setState("thinking"); return true;
  }, []);
  const interrupt = useCallback(() => { const live = liveRef.current; if (live?.ready) { live.sdk?.interrupt(); setState("listening"); } }, []);
  const setMicEnabled = useCallback((enabled: boolean) => { if (!enabled) { stop(); setState("muted"); } }, [stop]);
  return { state, error, activeTool, focusMode, greeting: null, startConversation, startOneCommand: startConversation, stop, interrupt, setMicEnabled, updateContext, sendText };
}
