import { waitForGateCapture } from "@workspace/gate-booth";
import { router, usePathname } from "expo-router";
import { AppState } from "react-native";
import { Audio } from "expo-av";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeAgent, RealtimeSession, tool, type RealtimeItem } from "@workspace/askv-realtime-sdk";
import { voiceApplicationInstructions, voiceSeedMessage, privateVoiceContext, voiceContextBinding, isQuickShiftNote, voiceQuickNoteInstructions } from "@workspace/askv-realtime-sdk/app-context";
import { readVoicePageContext, subscribeVoicePageContext } from "@workspace/gate-booth";
import { askVMicrophone } from "@workspace/askv-wake";
import { normalizePlateState, parseSpokenPlateState, reconcileAutomatedPlateUpdate } from "@workspace/plate-state";
import { createWatchGateForm, gateVoiceFormOpen, isWatchGateDraft } from "@workspace/gate-booth";
import { confirmGateCheckIn, gateVoiceAudioInput, gateVoiceTrigger, gateCheckOutQuery, checkInQuestion, missingCheckInField, createGateVoicePrompter, isGateVoicePage, createSilentGateCheckIn, readGateVoiceDraft, subscribeGateVoiceDraft, notifyGateVoiceSaved, fillGateVoiceDraft, cancelGateVoiceDraft, createGateCheckInFocus, gateCheckInFocusAvailable, readGateVoiceGuidance, subscribeGateVoiceGuidance, parseGateSetupProgressHint, parseGateWorkflowOffer, publishGateVoiceWorkflowResult, gateWorkflowToolArguments, decideGateVoiceReply, checkInPrompt, checkInReceipt, checkoutSpeech, CHECK_OUT_PROMPT, GATE_VOICE_DECLINED } from "@workspace/gate-booth";
import { createTranscriptCleanup } from "@workspace/askv-realtime-sdk/transcript-cleanup";
import { getToken, getCachedToken, subscribeToken, subscribeUser, type StoredUser } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useAssistant, type AssistantMessage } from "@/hooks/use-assistant";
import { openAskVMicrophone, sdkTransport, type AskVMicrophone } from "@/lib/askv-sdk/transport";
import { emitAskVDataChanged, executeAskVClientIntent } from "@/lib/askv-client-tools";
import { withAskVToolLocation, type AskVCoordinates } from "@/lib/askv-tool-location";
import { apiFetch, getApiBase } from "@/lib/api";
import { type AskVVoiceState } from "@/lib/askv-voice-state";
import { readAskVAcrossVndrly, readAskVMuted, writeAskVAcrossVndrly, writeAskVMuted } from "@/lib/askvVoicePreferences";
import { nativeAskVContextPath } from "@/lib/askv-context-path";
import { nativeUuid } from "@/lib/native-uuid";
import { speakAskV, stopAskVSpeech } from "@/lib/askv-speech";
import { configureAskVAudioSession, releaseAskVAudioSession, subscribeAskVAudioInterruption } from "@/lib/askv-audio-session";
import { recordAskVMetric, type AskVMetricReason } from "@/lib/askv-voice-metrics";
import { askVWake, checkInProgress, isAskVPause, isGateSaveNow, gateEntryStarted, voiceErrorEndsSession, plainGateError, plainGateFailure, gateChoiceQuestion, matchGateChoice, chooseGateVoiceGate, createVoiceRetryLadder, createVoiceLinkPulse, voiceRefreshDue, VOICE_PULSE_MS } from "@workspace/gate-booth";
import { preparedShiftNoteMatchesDraft, reviseShiftNote, shiftNoteDecision, shiftNoteFromCommand } from "@/lib/askv-shift-note-draft";

type Assistant = ReturnType<typeof useAssistant>;
interface AskVVoiceSessionValue {
  state: AskVVoiceState; error: string | null; greeting: string | null;
  muted: boolean; acrossVndrly: boolean; wakeSupported: boolean; preferencesReady: boolean;
  assistant: Assistant;
  startConversation: (seed?: string, path?: string, options?: { gateFocus?: boolean }) => Promise<void>;
  stop: (reason?: AskVMetricReason) => Promise<void>;
  setMuted: (muted: boolean) => void;
  /** Paused, V stays connected and hears the room as background until she is called or resumed. */
  paused: boolean;
  /** Asleep after a save: paused with her panel closed, until she is called or tapped. */
  asleep: boolean;
  setPaused: (paused: boolean) => void;
  setAcrossVndrly: (enabled: boolean) => void;
  subscribeReplies: (listener: (text: string) => void) => () => void;
  checkInReview: CheckInReview;
  checkInSaving: boolean;
  checkInError: string | null;
  confirmCheckIn: (key: string) => Promise<void>;
  shiftNoteDraft: { text: string; status: "collecting" | "preparing" | "revising" | "ready" | "submitting" } | null;
  sendShiftNoteText: (text: string) => Promise<void>;
}
type CheckInReview = ReturnType<ReturnType<typeof createSilentGateCheckIn>["review"]>;
type WireTool = { name: string; description: string; parameters: Record<string, any> };
type VoiceConfig = {
  clientSecret: string; model: string; voice: string; instructions: string;
  tools: WireTool[]; toolMetadata: { name: string; mutating: boolean }[];
};
type Live = {
  id: string; scope: string; startedAt: number; abort: AbortController; stream: AskVMicrophone | null;
  sdk: RealtimeSession | null; release: (() => Promise<void>) | null; ready: boolean; readyAt?: number;
  token: string | null; config: VoiceConfig | null; starting: Promise<void> | null;
  conversation: Promise<number> | null; saving: Promise<void>; saved: Set<string>;
  delegating: Promise<void>; delegateActive: boolean;
  queued: Set<string>; lastUser: string | null;
  binding: string; seen: Map<string, string>;
  focus: ReturnType<typeof createGateCheckInFocus>;
  checkIn: ReturnType<typeof createSilentGateCheckIn>;
  prompts: ReturnType<typeof createGateVoicePrompter>;
  audioTurns: Map<string, boolean>;
  gateTranscript?: { itemId: string; text: string; trigger?: "in" | "out" };
  /** The operator's latest words, sent with a Gate action as its spoken approval. */
  heard?: { eventId: string; text: string };
  /** A check-in or check-out spoken on another Gate screen, continued on the Gate form. */
  carry?: string;
  checkoutRunning?: boolean;
  audioConfigured?: boolean;
  confirming?: boolean;
  mutePlayback?: (muted: boolean) => void;
  quickNote?: boolean;
  noteOperationId?: string;
  pending: { name: string; arguments: string; args?: string; key: string; path: string; coordinates?: AskVCoordinates | null } | null;
  runTool?: Record<string, (...args: any[]) => Promise<string>>;
  promptedKey?: string;
  /** Counts down to the automatic pause of a check-in nobody is adding to. */
  idle?: ReturnType<typeof setTimeout>;
  reviewKey?: string;
  /** V asked which gate; the next answer picks it. */
  askingGate?: boolean;
};
const Context = createContext<AskVVoiceSessionValue | null>(null);
const OTHER_GATE_SCREEN = /^\/mobile\/(?:change-over|gate-history|gate-map|shift-notes)(?:[/?#]|$)/;
/** Longest a spoken request may wait for its answer before V gives up and listens again. */
const VOICE_TURN_LIMIT_MS = 60_000;
const MICROPHONE_CHECK_MS = 5_000;
/** How long an open check-in may sit with nothing said or typed before V pauses herself. */
const CHECK_IN_IDLE_MS = 30_000;
const NOT_ANSWERED = { en: "I didn't get that. Please say it again.", es: "No lo entendí. Dilo otra vez, por favor.", pt: "Não entendi. Diga de novo, por favor." };
const scopeOf = (u: StoredUser | null) => u ? [u.id, u.activeMembershipId, u.role, u.partnerId, u.vendorId].join(":") : "";
/** Away from the Gate page, whoever holds a watch checks people in and out against that gate without leaving the page. */
const watchDesk = createWatchGateForm({
  request: (method, path, body) => apiFetch("/api" + path, body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  position: async () => {
    const { latitude, longitude } = await withAskVToolLocation("confirm_visitor_check_in", {});
    return typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null;
  },
  plate: reconcileAutomatedPlateUpdate,
});
/** The server answered and said no: its reason is shown as given. */
class ServerRefusal extends Error { constructor(message: string, readonly status: number) { super(message); } }
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
  if (!response.ok && (!toolResult || response.status === 401)) throw new ServerRefusal(plainGateFailure(response.status, data.message ?? data.error), response.status);
  return data;
}

/** OpenAI's SDK owns audio, turn-taking, interruptions, tool execution and replies. */
export function AskVVoiceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
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
  const [checkInReview, setCheckInReview] = useState<CheckInReview>(null);
  const [checkInSaving, setCheckInSaving] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [shiftNoteDraft, setShiftNoteDraftState] = useState<AskVVoiceSessionValue["shiftNoteDraft"]>(null);
  const shiftNoteRef = useRef<{ text: string; status: "collecting" | "preparing" | "revising" | "ready" | "submitting"; reference?: string; allowRevision?: boolean } | null>(null);
  const setShiftNoteDraft = (draft: typeof shiftNoteRef.current) => {
    shiftNoteRef.current = draft;
    setShiftNoteDraftState(draft ? { text: draft.text, status: draft.status } : null);
  };
  const mounted = useRef(true), pathRef = useRef(pathname), scopeRef = useRef(scope), userRef = useRef(user);
  pathRef.current = pathname; scopeRef.current = scope; userRef.current = user;
  const liveRef = useRef<Live | null>(null);
  const askVNavigation = useRef<{ expires: number } | null>(null);
  const pendingVoiceReply = useRef<string | null>(null);
  const speakingTextReply = useRef(false);
  const speechTurn = useRef(0);
  const ladder = useRef(createVoiceRetryLadder());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef({ state, activeTool }); busy.current = { state, activeTool };
  /** A call, Siri or an alarm holds the audio: V is deaf until it is given back, and is not treated as broken meanwhile. */
  const interrupted = useRef(false);
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const [asleep, setAsleep] = useState(false);
  const asleepRef = useRef(false);
  /** What a session that reconnects on its own hands to the next one, so an open check-in keeps its place. */
  const kept = useRef<{ checkIn: Live["checkIn"]; promptedKey?: string; paused: boolean; asleep: boolean } | null>(null);
  const messagesRef = useRef(new Map<string, AssistantMessage>());
  const mutedRef = useRef(false), acrossRef = useRef(false), preferenceVersion = useRef(0);
  const replies = useRef(new Set<(text: string) => void>());
  const base = useAssistant({
    pagePath: nativeAskVContextPath(pathname),
    onClientIntent: async intent => {
      const mayNavigate = ["open_screen", "prefill_gate_visit", "prefill_draft", "launch_camera", "launch_scanner", "start_ticket_entry"].includes(intent.name);
      const navigation = mayNavigate ? { expires: Date.now() + 10_000 } : null;
      if (navigation) askVNavigation.current = navigation;
      try {
        const result = await executeAskVClientIntent(intent, pathRef.current);
        if (navigation && !result.opened && askVNavigation.current === navigation) askVNavigation.current = null;
        return result;
      } catch (error) {
        if (navigation && askVNavigation.current === navigation) askVNavigation.current = null;
        throw error;
      }
    },
    onMutation: () => {
      emitAskVDataChanged();
      void queryClient.invalidateQueries({ queryKey: ["change-over-state"] });
    },
    onAssistantReply: text => {
      replies.current.forEach(listener => listener(text));
      const live = liveRef.current;
      if (shiftNoteRef.current && shiftNoteRef.current.status !== "submitting") {
        if (pendingVoiceReply.current === live?.id) pendingVoiceReply.current = null;
        return;
      }
      if (shiftNoteRef.current?.status === "submitting") setShiftNoteDraft(null);
      if (!live || pendingVoiceReply.current !== live.id || live.abort.signal.aborted) return;
      pendingVoiceReply.current = null;
      speakingTextReply.current = true;
      const turn = ++speechTurn.current;
      setState("speaking");
      const language = userRef.current?.preferredLanguage === "es" ? "es-US"
        : userRef.current?.preferredLanguage === "pt" ? "pt-BR" : "en-US";
      speakAskV(text, language, true, () => {
        if (liveRef.current !== live || live.abort.signal.aborted || speechTurn.current !== turn) return;
        speakingTextReply.current = false;
        setState("listening");
      });
    },
    onConfirmation: (reference, toolName, arguments_) => {
      const draft = shiftNoteRef.current, live = liveRef.current;
      if (!draft || draft.status !== "preparing" || toolName !== "manage_gate_shift" || !live || live.abort.signal.aborted) return;
      const preparedText = typeof arguments_?.text === "string" ? arguments_.text : null;
      if (draft.allowRevision && arguments_?.action === "add_shift_note" && preparedText && preparedText.length <= 2000 && preparedText !== draft.text) {
        setShiftNoteDraft({ text: preparedText, status: "ready", reference });
      } else if (!preparedShiftNoteMatchesDraft(arguments_, draft.text)) {
        setShiftNoteDraft({ text: draft.text, status: "collecting" });
        setError("The prepared note did not match your words. Please correct or repeat it.");
        return;
      } else setShiftNoteDraft({ ...draft, status: "ready", reference });
      pendingVoiceReply.current = null;
      speakingTextReply.current = true;
      const turn = ++speechTurn.current;
      setState("speaking");
      const language = userRef.current?.preferredLanguage === "es" ? "es-US" : userRef.current?.preferredLanguage === "pt" ? "pt-BR" : "en-US";
      speakAskV(`Shift note: ${shiftNoteRef.current?.text ?? draft.text}. Confirm?`, language, true, () => {
        if (liveRef.current !== live || speechTurn.current !== turn) return;
        speakingTextReply.current = false;
        setState("listening");
      });
    },
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
  const closeLive = useCallback((live: Live, reason: AskVMetricReason) => {
    // The drop log: every session that ends, or never connects, names its cause once.
    if (live.token && !live.abort.signal.aborted) recordAskVMetric({ token: live.token, sessionId: live.id }, live.ready ? "session_end" : "fallback", { durationMs: Date.now() - live.startedAt, reason });
    live.prompts.hush(); clearTimeout(live.idle);
    live.abort.abort(); live.ready = false;
    try { live.sdk?.close(); } finally { stopStream(live.stream); live.stream = null; }
    const release = live.release; live.release = null;
    const configured = live.audioConfigured; live.audioConfigured = false;
    void (configured ? releaseAskVAudioSession().catch(() => undefined) : Promise.resolve()).then(() => release?.()).catch(() => undefined);
  }, []);
  const stop = useCallback(async (reason: AskVMetricReason = "user") => {
    // Stopped while waiting to reconnect: the wait ends and its check-in is not carried.
    if (retryTimer.current !== undefined) { clearTimeout(retryTimer.current); retryTimer.current = undefined; kept.current = null; }
    interrupted.current = false;
    metadata.current = {};
    askVNavigation.current = null;
    pendingVoiceReply.current = null;
    speechTurn.current += 1;
    if (speakingTextReply.current) stopAskVSpeech();
    speakingTextReply.current = false;
    setShiftNoteDraft(null);
    const live = liveRef.current; liveRef.current = null;
    if (live?.delegateActive) assistantRef.current.stopGeneration();
    if (live) closeLive(live, reason);
    // An unsaved watch-form entry survives only the reconnect that carries its check-in over.
    if (!kept.current) watchDesk.close();
    pausedRef.current = asleepRef.current = false;
    if (mounted.current) { setState("stopped"); setPausedState(false); setAsleep(false); setActiveTool(null); setCheckInReview(null); setCheckInSaving(false); setCheckInError(null); }
  }, [closeLive]);
  /** Ends this session and starts the next after `wait`, with the open check-in, the pause and the sleep carried across; with no wait left, shows why. */
  const carry = (live: Live, reason: AskVMetricReason, wait: number | null, message = "askv.voiceFailed") => {
    kept.current = wait === null ? null : { checkIn: live.checkIn, promptedKey: live.promptedKey, paused: pausedRef.current, asleep: asleepRef.current };
    void stop(reason).then(() => {
      if (!mounted.current || liveRef.current || scopeRef.current !== live.scope) { kept.current = null; return; }
      if (wait === null) { setError(message); setState("error"); return; }
      if (!wait) { void startRef.current(); return; }
      setState("connecting");
      retryTimer.current = setTimeout(() => { retryTimer.current = undefined; void startRef.current(); }, wait);
    });
  };
  /** The link ended on its own: log why, then connect again, waiting longer each time, so an open check-in keeps its place. */
  const recover = (live: Live, reason: AskVMetricReason, message = "askv.voiceFailed") => {
    if (!valid(live)) return;
    carry(live, reason, AppState.currentState === "background" || mutedRef.current ? null : ladder.current.next(live.readyAt ? Date.now() - live.readyAt : 0), message);
  };
  /** The audio is back after a call or Siri. iOS may not restart the microphone, so V moves to a fresh session with the open check-in. */
  const audioBack = useRef(() => {});
  audioBack.current = () => {
    if (!interrupted.current) return;
    interrupted.current = false;
    const live = liveRef.current;
    if (live?.ready && valid(live)) carry(live, "interruption", 0);
  };
  /** Nobody is talking and nothing is being entered, saved or answered: V can change sessions unnoticed. */
  const quiet = (live: Live) => {
    const current = applicationContext();
    return busy.current.state === "listening" && !busy.current.activeTool && !assistantRef.current.streaming && !speakingTextReply.current && !shiftNoteRef.current
      && !live.prompts.busy() && !live.confirming && !live.checkoutRunning && !live.pending && !live.delegateActive
      && (pausedRef.current || (!live.checkIn.pending(current) && !live.checkIn.review(current)));
  };

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
  function queueReasonedVoiceTurn(live: Live, utterance: string, confirmationReference?: string): Promise<void> {
    const queued = live.delegating.catch(() => undefined).then(async () => {
      if (!valid(live)) return;
      // The text engine declines overlapping sends. Keep spoken requests and
      // page prompts in order until the previous turn has finished.
      while (valid(live) && assistantRef.current.streaming) {
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      if (!valid(live)) return;
      if (speakingTextReply.current) { speechTurn.current += 1; stopAskVSpeech(); speakingTextReply.current = false; }
      pendingVoiceReply.current = live.id;
      live.delegateActive = true;
      writeState(live, "thinking");
      // A request that never answers must not hold every later request behind it.
      const began = Date.now();
      let giveUp!: () => void;
      const gaveUp = new Promise<void>(resolve => { giveUp = resolve; });
      const limit = setTimeout(() => {
        if (valid(live)) {
          if (live.token) recordAskVMetric({ token: live.token, sessionId: live.id }, "turn", { durationMs: Date.now() - began, reason: "timeout" });
          assistantRef.current.stopGeneration();
          const language = userRef.current?.preferredLanguage === "es" ? "es" : userRef.current?.preferredLanguage === "pt" ? "pt" : "en";
          speakAskV(NOT_ANSWERED[language], language === "es" ? "es-US" : language === "pt" ? "pt-BR" : "en-US", true);
        }
        giveUp();
      }, VOICE_TURN_LIMIT_MS);
      try { await Promise.race([assistantRef.current.send(utterance, "ios_voice", confirmationReference, true), gaveUp]); }
      finally {
        clearTimeout(limit);
        live.delegateActive = false;
        if (pendingVoiceReply.current === live.id) {
          pendingVoiceReply.current = null;
          writeState(live, "listening");
        }
      }
    });
    live.delegating = queued.catch(error => {
      if (valid(live)) setError(plainGateError(error, "askv.voiceFailed"));
    });
    return live.delegating;
  }
  function prepareShiftNote(live: Live, text: string, correction?: string): void {
    const previous = live.delegating;
    void previous.catch(() => undefined).then(async () => {
      if (!valid(live) || shiftNoteRef.current?.text !== text) return;
      setShiftNoteDraft({ text, status: "preparing", allowRevision: Boolean(correction) });
      await queueReasonedVoiceTurn(live, correction
        ? `Revise the pending shift note. Current exact note: ${text}\nOperator correction: ${correction}\nPrepare the revised note for confirmation. Do not submit it yet.`
        : `Add shift note: ${text}\nPrepare this exact note for confirmation. Do not submit it yet.`);
      if (valid(live) && shiftNoteRef.current?.text === text && shiftNoteRef.current.status === "preparing") {
        setShiftNoteDraft({ text, status: "collecting" });
        setError("The shift note could not be prepared. Please try again.");
      }
    });
  }
  function collectShiftNote(live: Live, utterance: string): boolean {
    const command = shiftNoteFromCommand(utterance);
    if (command !== null) {
      const text = command;
      if (text.length > 2000) {
        setShiftNoteDraft({ text, status: "collecting" });
        setError("The shift note is over 2000 characters. Please shorten it.");
        return true;
      }
      setError(null);
      setShiftNoteDraft({ text, status: text ? "preparing" : "collecting" });
      if (text) prepareShiftNote(live, text);
      return true;
    }
    const draft = shiftNoteRef.current;
    if (!draft) return false;
    const decision = shiftNoteDecision(utterance);
    if (decision === "cancel") { setShiftNoteDraft(null); void queueReasonedVoiceTurn(live, "Cancel the pending shift note. Do not save it."); return true; }
    if (decision === "approve") {
      if (draft.status === "ready" && draft.reference) {
        void live.delegating.catch(() => undefined).then(() => {
          if (!valid(live) || shiftNoteRef.current?.status !== "ready" || shiftNoteRef.current.reference !== draft.reference) return;
          setShiftNoteDraft({ ...draft, status: "submitting" });
          void queueReasonedVoiceTurn(live, "Confirm", draft.reference);
        });
      }
      return true;
    }
    const revised = draft.status === "collecting" && !draft.text ? utterance.trim() : reviseShiftNote(draft.text, utterance);
    if (revised !== null && revised.trim()) {
      const text = revised.trim();
      if (text.length > 2000) {
        setError("The shift note is over 2000 characters. Please shorten it.");
        return true;
      }
      setError(null);
      setShiftNoteDraft({ text, status: "revising" });
      prepareShiftNote(live, text);
      return true;
    }
    if (draft.status !== "submitting" && !/\?$|^(?:who|what|when|where|how|can|could|show|tell)\b/i.test(utterance.trim())) {
      setError(null);
      setShiftNoteDraft({ text: draft.text, status: "revising", allowRevision: true });
      prepareShiftNote(live, draft.text, utterance.trim());
      return true;
    }
    if (draft.status !== "submitting") {
      setShiftNoteDraft(null);
      void queueReasonedVoiceTurn(live, "Cancel the pending shift note. Do not save it.");
    }
    return false;
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
      // Spoken requests are saved by the text reasoning route after transcription.
      // The realtime history still supplies the current utterance for Gate focus.
      if (item.role !== "user" || !item.content.some(part => "transcript" in part)) record(live, message);
    }
  }
  function makeAgent(live: Live): RealtimeAgent {
    const config = live.config!;
    return new RealtimeAgent({
      name: "AskV",
      instructions: config.instructions + voiceApplicationInstructions(applicationContext()) + (live.quickNote ? "" : live.focus.instructions(applicationContext())) + voiceQuickNoteInstructions(),
      tools: config.tools.map(definition => tool({
        name: definition.name, description: definition.description, parameters: definition.parameters as any, strict: false,
        execute: (live.runTool ??= {})[definition.name] = async (raw, _context, details) => {
          const refuse = (error: string) => {
            const reply = checkoutSpeech(definition.name, { ok: false, error });
            if (reply && valid(live)) live.prompts.say(reply);
            return JSON.stringify({ ok: false, error });
          };
          if (!valid(live) || !live.token) return JSON.stringify({ ok: false, error: "Voice session ended" });
          if (live.checkIn.active(applicationContext())) return refuse("Finish or cancel the check-in first.");
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
          if (!valid(live) || live.checkIn.active(applicationContext())) return refuse("Voice action interrupted.");
          const utterance = live.heard ?? (live.lastUser ? { eventId: live.lastUser, text: messagesRef.current.get(live.lastUser)?.content ?? "" } : null);
          const result = await post(live.token, "voice/actions", {
            ...applicationContext(),
            name: definition.name, arguments: coordinates, sessionId: live.id, callId,
            idempotencyKey: pending?.key ?? callId, clientSurface: "ios", path,
            gateDraft: readGateVoiceDraft(),
            ...(utterance ? { utterance } : {}),
          }, live.abort.signal, true);
          if (!valid(live) || path !== nativeAskVContextPath(pathRef.current)) return JSON.stringify({ ok: false, message: "The screen changed. Review the action again." });
          metadata.current.toolCalls = [...(metadata.current.toolCalls ?? []), { name: definition.name, input: coordinates, output: typeof result.output === "string" ? result.output : JSON.stringify(result) }];
          if (result.recovery) metadata.current.recovery = { ...result.recovery, needed: Array.isArray(result.recovery.needed) ? result.recovery.needed : [result.recovery.needed] };
          live.pending = result.requiresConfirmation ? {
            name: definition.name, arguments: fingerprint(args), args: JSON.stringify(args), key: result.idempotencyKey,
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
          if (output?.ok && output.action === "visitor_checked_out" && output.verification === "canonical_readback") notifyGateVoiceSaved({ checkoutCompleted: true });
          const checkoutReply = checkoutSpeech(definition.name, result.requiresConfirmation ? result : output);
          if (checkoutReply) live.prompts.say(checkoutReply);
          // What V says about a check-out that did not go through is also shown.
          if (checkoutReply && output?.ok === false && !result.requiresConfirmation) setCheckInError(checkoutReply);
          // Saved: V goes quiet and closes her panel until she is called again.
          if (output?.ok && (output.action === "visitor_checked_in" || (output.action === "visitor_checked_out" && output.verification === "canonical_readback"))) pause(live, true, true);
          return JSON.stringify(output);
        },
      })),
    });
  }
  /** A check-in left open with nothing said or typed pauses itself, so the room cannot fill the form. */
  const armIdle = (live: Live) => {
    clearTimeout(live.idle);
    live.idle = setTimeout(() => {
      if (!valid(live) || pausedRef.current) return;
      const current = applicationContext();
      if (!live.checkIn.pending(current) && !live.checkIn.review(current)?.ready) return;
      if (live.prompts.busy() || live.confirming) armIdle(live); else pause(live, true);
    }, CHECK_IN_IDLE_MS);
  };
  /** Paused, V keeps hearing but treats it all as background until she is called or told to continue. */
  const pause = (live: Live, next: boolean, sleep = false): boolean => {
    if (!valid(live) || (pausedRef.current === next && asleepRef.current === (next && sleep))) return false;
    pausedRef.current = next; asleepRef.current = next && sleep;
    setPausedState(next); setAsleep(next && sleep);
    live.prompts.hush();
    if (next) clearTimeout(live.idle); else armIdle(live);
    writeState(live, "listening");
    return true;
  };
  const syncGateReview = (live: Live, settled = false) => {
    const current = applicationContext();
    live.mutePlayback?.(live.gateTranscript?.trigger === "in" || live.checkIn.active(current));
    const review = live.checkIn.review(current);
    // Typing into the form counts as the operator still working on it.
    // A reason shown for the last attempt no longer applies once the entry changes.
    if (review?.key !== live.reviewKey) { live.reviewKey = review?.key; armIdle(live); setCheckInError(null); }
    // Read the complete form back once, and never while the operator is mid-sentence.
    // A short tag may be the first piece of one still being read aloud: wait for the pause.
    if (!pausedRef.current && review?.ready && review.key !== live.promptedKey && !live.prompts.busy() && (settled || review.vehiclePlate.length > 4)) { live.promptedKey = review.key; live.prompts.say(checkInPrompt(review)); }
    setCheckInReview(previous => previous?.key === review?.key ? previous : review);
  };
  /** Says where the open check-in stands when the operator comes back to it. False when none is open. */
  const whereLeftOff = (live: Live): boolean => {
    const current = applicationContext(), review = live.checkIn.review(current);
    if (review?.ready) { live.promptedKey = review.key; live.prompts.say(checkInPrompt(review)); return true; }
    const field = live.checkIn.pending(current);
    if (field) live.prompts.say(checkInProgress(review, checkInQuestion(field)));
    return Boolean(field);
  };
  const setPaused = useCallback((next: boolean) => {
    const live = liveRef.current;
    if (live?.ready && pause(live, next) && !next) whereLeftOff(live);
  }, []);
  /** The one-word question for the next missing check-in field, once "check in" was said. */
  const nextQuestion = (live: Live) => () => {
    if (!valid(live)) return null;
    // A read-back that was held while the operator was talking is due now.
    syncGateReview(live, true);
    const field = live.checkIn.pending(applicationContext());
    return field ? checkInQuestion(field) : null;
  };
  /** A problem V says aloud is also shown in her pane. */
  const problem = (live: Live, message: string) => { if (valid(live)) { setCheckInError(message); live.prompts.say(message); } };
  /** Only a gate that is not chosen holds a save: V asks which, and takes the answer by voice. */
  const askGate = (live: Live) => {
    live.askingGate = true;
    problem(live, gateChoiceQuestion(readGateVoiceDraft()));
  };
  /** Saves the open check-in as it stands. Details nobody gave are flagged, not waited for. */
  const confirmCheckIn = useCallback(async (key: string) => {
    const live = liveRef.current;
    // A tap that cannot save says why instead of doing nothing.
    if (!live?.ready || !valid(live)) { setCheckInError("V is not connected. Reopen V, or use the Gate form."); return; }
    if (live.confirming) return;
    pause(live, false);
    const review = live.checkIn.review(applicationContext());
    if (!review || review.key !== key) { problem(live, "The check-in changed. Review it, then say yes."); return; }
    if (!review.savable) { askGate(live); return; }
    live.confirming = true;
    setCheckInSaving(true); setCheckInError(null);
    try {
      const flags = await confirmGateCheckIn(key);
      if (valid(live)) {
        // Away from the Gate page a saved check-in ends there, so later requests reach the assistant again.
        if (isWatchGateDraft(readGateVoiceDraft())) live.checkIn.reset();
        live.promptedKey = review.key; live.prompts.say(checkInReceipt(review, flags)); syncGateReview(live);
        // Saved: V goes quiet and closes her panel until she is called again.
        pause(live, true, true);
      }
    } catch (error) {
      // The operator is not looking at the screen: say why it was not saved, and stay open.
      const message = plainGateError(error, "Check-in could not be saved.");
      if (valid(live)) { setCheckInError("Not saved: " + message); live.prompts.say(message); }
    } finally {
      live.confirming = false;
      if (valid(live)) setCheckInSaving(false);
    }
  }, []);
  const collectCheckIn = (live: Live, text: string, interrupted = false, eventId?: string, watchRead = false): boolean => {
    const current = applicationContext();
    const spoken = gateVoiceTrigger(text);
    armIdle(live);
    live.heard = { eventId: eventId ?? "typed-" + Date.now() + "-" + Math.random().toString(36).slice(2), text };
    // The answer to "Which gate?": pick it, then wait for the yes.
    if (live.askingGate && !spoken) {
      const gate = matchGateChoice(readGateVoiceDraft(), text);
      if (gate) {
        live.askingGate = false; setCheckInError(null);
        chooseGateVoiceGate(gate.id);
        live.prompts.say(`${gate.name}. Say yes to check in.`);
        writeState(live, "listening");
        return true;
      }
    }
    live.askingGate = false;
    // "Check in" or "check out" away from the Gate page: whoever holds a watch does it right here, against that gate.
    if (spoken && !watchRead && !isGateVoicePage(current.path)) {
      writeState(live, "listening");
      void watchDesk.open().catch(() => false).then(held => {
        if (!valid(live) || (held && collectCheckIn(live, text, interrupted, eventId, true))) return;
        // Without a watch, another Gate screen still opens the Gate form and continues there.
        if (OTHER_GATE_SCREEN.test(current.path)) {
          live.carry = text;
          askVNavigation.current = { expires: Date.now() + 10_000 };
          router.push("/(tabs)/gate" as never);
        } else {
          // Not a Gate crossing after all: hand the request to the assistant, as any other spoken request.
          if (eventId && messagesRef.current.delete(eventId)) setVoiceMessages([...messagesRef.current.values()]);
          void queueReasonedVoiceTurn(live, text);
        }
      });
      return true;
    }
    const trigger = gateVoiceFormOpen(current) ? spoken : undefined;
    if (isWatchGateDraft(current.gateDraft)) {
      // A check-out replaces any check-in still open on the watch form.
      if (trigger === "out") { live.checkIn.hear(current, text); syncGateReview(live); live.sdk?.interrupt(); }
      const handled = watchDesk.hearCheckOut(text, {
        say: message => { if (valid(live)) live.prompts.say(message); },
        // Shown as "Not saved" when the save itself failed, as a failed check-in is; she says the reason alone.
        fail: (message, notSaved) => { if (valid(live)) { setCheckInError(notSaved ? "Not saved: " + message : message); live.prompts.say(message); } },
        saved: receipt => { if (valid(live)) { live.prompts.say(receipt); pause(live, true, true); } },
      });
      if (handled) { setCheckInError(null); writeState(live, "listening"); return true; }
    }
    if (!trigger && live.pending?.name === "confirm_visitor_check_out" && live.pending.args && live.runTool?.confirm_visitor_check_out) {
      const decision = decideGateVoiceReply(text, "check_out");
      if (decision === "submit") void live.runTool.confirm_visitor_check_out(JSON.parse(live.pending.args));
      else if (decision === "refuse" || decision === "correct") { live.pending = null; live.prompts.say(GATE_VOICE_DECLINED); }
      else live.prompts.say(CHECK_OUT_PROMPT);
      writeState(live, "listening");
      return true;
    }
    const checkoutQuery = trigger === "out" ? gateCheckOutQuery(text) : "";
    const runTool = live.runTool;
    if (checkoutQuery && runTool?.prepare_visitor_check_out && runTool.confirm_visitor_check_out) {
      // Find the visitor and stage the check-out here; the chat model is not needed for this.
      live.checkIn.hear(current, text);
      syncGateReview(live);
      live.sdk?.interrupt();
      if (!live.checkoutRunning) {
        live.checkoutRunning = true;
        live.pending = null;
        writeState(live, "thinking");
        void (async () => {
          for (let wait = 0; wait < 80 && valid(live) && !applicationContext().gateDraft; wait++) await new Promise(resolve => setTimeout(resolve, 100));
          const gateDraft = applicationContext().gateDraft;
          const prepared = JSON.parse(await runTool.prepare_visitor_check_out({ query: checkoutQuery, siteLocationId: gateDraft?.siteLocationId }));
          if (prepared.ok && prepared.matches?.length === 1 && !prepared.needsChoice) {
            await runTool.confirm_visitor_check_out({ visitId: prepared.matches[0].id, ...(gateDraft?.gateStationId ? { gateStationId: gateDraft.gateStationId } : {}) });
          } else problem(live, !prepared.ok ? `Checkout failed. ${plainGateError(prepared.error ?? prepared.message, "")}`.trim() : prepared.needsChoice ? "Which visitor?" : "No matching visitor found.");
        })().catch(error => problem(live, `Checkout failed. ${plainGateError(error, "")}`.trim()))
          .finally(() => { live.checkoutRunning = false; writeState(live, "listening"); });
      }
      return true;
    }
    if (live.checkIn.active(current) && /^(?:cancel(?: (?:this |the )?(?:check[ -]?in|entry|draft))?|never ?mind)[.!\s]*$/i.test(text.trim())) {
      live.checkIn.reset(); cancelGateVoiceDraft(); syncGateReview(live);
      setCheckInError(null); writeState(live, "listening"); return true;
    }
    if (trigger && !interrupted) {
      if (trigger === "in") live.mutePlayback?.(true);
      live.sdk?.interrupt();
    }
    const review = live.checkIn.review(current);
    if (!trigger && review?.ready) {
      const decision = decideGateVoiceReply(text, "check_in", review);
      if (decision === "submit") void confirmCheckIn(review.key);
      else if (decision === "refuse") { live.prompts.say(GATE_VOICE_DECLINED); }
      else if (decision === "repeat") { live.promptedKey = review.key; live.prompts.say(checkInPrompt(review)); }
      else {
        // A correction is read back again once the form shows it.
        live.promptedKey = undefined;
        const consumed = live.checkIn.hear(current, text);
        live.prompts.ask(() => { if (valid(live)) syncGateReview(live, true); return null; });
        if (consumed) writeState(live, "listening");
        return Boolean(consumed);
      }
      writeState(live, "listening");
      return true;
    }
    // A "yes" before the form is complete. A sentence naming the check-in itself is dictation, not approval.
    if (!trigger && live.checkIn.active(current) && !/\bch[ei]ck(?:ing)?[ -]?in\b/i.test(text) && decideGateVoiceReply(text, "check_in") === "submit") {
      const field = missingCheckInField(review);
      if (review && !review.savable) askGate(live);
      // "Yes", "save it", "that's all": save what is there, flagged. A looser word may be an answer, so the question is asked again.
      else if (review && isGateSaveNow(text) && (!eventId || gateEntryStarted(readGateVoiceDraft()))) void confirmCheckIn(review.key);
      else if (field) live.prompts.say(checkInQuestion(field));
      writeState(live, "listening");
      return true;
    }
    const consumed = live.checkIn.hear(current, text);
    syncGateReview(live);
    if (consumed === "start") { live.pending = null; setCheckInError(null); }
    if (consumed) { writeState(live, "listening"); live.prompts.ask(nextQuestion(live)); }
    return Boolean(consumed);
  };
  const startConversation = useCallback((seed?: string, path?: string, options?: { gateFocus?: boolean }): Promise<void> => {
    const existing = liveRef.current;
    if (existing) {
      // A tap on AskV wakes her when she is paused or asleep.
      if (existing.ready) pause(existing, false);
      if (options?.gateFocus !== false && isGateVoicePage(applicationContext().path)) {
        existing.checkIn.engage(applicationContext());
        existing.mutePlayback?.(true);
        syncGateReview(existing);
      }
      const message = voiceSeedMessage(seed), ready = existing.starting ?? Promise.resolve();
      return message ? ready.then(() => { if (valid(existing) && existing.ready && !collectShiftNote(existing, message) && !collectCheckIn(existing, message)) void queueReasonedVoiceTurn(existing, message); }) : ready;
    }
    clearTimeout(retryTimer.current); retryTimer.current = undefined;
    const carried = kept.current; kept.current = null;
    // A start the operator asked for begins the reconnect waits over.
    if (!carried) ladder.current.reset();
    if (!userRef.current || AppState.currentState === "background") return Promise.resolve();
    ++preferenceVersion.current; mutedRef.current = false; setMutedState(false);
    setError(null); setState("connecting");
    const live: Live = {
      id: "sdk-" + userRef.current.id + "-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      scope: scopeRef.current, startedAt: Date.now(), abort: new AbortController(), stream: null, sdk: null, release: null,
      ready: false, token: null, config: null, starting: null, conversation: null,
      saving: Promise.resolve(), delegating: Promise.resolve(), delegateActive: false,
      saved: new Set(), queued: new Set(), lastUser: null, pending: null,
      binding: voiceContextBinding(applicationContext()), seen: new Map(), focus: createGateCheckInFocus(),
      checkIn: carried?.checkIn ?? createSilentGateCheckIn({ normalizePlateState, parseSpokenPlateState }), audioTurns: new Map(),
      promptedKey: carried?.promptedKey,
      // Gate prompts play while the microphone stays open: never switch iOS to playback-only audio.
      // The operator gets the full quiet time to answer whatever V just said.
      prompts: createGateVoicePrompter(text => { speakAskV(text, "en-US", true); armIdle(live); }),
    };
    liveRef.current = live;
    if (carried?.paused) { pausedRef.current = true; setPausedState(true); asleepRef.current = carried.asleep; setAsleep(carried.asleep); }
    if (options?.gateFocus !== false && isGateVoicePage(applicationContext().path)) {
      live.checkIn.engage(applicationContext());
      syncGateReview(live);
    } else if (carried) syncGateReview(live); // Carried over a reconnect: shown again at once, on whatever page the operator is.
    const check = () => { if (!valid(live)) throw Object.assign(new Error("Voice stopped"), { name: "AbortError" }); };
    const microphone = askVMicrophone.acquire("askv", async () => {
      if (liveRef.current === live) { liveRef.current = null; closeLive(live, "interruption"); if (mounted.current) setState("stopped"); }
    }).then(async release => {
      if (!valid(live)) { void release(); check(); }
      live.release = release;
      // Record-and-play on the loudspeaker for the whole session, so spoken prompts are
      // audible without switching iOS to playback-only audio, which stops the microphone.
      live.audioConfigured = true;
      await configureAskVAudioSession().catch(() => undefined);
      if (!valid(live)) check();
      // A microphone that will not open because it is not allowed says so, instead of "could not connect".
      const stream = await openAskVMicrophone().catch(async cause => {
        const permission = await Audio.getPermissionsAsync().catch(() => null);
        throw permission && permission.status !== "granted" ? new Error("askv.microphoneDenied") : cause;
      });
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
        // The browser preview can use a transport without this native playback hook.
        live.mutePlayback = muted => { if (typeof transport.setPlaybackMuted === "function") transport.setPlaybackMuted(muted); };
        if (live.checkIn.active(applicationContext())) live.mutePlayback(true);
        const updateSessionConfig = transport.updateSessionConfig.bind(transport);
        transport.updateSessionConfig = update => {
          const audio = "audio" in update ? update.audio : undefined;
          return updateSessionConfig({
            ...update,
            audio: { ...audio, input: { ...audio?.input, ...gateVoiceAudioInput(applicationContext().path) } },
          });
        };
        const sendEvent = transport.sendEvent.bind(transport);
        transport.sendEvent = event => {
          // Realtime transcribes and detects turns; the Responses chat path
          // owns every substantive answer and tool call. An SDK-generated
          // response here would duplicate the same spoken request.
          if (event.type !== "response.create") sendEvent(event);
        };
        const sdk = new RealtimeSession(makeAgent(live), {
          model: config.model, transport, historyStoreAudio: false,
          config: { audio: { input: gateVoiceAudioInput(nativeAskVContextPath(path ?? pathRef.current)), output: { voice: config.voice } } },
        });
        live.sdk = sdk;
        sdk.on("history_updated", history => acceptHistory(live, history));
        sdk.on("audio_start", () => { if (!live.checkIn.active(applicationContext())) writeState(live, "speaking"); });
        sdk.on("audio_stopped", () => writeState(live, "listening"));
        sdk.on("audio_interrupted", () => writeState(live, "listening"));
        const transcriptCleanup = createTranscriptCleanup(event => transport.sendEvent(event));
        sdk.on("transport_event", event => {
          if (!valid(live)) return;
          transcriptCleanup.observe(event);
          if (event.type === "conversation.item.input_audio_transcription.delta" && typeof event.item_id === "string" && typeof event.delta === "string" && isGateVoicePage(applicationContext().path)) {
            const previous = live.gateTranscript?.itemId === event.item_id ? live.gateTranscript : undefined;
            const text = ((previous?.text ?? "") + event.delta).slice(0, 128);
            const trigger = gateVoiceTrigger(text);
            live.gateTranscript = { itemId: event.item_id, text, trigger };
            if (trigger && trigger !== previous?.trigger) {
              if (trigger === "in") live.mutePlayback?.(true);
              sdk.interrupt();
            }
          }
          // A pending question waits while the operator is still talking.
          if (event.type === "input_audio_buffer.speech_started") { live.prompts.hush(); live.prompts.began(); }
          if (event.type === "conversation.item.input_audio_transcription.completed" || event.type === "conversation.item.input_audio_transcription.failed") live.prompts.heard();
          if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.item_id === "string" && typeof event.transcript === "string" && !live.audioTurns.has(event.item_id)) {
            const partial = live.gateTranscript?.itemId === event.item_id ? live.gateTranscript : undefined;
            if (partial) live.gateTranscript = undefined;
            const ignore = () => { live.audioTurns.set(event.item_id, true); transcriptCleanup.queue(event.item_id); };
            let transcript: string = event.transcript;
            const wake = askVWake(transcript);
            if (pausedRef.current) {
              // Paused: everything is background until V is called, told to continue, or given a Gate command.
              if (live.prompts.echo(transcript) || (wake === null && !(gateVoiceFormOpen(applicationContext()) && gateVoiceTrigger(transcript)))) { ignore(); return; }
              pause(live, false);
              if (wake === "") { ignore(); if (!whereLeftOff(live)) live.prompts.say("I'm listening."); return; }
              if (wake) transcript = wake;
            } else {
              // "West Gate" after "Which gate? East Gate, West Gate." is the answer, though the words are also hers.
              if (live.prompts.echo(transcript) && !(live.askingGate && matchGateChoice(readGateVoiceDraft(), transcript))) {
                // AskV's own prompt came back through the microphone.
                ignore();
                live.prompts.ask(nextQuestion(live), false);
                return;
              }
              if (isAskVPause(transcript)) { ignore(); pause(live, true); live.prompts.say("Paused."); return; }
              // "Let's finish the check-in" while she is already listening: say where it stands.
              if (wake === "" && whereLeftOff(live)) { ignore(); return; }
            }
            const collected = collectShiftNote(live, transcript) || collectCheckIn(live, transcript, Boolean(partial?.trigger && partial.trigger === gateVoiceTrigger(transcript)), event.item_id);
            live.audioTurns.set(event.item_id, collected);
            if (collected) transcriptCleanup.queue(event.item_id);
            else if (transcript.trim()) {
              live.audioTurns.set(event.item_id, true);
              transcriptCleanup.queue(event.item_id);
              messagesRef.current.delete(event.item_id);
              setVoiceMessages([...messagesRef.current.values()]);
              void queueReasonedVoiceTurn(live, transcript);
            }
            else { writeState(live, "listening"); live.prompts.ask(nextQuestion(live), false); }
          }
          if (event.type === "conversation.item.input_audio_transcription.failed" && live.gateTranscript && live.gateTranscript.itemId === event.item_id) {
            live.gateTranscript = undefined;
            syncGateReview(live);
          }
          // Background sound during a pause does not move V between listening and thinking.
          if (pausedRef.current) return;
          if (live.gateTranscript?.trigger === "in" || live.checkIn.active(applicationContext())) {
            if (event.type === "output_audio_buffer.started") sdk.interrupt();
            return;
          }
          if (event.type === "input_audio_buffer.speech_started") {
            if (speakingTextReply.current) {
              speechTurn.current += 1;
              stopAskVSpeech();
              speakingTextReply.current = false;
            }
            writeState(live, "listening");
          }
          if (event.type === "input_audio_buffer.speech_stopped" || event.type === "response.created") writeState(live, "thinking");
          if (event.type === "output_audio_buffer.started") writeState(live, "speaking");
          if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") writeState(live, "listening");
        });
        sdk.on("agent_tool_start", (_ctx, _agent, currentTool) => { if (valid(live)) setActiveTool(currentTool.name); });
        sdk.on("agent_tool_end", () => { if (valid(live)) setActiveTool(null); });
        // A refused request (a cancel that came too late) is reported as an error while the link stays up; it is not a drop.
        sdk.on("error", failure => { if (voiceErrorEndsSession(failure, live.ready && transport.status === "connected")) recover(live, "error"); });
        transport.on("connection_change", status => { if (status === "disconnected" && live.ready) recover(live, "network", "The voice connection ended. Tap AskV to retry."); });
        await sdk.connect({ apiKey: config.clientSecret }); check();
        live.ready = true; live.readyAt = Date.now(); setState("listening");
        armIdle(live);
        // A link can die without saying so, and the voice service ends every session at 60 minutes: V checks for both.
        const dead = createVoiceLinkPulse();
        const pulse = setInterval(() => {
          if (!valid(live)) { clearInterval(pulse); return; }
          if (voiceRefreshDue(Date.now() - live.readyAt!, quiet(live))) { clearInterval(pulse); carry(live, "refresh", 0); return; }
          if (typeof transport.linkReceived !== "function") return;
          void transport.linkReceived().then(received => {
            if (valid(live) && dead(received)) { clearInterval(pulse); recover(live, "network", "The voice connection ended. Tap AskV to retry."); }
          }).catch(() => undefined);
        }, VOICE_PULSE_MS);
        // The connection can stay up after iOS stops the microphone, so check that audio still leaves the phone.
        if (typeof transport.microphoneProgress === "function") {
          let last: { packetsSent: number; energy: number | null } | null = null, stalled = 0, silent = 0, heard = false;
          const watch = setInterval(() => {
            if (!valid(live)) { clearInterval(watch); return; }
            // A call holds the microphone: silence until it ends is expected.
            if (interrupted.current) { last = null; stalled = 0; silent = 0; return; }
            void transport.microphoneProgress().then(now => {
              if (!now || !valid(live) || interrupted.current) return;
              if (last) {
                stalled = now.packetsSent > last.packetsSent ? 0 : stalled + 1;
                // Exact silence only counts after this session has heard sound, so a quiet room is left alone.
                if (now.energy !== null && last.energy !== null) { if (now.energy > last.energy) { heard = true; silent = 0; } else silent += 1; }
              }
              last = now;
              if (stalled >= 2 || (heard && silent >= 6)) { clearInterval(watch); recover(live, "microphone", "The microphone stopped. Tap AskV to retry."); }
            }).catch(() => undefined);
          }, MICROPHONE_CHECK_MS);
        }
        const message = voiceSeedMessage(seed); if (message && !collectShiftNote(live, message) && !collectCheckIn(live, message)) void queueReasonedVoiceTurn(live, message);
      } catch (cause) {
        const current = valid(live);
        // Why V did not start, in the operator's words: the microphone is off, the server said no, or there is no connection.
        const text = cause instanceof Error ? cause.message : "";
        const [reason, message]: [AskVMetricReason, string] = text === "askv.microphoneDenied" ? ["permission", text]
          : text === "Not authenticated" ? ["auth", plainGateFailure(401)]
          : cause instanceof ServerRefusal ? ["unavailable", text]
          : plainGateError(cause, "") === plainGateFailure(null) ? ["network", "No connection. Tap AskV to retry."]
          : ["unavailable", "askv.voiceFailed"];
        // A reconnect that could not get through tries again after the next wait; a refusal or a blocked microphone is final.
        if (current && carried && (reason === "network" || (reason === "unavailable" && !(cause instanceof ServerRefusal && cause.status < 500)))) { recover(live, reason, message); return; }
        if (liveRef.current === live) liveRef.current = null;
        closeLive(live, reason);
        if (current) { setError(message); setState("error"); }
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
      syncGateReview(live);
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
    if (next) void stop("muted"); else void startRef.current();
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
    previousScope.current = scope; void stop("auth");
    messagesRef.current.clear(); setVoiceMessages([]); assistantRef.current.startNew(); setError(null);
  }, [scope, stop]);
  useEffect(() => {
    mounted.current = true;
    const token = subscribeToken(() => { void stop("auth"); });
    const account = subscribeUser(next => { if (scopeOf(next) !== scopeRef.current) void stop("auth"); });
    // Control Centre, a call banner or a permission prompt makes the app inactive without leaving it: V stays on.
    // The end of an interruption is not always reported, so the app becoming active again counts as the end too.
    const subscription = AppState.addEventListener("change", status => {
      if (status === "background") void stop("background"); else if (status === "active") audioBack.current();
    });
    const audio = subscribeAskVAudioInterruption(phase => { if (phase === "began") interrupted.current = Boolean(liveRef.current); else audioBack.current(); });
    return () => { mounted.current = false; token(); account(); subscription.remove(); audio(); void stop(); };
  }, [stop]);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const changed = previousPath.current !== pathname;
    const withinWorkHub = /^\/work-hub(?:\/|$)/.test(previousPath.current) && /^\/work-hub(?:\/|$)/.test(pathname);
    const requestedNavigation = changed && askVNavigation.current !== null && askVNavigation.current.expires >= Date.now();
    if (changed) askVNavigation.current = null;
    previousPath.current = pathname;
    // On the Gate page its own form takes over from the watch form.
    if (isGateVoicePage(nativeAskVContextPath(pathname))) watchDesk.close();
    const live = liveRef.current;
    if (changed && live?.ready) {
      live.pending = null;
      if (shiftNoteRef.current) setShiftNoteDraft(null);
      live.gateTranscript = undefined;
      live.checkIn.attach(applicationContext());
      if (isGateVoicePage(applicationContext().path)) live.checkIn.engage(applicationContext());
      syncGateReview(live);
      void live.sdk?.updateAgent(makeAgent(live)).catch(() => undefined);
      const carried = live.carry;
      live.carry = undefined;
      if (carried && isGateVoicePage(applicationContext().path)) collectCheckIn(live, carried);
    }
    if (changed && !requestedNavigation && !withinWorkHub && !acrossRef.current) void stop("navigation");
  }, [pathname, stop]);
  const send = useCallback(async (text: string, mode: "ios_text" | "ios_voice" = "ios_text", confirmationReference?: string, focusMode = false) => {
    const live = liveRef.current;
    if (focusMode && !confirmationReference && live && valid(live) && !mutedRef.current &&
      (collectShiftNote(live, text) || collectCheckIn(live, text))) return;
    return assistantRef.current.send(text, mode, confirmationReference, focusMode);
  }, []);
  const sendShiftNoteText = useCallback(async (text: string) => {
    const live = liveRef.current;
    if (!live || !valid(live)) return;
    if (collectShiftNote(live, text)) return;
    await live.delegating.catch(() => undefined);
    if (valid(live)) await assistantRef.current.send(text, "ios_text", undefined, true);
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
    // A reply still being worked on is never shown as listening.
    state: base.streaming && state === "listening" ? "thinking" : state, error: error ?? base.error, greeting: null, muted, acrossVndrly, wakeSupported: false, preferencesReady,
    assistant, startConversation, stop, setMuted, paused, asleep, setPaused, setAcrossVndrly, subscribeReplies,
    checkInReview, checkInSaving, checkInError, confirmCheckIn,
    shiftNoteDraft, sendShiftNoteText,
  }), [state, base.streaming, error, base.error, muted, paused, asleep, setPaused, acrossVndrly, preferencesReady, assistant, startConversation, stop, setMuted, setAcrossVndrly, subscribeReplies, checkInReview, checkInSaving, checkInError, confirmCheckIn, shiftNoteDraft, sendShiftNoteText]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAskVVoiceSession(): AskVVoiceSessionValue {
  const value = useContext(Context);
  if (!value) throw new Error("useAskVVoiceSession must be used within AskVVoiceProvider");
  return value;
}
