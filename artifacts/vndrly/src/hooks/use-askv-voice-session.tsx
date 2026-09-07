import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useAssistant } from '@/hooks/use-assistant';
import { useAskVRealtime } from '@/hooks/use-askv-realtime';
import { useAskVWakeListener } from '@/hooks/use-askv-wake-listener';
import { readAskVAcrossVndrly, readAskVMuted, writeAskVMuted } from '@/lib/askv-voice-preferences';
import { stopAskVSpeech } from '@/lib/askv-speech';
import { clearAskVClientDrafts } from '@/lib/askv-client-intents';
import { AskVTranscriptQueue } from '@/lib/askv-transcript-queue';
import { isAskVNaturalVoiceEnabled } from '@/lib/askv-natural-voice';
import { askVMicrophone } from '@workspace/askv-wake';
import { useQueryClient } from '@tanstack/react-query';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
interface AskVVoiceSessionValue {
  state: ReturnType<typeof useAskVRealtime>['state']; error: string | null; greeting: string | null;
  muted: boolean; acrossVndrly: boolean; wakeSupported: boolean; wakeReady: boolean;
  assistant?: ReturnType<typeof useAssistant>;
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
  const queryClient = useQueryClient();
  const { user } = useAuth(); const [location] = useLocation();
  const userId = typeof user?.userId === 'number' ? user.userId : null;
  const [muted, setMutedState] = useState(() => userId != null && readAskVMuted(userId));
  const [acrossVndrly, setAcross] = useState(() => userId != null && readAskVAcrossVndrly(userId));
  const [foreground, setForeground] = useState(() => document.visibilityState !== 'hidden');
  const [enabled, setEnabled] = useState(isAskVNaturalVoiceEnabled);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const capabilities = useRef<Promise<boolean> | undefined>(undefined);
  const startAttempt = useRef(0);
  const ensureCapabilities = useCallback(() => {
    capabilities.current ??= fetch(`${BASE}/api/assistant/voice/capabilities`, { credentials: 'include' })
      .then(async response => response.ok && (await response.json()).enabled === true).catch(() => false);
    return capabilities.current;
  }, []);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [microphoneOwner, setMicrophoneOwner] = useState(askVMicrophone.owner);
  const assistant = useAssistant({ pageContext: { path: location } });
  const latestAssistant = useRef(assistant); latestAssistant.current = assistant;
  const saveQueue = useRef(new AskVTranscriptQueue()); const mounted = useRef(true);
  const voice = useAskVRealtime({ acrossVndrly,
    // Canonical Gate and ticket mutations affect multiple lists, history and maps.
    onMutation: mutation => { window.dispatchEvent(new CustomEvent('askv:data-changed', { detail: mutation })); },
    flushTranscripts: () => saveQueue.current.flush(),
    prepareConversation: async signal => {
      await saveQueue.current.flush();
      return latestAssistant.current.prepareVoiceConversation(signal);
    },
    onTranscript: (message, conversationId, sessionId) => {
      latestAssistant.current.appendVoiceTranscript(message);
      saveQueue.current.add(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(`${BASE}/api/assistant/voice/transcript`, { method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...message, conversationId, sessionId }) });
            if (!response.ok) throw new Error('Your voice transcript could not be saved. It remains visible in this session.');
            const result = await response.json() as { messageId: number };
            if (mounted.current) latestAssistant.current.appendVoiceTranscript(message, result.messageId);
            return;
          } catch (cause) { if (attempt === 1) throw cause; }
        }
      });
      void saveQueue.current.flush().then(() => { if (mounted.current) setHistoryError(null); })
        .catch(cause => { if (mounted.current) setHistoryError(cause instanceof Error ? cause.message : 'Transcript could not be saved.'); });
    },
  });
  const stop = useCallback(() => { startAttempt.current++; voice.stop(); }, [voice.stop]);
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
    void ensureCapabilities().then(available => { if (!cancelled) setServerEnabled(available); });
    return () => { cancelled = true; };
  }, [userId, enabled, ensureCapabilities]);
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
  useEffect(() => { voice.updateContext({ path: location }); }, [location, voice.updateContext]);
  const wake = useAskVWakeListener({ enabled: enabled && serverEnabled === true && userId != null && acrossVndrly && !muted && foreground && (!microphoneOwner || microphoneOwner === 'wake') && ['stopped', 'wake-idle'].includes(voice.state),
    onWake: source => {
      const now = latest.current;
      if (!isAskVNaturalVoiceEnabled() || now.muted || !now.foreground || now.userId == null) { void source.stop(); return; }
      void now.voice.startConversation('AskV wake', now.location, source);
    },
  });
  useEffect(() => { if (wake.error) stop(); }, [wake.error, stop]);
  const startConversation = useCallback(async (seed?: string, path?: string) => {
    let now = latest.current;
    if (!isAskVNaturalVoiceEnabled() || now.muted || !now.foreground || now.userId == null) return;
    const attempt = ++startAttempt.current;
    if (!await ensureCapabilities()) { setServerEnabled(false); return; }
    now = latest.current;
    if (attempt !== startAttempt.current || !isAskVNaturalVoiceEnabled() || now.muted || !now.foreground || now.userId == null || !mounted.current) return;
    stopAskVSpeech(); await now.voice.startConversation(seed, path ?? now.location);
  }, [ensureCapabilities]);
  const closePanel = useCallback(() => { if (!latest.current.acrossVndrly) stop(); }, [stop]);
  const setMuted = useCallback((next: boolean) => {
    latest.current.muted = next; setMutedState(next);
    if (latest.current.userId != null) writeAskVMuted(latest.current.userId, next);
    if (next) { stop(); stopAskVSpeech(); }
    else void startConversation('unmute');
  }, [startConversation, stop]);
  const sendText = useCallback(async (text: string) => {
    if (latest.current.voice.sendText(text)) return;
    stop();
    try { await saveQueue.current.flush(); await latestAssistant.current.send(text); }
    catch { setHistoryError('Your previous voice turn is still waiting to save. Reconnect and retry your message.'); }
  }, [stop]);
  const unavailable = !enabled || serverEnabled === false;
  const value = useMemo<AskVVoiceSessionValue>(() => ({ state: muted ? 'muted' : unavailable ? 'error' : voice.state,
    error: voice.error ?? wake.error ?? historyError ?? (unavailable ? 'Natural voice is unavailable. You can type or use the microphone recording option.' : null), greeting: voice.greeting, muted, acrossVndrly,
    wakeSupported: wake.supported, wakeReady: wake.ready, assistant, startConversation, closePanel,
    stop, setMuted, sendText,
  }), [voice.state, voice.error, voice.greeting, stop, wake.error, wake.supported, wake.ready, historyError, unavailable, muted, acrossVndrly, assistant, startConversation, closePanel, setMuted, sendText]);
  return <AskVVoiceSessionContext.Provider value={value}>{children}</AskVVoiceSessionContext.Provider>;
}
const fallback: AskVVoiceSessionValue = { state: 'stopped', error: null, greeting: null, muted: false, acrossVndrly: false,
  wakeSupported: false, wakeReady: false, startConversation: async () => {}, closePanel: () => {}, stop: () => {}, setMuted: () => {}, sendText: async () => {} };
export function useAskVVoiceSession(): AskVVoiceSessionValue { return useContext(AskVVoiceSessionContext) ?? fallback; }
