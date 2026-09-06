import { usePathname } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { askVMicrophone } from "@workspace/askv-wake";
import { getToken, subscribeToken, subscribeUser, type StoredUser } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useAssistant, type AssistantMessage } from "@/hooks/use-assistant";
import { createAskVRealtimeClient, type AskVRealtimeClient, type AskVTranscript } from "@/lib/askv-realtime-client";
import { configureAskVAudioSession, isAskVAppActive, releaseAskVAudioSession, requestAskVMicrophonePermission, subscribeAskVAppState } from "@/lib/askv-audio-session";
import { createLocalAskVWakeDetector, type LocalAskVWakeDetector } from "@/lib/askv-local-wake";
import { stopAskVSpeech } from "@/lib/askv-speech";
import { emitAskVDataChanged, executeAskVClientIntent } from "@/lib/askv-client-tools";
import { withAskVToolLocation, type AskVCoordinates } from "@/lib/askv-tool-location";
import { recordAskVMetric } from "@/lib/askv-voice-metrics";
import { getApiBase } from "@/lib/api";
import { ASKV_IDLE_MS, type AskVVoiceState } from "@/lib/askv-voice-state";
import { readAskVAcrossVndrly, readAskVMuted, writeAskVAcrossVndrly, writeAskVMuted } from "@/lib/askvVoicePreferences";

type Assistant = ReturnType<typeof useAssistant>;
interface AskVVoiceSessionValue {
  state: AskVVoiceState;
  error: string | null;
  greeting: string | null;
  muted: boolean;
  acrossVndrly: boolean;
  wakeSupported: boolean;
  preferencesReady: boolean;
  assistant: Assistant;
  startConversation: (seed?: string, path?: string) => Promise<void>;
  stop: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setAcrossVndrly: (enabled: boolean) => void;
  subscribeReplies: (listener: (text: string) => void) => () => void;
}
const AskVVoiceSessionContext = createContext<AskVVoiceSessionValue | null>(null);
function scopeOf(user: StoredUser | null): string {
  return user ? [user.id, user.activeMembershipId, user.role, user.partnerId, user.vendorId].join(":") : "";
}
function abortError() { return Object.assign(new Error("AskV voice stopped"), { name: "AbortError" }); }
async function post(token: string, path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(getApiBase() + "/api/assistant/" + path, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? data.error ?? "assistant.realtime_failed");
  return data;
}
type LiveSession = { sessionId: string; conversationId: number; token: string; scope: string; generation: number; startedAt: number; turnStartedAt: number; woke: boolean; hadUserTurn: boolean; firstAudio: boolean };
type PendingTranscript = AskVTranscript & { session: LiveSession };

export function AskVVoiceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const scope = scopeOf(user);
  const [state, setState] = useState<AskVVoiceState>("stopped");
  const [error, setError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [acrossVndrly, setAcross] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(false);
  const mounted = useRef(true);
  const userRef = useRef(user); userRef.current = user;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const pathRef = useRef(pathname); pathRef.current = pathname;
  const mutedRef = useRef(false);
  const acrossRef = useRef(false);
  const foregroundRef = useRef(isAskVAppActive());
  const generation = useRef(0);
  const stateRef = useRef<AskVVoiceState>("stopped");
  const startPromise = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const clientRef = useRef<AskVRealtimeClient | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const detectorRef = useRef<LocalAskVWakeDetector | null>(null);
  const releaseMicRef = useRef<(() => Promise<void>) | null>(null);
  const micLeaseRef = useRef<symbol | null>(null);
  const cleanupRef = useRef<Promise<void>>(Promise.resolve());
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSpeakingRef = useRef(false);
  const pendingCoordinates = useRef(new Map<string, AskVCoordinates>());
  const latestUserTranscript = useRef<{ sessionId: string; eventId: string } | null>(null);
  const confirmationBoundary = useRef(new Map<string, string | null>());
  const prefsRef = useRef<{ userId: number; promise: Promise<void> } | null>(null);
  const preferenceVersion = useRef(0);
  const pendingTranscripts = useRef<PendingTranscript[]>([]);
  const flushing = useRef<Promise<void> | null>(null);
  const replies = useRef(new Set<(text: string) => void>());
  const contextVersion = useRef(0);
  const contextQueue = useRef<Promise<void>>(Promise.resolve());
  const baseAssistant = useAssistant({
    onAssistantReply: text => replies.current.forEach(listener => listener(text)),
    onClientIntent: intent => executeAskVClientIntent(intent, pathRef.current),
    onMutation: emitAskVDataChanged,
  });
  const assistantRef = useRef(baseAssistant); assistantRef.current = baseAssistant;
  const startRef = useRef<(seed?: string, path?: string) => Promise<void>>(async () => {});
  const disposeRef = useRef<(next?: AskVVoiceState, keepWake?: boolean, releaseOwner?: boolean) => Promise<void>>(async () => {});

  const writeState = useCallback((next: AskVVoiceState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);
  const clearIdle = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = null;
  }, []);
  const dispose = useCallback(async (next: AskVVoiceState = "stopped", keepWake = false, releaseOwner = true) => {
    generation.current += 1;
    startPromise.current = null;
    abortRef.current?.abort(); abortRef.current = null;
    clearIdle();
    userSpeakingRef.current = false;
    pendingCoordinates.current.clear();
    latestUserTranscript.current = null; confirmationBoundary.current.clear();
    clientRef.current?.close(); clientRef.current = null;
    stopAskVSpeech();
    const session = sessionRef.current; sessionRef.current = null;
    if (session) {
      recordAskVMetric(session, "session_end", { durationMs: Date.now() - session.startedAt,
        reason: mutedRef.current ? "muted" : next === "interrupted" ? "background" : next === "error" ? "network" : "user" });
      if (session.woke && !session.hadUserTurn) recordAskVMetric(session, "false_wake", { reason: "empty_turn" });
      void post(session.token, "realtime/end", { sessionId: session.sessionId }).catch(() => undefined);
    }
    writeState(mutedRef.current ? "muted" : next);
    if (!keepWake) {
      const detector = detectorRef.current; detectorRef.current = null;
      const release = releaseMicRef.current; releaseMicRef.current = null;
      micLeaseRef.current = null;
      const earlierCleanup = cleanupRef.current;
      // Invalidate capture now, while retaining every earlier asynchronous audio reset.
      const stoppingDetector = detector?.stop().catch(() => undefined);
      const cleanup = (async () => {
        await earlierCleanup.catch(() => undefined);
        await stoppingDetector;
        await releaseAskVAudioSession().catch(() => undefined);
        if (releaseOwner) await release?.().catch(() => undefined);
      })();
      cleanupRef.current = cleanup;
      await cleanup;
    }
  }, [clearIdle, writeState]);
  disposeRef.current = dispose;
  const stop = useCallback(() => dispose(), [dispose]);

  const ensurePreferences = useCallback((id: number) => {
    if (prefsRef.current?.userId === id) return prefsRef.current.promise;
    const current = ++preferenceVersion.current;
    setPreferencesReady(false);
    const promise = Promise.all([readAskVMuted(id), readAskVAcrossVndrly(id)]).then(([savedMute, savedAcross]) => {
      if (!mounted.current || userRef.current?.id !== id || current !== preferenceVersion.current) return;
      mutedRef.current = savedMute; acrossRef.current = savedAcross;
      setMutedState(savedMute); setAcross(savedAcross); setPreferencesReady(true);
      if (savedMute) writeState("muted");
    }).catch(() => {
      if (!mounted.current || userRef.current?.id !== id) return;
      // Reading a remembered mute failed: never silently activate capture.
      mutedRef.current = true; setMutedState(true); setPreferencesReady(true);
      setError("askv.voicePreferencesFailed"); writeState("muted");
    });
    prefsRef.current = { userId: id, promise };
    return promise;
  }, [writeState]);

  const flushTranscripts = useCallback(() => {
    if (flushing.current) return flushing.current;
    const operation = (async () => {
      while (pendingTranscripts.current.length) {
        const transcript = pendingTranscripts.current[0];
        const data = await post(transcript.session.token, "voice/transcript", {
          conversationId: transcript.session.conversationId, sessionId: transcript.session.sessionId,
          eventId: transcript.eventId, role: transcript.role, content: transcript.content,
        });
        if (pendingTranscripts.current[0] !== transcript) continue;
        pendingTranscripts.current.shift();
        if (scopeRef.current === transcript.session.scope && mounted.current) {
          assistantRef.current.upsertMessage({ id: transcript.eventId, role: transcript.role, content: transcript.content, serverId: data.messageId });
        }
      }
    })();
    flushing.current = operation;
    void operation.finally(() => { if (flushing.current === operation) flushing.current = null; }).catch(() => undefined);
    return operation;
  }, []);
  const recordTranscript = useCallback((transcript: AskVTranscript, session: LiveSession) => {
    if (!mounted.current || scopeRef.current !== session.scope) return;
    if (transcript.role === "user") {
      latestUserTranscript.current = { sessionId: session.sessionId, eventId: transcript.eventId };
      if (!/^ask[\s-]?v[.!?]?$/i.test(transcript.content.trim())) session.hadUserTurn = true;
      if (/^(?:no[, ]|actually\b|correction\b)/i.test(transcript.content)) recordAskVMetric(session, "correction", { reason: "user" });
    }
    assistantRef.current.upsertMessage({ id: transcript.eventId, role: transcript.role, content: transcript.content });
    if (!pendingTranscripts.current.some(item => item.eventId === transcript.eventId)) {
      pendingTranscripts.current.push({ ...transcript, session });
    }
    void flushTranscripts().catch(() => { if (mounted.current && scopeRef.current === session.scope) setError("askv.voiceHistoryFailed"); });
  }, [flushTranscripts]);

  const syncContext = useCallback((session: LiveSession, path: string) => {
    const version = ++contextVersion.current;
    const update = contextQueue.current.catch(() => undefined).then(async () => {
      if (sessionRef.current !== session || version !== contextVersion.current) return;
      const entityId = Number(path.match(/\/(?:ticket|site|invoice)\/(\d+)/)?.[1]) || undefined;
      const data = await post(session.token, "realtime/context", { sessionId: session.sessionId, path, entityId }, abortRef.current?.signal);
      if (sessionRef.current === session && version === contextVersion.current) {
        clientRef.current?.updateContext({ ...data.context, path, tools: data.tools });
      }
    });
    contextQueue.current = update;
    return update;
  }, []);

  const startConversation = useCallback((seed?: string, path?: string): Promise<void> => {
    if (startPromise.current) return startPromise.current;
    if (clientRef.current && sessionRef.current) return Promise.resolve();
    const startUser = userRef.current;
    if (!startUser || !foregroundRef.current) return Promise.resolve();
    const currentScope = scopeRef.current;
    const current = ++generation.current;
    const startedAt = Date.now();
    const sessionId = "ios-" + startUser.id + "-" + startedAt + "-" + Math.random().toString(36).slice(2);
    let metricToken: string | undefined;
    const ac = new AbortController(); abortRef.current = ac;
    const valid = () => mounted.current && !ac.signal.aborted && generation.current === current
      && foregroundRef.current && scopeRef.current === currentScope && !mutedRef.current;
    const check = () => { if (!valid()) throw abortError(); };
    const operation = (async () => {
      try {
        await ensurePreferences(startUser.id); check();
        setError(null); writeState("connecting");
        await cleanupRef.current; check();
        await flushTranscripts(); check();
        const token = await getToken(); check();
        if (!token) throw new Error("auth.not_authenticated");
        metricToken = token;
        const capabilityResponse = await fetch(getApiBase() + "/api/assistant/voice/capabilities", {
          headers: { Authorization: "Bearer " + token }, signal: ac.signal,
        }); check();
        if (!capabilityResponse.ok) throw new Error("askv.voiceFailed");
        const capabilities = await capabilityResponse.json(); check();
        if (capabilities.enabled !== true) throw new Error("askv.naturalVoiceUnavailable");
        await requestAskVMicrophonePermission(check); check();
        // iOS can resolve the permission promise just before reporting active again.
        const permissionReturnDeadline = Date.now() + 5000;
        while (!isAskVAppActive()) {
          check();
          if (Date.now() >= permissionReturnDeadline) throw new Error("askv.voiceInterrupted");
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        check();
        if (!releaseMicRef.current) {
          const lease = Symbol("AskV microphone lease");
          const release = await askVMicrophone.acquire("askv", async () => {
            // Releasing an old lease cannot stop a newer session in this provider.
            if (micLeaseRef.current === lease) await disposeRef.current("stopped", false, false);
          });
          if (!valid()) { void release(); throw abortError(); }
          releaseMicRef.current = release;
          micLeaseRef.current = lease;
        }
        await configureAskVAudioSession(); check();
        let detector = detectorRef.current;
        let startingDetector = false;
        if (!detector) detector = createLocalAskVWakeDetector({
          onWake: () => {
            if (stateRef.current === "wake-idle" && acrossRef.current && foregroundRef.current && !mutedRef.current) {
              void startRef.current("wake AskV", pathRef.current);
            }
          },
          onError: code => {
            if (!mounted.current) return;
            setWakeSupported(false);
            setError(code === "APP_INACTIVE" || code === "AUDIO_INTERRUPTED" ? "askv.voiceInterrupted" : "askv.wakeUnavailable");
            if (startingDetector && !sessionRef.current) return;
            void disposeRef.current(code === "APP_INACTIVE" || code === "AUDIO_INTERRUPTED" ? "interrupted" : "error");
          },
        });
        if (detector) {
          detectorRef.current = detector;
          try {
            startingDetector = true;
            await detector.start(); check();
            await detector.setDetectionEnabled(false); check();
            setWakeSupported(true);
          } catch (reason) {
            check();
            await detector.stop().catch(() => undefined); check();
            detectorRef.current = null; detector = null;
            setWakeSupported(false); setError("askv.wakeUnavailable");
          } finally { startingDetector = false; }
        } else setWakeSupported(false);
        const existing = assistantRef.current.getConversationId();
        const conversation = await post(token, "voice/conversation", { ...(existing ? { conversationId: existing } : {}) }, ac.signal); check();
        const history = (conversation.messages ?? []) as Array<{ id: number; role: "user" | "assistant"; content: string }>;
        assistantRef.current.restoreConversation(conversation.conversationId, history.map(message => ({
          id: "db-" + message.id, serverId: message.id, role: message.role, content: message.content,
        })));
        const greetingData = await post(token, "voice/greeting", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, ac.signal); check();
        const spokenGreeting = typeof greetingData.text === "string" && greetingData.text.trim() ? greetingData.text : "I'm listening.";
        setGreeting(spokenGreeting);
        const session: LiveSession = {
          sessionId,
          conversationId: conversation.conversationId, token, scope: currentScope, generation: current,
          startedAt, turnStartedAt: startedAt, woke: Boolean(seed?.toLowerCase().includes("wake")), hadUserTurn: false, firstAudio: false,
        };
        sessionRef.current = session;
        const client = await createAskVRealtimeClient({
          token, sessionId: session.sessionId, conversationId: session.conversationId,
          signal: ac.signal, seedMessage: seed, path: path ?? pathRef.current,
          greeting: spokenGreeting, history, audioSource: detector?.audioSource,
          onToolCall: async call => {
            check(); clearIdle(); writeState("thinking");
            const parsed = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
            const { confirmationPhrase, confirmationEventId: _untrustedEventId, idempotencyKey, callId, ...rawArguments } = parsed ?? {};
            const stableKey = idempotencyKey ?? callId ?? call.callId;
            let confirmationEventId: string | undefined;
            const confirming = confirmationBoundary.current.has(stableKey);
            if (confirming) {
              const reply = latestUserTranscript.current;
              if (!reply || reply.sessionId !== session.sessionId || reply.eventId === confirmationBoundary.current.get(stableKey)) {
                return JSON.stringify({ requiresConfirmation: true, awaitingUserConfirmation: true, idempotencyKey: stableKey,
                  message: "Wait for the user's spoken or typed reply before continuing." });
              }
              try { await flushTranscripts(); check(); }
              catch { return JSON.stringify({ ok: false, requiresConfirmation: true, message: "The confirmation could not be saved. Nothing was changed." }); }
              confirmationEventId = reply.eventId;
            }
            let domainArguments: Record<string, unknown>;
            try {
              domainArguments = await withAskVToolLocation(call.name, rawArguments,
                confirming ? pendingCoordinates.current.get(stableKey) : undefined);
            } catch (reason) { return JSON.stringify({ ok: false, error: reason instanceof Error ? reason.message : "Location unavailable. Nothing was changed." }); }
            check();
            let data;
            try { data = await post(token, "realtime/tool-call", {
              name: call.name, arguments: domainArguments, clientSurface: "ios",
              sessionId: session.sessionId, conversationId: session.conversationId,
              callId: callId ?? call.callId, idempotencyKey: stableKey,
              ...(confirmationEventId ? { confirmationEventId } : {}),
              ...(typeof confirmationPhrase === "string" ? { confirmationPhrase } : {}),
            }, ac.signal); }
            catch (reason) {
              check();
              return JSON.stringify({ ok: false, error: reason instanceof Error ? reason.message : "The action did not complete." });
            }
            check();
            if (data.tools || data.context) {
              contextVersion.current += 1; confirmationBoundary.current.clear(); pendingCoordinates.current.clear();
              clientRef.current?.updateContext({ ...data.context, tools: data.tools });
            }
            if (data.requiresConfirmation) confirmationBoundary.current.set(stableKey, latestUserTranscript.current?.eventId ?? null);
            else confirmationBoundary.current.delete(stableKey);
            if (data.requiresConfirmation && typeof domainArguments.latitude === "number" && typeof domainArguments.longitude === "number") {
              pendingCoordinates.current.set(stableKey, { latitude: domainArguments.latitude, longitude: domainArguments.longitude });
            } else pendingCoordinates.current.delete(stableKey);
            let output = data;
            if (typeof data.output === "string") {
              try { output = JSON.parse(data.output); } catch { return data.output; }
            }
            if (output.execution === "client" && output.intent) {
              const result = await executeAskVClientIntent(output.intent, pathRef.current);
              return JSON.stringify(result);
            }
            if (data.ok === true && (data.mutating === true || (data.mutation && typeof data.mutation === "object") || Array.isArray(data.refresh)
              || Array.isArray(output.refresh) || output.visitId || output.ticketId)) emitAskVDataChanged();
            return JSON.stringify(output);
          },
          onSpeechStarted: () => {
            if (!valid()) return;
            clearIdle();
            userSpeakingRef.current = true;
            if (stateRef.current === "speaking" || stateRef.current === "greeting") {
              recordAskVMetric(session, "interruption", { reason: "user" }); clientRef.current?.interrupt();
            }
            writeState("listening");
          },
          onSpeechStopped: () => { if (valid()) { session.turnStartedAt = Date.now(); userSpeakingRef.current = false; clearIdle(); writeState("thinking"); } },
          onAudio: () => { if (valid()) {
            if (!session.firstAudio) { session.firstAudio = true; recordAskVMetric(session, "first_audio", { durationMs: Date.now() - startedAt }); }
            clearIdle(); writeState("speaking");
          } },
          onDone: () => {
            if (!valid() || userSpeakingRef.current) return;
            clearIdle(); writeState("listening");
            idleRef.current = setTimeout(() => {
              if (!valid() || stateRef.current !== "listening") return;
              recordAskVMetric(session, "idle", { reason: "timeout", durationMs: ASKV_IDLE_MS });
              if (acrossRef.current && detectorRef.current) {
                const wakeDetector = detectorRef.current;
                const closing = disposeRef.current("stopped", true);
                const wakeGeneration = generation.current;
                const canIdle = () => mounted.current && generation.current === wakeGeneration && !mutedRef.current
                  && foregroundRef.current && acrossRef.current && detectorRef.current === wakeDetector;
                void closing.then(async () => {
                  if (!canIdle()) return;
                  try { await wakeDetector.setDetectionEnabled(true); if (canIdle()) writeState("wake-idle"); }
                  catch { if (canIdle()) { setError("askv.wakeUnavailable"); await disposeRef.current("error"); } }
                });
              } else void disposeRef.current();
            }, ASKV_IDLE_MS);
          },
          onTranscript: transcript => { if (valid()) recordTranscript(transcript, session); },
          onUsage: usage => { if (valid()) recordAskVMetric(session, "turn", { usage, durationMs: Date.now() - session.turnStartedAt }); },
          onError: message => { if (valid()) { setError(message); void disposeRef.current("error"); } },
        });
        if (!valid()) { client.close(); throw abortError(); }
        clientRef.current = client;
        writeState("greeting");
        await client.connect(); check();
        recordAskVMetric(session, "session_start");
        if (session.woke) recordAskVMetric(session, "wake");
        if (!detector) recordAskVMetric(session, "fallback", { reason: "unavailable" });
        // Route changes during connection must reach the model before the next turn.
        await syncContext(session, pathRef.current); check();
        // Only playback completion can enter listening and start the five-minute timer.
      } catch (reason) {
        if ((reason as Error).name === "AbortError" || !valid()) return;
        if (metricToken && !sessionRef.current) recordAskVMetric({ token: metricToken, sessionId }, "fallback", {
          durationMs: Date.now() - startedAt,
          reason: reason instanceof Error && reason.message === "askv.microphoneDenied" ? "permission" : "unavailable",
        });
        setError(reason instanceof Error ? reason.message : "assistant.realtime_failed");
        await disposeRef.current("error");
      }
    })();
    startPromise.current = operation;
    void operation.finally(() => { if (startPromise.current === operation) startPromise.current = null; }).catch(() => undefined);
    return operation;
  }, [clearIdle, ensurePreferences, flushTranscripts, recordTranscript, syncContext, writeState]);
  startRef.current = startConversation;

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (startPromise.current) await startPromise.current;
    const session = sessionRef.current;
    const accepted = !mutedRef.current && clientRef.current?.sendText(text);
    if (accepted && session) {
      session.turnStartedAt = Date.now();
      clearIdle(); writeState("thinking");
      recordTranscript({ eventId: accepted + ":user", role: "user", content: text.trim() }, session);
      return;
    }
    try { await flushTranscripts(); await assistantRef.current.send(text); }
    catch { if (mounted.current) setError("askv.voiceHistoryFailed"); }
  }, [clearIdle, flushTranscripts, recordTranscript, writeState]);
  const setMuted = useCallback((next: boolean) => {
    preferenceVersion.current += 1;
    mutedRef.current = next; setMutedState(next); setPreferencesReady(true);
    const id = userRef.current?.id;
    if (id != null) void writeAskVMuted(id, next).catch(() => setError("askv.voicePreferencesFailed"));
    if (next) { clientRef.current?.setMicEnabled(false); void disposeRef.current("muted"); }
    else {
      writeState("stopped");
      if (pathRef.current.endsWith("/askv")) void startRef.current("unmute", pathRef.current);
    }
  }, [writeState]);
  const setAcrossVndrly = useCallback((enabled: boolean) => {
    acrossRef.current = enabled; setAcross(enabled);
    const id = userRef.current?.id;
    if (id != null) void writeAskVAcrossVndrly(id, enabled).catch(() => setError("askv.voicePreferencesFailed"));
    if (!enabled && !pathRef.current.endsWith("/askv")) void disposeRef.current();
  }, []);
  const subscribeReplies = useCallback((listener: (text: string) => void) => {
    replies.current.add(listener); return () => { replies.current.delete(listener); };
  }, []);

  useEffect(() => {
    if (user?.id) void ensurePreferences(user.id);
    else { prefsRef.current = null; setPreferencesReady(false); }
  }, [user?.id, ensurePreferences]);
  const priorScope = useRef(scope);
  useEffect(() => {
    if (priorScope.current === scope) return;
    priorScope.current = scope;
    void disposeRef.current();
    assistantRef.current.startNew();
    pendingTranscripts.current = [];
    setGreeting(null); setError(null);
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    const tokenSubscription = subscribeToken(() => { void disposeRef.current(); });
    const userSubscription = subscribeUser(next => {
      if (scopeOf(next) !== scopeRef.current) {
        scopeRef.current = scopeOf(next); userRef.current = next;
        void disposeRef.current();
      }
    });
    const subscription = subscribeAskVAppState(
      () => { foregroundRef.current = true; },
      () => { foregroundRef.current = false; void disposeRef.current("interrupted"); },
    );
    return () => {
      mounted.current = false;
      tokenSubscription(); userSubscription(); subscription.remove();
      void disposeRef.current();
    };
  }, []);
  useEffect(() => {
    if (!pathname.endsWith("/askv") && !acrossRef.current) { void disposeRef.current(); return; }
    const session = sessionRef.current;
    if (!session || mutedRef.current) return;
    pendingCoordinates.current.clear();
    confirmationBoundary.current.clear();
    void syncContext(session, pathname).catch(() => {
      if (sessionRef.current === session) { setError("askv.voiceContextFailed"); void disposeRef.current("error"); }
    });
  }, [pathname, acrossVndrly, syncContext]);

  const assistant = useMemo<Assistant>(() => ({
    ...baseAssistant, send,
    startNew: () => { void disposeRef.current(); baseAssistant.startNew(); },
    clear: async () => { await disposeRef.current(); await baseAssistant.clear(); },
  }), [baseAssistant, send]);
  const value = useMemo<AskVVoiceSessionValue>(() => ({
    state, error, greeting, muted, acrossVndrly, wakeSupported, preferencesReady, assistant,
    startConversation, stop, setMuted, setAcrossVndrly, subscribeReplies,
  }), [state, error, greeting, muted, acrossVndrly, wakeSupported, preferencesReady, assistant, startConversation, stop, setMuted, setAcrossVndrly, subscribeReplies]);
  return <AskVVoiceSessionContext.Provider value={value}>{children}</AskVVoiceSessionContext.Provider>;
}
export function useAskVVoiceSession(): AskVVoiceSessionValue {
  const session = useContext(AskVVoiceSessionContext);
  if (!session) throw new Error("useAskVVoiceSession must be used within AskVVoiceProvider");
  return session;
}
