import { expect, it, vi } from 'vitest';
import { createAskVVoiceMetrics, normalizeAskVUsage } from './askv-voice-metrics';
it('normalizes known token counters without double counting cached input', () => {
  expect(normalizeAskVUsage({ input_token_details: { text_tokens: 2, audio_tokens: 10, cached_tokens_details: { text_tokens: 7, audio_tokens: 4 } },
    output_token_details: { text_tokens: -1, audio_tokens: Infinity } })).toEqual({ inputTextTokens: 2, inputAudioTokens: 10, cachedTextTokens: 2, cachedAudioTokens: 4, outputTextTokens: 0, outputAudioTokens: 0 });
});
it('emits metadata only and distinguishes empty activation from a user turn', () => {
  const fetcher = vi.fn(async () => ({ status: 200 })); vi.stubGlobal('fetch', fetcher);
  const metrics = createAskVVoiceMetrics('session', Date.now(), true); metrics.start(7);
  metrics.transcript('no, I said confidential site information'); metrics.audio(); metrics.audio(); metrics.end(); metrics.end();
  const bodies = fetcher.mock.calls.map((call: any) => JSON.parse(call[1].body));
  expect(bodies.filter(body => body.event === 'first_audio')).toHaveLength(1);
  expect(bodies.filter(body => body.event === 'session_end')).toHaveLength(1);
  expect(bodies.some(body => body.event === 'false_wake')).toBe(false);
  expect(JSON.stringify(bodies)).not.toContain('confidential'); vi.unstubAllGlobals();
});
