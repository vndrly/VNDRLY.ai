import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { privateVoiceContext, voiceContextBinding } from "@workspace/askv-realtime-sdk/app-context";
import { shouldOfferAskVVisualResult } from "@workspace/api-client-react/askv-visual-results";
import { useAuth } from "@/hooks/use-auth";
import { useAssistant, type AssistantMessage } from "@/hooks/use-assistant";
import { useAskVGateGuidance } from "@/hooks/use-askv-gate-guidance";
import { useAskVRealtime, type VoiceTranscript } from "@/hooks/use-askv-realtime";
import { readAskVAcrossVndrly, readAskVMuted, writeAskVMuted } from "@/lib/askv-voice-preferences";
import { clearAskVClientDrafts } from "@/lib/askv-client-intents";
import { currentBrowserVoiceAvailability, type AskVVoiceAvailabilityStatus } from "@/lib/askv-voice-availability";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
interface AskVVoiceSessionValue {
  state: ReturnType<typeof useAskVRealtime>["state"]; error: string | null; greeting: string | null;
  muted: boolean; acrossVndrly: boolean; wakeSupported: boolean; wakeReady: boolean;
  availabilityStatus: AskVVoiceAvailabilityStatus; assistant?: ReturnType<typeof useAssistant>;
  setPanelOpen?: (open: boolean) => void;
  startConversation: (seed?: string, path?: string) => Promise<void>;
  closePanel: () => void; stop: () => void; setMuted: (muted: boolean) => void; sendText: (text: string) => Promise<void>;
}
const Context = createContext<AskVVoiceSessionValue | null>(null);
export function AskVVoiceBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <AskVVoiceProvider key={`${user?.userId}:${user?.role}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}`}>{children}</AskVVoiceProvider>;
}

export function AskVVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth(); const [location] = useLocation(); const queryClient = useQueryClient();
  const gateGuidance = useAskVGateGuidance();
  const userId = user?.userId ?? null;
  const [muted, setMutedState] = useState(() => userId != null && readAskVMuted(userId));
  const [acrossVndrly, setAcross] = useState(() => userId != null && readAskVAcrossVndrly(userId));
  const [panelOpen, setPanelOpen] = useState(false);
  const availability = useMemo(currentBrowserVoiceAvailability, []);
  const base = useAssistant({ pageContext: { path: location }, liveUpdates: panelOpen });
  const baseRef = useRef(base); baseRef.current = base;
  const mounted = useRef(true), current = useRef({ userId, location, muted, acrossVndrly });
  current.current = { userId, location, muted, acrossVndrly };
  const messages = useRef(new Map<string, AssistantMessage>());
  const metadata = useRef<Partial<AssistantMessage>>({});
  const histories = useRef(new Map<string, { conversation: Promise<number> | null; saving: Promise<void>; saved: Set<string>; queued: Set<string> }>());
  function persist(message: AssistantMessage, sessionId: string) {
    const context = baseRef.current.getApplicationContext();
    if (privateVoiceContext(context) || message.pending || !message.content.trim()) return;
    const binding = voiceContextBinding(context);
    let history = histories.current.get(sessionId);
    if (!history) { history = { conversation: null, saving: Promise.resolve(), saved: new Set(), queued: new Set() }; histories.current.set(sessionId, history); }
    if (history.saved.has(message.id) || history.queued.has(message.id)) return;
    history.queued.add(message.id);
    const valid = () => mounted.current && binding === voiceContextBinding(baseRef.current.getApplicationContext()) && !privateVoiceContext(baseRef.current.getApplicationContext());
    history.saving = history.saving.catch(() => undefined).then(async () => {
      if (!valid()) return;
      if (!history!.conversation) {
        history!.conversation = (async () => {
          const response = await fetch(`${BASE}/api/assistant/voice/conversation`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: baseRef.current.getConversationId() }) });
          if (!response.ok) throw new Error("Transcript storage unavailable");
          const value = await response.json(); if (valid()) baseRef.current.adoptVoiceConversation(value.conversationId);
          return value.conversationId as number;
        })();
        void history!.conversation.catch(() => { history!.conversation = null; });
      }
      const conversationId = await history!.conversation;
      if (!valid()) return;
      const response = await fetch(`${BASE}/api/assistant/voice/transcript`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, sessionId, eventId: message.id, role: message.role, content: message.content, clientSurface: "web", spoken: false,
          gateSetupProgress: message.gateSetupProgress, gateWorkflowOffer: message.gateWorkflowOffer, selectedConnection: context.selectedConnection }) });
      if (!response.ok) throw new Error("Transcript storage unavailable");
      const result = await response.json(); history!.saved.add(message.id);
      if (valid()) { const latest = messages.current.get(message.id) ?? message; messages.current.set(message.id, { ...latest, serverId: result.messageId }); baseRef.current.appendVoiceTranscript({ ...latest, eventId: message.id }, result.messageId); }
    });
    void history.saving.finally(() => history!.queued.delete(message.id)).catch(() => undefined);
  }
  const voice = useAskVRealtime({
    readApplicationContext: () => baseRef.current.getApplicationContext(),
    onGateSetupProgress: gateSetupProgress => { metadata.current.gateSetupProgress = gateSetupProgress; },
    onGateWorkflowOffer: gateWorkflowOffer => { metadata.current.gateWorkflowOffer = gateWorkflowOffer; },
    onToolResult: result => {
      metadata.current.toolCalls = [...(metadata.current.toolCalls ?? []), { name: result.name, input: result.input, output: result.output }];
      if (result.recovery) metadata.current.recovery = result.recovery;
    },
    onMutation: mutation => window.dispatchEvent(new CustomEvent("askv:data-changed", { detail: mutation })),
    onTranscript: (message: VoiceTranscript, sessionId) => {
      const prior = messages.current.get(message.eventId);
      const value: AssistantMessage = { ...prior, ...(message.role === "assistant" ? metadata.current : {}), id: message.eventId, role: message.role, content: message.content, pending: message.pending };
      if (message.role === "assistant" && !message.pending) metadata.current = {};
      messages.current.set(value.id, value); baseRef.current.appendVoiceTranscript({ ...value, eventId: value.id });
      if (value.role === "assistant" && !value.pending && prior?.pending !== false && shouldOfferAskVVisualResult(value.content)) window.dispatchEvent(new CustomEvent("askv:show-results"));
      persist(value, sessionId);
    },
  });
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const startConversation = useCallback(async (seed?: string, path?: string) => {
    const now = current.current;
    if (now.userId == null || now.muted || document.visibilityState === "hidden") return;
    await voiceRef.current.startConversation(seed, path ?? now.location);
  }, []);
  const stop = useCallback(() => { metadata.current = {}; voiceRef.current.stop(); }, []);
  const closePanel = useCallback(() => { if (!current.current.acrossVndrly) stop(); }, [stop]);
  const setMuted = useCallback((next: boolean) => {
    current.current.muted = next; setMutedState(next);
    if (current.current.userId != null) writeAskVMuted(current.current.userId, next);
    if (next) stop(); else void startConversation();
  }, [stop, startConversation]);
  const sendText = useCallback(async (text: string) => {
    if (voiceRef.current.sendText(text)) return;
    await baseRef.current.send(text);
  }, []);
  const binding = voiceContextBinding(base.getApplicationContext());
  const previousBinding = useRef(binding);
  useEffect(() => {
    if (previousBinding.current === binding) return;
    previousBinding.current = binding;
    const running = !["stopped", "error", "muted"].includes(voiceRef.current.state);
    stop(); // A fresh SDK history keeps private connection content out of later company turns.
    if (running) void startConversation();
  }, [binding, stop, startConversation]);
  useEffect(() => { voice.updateContext({ path: location, gateGuidance: gateGuidance ?? null }); }, [location, JSON.stringify(gateGuidance ?? null), voice.updateContext]);
  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries(); };
    window.addEventListener("askv:data-changed", refresh); return () => window.removeEventListener("askv:data-changed", refresh);
  }, [queryClient]);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === "hidden") stop(); };
    const refresh = () => { if (userId == null) return; const mute = readAskVMuted(userId); current.current.muted = mute; setMutedState(mute); setAcross(readAskVAcrossVndrly(userId)); if (mute) stop(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", stop);
    window.addEventListener("storage", refresh); window.addEventListener("askv:muted-changed", refresh); window.addEventListener("askv:across-changed", refresh);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", stop); window.removeEventListener("storage", refresh); window.removeEventListener("askv:muted-changed", refresh); window.removeEventListener("askv:across-changed", refresh); };
  }, [userId, stop]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearAskVClientDrafts(); }; }, []);
  const assistant = { ...base, send: async (text: string, mode?: "web_text" | "web_voice", confirmationReference?: string) => {
    if (!confirmationReference && voiceRef.current.sendText(text)) return;
    return base.send(text, mode, confirmationReference);
  }, activeTool: voice.activeTool ?? base.activeTool,
    startNew: () => { stop(); messages.current.clear(); base.startNew(); }, clear: async () => { stop(); messages.current.clear(); await base.clear(); } };
  const value: AskVVoiceSessionValue = { state: muted ? "muted" : voice.state, error: voice.error, greeting: null, muted, acrossVndrly,
    wakeSupported: false, wakeReady: false, availabilityStatus: availability.status, assistant, setPanelOpen, startConversation, closePanel, stop, setMuted, sendText };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
const fallback: AskVVoiceSessionValue = { state: "stopped", error: null, greeting: null, muted: false, acrossVndrly: false, wakeSupported: false, wakeReady: false, availabilityStatus: "available", startConversation: async () => {}, stop: () => {}, closePanel: () => {}, setMuted: () => {}, sendText: async () => {} };
export function useAskVVoiceSession(): AskVVoiceSessionValue { return useContext(Context) ?? fallback; }
