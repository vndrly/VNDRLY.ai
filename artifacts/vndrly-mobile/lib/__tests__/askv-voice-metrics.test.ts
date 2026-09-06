import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://example.test" }));
import { readAskVUsage, recordAskVMetric } from "../askv-voice-metrics";
afterEach(() => vi.unstubAllGlobals());
it("emits fixed usage counters without user content or provider error text", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  const usage = { input_token_details: { text_tokens: 8, audio_tokens: 12, cached_tokens_details: { audio_tokens: 5 } }, output_token_details: { audio_tokens: 21 }, transcript: "Private site details", error: "Secret error", total_tokens: Infinity };
  expect(readAskVUsage(usage)).toEqual({ inputTextTokens: 8, inputAudioTokens: 12, cachedTextTokens: 0, cachedAudioTokens: 5, outputTextTokens: 0, outputAudioTokens: 21 });
  recordAskVMetric({ token: "token", sessionId: "session-1", conversationId: 12 }, "turn", { usage });
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(body).toMatchObject({ clientSurface: "ios", event: "turn", usage: { outputAudioTokens: 21 } });
  expect(JSON.stringify(body)).not.toMatch(/Private|Secret|transcript|Infinity/);
});
