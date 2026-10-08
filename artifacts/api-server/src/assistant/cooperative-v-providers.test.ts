import { describe, expect, it, vi } from "vitest";
import { openAIConversationInput, requestOpenAIVRound } from "./cooperative-v-providers";

describe("OpenAI V provider bridge", () => {
  const tools = [{ name: "read_task", description: "Read saved task", input_schema: { type: "object" as const, properties: {} } }];
  it("translates the shared transcript including saved tool outputs without private ChatGPT state", () => {
    expect(openAIConversationInput([
      { role: "user", content: "read" },
      { role: "assistant", content: [{ type: "tool_use", id: "call1", name: "read_task", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call1", content: '{"id":42}' }] },
    ])).toEqual([
      { role: "user", content: "read" },
      { type: "function_call", call_id: "call1", name: "read_task", arguments: "{}" },
      { type: "function_call_output", call_id: "call1", output: '{"id":42}' },
    ]);
  });
  it("uses bounded non-stored Responses requests with only supplied tools", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [
      { type: "message", content: [{ type: "output_text", text: "Saved task" }] },
      { type: "function_call", call_id: "call2", name: "read_task", arguments: "{}" },
    ], usage: { input_tokens: 20, output_tokens: 5 } }), { status: 200 }));
    const result = await requestOpenAIVRound({ system: "V", messages: [{ role: "user", content: "read" }], tools, maxTokens: 2048 }, { apiKey: "test-key", fetcher });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ store: false, parallel_tool_calls: false, max_output_tokens: 2048, tools: [{ type: "function", name: "read_task", strict: false }] });
    expect(body).not.toHaveProperty("conversation");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(result).toMatchObject({ stop_reason: "tool_use", usage: { input_tokens: 20, output_tokens: 5 } });
    expect(result.content).toContainEqual({ type: "tool_use", id: "call2", name: "read_task", input: {}, caller: { type: "direct" } });
  });
  it("rejects unknown tools and malformed calls before any executor can see them", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "function_call", call_id: "x", name: "delete_everything", arguments: "{}" }] }), { status: 200 }));
    await expect(requestOpenAIVRound({ system: "V", messages: [], tools, maxTokens: 2048 }, { apiKey: "test", fetcher })).rejects.toMatchObject({ retryable: false });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", output: [{ type: "function_call", call_id: "x", name: "read_task", arguments: "garbage" }] }), { status: 200 }));
    await expect(requestOpenAIVRound({ system: "V", messages: [], tools, maxTokens: 2048 }, { apiKey: "test", fetcher })).rejects.toMatchObject({ retryable: false });
  });
  it("classifies authentication as terminal and transport outages as eligible for fallback", async () => {
    const input = { system: "V", messages: [], tools, maxTokens: 2048 };
    await expect(requestOpenAIVRound(input, { apiKey: "test", fetcher: vi.fn().mockResolvedValue(new Response("{}", { status: 401 })) })).rejects.toMatchObject({ retryable: false });
    await expect(requestOpenAIVRound(input, { apiKey: "test", fetcher: vi.fn().mockResolvedValue(new Response("{}", { status: 503 })) })).rejects.toMatchObject({ retryable: true });
  });
});
