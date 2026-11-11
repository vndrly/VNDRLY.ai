import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";
import { requestOpenAIVRound } from "../cooperative-v-providers";
/** Compatibility envelope for evaluations; all inference uses the production adapter. */
export class ProductionEvalClient {
  messages = { create: (input: { system: string; messages: Anthropic.MessageParam[]; max_tokens: number; model?: string }) =>
    requestOpenAIVRound({ system: input.system, messages: input.messages, tools: [], maxTokens: input.max_tokens }, { apiKey: process.env.OPENAI_API_KEY ?? "" }) };
}
