import { useCallback, useEffect, useRef, useState } from 'react';
import type { WakeAudioSource } from '@workspace/askv-wake';
import { applyAskVClientIntent, parseAskVClientIntent } from '@/lib/askv-client-intents';
import { createAskVRealtimeClient, type AskVRealtimeClient, type VoiceTranscript } from '@/lib/askv-realtime-client';
import { ASKV_IDLE_MS, type AskVVoiceState } from '@/lib/askv-voice-state';
import { addAskVToolLocation } from '@/lib/askv-tool-location';
import { createAskVVoiceMetrics } from '@/lib/askv-voice-metrics';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export type AskVRealtimeState = AskVVoiceState;
type Conversation = { conversationId: number; messages: Array<{ role: 'user' | 'assistant'; content: string }> };
export function useAskVRealtime(args?: {
  acrossVndrly?: boolean;
  prepareConversation?: (signal: AbortSignal) => Promise<Conversation>;
  onTranscript?: (message: VoiceTranscript, conversationId: number, sessionId: string) => void;
  flushTranscripts?: () => Promise<void>;
  onMutation?: (mutation: { name: string; refresh: string[] }) => void;
}) {
  const latest = useRef(args); latest.current = args;
  const [state, setState] = useState<AskVVoiceState>('stopped');
  const [error, setError] = useState<string | null>(null), [greeting, setGreeting] = useState<string | null>(null);
  const current = useRef<AskVVoiceState>('stopped'), generation = useRef(0);
  const client = useRef<AskVRealtimeClient | null>(null), abort = useRef<AbortController | null>(null);
  const session = useRef<string | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const source = useRef<WakeAudioSource | undefined>(undefined);
  const userSpeaking = useRef(false);
  const metrics = useRef<ReturnType<typeof createAskVVoiceMetrics> | undefined>(undefined);
  const latestContext = useRef<Parameters<AskVRealtimeClient['updateContext']>[0] | undefined>(undefined);
  const transition = useCallback((next: AskVVoiceState) => { current.current = next; setState(next); }, []);
  const clearIdle = useCallback(() => { clearTimeout(timer.current); timer.current = undefined; }, []);
  const stop = useCallback(() => {
    metrics.current?.end(); metrics.current = undefined;
    generation.current++; clearIdle(); abort.current?.abort(); abort.current = null;
    userSpeaking.current = false;
    client.current?.close(); client.current = null; void source.current?.stop(); source.current = undefined;
    const ended = session.current; session.current = null;
    if (ended) void fetch(`${BASE}/api/assistant/realtime/end`, { method: 'POST', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: ended }),
    }).catch(() => undefined);
    transition('stopped');
  }, [clearIdle, transition]);
  const armIdle = useCallback(() => {
    clearIdle(); timer.current = setTimeout(() => {
      metrics.current?.event('idle', { reason: 'timeout', durationMs: ASKV_IDLE_MS });
      stop(); if (latest.current?.acrossVndrly) transition('wake-idle');
    }, ASKV_IDLE_MS);
  }, [clearIdle, stop, transition]);
  useEffect(() => stop, [stop]);
  const startConversation = useCallback(async (seedMessage?: string, path?: string, audioSource?: WakeAudioSource) => {
    if (!['stopped', 'muted', 'error', 'wake-idle'].includes(current.current)) { void audioSource?.stop(); return; }
    const attempt = ++generation.current, controller = new AbortController(); abort.current = controller; source.current = audioSource;
    const valid = () => attempt === generation.current && !controller.signal.aborted;
    transition('connecting'); setError(null);
    const sessionId = crypto.randomUUID(); session.current = sessionId;
    metrics.current = createAskVVoiceMetrics(sessionId, Date.now(), !!audioSource);
    const deadline = setTimeout(() => {
      if (valid()) { stop(); setError('AskV took too long to connect. You can still type.'); transition('error'); }
    }, 30000);
    try {
      const conversation = latest.current?.prepareConversation
        ? await latest.current.prepareConversation(controller.signal)
        : await fetch(`${BASE}/api/assistant/voice/conversation`, { method: 'POST', credentials: 'include', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(async r => { if (!r.ok) throw new Error('Could not restore your conversation.'); return r.json() as Promise<Conversation>; });
      if (!valid()) return;
      metrics.current?.start(conversation.conversationId);
      const response = await fetch(`${BASE}/api/assistant/voice/greeting`, { method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      if (!response.ok) throw new Error('AskV could not start. You can still type.');
      const data = await response.json() as { text?: string }; if (!valid()) return;
      const text = data.text ?? "I'm listening."; setGreeting(text);
      let lastUserTranscript: VoiceTranscript | undefined;
      const pendingConfirmations = new Map<string, { key: string; arguments: unknown; afterEventId?: string }>();
      const created = await createAskVRealtimeClient({ seedMessage, path, sessionId, conversationId: conversation.conversationId,
        signal: controller.signal, greeting: text, history: conversation.messages, audioSource,
        onTranscript: message => {
          if (!valid()) return;
          if (message.role === 'user') { lastUserTranscript = message; metrics.current?.transcript(message.content); }
          latest.current?.onTranscript?.(message, conversation.conversationId, sessionId);
        },
        onToolCall: async call => {
          if (!valid()) throw new Error('Voice session ended.');
          clearIdle(); transition('thinking');
          let domain = call.arguments && typeof call.arguments === 'object' ? call.arguments as Record<string, unknown> : {};
          const pending = pendingConfirmations.get(call.name);
          let confirmationEventId: string | undefined;
          if (pending) {
            // Tool generation can beat the user's transcription event. Never substitute the model's phrase.
            const until = Date.now() + 4000;
            while (valid() && (!lastUserTranscript || lastUserTranscript.eventId === pending.afterEventId) && Date.now() < until) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!valid()) return 'Voice session ended.';
            if (!lastUserTranscript || lastUserTranscript.eventId === pending.afterEventId) return JSON.stringify({ ok: false, requiresConfirmation: true, message: 'The spoken confirmation has not arrived. Please confirm the pending action.' });
            await latest.current?.flushTranscripts?.();
            confirmationEventId = lastUserTranscript.eventId;
          }
          try { domain = await addAskVToolLocation(call.name, domain, pending?.arguments); }
          catch { return JSON.stringify({ ok: false, message: 'Location permission is required for this action. You can continue in the existing form.' }); }
          if (!valid()) return 'Voice session ended.';
          const result = await fetch(`${BASE}/api/assistant/realtime/tool-call`, { method: 'POST', credentials: 'include', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: call.name, arguments: domain,
              sessionId, conversationId: conversation.conversationId, callId: call.callId,
              confirmationEventId,
              idempotencyKey: pending ? pending.key : call.callId,
              clientSurface: 'web' }) });
          const body = await result.json();
          if (valid() && result.ok && body.mutation) latest.current?.onMutation?.(body.mutation);
          if (body.tools || body.context) client.current?.applyToolContext(body);
          const output = body.output ?? (body.requiresConfirmation ? body : body.message ?? body.error ?? '');
          let parsed: Record<string, unknown> | undefined;
          try { parsed = typeof output === 'string' ? JSON.parse(output) : output; } catch { /* ordinary tool text */ }
          if (parsed?.requiresConfirmation && typeof parsed.idempotencyKey === 'string') pendingConfirmations.set(call.name, { key: parsed.idempotencyKey, arguments: parsed.arguments, afterEventId: lastUserTranscript?.eventId });
          else if (result.ok) pendingConfirmations.delete(call.name);
          if (!valid()) throw new Error('Voice session ended.');
          const intent = parseAskVClientIntent(output);
          if (intent) return JSON.stringify({ ...body, clientResult: applyAskVClientIntent(intent) });
          return typeof output === 'string' ? output : JSON.stringify(output);
        },
        onSpeechStarted: () => { if (valid()) { userSpeaking.current = true; clearIdle(); if (current.current === 'speaking') { metrics.current?.event('interruption'); client.current?.interrupt(); } transition('listening'); } },
        onSpeechStopped: () => { if (valid()) { metrics.current?.startTurn(); userSpeaking.current = false; clearIdle(); transition('thinking'); } },
        onAudio: () => { if (valid()) { metrics.current?.audio(); clearIdle(); transition('speaking'); } },
        onResponse: response => { if (valid()) metrics.current?.response(response); },
        onPlaybackStopped: () => { if (valid()) { transition('listening'); if (!userSpeaking.current) armIdle(); } },
        onError: message => { if (valid()) { metrics.current?.event('fallback', { reason: 'unavailable' }); stop(); setError(message); transition('error'); } },
      });
      if (!valid()) { created.close(); return; }
      client.current = created;
      if (latestContext.current) created.updateContext(latestContext.current);
      await created.connect(); if (!valid()) { created.close(); return; }
      if (current.current === 'connecting') transition('listening');
      // The click greeting arms idle only after its actual output-buffer stop event.
      // Wake capture has no greeting, so silence after activation still has a bound.
      if (audioSource && current.current === 'listening') armIdle();
    } catch (cause) {
      if (!valid()) return;
      const permissionDenied = !!cause && typeof cause === 'object' && 'name' in cause && cause.name === 'NotAllowedError';
      metrics.current?.event('fallback', { reason: permissionDenied ? 'permission' : 'network' });
      const message = permissionDenied
        ? 'Microphone access is blocked for vndrly.ai. Allow it in your browser settings, then reopen AskV.'
        : cause instanceof Error ? cause.message : 'AskV voice could not start.';
      stop(); setError(message); transition('error');
    } finally { clearTimeout(deadline); }
  }, [armIdle, clearIdle, stop, transition]);
  const interrupt = useCallback(() => { client.current?.interrupt(); transition('listening'); armIdle(); }, [transition, armIdle]);
  const setMicEnabled = useCallback((enabled: boolean) => { if (!enabled) { stop(); transition('muted'); } }, [stop, transition]);
  const updateContext = useCallback((context: Parameters<AskVRealtimeClient['updateContext']>[0]) => {
    latestContext.current = context; client.current?.updateContext(context);
  }, []);
  const sendText = useCallback((text: string) => { if (!client.current || ['connecting', 'stopped', 'error', 'muted', 'wake-idle'].includes(current.current)) return false;
    metrics.current?.startTurn();
    client.current.sendText(text); clearIdle(); transition('thinking'); return true;
  }, [clearIdle, transition]);
  return { state, error, greeting, startConversation, startOneCommand: startConversation, stop, interrupt, setMicEnabled, updateContext, sendText };
}
