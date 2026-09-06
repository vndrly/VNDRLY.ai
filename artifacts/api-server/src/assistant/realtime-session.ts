import crypto from "crypto";
import type { OpenAIRealtimeTool } from "./tool-registry";

export const DEFAULT_ASKV_REALTIME_MODEL = "gpt-realtime-2.1";

export interface CreateAskVRealtimeClientSecretArgs {
  apiKey: string;
  userId: number;
  model: string;
  voice: string;
  instructions: string;
  tools: OpenAIRealtimeTool[];
  fetchImpl?: typeof fetch;
}

export interface CreateAskVRealtimeCallArgs extends CreateAskVRealtimeClientSecretArgs {
  sdp: string;
}

export interface AskVRealtimeClientSecret {
  value: string;
  expires_at?: number;
}

export function hashSafetyIdentifier(userId: number): string {
  return crypto.createHash("sha256").update(`vndrly-user:${userId}`).digest("hex");
}

function buildRealtimeSessionConfig(args: CreateAskVRealtimeClientSecretArgs) {
  return {
    type: "realtime",
    model: args.model,
    instructions: args.instructions,
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
      },
      output: {
        voice: args.voice,
      },
    },
    tool_choice: "auto",
    tools: args.tools,
  };
}

export async function createAskVRealtimeClientSecret(
  args: CreateAskVRealtimeClientSecretArgs,
): Promise<AskVRealtimeClientSecret> {
  const fetcher = args.fetchImpl ?? fetch;
  const res = await fetcher("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": hashSafetyIdentifier(args.userId),
    },
    body: JSON.stringify({
      session: buildRealtimeSessionConfig(args),
    }),
  });

  if (!res.ok) {
    throw new Error(`openai.realtime_client_secret_failed:${res.status}`);
  }

  const data = (await res.json()) as Partial<AskVRealtimeClientSecret>;
  if (!data.value) {
    throw new Error("openai.realtime_client_secret_missing_value");
  }
  return { value: data.value, expires_at: data.expires_at };
}

export async function createAskVRealtimeCall(args: CreateAskVRealtimeCallArgs): Promise<string> {
  const fetcher = args.fetchImpl ?? fetch;
  const body = new FormData();
  body.set("sdp", args.sdp);
  body.set("session", JSON.stringify(buildRealtimeSessionConfig(args)));

  const res = await fetcher("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "OpenAI-Safety-Identifier": hashSafetyIdentifier(args.userId),
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`openai.realtime_call_failed:${res.status}`);
  }

  return res.text();
}
