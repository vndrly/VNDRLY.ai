import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useAssistant } from '@/hooks/use-assistant';
import { useAskVGateGuidance } from '@/hooks/use-askv-gate-guidance';
import type { GateWorkflowOffer, GateSetupProgressHint } from '@workspace/gate-booth';
import { useAskVRealtime } from '@/hooks/use-askv-realtime';
import { useAskVWakeListener } from '@/hooks/use-askv-wake-listener';
import { readAskVAcrossVndrly, readAskVMuted, writeAskVMuted } from '@/lib/askv-voice-preferences';
import { speakAskV, stopAskVSpeech } from '@/lib/askv-speech';
import { clearAskVClientDrafts } from '@/lib/askv-client-intents';
import { AskVTranscriptQueue } from '@/lib/askv-transcript-queue';
import { isAskVNaturalVoiceEnabled } from '@/lib/askv-natural-voice';
import {
  capabilityVoiceAvailability,
  currentBrowserVoiceAvailability,
  microphonePermissionAvailability,
  type AskVVoiceAvailability,
  type AskVVoiceAvailabilityStatus,
} from '@/lib/askv-voice-availability';
import { askVMicrophone } from '@workspace/askv-wake';
import { notifyGateVoiceSaved } from '@workspace/gate-booth';
import { useQueryClient } from '@tanstack/react-query';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
interface AskVVoiceSessionValue {
  state: ReturnType<typeof useAskVRealtime>['state']; error: string | null; greeting: string | null;
  muted: boolean; acrossVndrly: boolean; wakeSupported: boolean; wakeReady: boolean;
  availabilityStatus: AskVVoiceAvailabilityStatus;
  assistant?: ReturnType<typeof useAssistant>;
  setPanelOpen?: (open: boolean) => void;
  startConversation: (seed?: string, path?: string) => Promise<void>;
  closePanel: () => void; stop: () => void; setMuted: (muted: boolean) => void;
  sendText: (text: string) => Promise<void>;
}
const AskVVoiceSessionContext = createContext<AskVVoiceSessionValue | null>(null);

/** A new authentication context gets a new conversation and microphone owner. */
export function AskVVoiceBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <AskVVoiceProvider key={`${user?.userId}:${user?.role}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}`}>{children}</AskVVoiceProvider>;
}

export function AskVVoiceProvider({ children }: { children: ReactNode }) {
  const gateGuidance = useAskVGateGuidance();
  const guidanceFingerprint = JSON.stringify(gateGuidance ?? null);
  const queryClient = useQueryClient();
  const { user } = useAuth(); const [location] = useLocation();
  const userId = typeof user?.userId === 'number' ? user.userId : null;
  const [muted, setMutedState] = useState(() => userId != null && readAskVMuted(userId));
  const [acrossVndrly, setAcross] = useState(() => userId != null && readAskVAcrossVndrly(userId));
  const [foreground, setForeground] = useState(() => document.visibilityState !== 'hidden');
  const [enabled, setEnabled] = useState(isAskVNaturalVoiceEnabled);
  const [panelOpen, setPanelOpen] = useState(false);
  const browserAvailability = useMemo(currentBrowserVoiceAvailability, []);
  const [permissionAvailability, setPermissionAvailability] = useState<AskVVoiceAvailability>({ status: 'available', message: null });
  const [serverAvailability, setServerAvailability] = useState<AskVVoiceAvailability | null>(null);
  const capabilities = useRef<Promise<AskVVoiceAvailability> | undefined>(undefined);
  const startAttempt = useRef(0);
  const ensureCapabilities = useCallback(() => {
    capabilities.current ??= fetch(`${BASE}/api/assistant/voice/capabilities`, { credentials: 'include' })
      .then(async response => {
        if (!response.ok) return { status: 'connection_failed', message: response.status === 401
          ? 'Your session expired. Sign in again to use natural voice.'
          : 'AskV could not verify voice availability. Check your connection and try again.' } as AskVVoiceAvailability;
        return capabilityVoiceAvailability(await response.json());
      }).catch(() => {
        capabilities.current = undefined;
        return { status: 'connection_failed', message: 'AskV could not verify voice availability. Check your connection and try again.' } as AskVVoiceAvailability;
      });
    return capabilities.current;
  }, []);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [microphoneOwner, setMicrophoneOwner] = useState(askVMicrophone.owner);
  const spokenTurn = useRef(false);
  const assistant = useAssistant({ pageContext: { path: location }, liveUpdates: panelOpen,
    onAssistantReply: text => { if (spokenTurn.current) speakAskV(text); },
  });
  const pendingGateGuidance = useRef<GateSetupProgressHint | undefined>(undefined);
  const pendingWorkflowOffer = useRef<GateWorkflowOffer | undefined>(undefined);
  const latestAssistant = useRef(assistant); latestAssistant.current = assistant;
  const saveQueue = useRef(new AskVTranscriptQueue()); const mounted = useRef(true);
  const spokenReceipt = useRef<{ sessionId: string; eventId: string; name: string; output: string } | null>(null);
  const voice = useAskVRealtime({ acrossVndrly,
    onUserText: async text => {
      stopAskVSpeech();
      await saveQueue.current.flush();
      spokenTurn.current = true;
      try { await latestAssistant.current.send(text); }
      finally { spokenTurn.current = false; }
    },
    onGateSetupProgress: hint => { pendingGateGuidance.current = hint; },
    onGateWorkflowOffer: offer => { pendingWorkflowOffer.current = offer; },
    // Canonical Gate and ticket mutations affect multiple lists, history and maps.
    onMutation: mutation => { window.dispatchEvent(new CustomEvent('askv:data-changed', { detail: mutation })); },
    flushTranscripts: () => saveQueue.current.flush(),
    readSpokenReceipt: (sessionId, eventId, name) => {
      const receipt = spokenReceipt.current;
      return receipt?.sessionId === sessionId && receipt.eventId === eventId && receipt.name === name ? receipt.output : undefined;
    },
    prepareConversation: async signal => {
      await saveQueue.current.flush();
      return latestAssistant.current.prepareVoiceConversation(signal);
    },
    onTranscript: (message, conversationId, sessionId) => {
      const hint = message.role === 'assistant' ? pendingGateGuidance.current : undefined;
      const offer = message.role === 'assistant' ? pendingWorkflowOffer.current : undefined;
      pendingGateGuidance.current = undefined;
      pendingWorkflowOffer.current = undefined;
      latestAssistant.current.appendVoiceTranscript({ ...message, ...(hint ? { gateSetupProgress: hint } : {}), ...(offer ? { gateWorkflowOffer: offer } : {}) });
      saveQueue.current.add(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(`${BASE}/api/assistant/voice/transcript`, { method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...message, conversationId, sessionId, ...(message.spoken ? { clientSurface: 'web' } : {}) }) });
            if (!response.ok) throw new Error('Your voice transcript could not be saved. It remains visible in this session.');
            const result = await response.json() as { messageId: number; action?: { ok: boolean; toolName?: string; output?: string; submitted?: Record<string, unknown>; mutation?: { name: string; refresh: string[] } } };
            if (mounted.current) latestAssistant.current.appendVoiceTranscript(message, result.messageId);
            if (mounted.current && result.action?.toolName && result.action.output) {
              spokenReceipt.current = { sessionId, eventId: message.eventId, name: result.action.toolName, output: result.action.output };
              if (result.action.ok && result.action.toolName === 'confirm_visitor_check_in' && result.action.submitted) notifyGateVoiceSaved(result.action.submitted);
            }
            if (mounted.current && result.action?.mutation) {
              window.dispatchEvent(new CustomEvent('askv:data-changed', { detail: result.action.mutation }));
            }
            return;
          } catch (cause) { if (attempt === 1) throw cause; }
        }
      });
      void saveQueue.current.flush().then(() => { if (mounted.current) setHistoryError(null); })
        .catch(cause => { if (mounted.current) setHistoryError(cause instanceof Error ? cause.message : 'Transcript could not be saved.'); });
    },
  });
  useEffect(() => {
    if (["stopped", "error", "muted", "wake-idle"].includes(voice.state)) { pendingGateGuidance.current = undefined; pendingWorkflowOffer.current = undefined; }
  }, [voice.state]);
  const stop = useCallback(() => {
    startAttempt.current++;
    // Audio lifecycle changes must not abort an independent typed request.
    if (spokenTurn.current) latestAssistant.current.cancel();
    spokenTurn.current = false;
    stopAskVSpeech();
    voice.stop();
  }, [voice.stop]);
  const latest = useRef({ muted, foreground, userId, location, voice, acrossVndrly });
  latest.current = { muted, foreground, userId, location, voice, acrossVndrly };
  useEffect(() => askVMicrophone.subscribe(owner => {
    setMicrophoneOwner(owner);
    if (owner && !['wake', 'realtime'].includes(owner)) { startAttempt.current++; latest.current.voice.stop(); }
  }), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; startAttempt.current++; stopAskVSpeech(); clearAskVClientDrafts(); }; }, []);
  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries(); };
    window.addEventListener('askv:data-changed', refresh);
    return () => window.removeEventListener('askv:data-changed', refresh);
  }, [queryClient]);
  useEffect(() => {
    if (userId == null || !enabled) return;
    let cancelled = false;
    void ensureCapabilities().then(availability => { if (!cancelled) setServerAvailability(availability); });
    return () => { cancelled = true; };
  }, [userId, enabled, ensureCapabilities]);
  useEffect(() => {
    if (browserAvailability.status !== 'available' || !navigator.permissions?.query) return;
    let cancelled = false; let permission: PermissionStatus | undefined;
    const update = () => { if (!cancelled && permission) setPermissionAvailability(microphonePermissionAvailability(permission.state)); };
    void navigator.permissions.query({ name: 'microphone' as PermissionName }).then(result => {
      if (cancelled) return;
      permission = result; update(); permission.addEventListener?.('change', update);
    }).catch(() => undefined);
    return () => { cancelled = true; permission?.removeEventListener?.('change', update); };
  }, [browserAvailability.status]);
  useEffect(() => {
    const refresh = () => {
      const nextEnabled = isAskVNaturalVoiceEnabled(); setEnabled(nextEnabled);
      if (!nextEnabled) stop();
      if (userId == null) return;
      const nextMuted = readAskVMuted(userId); setMutedState(nextMuted); setAcross(readAskVAcrossVndrly(userId));
      if (nextMuted) { stop(); stopAskVSpeech(); }
    };
    const onMute = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: number; enabled: boolean }>).detail;
      if (detail?.userId !== userId) return;
      setMutedState(detail.enabled); latest.current.muted = detail.enabled;
      if (detail.enabled) { stop(); stopAskVSpeech(); }
    };
    const onAcross = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: number; enabled: boolean }>).detail;
      if (detail?.userId === userId) setAcross(detail.enabled);
    };
    window.addEventListener('storage', refresh); window.addEventListener('askv:muted-changed', onMute); window.addEventListener('askv:across-changed', onAcross);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('askv:muted-changed', onMute); window.removeEventListener('askv:across-changed', onAcross); };
  }, [userId, stop]);
  useEffect(() => {
    const pause = () => { latest.current.foreground = false; setForeground(false); stop(); stopAskVSpeech(); };
    const visibility = () => { if (document.visibilityState === 'hidden') pause(); else { latest.current.foreground = true; setForeground(true); } };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pause);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pause); };
  }, [stop]);
  useEffect(() => { voice.updateContext({ path: location, gateGuidance: gateGuidance ?? null }); }, [location, guidanceFingerprint, voice.updateContext]);
  const clientAvailability: AskVVoiceAvailability = !enabled
    ? { status: 'disabled_client', message: 'Natural voice is disabled in this browser.' }
    : browserAvailability.status !== 'available' ? browserAvailability
      : permissionAvailability.status !== 'available' ? permissionAvailability
        : serverAvailability ?? { status: 'available', message: null };
  const wake = useAskVWakeListener({ enabled: clientAvailability.status === 'available' && userId != null && acrossVndrly && !muted && foreground && (!microphoneOwner || microphoneOwner === 'wake') && ['stopped', 'wake-idle'].includes(voice.state),
    onWake: source => {
      const now = latest.current;
      if (!isAskVNaturalVoiceEnabled() || now.muted || !now.foreground || now.userId == null) { void source.stop(); return; }
      void now.voice.startConversation('AskV wake', now.location, source);
    },
  });
  useEffect(() => { if (wake.error) stop(); }, [wake.error, stop]);
  const startConversation = useCallback(async (seed?: string, path?: string) => {
    let now = latest.current;
    if (!isAskVNaturalVoiceEnabled() || clientAvailability.status !== 'available' || now.muted || !now.foreground || now.userId == null) return;
    const attempt = ++startAttempt.current;
    const availability = await ensureCapabilities();
    setServerAvailability(availability);
    if (availability.status !== 'available') return;
    now = latest.current;
    if (attempt !== startAttempt.current || !isAskVNaturalVoiceEnabled() || now.muted || !now.foreground || now.userId == null || !mounted.current) return;
    stopAskVSpeech(); await now.voice.startConversation(seed, path ?? now.location);
  }, [ensureCapabilities, clientAvailability.status]);
  const closePanel = useCallback(() => { if (!latest.current.acrossVndrly) stop(); }, [stop]);
  const setMuted = useCallback((next: boolean) => {
    latest.current.muted = next; setMutedState(next);
    if (latest.current.userId != null) writeAskVMuted(latest.current.userId, next);
    if (next) { stop(); stopAskVSpeech(); }
    else void startConversation('unmute');
  }, [startConversation, stop]);
  const sendText = useCallback(async (text: string) => {
    stop();
    // Typed requests never depend on the audio transport being connected.
    await latestAssistant.current.send(text);
  }, [stop]);
  const unavailable = clientAvailability.status !== 'available';
  const value = useMemo<AskVVoiceSessionValue>(() => ({ state: muted ? 'muted' : unavailable ? 'error' : voice.state,
    error: voice.error ?? wake.error ?? historyError ?? (unavailable ? clientAvailability.message : null), greeting: voice.greeting, muted, acrossVndrly,
    availabilityStatus: clientAvailability.status,
    wakeSupported: wake.supported, wakeReady: wake.ready, assistant, setPanelOpen, startConversation, closePanel,
    stop, setMuted, sendText,
  }), [voice.state, voice.error, voice.greeting, stop, wake.error, wake.supported, wake.ready, historyError, unavailable, clientAvailability.message, clientAvailability.status, muted, acrossVndrly, assistant, startConversation, closePanel, setMuted, sendText]);
  return <AskVVoiceSessionContext.Provider value={value}>{children}</AskVVoiceSessionContext.Provider>;
}
const fallback: AskVVoiceSessionValue = { state: 'stopped', error: null, greeting: null, muted: false, acrossVndrly: false,
  availabilityStatus: 'available', wakeSupported: false, wakeReady: false, setPanelOpen: () => {}, startConversation: async () => {}, closePanel: () => {}, stop: () => {}, setMuted: () => {}, sendText: async () => {} };
export function useAskVVoiceSession(): AskVVoiceSessionValue { return useContext(AskVVoiceSessionContext) ?? fallback; }
