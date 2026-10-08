import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";
import { VProviderError } from "./cooperative-v";

export type VModelRoundInput = { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[]; maxTokens: number };
export type VModelRound = Pick<Anthropic.Message, "content" | "stop_reason" | "usage"> & { model: string };

/** Keep one deliberately shared transcript. No ChatGPT conversation/subscription/app
 * credentials or remotely stored response state is inferred from an OpenAI API key.
 */
export function openAIConversationInput(messages: Anthropic.MessageParam[]): Record<string, unknown>[] {
  return messages.flatMap(message => {
    if (typeof message.content === "string") return [{ role: message.role, content: message.content }];
    return message.content.flatMap((block): Record<string, unknown>[] => {
      if (block.type === "text") return [{ role: message.role, content: block.text }];
      if (block.type === "tool_use") return [{ type: "function_call", call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) }];
      if (block.type === "tool_result") return [{ type: "function_call_output", call_id: block.tool_use_id, output: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? []) }];
      // This chat route currently supplies text and tools only. Unsupported media
      // must be handled explicitly, never silently sent to another cloud provider.
      throw new VProviderError("Unsupported V conversation content", false);
    });
  });
}

export async function requestOpenAIVRound(input: VModelRoundInput, options: {
  apiKey: string; model?: string; fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<VModelRound> {
  if (!options.apiKey.trim()) throw new VProviderError("OpenAI provider is not configured", false);
  const model = options.model || process.env.ASKV_OPENAI_MODEL?.trim() || "gpt-4.1";
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: input.system, input: openAIConversationInput(input.messages),
        tools: input.tools.map(tool => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false })),
        store: false, parallel_tool_calls: false, max_output_tokens: input.maxTokens,
      }),
    });
  } catch (error) {
    if (error instanceof VProviderError) throw error;
    throw new VProviderError("OpenAI provider connection unavailable", true);
  }
  if (!response.ok) throw new VProviderError(`OpenAI provider HTTP ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500);
  const payload = await response.json() as { status?: string; model?: string; output?: Array<{ type: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
  if (payload.status !== "completed" || !Array.isArray(payload.output)) throw new VProviderError("OpenAI response incomplete; resume remaining work", false);
  const allowed = new Set(input.tools.map(tool => tool.name));
  const content: Anthropic.ContentBlock[] = [];
  for (const item of payload.output) {
    if (item.type === "function_call") {
      if (!item.name || !allowed.has(item.name) || !item.call_id || typeof item.arguments !== "string") throw new VProviderError("OpenAI requested an unavailable V tool", false);
      let parsed: unknown;
      try { parsed = JSON.parse(item.arguments); } catch { throw new VProviderError("OpenAI tool arguments invalid", false); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new VProviderError("OpenAI tool arguments must be an object", false);
      content.push({ type: "tool_use", id: item.call_id, name: item.name, input: parsed, caller: { type: "direct" } });
    } else if (item.type === "message") {
      for (const block of item.content ?? []) {
        const text = block.type === "output_text" ? block.text : block.type === "refusal" ? block.refusal : undefined;
        if (text) content.push({ type: "text", text, citations: null });
      }
    }
  }
  return { content, stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", model: payload.model ?? model,
    usage: { input_tokens: payload.usage?.input_tokens ?? 0, output_tokens: payload.usage?.output_tokens ?? 0, cache_creation_input_tokens: null, cache_read_input_tokens: payload.usage?.input_tokens_details?.cached_tokens ?? null },
  } as VModelRound;
}

/** Buffer each completed model round before exposing it. A provider that dies after
 * partial output cannot leave duplicate/contradictory text when the alternate replies.
 * Tool dispatch still happens exclusively in the authenticated route coordinator.
 */
export async function requestAnthropicVRound(input: VModelRoundInput): Promise<VModelRound> {
  try {
    const stream = anthropic.messages.stream({ model: "claude-sonnet-4-5", max_tokens: input.maxTokens, system: input.system, tools: input.tools, messages: input.messages }, { timeout: 45_000, maxRetries: 0 });
    const response = await stream.finalMessage();
    return { content: response.content, stop_reason: response.stop_reason, usage: response.usage, model: response.model };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    throw new VProviderError(status ? `AskV provider HTTP ${status}` : "AskV provider connection unavailable", status === undefined || status === 408 || status === 429 || status >= 500);
  }
}
