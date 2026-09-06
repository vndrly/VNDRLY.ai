const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
type Reason = 'user' | 'timeout' | 'muted' | 'background' | 'network' | 'permission' | 'unavailable' | 'interruption' | 'empty_turn';
type Event = 'session_start' | 'session_end' | 'first_audio' | 'turn' | 'interruption' | 'wake' | 'false_wake' | 'correction' | 'fallback' | 'idle';
export function normalizeAskVUsage(usage: Record<string, any> = {}) {
  const input = usage.input_token_details ?? {}, output = usage.output_token_details ?? {}, cached = input.cached_tokens_details ?? {};
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return { inputTextTokens: count(input.text_tokens), inputAudioTokens: count(input.audio_tokens),
    cachedTextTokens: Math.min(count(cached.text_tokens), count(input.text_tokens)), cachedAudioTokens: Math.min(count(cached.audio_tokens), count(input.audio_tokens)),
    outputTextTokens: count(output.text_tokens), outputAudioTokens: count(output.audio_tokens) };
}

/** Only bounded counters and event classifications leave this observer; never speech or audio. */
export function createAskVVoiceMetrics(sessionId: string, activatedAt: number, fromWake: boolean) {
  let conversationId: number | undefined, firstAudio = false, userTurn = false, ended = false;
  let turnStartedAt: number | undefined, replyLatencyMs: number | undefined;
  const emit = (event: Event, extra: { durationMs?: number; reason?: Reason; usage?: ReturnType<typeof normalizeAskVUsage> } = {}) => {
    const body = { sessionId, conversationId, eventId: crypto.randomUUID(), event, clientSurface: 'web', ...extra };
    // A stable event id permits an at-most-one stored observation if the first response is lost.
    const send = () => fetch(`${BASE}/api/assistant/voice/metrics`, { method: 'POST', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    void send().then(response => response.status >= 500 ? send() : undefined).catch(() => undefined);
  };
  return {
    start(id: number) { conversationId = id; emit('session_start'); if (fromWake) emit('wake'); },
    startTurn() { turnStartedAt = Date.now(); replyLatencyMs = undefined; },
    audio() {
      if (turnStartedAt != null && replyLatencyMs == null) replyLatencyMs = Date.now() - turnStartedAt;
      if (!firstAudio) { firstAudio = true; emit('first_audio', { durationMs: Date.now() - activatedAt }); }
    },
    transcript(text: string) {
      if (text.trim() && !/^ask\s?v[.!?,\s]*$/i.test(text.trim())) userTurn = true;
      if (/^(?:no[, ]+i said|that(?:'s| is) not what i said|you misheard)\b/i.test(text.trim())) emit('correction');
    },
    response(response: Record<string, any>) { emit('turn', { usage: normalizeAskVUsage(response.usage),
      ...(turnStartedAt == null ? {} : { durationMs: replyLatencyMs ?? Date.now() - turnStartedAt }) }); },
    event: emit,
    end() { if (ended) return; ended = true; emit('session_end', { durationMs: Date.now() - activatedAt });
      if (fromWake && !userTurn) emit('false_wake', { reason: 'empty_turn' }); },
  };
}
