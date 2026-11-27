import { waitForGateCapture } from "@workspace/gate-booth";
import { router, usePathname } from "expo-router";
import { AppState } from "react-native";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeAgent, RealtimeSession, tool, type RealtimeItem } from "@workspace/askv-realtime-sdk";
import { voiceApplicationInstructions, voiceSeedMessage, privateVoiceContext, voiceContextBinding, isQuickShiftNote, voiceQuickNoteInstructions } from "@workspace/askv-realtime-sdk/app-context";
import { readVoicePageContext, subscribeVoicePageContext } from "@workspace/gate-booth";
import { askVMicrophone } from "@workspace/askv-wake";
import { normalizePlateState, parseSpokenPlateState } from "@workspace/plate-state";
import { confirmGateCheckIn, gateVoiceAudioInput, gateVoiceTrigger, gateCheckOutQuery, checkInQuestion, missingCheckInField, createGateVoicePrompter, isGateVoicePage, createSilentGateCheckIn, readGateVoiceDraft, subscribeGateVoiceDraft, notifyGateVoiceSaved, fillGateVoiceDraft, cancelGateVoiceDraft, createGateCheckInFocus, gateCheckInFocusAvailable, readGateVoiceGuidance, subscribeGateVoiceGuidance, parseGateSetupProgressHint, parseGateWorkflowOffer, publishGateVoiceWorkflowResult, gateWorkflowToolArguments, decideGateVoiceReply, checkInPrompt, checkInReceipt, checkoutSpeech, CHECK_OUT_PROMPT, GATE_VOICE_DECLINED } from "@workspace/gate-booth";
import { createTranscriptCleanup } from "@workspace/askv-realtime-sdk/transcript-cleanup";
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
import { speakAskV, stopAskVSpeech } from "@/lib/askv-speech";
import { configureAskVAudioSession, releaseAskVAudioSession } from "@/lib/askv-audio-session";
import { preparedShiftNoteMatchesDraft, reviseShiftNote, shiftNoteDecision, shiftNoteFromCommand } from "@/lib/askv-shift-note-draft";

type Assistant = ReturnType<typeof useAssistant>;
interface AskVVoiceSessionValue {
  state: AskVVoiceState; error: string | null; greeting: string | null;
  muted: boolean; acrossVndrly: boolean; wakeSupported: boolean; preferencesReady: boolean;
  assistant: Assistant;
  startConversation: (seed?: string, path?: string, options?: { gateFocus?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  setMuted: (muted: boolean) => void;
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
  id: string; scope: string; abort: AbortController; stream: AskVMicrophone | null;
  sdk: RealtimeSession | null; release: (() => Promise<void>) | null; ready: boolean;
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
};
const Context = createContext<AskVVoiceSessionValue | null>(null);
const OTHER_GATE_SCREEN = /^\/mobile\/(?:change-over|gate-history|gate-map|shift-notes)(?:[/?#]|$)/;
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
  const closeLive = useCallback((live: Live) => {
    live.prompts.hush();
    live.abort.abort(); live.ready = false;
    try { live.sdk?.close(); } finally { stopStream(live.stream); live.stream = null; }
    const release = live.release; live.release = null;
    const configured = live.audioConfigured; live.audioConfigured = false;
    void (configured ? releaseAskVAudioSession().catch(() => undefined) : Promise.resolve()).then(() => release?.()).catch(() => undefined);
  }, []);
  const stop = useCallback(async () => {
    metadata.current = {};
    askVNavigation.current = null;
    pendingVoiceReply.current = null;
    speechTurn.current += 1;
    if (speakingTextReply.current) stopAskVSpeech();
    speakingTextReply.current = false;
    setShiftNoteDraft(null);
    const live = liveRef.current; liveRef.current = null;
    if (live?.delegateActive) assistantRef.current.stopGeneration();
    if (live) closeLive(live);
    if (mounted.current) { setState("stopped"); setActiveTool(null); setCheckInReview(null); setCheckInSaving(false); setCheckInError(null); }
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
      try { await assistantRef.current.send(utterance, "ios_voice", confirmationReference, true); }
      finally {
        live.delegateActive = false;
        if (pendingVoiceReply.current === live.id) {
          pendingVoiceReply.current = null;
          writeState(live, "listening");
        }
      }
    });
    live.delegating = queued.catch(error => {
      if (valid(live)) setError(error instanceof Error ? error.message : "askv.voiceFailed");
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
          return JSON.stringify(output);
        },
      })),
    });
  }
  const syncGateReview = (live: Live, settled = false) => {
    const current = applicationContext();
    live.mutePlayback?.(live.gateTranscript?.trigger === "in" || live.checkIn.active(current));
    const review = live.checkIn.review(current);
    // Read the complete form back once, and never while the operator is mid-sentence.
    // A short tag may be the first piece of one still being read aloud: wait for the pause.
    if (review?.ready && review.key !== live.promptedKey && !live.prompts.busy() && (settled || review.vehiclePlate.length > 4)) { live.promptedKey = review.key; live.prompts.say(checkInPrompt(review)); }
    setCheckInReview(previous => previous?.key === review?.key ? previous : review);
  };
  /** The one-word question for the next missing check-in field, once "check in" was said. */
  const nextQuestion = (live: Live) => () => {
    if (!valid(live)) return null;
    // A read-back that was held while the operator was talking is due now.
    syncGateReview(live, true);
    const field = live.checkIn.pending(applicationContext());
    return field ? checkInQuestion(field) : null;
  };
  const confirmCheckIn = useCallback(async (key: string) => {
    const live = liveRef.current;
    if (!live?.ready || !valid(live) || live.confirming) return;
    const review = live.checkIn.review(applicationContext());
    if (!review?.ready || review.key !== key) return;
    live.confirming = true;
    setCheckInSaving(true); setCheckInError(null);
    try {
      await confirmGateCheckIn(key);
      if (valid(live)) { live.promptedKey = review.key; live.prompts.say(checkInReceipt(review)); syncGateReview(live); }
    } catch (error) {
      // The operator is not looking at the screen: say why it was not saved.
      const message = error instanceof Error ? error.message : "Check-in could not be saved.";
      if (valid(live)) { setCheckInError(message); live.prompts.say(message); }
    } finally {
      live.confirming = false;
      if (valid(live)) setCheckInSaving(false);
    }
  }, []);
  const collectCheckIn = (live: Live, text: string, interrupted = false, eventId?: string) => {
    const current = applicationContext();
    const spoken = gateVoiceTrigger(text);
    live.heard = { eventId: eventId ?? "typed-" + Date.now() + "-" + Math.random().toString(36).slice(2), text };
    // "Check in" or "check out" said on another Gate screen opens the Gate form and continues there.
    if (spoken && !isGateVoicePage(current.path) && OTHER_GATE_SCREEN.test(current.path)) {
      live.carry = text;
      askVNavigation.current = { expires: Date.now() + 10_000 };
      router.push("/(tabs)/gate" as never);
      writeState(live, "listening");
      return true;
    }
    const trigger = isGateVoicePage(current.path) ? spoken : undefined;
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
          } else if (valid(live)) live.prompts.say(prepared.needsChoice ? "Which visitor?" : "No matching visitor found.");
        })().catch(() => { if (valid(live)) live.prompts.say("Checkout failed."); })
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
      setCheckInError("Complete the name, company, plate and issuing state before confirming.");
      if (field) live.prompts.say(checkInQuestion(field));
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
      if (options?.gateFocus !== false && isGateVoicePage(applicationContext().path)) {
        existing.checkIn.engage(applicationContext());
        existing.mutePlayback?.(true);
        syncGateReview(existing);
      }
      const message = voiceSeedMessage(seed), ready = existing.starting ?? Promise.resolve();
      return message ? ready.then(() => { if (valid(existing) && existing.ready && !collectShiftNote(existing, message) && !collectCheckIn(existing, message)) void queueReasonedVoiceTurn(existing, message); }) : ready;
    }
    if (!userRef.current || AppState.currentState === "background") return Promise.resolve();
    ++preferenceVersion.current; mutedRef.current = false; setMutedState(false);
    setError(null); setState("connecting");
    const live: Live = {
      id: "sdk-" + userRef.current.id + "-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      scope: scopeRef.current, abort: new AbortController(), stream: null, sdk: null, release: null,
      ready: false, token: null, config: null, starting: null, conversation: null,
      saving: Promise.resolve(), delegating: Promise.resolve(), delegateActive: false,
      saved: new Set(), queued: new Set(), lastUser: null, pending: null,
      binding: voiceContextBinding(applicationContext()), seen: new Map(), focus: createGateCheckInFocus(),
      checkIn: createSilentGateCheckIn({ normalizePlateState, parseSpokenPlateState }), audioTurns: new Map(),
      // Gate prompts play while the microphone stays open: never switch iOS to playback-only audio.
      prompts: createGateVoicePrompter(text => speakAskV(text, "en-US", true)),
    };
    liveRef.current = live;
    if (options?.gateFocus !== false && isGateVoicePage(applicationContext().path)) {
      live.checkIn.engage(applicationContext());
      syncGateReview(live);
    }
    const check = () => { if (!valid(live)) throw Object.assign(new Error("Voice stopped"), { name: "AbortError" }); };
    const microphone = askVMicrophone.acquire("askv", async () => {
      if (liveRef.current === live) { liveRef.current = null; closeLive(live); if (mounted.current) setState("stopped"); }
    }).then(async release => {
      if (!valid(live)) { void release(); check(); }
      live.release = release;
      // Record-and-play on the loudspeaker for the whole session, so spoken prompts are
      // audible without switching iOS to playback-only audio, which stops the microphone.
      live.audioConfigured = true;
      await configureAskVAudioSession().catch(() => undefined);
      if (!valid(live)) check();
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
            if (live.prompts.echo(event.transcript)) {
              // AskV's own prompt came back through the microphone.
              live.audioTurns.set(event.item_id, true);
              transcriptCleanup.queue(event.item_id);
              live.prompts.ask(nextQuestion(live), false);
              return;
            }
            const collected = collectShiftNote(live, event.transcript) || collectCheckIn(live, event.transcript, Boolean(partial?.trigger && partial.trigger === gateVoiceTrigger(event.transcript)), event.item_id);
            live.audioTurns.set(event.item_id, collected);
            if (collected) transcriptCleanup.queue(event.item_id);
            else if (event.transcript.trim()) {
              live.audioTurns.set(event.item_id, true);
              transcriptCleanup.queue(event.item_id);
              messagesRef.current.delete(event.item_id);
              setVoiceMessages([...messagesRef.current.values()]);
              void queueReasonedVoiceTurn(live, event.transcript);
            }
            else { writeState(live, "listening"); live.prompts.ask(nextQuestion(live), false); }
          }
          if (event.type === "conversation.item.input_audio_transcription.failed" && live.gateTranscript && live.gateTranscript.itemId === event.item_id) {
            live.gateTranscript = undefined;
            syncGateReview(live);
          }
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
        const message = voiceSeedMessage(seed); if (message && !collectShiftNote(live, message) && !collectCheckIn(live, message)) void queueReasonedVoiceTurn(live, message);
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
    const withinWorkHub = /^\/work-hub(?:\/|$)/.test(previousPath.current) && /^\/work-hub(?:\/|$)/.test(pathname);
    const requestedNavigation = changed && askVNavigation.current !== null && askVNavigation.current.expires >= Date.now();
    if (changed) askVNavigation.current = null;
    previousPath.current = pathname;
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
    if (changed && !requestedNavigation && !withinWorkHub && !acrossRef.current) void stop();
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
    state, error: error ?? base.error, greeting: null, muted, acrossVndrly, wakeSupported: false, preferencesReady,
    assistant, startConversation, stop, setMuted, setAcrossVndrly, subscribeReplies,
    checkInReview, checkInSaving, checkInError, confirmCheckIn,
    shiftNoteDraft, sendShiftNoteText,
  }), [state, error, base.error, muted, acrossVndrly, preferencesReady, assistant, startConversation, stop, setMuted, setAcrossVndrly, subscribeReplies, checkInReview, checkInSaving, checkInError, confirmCheckIn, shiftNoteDraft, sendShiftNoteText]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAskVVoiceSession(): AskVVoiceSessionValue {
  const value = useContext(Context);
  if (!value) throw new Error("useAskVVoiceSession must be used within AskVVoiceProvider");
  return value;
}
