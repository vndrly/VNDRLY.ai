import type { AskVToolDefinition } from "./tool-registry";
import { SELECTED_EXTERNAL_CALENDAR_TOOL } from "./cooperative-v-connections";

/** The SDK owns conversation state. Keep domain capabilities, omit the legacy shadow-task protocol. */
export function voiceSdkTools(tools: AskVToolDefinition[]) {
  return tools.filter(tool => tool.name !== "read_gate_task" && tool.name !== "update_gate_task");
}

/** The official Realtime example's server-side ephemeral-key exchange. */
export async function createVoiceSdkSecret(options: { apiKey: string; model: string; voice: string }) {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: "Bearer " + options.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: { type: "realtime", model: options.model, audio: { output: { voice: options.voice } } },
    }),
  });
  if (!response.ok) throw new Error("Realtime token exchange failed (HTTP " + response.status + ")");
  const data = await response.json() as { value?: string; expires_at?: number };
  if (!data.value?.startsWith("ek_")) throw new Error("Provider did not return an ephemeral Realtime key");
  return { value: data.value, expires_at: data.expires_at };
}

/** Existing selected integrations are read on demand, never during microphone activation. */
export const VOICE_SDK_CONTEXT_TOOLS = [
  { type: "function" as const, name: SELECTED_EXTERNAL_CALENDAR_TOOL.name, description: SELECTED_EXTERNAL_CALENDAR_TOOL.description, parameters: SELECTED_EXTERNAL_CALENDAR_TOOL.input_schema },
  { type: "function" as const, name: "read_selected_saved_task", description: "Read the user's explicitly selected saved task, completed results and remaining steps under current company permissions. Does not restart work or modify the task.", parameters: { type: "object", properties: {}, additionalProperties: false } },
];
