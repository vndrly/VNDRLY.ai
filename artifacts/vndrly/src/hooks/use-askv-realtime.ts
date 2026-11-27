import { checkoutSpeech, waitForGateCapture, confirmGateCheckIn, isGateVoiceConfirm, decideGateVoiceReply, checkInPrompt, checkInReceipt, CHECK_OUT_PROMPT, GATE_VOICE_DECLINED } from "@workspace/gate-booth";
import { speakAskV, stopAskVSpeech } from "@/lib/askv-speech";
import { createTranscriptCleanup } from "@workspace/askv-realtime-sdk/transcript-cleanup";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession, tool, type RealtimeItem } from "@workspace/askv-realtime-sdk";
import { voiceApplicationInstructions, voiceSeedMessage, isQuickShiftNote, voiceQuickNoteInstructions, type VoiceApplicationContext } from "@workspace/askv-realtime-sdk/app-context";
import { askVMicrophone } from "@workspace/askv-wake";
import { normalizePlateState, parseSpokenPlateState, reconcileAutomatedPlateUpdate } from "@workspace/plate-state";
import { createWatchGateForm, gateVoiceFormOpen, isWatchGateDraft } from "@workspace/gate-booth";
import { gateVoiceAudioInput, gateVoiceTrigger, gateCheckOutQuery, checkInQuestion, missingCheckInField, createGateVoicePrompter, isGateVoicePage, createSilentGateCheckIn, readGateVoiceDraft, subscribeGateVoiceDraft, notifyGateVoiceSaved, fillGateVoiceDraft, cancelGateVoiceDraft, createGateCheckInFocus, gateCheckInFocusAvailable, parseGateSetupProgressHint, parseGateWorkflowOffer, gateWorkflowToolArguments, type GateSetupProgressHint, type GateWorkflowOffer } from "@workspace/gate-booth";
import { applyAskVClientIntentVerified, parseAskVClientIntent } from "@/lib/askv-client-intents";
import { addAskVToolLocation } from "@/lib/askv-tool-location";
import type { AskVVoiceState } from "@/lib/askv-voice-state";
import { readAskVPageContext, subscribeAskVPageContext } from "@/lib/askv-page-context";
import { captureAskVMicrophone, meterAskVMicrophone } from "@/lib/askv-microphone";
import { observeAskVAudio } from "@/lib/askv-audio-waveform";

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
  checkIn: ReturnType<typeof createSilentGateCheckIn>;
  prompts: ReturnType<typeof createGateVoicePrompter>;
  promptedKey?: string;
  audioTurns: Map<string, boolean>;
  gateAudio?: boolean;
  /** The last turn went to the assistant: its answer is heard and shown even while the Gate form keeps listening. */
  assistantTurn?: boolean;
  gateTranscript?: { itemId: string; text: string; trigger?: "in" | "out" };
  playback?: HTMLAudioElement;
  quickNote?: boolean;
  noteOperationId?: string;
  stopMicrophoneMeter?: () => void;
  stopWaveform?: () => void;
  confirming?: boolean;
  checkoutQuiet?: boolean;
  runTool?: Record<string, (raw: any, ctx?: any, details?: any) => Promise<string>>;
  checkoutRunning?: boolean;
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

/** Away from the Gate page, whoever holds a watch checks people in and out against that gate without leaving the page. */
const watchDesk = createWatchGateForm({
  request: async (method, path, body) => {
    const response = await fetch(`${BASE}/api${path}`, { method, credentials: "include",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${response.status}`);
    return data;
  },
  position: async () => {
    const { latitude, longitude } = await addAskVToolLocation("confirm_visitor_check_in", {});
    return typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null;
  },
  plate: reconcileAutomatedPlateUpdate,
});

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
    return { ...current, page: readAskVPageContext(current.path ?? window.location.pathname), gateDraft: readGateVoiceDraft() ?? null };
  };
  /** The Gate form is taking the conversation: the assistant stays quiet. Not while it answers a turn the form declined. */
  const capturing = (live: Live, current = snapshot()) => !live.assistantTurn && live.checkIn.active(current);
  /** Hands a turn the Gate form declined to the assistant, whose answer must be heard. */
  const toAssistant = (live: Live) => { live.assistantTurn = true; if (live.playback) live.playback.muted = Boolean(live.checkoutQuiet); };
  const close = (live: Live) => {
    live.prompts.hush();
    if (live.checkoutQuiet) stopAskVSpeech();
    live.abort.abort(); live.ready = false;
    live.stopMicrophoneMeter?.(); live.stopWaveform?.();
    live.stopMicrophoneMeter = undefined; live.stopWaveform = undefined;
    try { live.sdk?.close(); } finally { live.stream?.getTracks().forEach(track => track.stop()); live.stream = null; }
    void live.release?.().catch(() => undefined); live.release = undefined;
  };
  const stop = useCallback(() => {
    const live = liveRef.current; liveRef.current = null;
    if (live) close(live);
    watchDesk.close();
    if (mounted.current) { setState("stopped"); setActiveTool(null); setFocusMode(false); }
  }, []);
  const fail = (live: Live, cause: unknown) => {
    if (!valid(live)) return;
    // The SDK wraps server errors twice: failure.error.error contains the message.
    if (cause && typeof cause === "object" && "error" in cause && cause.error) cause = cause.error;
    if (import.meta.env.DEV) console.warn("[AskV session failure]", cause);
    stop();
    setError(cause instanceof Error && cause.name === "NotAllowedError"
      ? "Microphone access is blocked for vndrly.ai. Allow it in your browser settings, then reopen AskV."
      : cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message : "AskV voice could not start.");
    setState("error");
  };
  function agent(live: Live): RealtimeAgent {
    const config = live.config!;
    return new RealtimeAgent({ name: "AskV", instructions: config.instructions + voiceApplicationInstructions(snapshot()) + (live.quickNote ? "" : live.focus.instructions(snapshot())) + voiceQuickNoteInstructions(),
      tools: config.tools.map(definition => tool({
        name: definition.name, description: definition.description, parameters: definition.parameters as any, strict: false,
        execute: (live.runTool ??= {})[definition.name] = async (raw, _ctx, details) => {
          if (!valid(live)) return JSON.stringify({ ok: false, message: "Voice session ended" });
          if (capturing(live)) return JSON.stringify({ ok: false });
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          const { confirmed: _confirmed, confirmationPhrase: _phrase, confirmationEventId: _event, ...args } = parsed as Record<string, unknown>;
          if (definition.name === "manage_gate_shift" && args.action === "add_shift_note") args.operationId = live.noteOperationId ??= crypto.randomUUID();
          if (definition.name === "confirm_visitor_check_in") await waitForGateCapture();
          const current = snapshot(), path = current.path ?? "";
          const callId = details?.toolCall?.callId ?? crypto.randomUUID();
          const pending = live.pending?.name === definition.name && live.pending.args === JSON.stringify(args) && live.pending.path === path ? live.pending : undefined;
          const focusedArgs = live.focus.input(current, definition.name, args);
          if (gateCheckInFocusAvailable(current) && ["resolve_gate_check_in", "prepare_visitor_check_in", "confirm_visitor_check_in"].includes(definition.name)) fillGateVoiceDraft(focusedArgs);
          const input = gateWorkflowToolArguments(definition.name, await addAskVToolLocation(definition.name, focusedArgs, pending?.input));
          if (!valid(live) || capturing(live)) return JSON.stringify({ ok: false, message: "Voice action interrupted" });
          const result = await post("voice/actions", { ...current, gateDraft: readGateVoiceDraft() ?? null, name: definition.name, arguments: input, sessionId: live.id,
            callId, idempotencyKey: pending?.key ?? callId, clientSurface: "web",
            ...(live.lastUser ? { utterance: { eventId: live.lastUser.eventId, text: live.lastUser.content } } : {}),
          }, live.abort.signal, true);
          if (!valid(live)) return JSON.stringify({ ok: false, message: "Voice session ended" });
          live.pending = result.requiresConfirmation ? { name: definition.name, args: JSON.stringify(args), key: result.idempotencyKey, path, input } : undefined;
          if (result.tools) { config.tools = result.tools; await live.sdk?.updateAgent(agent(live)); }
          const output = result.output ?? live.focus.staged(current, result);
          let value: any; try { value = typeof output === "string" ? JSON.parse(output) : output; } catch { value = null; }
          const checkoutReply = checkoutSpeech(definition.name, result.requiresConfirmation ? result : value);
          if (checkoutReply) {
            live.checkoutQuiet = true;
            if (live.playback) live.playback.muted = true;
            live.prompts.say(checkoutReply);
          }
          const hint = definition.name === "query_gate_setup_progress" ? parseGateSetupProgressHint(value) : undefined;
          const offer = definition.name === "offer_gate_workflow" ? parseGateWorkflowOffer(value) : undefined;
          if (hint) latest.current?.onGateSetupProgress?.(hint);
          if (offer) latest.current?.onGateWorkflowOffer?.(offer);
          latest.current?.onToolResult?.({ name: definition.name, input, output: typeof output === "string" ? output : JSON.stringify(output), recovery: result.recovery });
          if (result.ok && result.mutation) latest.current?.onMutation?.(result.mutation);
          if (result.ok && definition.name === "manage_gate_shift" && input.action === "add_shift_note") { live.quickNote = false; live.noteOperationId = undefined; updateRef.current(); }
          if (value?.ok && value.action === "visitor_checked_in") { live.focus.completed(); notifyGateVoiceSaved(input); }
          if (value?.ok && value.action === "visitor_checked_out" && value.verification === "canonical_readback") notifyGateVoiceSaved({ checkoutCompleted: true });
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
    // On the Gate page its own form takes over from the watch form.
    if (isGateVoicePage(snapshot().path)) watchDesk.close();
    const current = snapshot();
    live?.checkIn.attach(current);
    if (live?.playback) live.playback.muted = Boolean(live.checkoutQuiet) || live.gateTranscript?.trigger === "in" || capturing(live, current);
    const gateAudio = isGateVoicePage(current.path);
    if (live?.ready && gateAudio !== live.gateAudio) {
      live.gateAudio = gateAudio;
      live.gateTranscript = undefined;
      if (gateAudio) live.checkIn.engage(current);
      if (live.playback) live.playback.muted = Boolean(live.checkoutQuiet) || capturing(live, current);
    }
    setFocusMode(Boolean(live && (live.quickNote || gateCheckInFocusAvailable(snapshot()))));
    if (live?.sdk && live.config && valid(live)) void live.sdk.updateAgent(agent(live)).catch(cause => fail(live, cause));
  };
  const updateRef = useRef(updateAgent); updateRef.current = updateAgent;
  const updateContext = useCallback((value: VoiceApplicationContext) => { context.current = value; updateRef.current(); }, []);
  useEffect(() => subscribeGateVoiceDraft(() => updateRef.current()), []);
  const engaged = !["stopped", "error", "muted"].includes(state);
  useEffect(() => engaged ? subscribeAskVPageContext(() => updateRef.current()) : undefined, [engaged]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop(); }; }, [stop]);
  /** The one-word question for the next missing check-in field, once "check in" was said. */
  const nextQuestion = (live: Live) => () => {
    if (!valid(live) || readBack(live, true)) return null;
    const field = live.checkIn.pending(snapshot());
    return field ? checkInQuestion(field) : null;
  };
  /** Read the complete form back once, and never while the operator is mid-sentence. */
  const readBack = (live: Live, settled = false) => {
    const ready = live.checkIn.review(snapshot());
    if (!ready?.ready || ready.key === live.promptedKey || live.prompts.busy()) return false;
    // A short tag may be the first piece of one still being read aloud: wait for the pause.
    if (!settled && ready.vehiclePlate.length <= 4) return false;
    live.promptedKey = ready.key;
    live.prompts.say(checkInPrompt(ready));
    return true;
  };
  /** True when the turn was a Gate crossing; "watch" while the operator's watch is still being read for it. */
  const collectCheckIn = (live: Live, text: string, interrupted = false, watchRead = false, voiceItem?: string): boolean | "watch" => {
    const answering = live.assistantTurn;
    const taken = collectTurn(live, text, interrupted, watchRead, voiceItem);
    // The form took this turn: the assistant goes quiet again.
    if (taken && answering) { live.assistantTurn = false; if (live.playback) live.playback.muted = Boolean(live.checkoutQuiet) || capturing(live); }
    return taken;
  };
  const collectTurn = (live: Live, text: string, interrupted: boolean, watchRead: boolean, voiceItem?: string): boolean | "watch" => {
    const current = snapshot();
    const spoken = gateVoiceTrigger(text);
    // "Check in" or "check out" away from the Gate page: whoever holds a watch does it right here, against that gate.
    if (spoken && !watchRead && !isGateVoicePage(current.path)) {
      setState("listening");
      void watchDesk.open().catch(() => false).then(held => {
        if (!valid(live)) return;
        if (held && collectCheckIn(live, text, interrupted, true)) {
          // A spoken turn kept out of the conversation still shows what the operator said.
          if (voiceItem) { const message: VoiceTranscript = { eventId: voiceItem, role: "user", content: text, pending: false }; live.lastUser = message; latest.current?.onTranscript?.(message, live.id); }
          return;
        }
        // Not a Gate crossing after all: hand the request to the assistant, as any other request.
        toAssistant(live); live.sdk?.sendMessage(text); setState("thinking");
      });
      return "watch";
    }
    const gateDraft = readGateVoiceDraft();
    const trigger = gateVoiceFormOpen(current) ? spoken : undefined;
    if (isWatchGateDraft(current.gateDraft)) {
      // A check-out replaces any check-in still open on the watch form.
      if (trigger === "out") { live.checkIn.hear(current, text); live.sdk?.interrupt(); }
      const handled = watchDesk.hearCheckOut(text, {
        say: message => { if (valid(live)) live.prompts.say(message); },
        fail: message => { if (valid(live)) { setError(message); live.prompts.say(message); } },
      });
      if (handled) { setError(null); setState("listening"); return true; }
      if (live.checkIn.active(current) && /^(?:cancel(?: (?:this |the )?(?:check[ -]?in|entry|draft))?|never ?mind)[.!\s]*$/i.test(text.trim())) {
        live.checkIn.reset(); cancelGateVoiceDraft(); setError(null);
        if (live.playback) live.playback.muted = Boolean(live.checkoutQuiet);
        setState("listening");
        return true;
      }
    }
    const checkoutQuery = trigger === "out" ? gateCheckOutQuery(text) : "";
    const review = live.checkIn.review(current);
    const checkoutWaiting = !trigger && live.pending?.name === "confirm_visitor_check_out" && live.runTool?.confirm_visitor_check_out;
    if (checkoutWaiting) {
      const decision = decideGateVoiceReply(text, "check_out");
      if (decision !== "submit") {
        if (decision === "refuse" || decision === "correct") live.pending = undefined;
        live.prompts.say(decision === "repeat" ? CHECK_OUT_PROMPT : GATE_VOICE_DECLINED);
        setState("listening");
        return true;
      }
    }
    const checkoutApproval = checkoutWaiting && decideGateVoiceReply(text, "check_out") === "submit";
    if ((checkoutApproval || checkoutQuery) && live.runTool?.confirm_visitor_check_out && (checkoutApproval || live.runTool.prepare_visitor_check_out)) {
      live.checkIn.hear(current, "check out");
      live.checkoutQuiet = true;
      if (live.playback) live.playback.muted = true;
      live.sdk?.interrupt();
      if (!live.checkoutRunning) {
        live.checkoutRunning = true;
        setState("thinking");
        // Defer until the transcript handler records the actual utterance used
        // by the server's confirmation guard.
        void Promise.resolve().then(async () => {
          if (checkoutApproval && live.pending) {
            await live.runTool!.confirm_visitor_check_out(JSON.parse(live.pending.args));
          } else {
            live.pending = undefined;
            const prepared = JSON.parse(await live.runTool!.prepare_visitor_check_out({ query: checkoutQuery, siteLocationId: gateDraft?.siteLocationId }));
            if (prepared.ok && prepared.matches?.length === 1 && !prepared.needsChoice) {
              await live.runTool!.confirm_visitor_check_out({ visitId: prepared.matches[0].id, ...(gateDraft?.gateStationId ? { gateStationId: gateDraft.gateStationId } : {}) });
            } else if (valid(live)) {
              live.prompts.say(prepared.needsChoice ? "Which visitor?" : "No matching visitor found.");
            }
          }
        }).catch(cause => { if (valid(live)) { setError(cause instanceof Error ? cause.message : "Checkout failed"); live.prompts.say("Checkout failed."); } })
          .finally(() => { live.checkoutRunning = false; if (valid(live)) setState("listening"); });
      }
      return true;
    }
    if (trigger === "out") live.checkoutQuiet = true;
    else if (trigger === "in" || (live.checkoutQuiet && !live.pending && !isGateVoiceConfirm(text))) live.checkoutQuiet = false;
    if (!trigger && review?.ready) {
      const decision = decideGateVoiceReply(text, "check_in", review);
      if (decision === "submit" && !live.confirming) {
        live.confirming = true;
        setError(null);
        void confirmGateCheckIn(review.key).then(() => {
          if (!valid(live)) return;
          // Away from the Gate page a saved check-in ends there, so later requests reach the assistant again.
          if (isWatchGateDraft(readGateVoiceDraft())) { live.checkIn.reset(); if (live.playback) live.playback.muted = Boolean(live.checkoutQuiet); }
          live.prompts.say(checkInReceipt(review));
        }).catch(cause => {
          // The operator is not looking at the screen: say why it was not saved.
          const message = cause instanceof Error ? cause.message : "Check-in could not be saved.";
          if (valid(live)) { setError(message); live.prompts.say(message); }
        }).finally(() => { live.confirming = false; });
        setState("listening");
        return true;
      }
      if (decision === "submit") { setState("listening"); return true; }
      if (decision === "refuse") { live.prompts.say(GATE_VOICE_DECLINED); setState("listening"); return true; }
      if (decision === "repeat") { live.promptedKey = review.key; live.prompts.say(checkInPrompt(review)); setState("listening"); return true; }
      // A correction is read back again, whether or not it changed the form.
      live.promptedKey = undefined;
    } else if (!trigger && live.checkIn.active(current) && decideGateVoiceReply(text, "check_in") === "submit") {
      const field = review && missingCheckInField(review);
      if (field) live.prompts.say(checkInQuestion(field));
      else setError("Complete the name, company, plate and issuing state before confirming.");
      setState("listening");
      return true;
    }
    if (trigger && !interrupted) {
      if (trigger === "in" && live.playback) live.playback.muted = true;
      live.sdk?.interrupt();
    }
    const consumed = live.checkIn.hear(current, text);
    // A reason shown for the last attempt no longer applies once the entry changes.
    if (consumed) setError(null);
    if (!readBack(live) && consumed) live.prompts.ask(nextQuestion(live));
    if (live.playback) live.playback.muted = Boolean(live.checkoutQuiet) || capturing(live);
    if (consumed === "start") live.pending = undefined;
    if (consumed) setState("listening");
    return Boolean(consumed);
  };
  const startConversation = useCallback((seed?: string, path?: string): Promise<void> => {
    const existing = liveRef.current;
    if (existing) {
      if (path) { context.current = { ...context.current, path }; updateRef.current(); }
      if (isGateVoicePage(snapshot().path)) existing.checkIn.engage(snapshot());
      const message = voiceSeedMessage(seed);
      const ready = existing.starting ?? Promise.resolve();
      return message ? ready.then(() => { if (valid(existing) && existing.ready && !collectCheckIn(existing, message)) { toAssistant(existing); existing.sdk!.sendMessage(message); setState("thinking"); } }) : ready;
    }
    const live: Live = { id: crypto.randomUUID(), abort: new AbortController(), sdk: null, stream: null, config: null, ready: false, seen: new Map(), focus: createGateCheckInFocus(), checkIn: createSilentGateCheckIn({ normalizePlateState, parseSpokenPlateState }), prompts: createGateVoicePrompter(text => speakAskV(text)), audioTurns: new Map() };
    liveRef.current = live; context.current = { ...context.current, ...(path ? { path } : {}) };
    if (isGateVoicePage(snapshot().path)) live.checkIn.engage(snapshot());
    setFocusMode(gateCheckInFocusAvailable(snapshot()));
    setError(null); setState("connecting");
    const check = () => { if (!valid(live)) throw new DOMException("Voice stopped", "AbortError"); };
    const microphone = askVMicrophone.acquire("askv", async () => { if (valid(live)) stop(); }).then(async release => {
      if (!valid(live)) { void release(); check(); }
      live.release = release;
      const capture = await captureAskVMicrophone(live.abort.signal);
      const { stream } = capture;
      if (!valid(live)) { stream.getTracks().forEach(track => track.stop()); check(); }
      live.stream = stream;
      live.stopMicrophoneMeter = meterAskVMicrophone(capture, true).stop;
      live.stopWaveform = observeAskVAudio(stream);
      return stream;
    });
    const configuration = post("voice/session", { path: path ?? context.current.path, manualAudioResponses: true }, live.abort.signal);
    const starting = (async () => {
      try {
        const [stream, config] = await Promise.all([microphone, configuration]); check(); live.config = config;
        live.playback = document.createElement("audio");
        live.playback.muted = capturing(live);
        const transport = new OpenAIRealtimeWebRTC({ mediaStream: stream, audioElement: live.playback });
        const updateSessionConfig = transport.updateSessionConfig.bind(transport);
        transport.updateSessionConfig = update => {
          const audio = "audio" in update ? update.audio : undefined;
          return updateSessionConfig({
            ...update,
            audio: { ...audio, input: { ...audio?.input, ...gateVoiceAudioInput(snapshot().path) } },
          });
        };
        const sendEvent = transport.sendEvent.bind(transport);
        transport.sendEvent = event => {
          if (event.type !== "response.create" || (live.gateTranscript?.trigger !== "in" && !capturing(live))) sendEvent(event);
        };
        const path = snapshot().path;
        live.gateAudio = isGateVoicePage(path);
        const sdk = new RealtimeSession(agent(live), { model: config.model, transport, historyStoreAudio: false, config: { audio: { input: gateVoiceAudioInput(path), output: { voice: config.voice } } } });
        const transcriptCleanup = createTranscriptCleanup(event => transport.sendEvent(event));
        live.sdk = sdk;
        const transition = (next: AskVVoiceState) => { if (valid(live)) setState(next); };
        sdk.on("history_updated", (history: RealtimeItem[]) => {
          if (!valid(live)) return;
          for (const item of history) {
            if (item.type !== "message" || (item.role !== "user" && item.role !== "assistant")) continue;
            if (live.audioTurns.get(item.itemId) || (item.role === "assistant" && capturing(live))) continue;
            const content = item.content.map(part => "text" in part ? part.text : "transcript" in part ? part.transcript ?? "" : "").join("").trim();
            if (!content) continue;
            const message: VoiceTranscript = { eventId: item.itemId, role: item.role, content, pending: item.status === "in_progress" };
            const signature = JSON.stringify([content, message.pending]);
            if (live.seen.get(item.itemId) === signature) continue;
            live.seen.set(item.itemId, signature);
            if (item.role === "user") live.lastUser = message;
            if (!message.pending) {
              const current = snapshot(), noteRequested = item.role === "user" && isQuickShiftNote(content);
              if (noteRequested) live.quickNote = true;
              const noteCancelled = live.quickNote && item.role === "user" && /^(?:(?:uh|okay|please)[, ]+)*(?:cancel\b|never\s?mind\b|no[.!]?$)/i.test(content.trim());
              const focus = live.quickNote ? { cancelled: Boolean(noteCancelled), changed: Boolean(noteRequested || noteCancelled) } : live.focus.observe(current, item.role, content);
              if (focus.cancelled) {
                const pending = live.pending; live.pending = undefined;
                if (live.quickNote) { live.quickNote = false; live.noteOperationId = undefined; } else cancelGateVoiceDraft();
                if (pending) void post("voice/actions", { ...current, name: pending.name, arguments: pending.input, sessionId: live.id, callId: crypto.randomUUID(), clientSurface: "web", utterance: { eventId: message.eventId, text: content } }, live.abort.signal, true).catch(() => undefined);
              }
              if (focus.changed) updateRef.current();
            }
            latest.current?.onTranscript?.(message, live.id);
          }
        });
        sdk.on("audio_start", () => { if (!capturing(live)) transition("speaking"); }); sdk.on("audio_stopped", () => transition("listening")); sdk.on("audio_interrupted", () => transition("listening"));
        sdk.on("transport_event", event => {
          if (!valid(live)) return;
          transcriptCleanup.observe(event);
          if (event.type === "conversation.item.input_audio_transcription.delta" && typeof event.item_id === "string" && typeof event.delta === "string" && isGateVoicePage(snapshot().path)) {
            const previous = live.gateTranscript?.itemId === event.item_id ? live.gateTranscript : undefined;
            const text = ((previous?.text ?? "") + event.delta).slice(0, 128);
            const trigger = gateVoiceTrigger(text);
            live.gateTranscript = { itemId: event.item_id, text, trigger };
            if (trigger && trigger !== previous?.trigger) {
              if (trigger === "out") live.checkoutQuiet = true;
              if (live.playback) live.playback.muted = true;
              sdk.interrupt();
            }
          }
          // A pending question waits while the operator is still talking.
          if (event.type === "input_audio_buffer.speech_started") { live.prompts.hush(); live.prompts.began(); }
          if (event.type === "conversation.item.input_audio_transcription.completed" || event.type === "conversation.item.input_audio_transcription.failed") live.prompts.heard();
          if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.item_id === "string" && typeof event.transcript === "string" && !live.audioTurns.has(event.item_id)) {
            const partial = live.gateTranscript?.itemId === event.item_id ? live.gateTranscript : undefined;
            if (partial) live.gateTranscript = undefined;
            if (live.prompts.echo(event.transcript)) {
              // AskV's own prompt came back through the microphone.
              live.audioTurns.set(event.item_id, true);
              transcriptCleanup.queue(event.item_id);
              live.prompts.ask(nextQuestion(live), false);
              return;
            }
            const collected = collectCheckIn(live, event.transcript, Boolean(partial?.trigger && partial.trigger === gateVoiceTrigger(event.transcript)), false, event.item_id);
            if (import.meta.env.DEV) console.debug("[AskV received speech]", event.transcript, "collected:", collected);
            live.audioTurns.set(event.item_id, Boolean(collected));
            if (collected === true && event.transcript.trim()) {
              const message: VoiceTranscript = { eventId: event.item_id, role: "user", content: event.transcript, pending: false };
              live.lastUser = message;
              latest.current?.onTranscript?.(message, live.id);
            }
            if (collected) transcriptCleanup.queue(event.item_id);
            else if (event.transcript.trim()) { toAssistant(live); transport.sendEvent({ type: "response.create" }); }
            else { transition("listening"); live.prompts.ask(nextQuestion(live), false); }
          }
          if (event.type === "conversation.item.input_audio_transcription.failed" && live.gateTranscript && live.gateTranscript.itemId === event.item_id) {
            live.gateTranscript = undefined;
            if (live.playback) live.playback.muted = Boolean(live.checkoutQuiet) || capturing(live);
          }
          if (live.gateTranscript?.trigger === "in" || capturing(live)) {
            if (event.type === "output_audio_buffer.started") sdk.interrupt();
            return;
          }
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
        const message = voiceSeedMessage(seed); if (message && !collectCheckIn(live, message)) { toAssistant(live); sdk.sendMessage(message); }
      } catch (cause) { if (valid(live)) fail(live, cause); }
      finally { live.starting = undefined; }
    })();
    live.starting = starting; return starting;
  }, [stop]);
  const sendText = useCallback((text: string) => {
    const live = liveRef.current; if (!live?.ready || !valid(live)) return false;
    live.lastUser = { eventId: crypto.randomUUID(), role: "user", content: text, pending: false };
    if (collectCheckIn(live, text)) return true;
    toAssistant(live); live.sdk!.sendMessage(text); setState("thinking"); return true;
  }, []);
  const interrupt = useCallback(() => { const live = liveRef.current; if (live?.ready) { live.sdk?.interrupt(); setState("listening"); } }, []);
  const setMicEnabled = useCallback((enabled: boolean) => { if (!enabled) { stop(); setState("muted"); } }, [stop]);
  return { state, error, activeTool, focusMode, greeting: null, startConversation, startOneCommand: startConversation, stop, interrupt, setMicEnabled, updateContext, sendText };
}
