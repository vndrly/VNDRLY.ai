import { requestOpenAIVRound, type VModelRoundInput } from "./cooperative-v-providers";

/** Text-only services share the same OpenAI adapter and cannot request tools. */
export function requestOpenAIText(input: { system: string; messages: VModelRoundInput["messages"]; max_tokens: number; model?: string; temperature?: number }, options: { timeout?: number; signal?: AbortSignal; maxRetries?: number } = {}) {
  return requestOpenAIVRound({ system: input.system, messages: input.messages, maxTokens: input.max_tokens, tools: [] },
    { apiKey: process.env.OPENAI_API_KEY ?? "", model: input.model, timeoutMs: options.timeout, signal: options.signal });
}
