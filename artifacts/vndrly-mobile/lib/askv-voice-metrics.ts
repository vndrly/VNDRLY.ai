import { getApiBase } from "@/lib/api";

type Event = "session_start" | "session_end" | "first_audio" | "turn" | "interruption" | "wake" | "false_wake" | "correction" | "fallback" | "idle";
type Reason = "user" | "timeout" | "muted" | "background" | "network" | "permission" | "unavailable" | "interruption" | "empty_turn";
type MetricSession = { token: string; sessionId: string; conversationId?: number };
let eventCounter = 0;
/** Metrics contain only counters and fixed labels, never transcripts, raw audio or error prose. */
export function readAskVUsage(raw: unknown): Record<string, number> {
  const usage = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const source = {
    inputTextTokens: usage.input_token_details?.text_tokens,
    inputAudioTokens: usage.input_token_details?.audio_tokens,
    cachedTextTokens: usage.input_token_details?.cached_tokens_details?.text_tokens,
    cachedAudioTokens: usage.input_token_details?.cached_tokens_details?.audio_tokens,
    outputTextTokens: usage.output_token_details?.text_tokens,
    outputAudioTokens: usage.output_token_details?.audio_tokens,
  };
  const counters = Object.fromEntries(Object.entries(source).map(([key, value]) => [key,
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0]));
  counters.cachedTextTokens = Math.min(counters.cachedTextTokens, counters.inputTextTokens);
  counters.cachedAudioTokens = Math.min(counters.cachedAudioTokens, counters.inputAudioTokens);
  return counters;
}
export function recordAskVMetric(session: MetricSession, event: Event, details: { durationMs?: number; reason?: Reason; usage?: unknown } = {}) {
  const usage = readAskVUsage(details.usage);
  const durationMs = details.durationMs;
  void fetch(getApiBase() + "/api/assistant/voice/metrics", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
    body: JSON.stringify({ sessionId: session.sessionId, conversationId: session.conversationId,
      eventId: "ios-metric-" + Date.now() + "-" + ++eventCounter, event, clientSurface: "ios",
      ...(typeof durationMs === "number" && Number.isFinite(durationMs) ? { durationMs: Math.min(86_400_000, Math.max(0, durationMs)) } : {}),
      ...(details.reason ? { reason: details.reason } : {}), ...(details.usage ? { usage } : {}),
    }),
  }).catch(() => undefined);
}
