import "../../../scripts/load-env-local.mjs";
import { requestAnthropicVRound, requestOpenAIVRound, type VModelRoundInput } from "../src/assistant/cooperative-v-providers";
import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";

// Synthetic provider/bridge verification only. No database or external account
// content is read; no VNDRLY mutation, grant or consent is created by this script.
const ready = { anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()), openai: Boolean(process.env.OPENAI_API_KEY?.trim()) };
const tools: Anthropic.Tool[] = [{ name: "read_synthetic_record", description: "Read the synthetic verification record. This read has no external effects.", input_schema: { type: "object", properties: {}, additionalProperties: false } }];
const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Read the synthetic verification record using read_synthetic_record. Do not guess its id; call the tool once, then state its saved id only after receiving the result." }];
const context: VModelRoundInput = { system: "You are V. Use only the supplied harmless read tool. Do not claim any real VNDRLY action.", messages, tools, maxTokens: 256 };
console.log(JSON.stringify({ configured: ready }));
if (!ready.anthropic || !ready.openai) { process.exitCode = 1; }
else {
  try {
    const first = await requestOpenAIVRound(context, { apiKey: process.env.OPENAI_API_KEY! });
    const reads = first.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (reads.length !== 1 || reads[0].name !== "read_synthetic_record") throw Error("Synthetic read was not requested exactly once");
    const shared: Anthropic.MessageParam[] = [...messages, { role: "assistant", content: first.content }, { role: "user", content: reads.map(read => ({ type: "tool_result" as const, tool_use_id: read.id, content: JSON.stringify({ id: 42, source: "synthetic_verification" }) })) }];
    const second = await requestAnthropicVRound({ ...context, messages: shared });
    const text = second.content.filter(block => block.type === "text").map(block => block.text).join(" ");
    const verified = /\b42\b/.test(text) && !second.content.some(block => block.type === "tool_use");
    console.log(JSON.stringify({ verified, firstModel: first.model, secondModel: second.model, sharedSyntheticRead: true, syntheticIdReadBack: verified, secondToolCalls: second.content.filter(block => block.type === "tool_use").length, firstUsage: first.usage, secondUsage: second.usage, realDomainActionVerified: false }));
    if (!verified) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ verified: false, error: error instanceof Error ? error.message : "Provider verification failed" }));
    process.exitCode = 1;
  }
}
