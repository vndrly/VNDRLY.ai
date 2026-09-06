import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ASKV_REALTIME_MODEL,
  createAskVRealtimeCall,
  createAskVRealtimeClientSecret,
  hashSafetyIdentifier,
} from "./realtime-session";

describe("AskV Realtime session", () => {
  it("defaults to the current OpenAI realtime voice model", () => {
    expect(DEFAULT_ASKV_REALTIME_MODEL).toBe("gpt-realtime-2.1");
  });

  it("hashes safety identifiers without exposing user ids", () => {
    const one = hashSafetyIdentifier(42);
    const two = hashSafetyIdentifier(42);
    expect(one).toBe(two);
    expect(one).not.toContain("42");
  });

  it("creates GA client secrets with session audio and tool config", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ value: "ek_test", expires_at: 123 }), { status: 200 }),
    );

    const secret = await createAskVRealtimeClientSecret({
      apiKey: "sk-test",
      userId: 7,
      model: "gpt-realtime-2",
      voice: "marin",
      instructions: "Use AskV tools.",
      tools: [{ type: "function", name: "query_tickets", description: "Query tickets", parameters: { type: "object" }, strict: true }],
      fetchImpl,
    });

    expect(secret.value).toBe("ek_test");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/client_secrets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "OpenAI-Safety-Identifier": hashSafetyIdentifier(7),
        }),
      }),
    );
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [, init] = call;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", create_response: true, interrupt_response: true } }, output: { voice: "marin" } },
        tool_choice: "auto",
        tools: [{ type: "function", name: "query_tickets" }],
      },
    });
  });

  it("creates server-mediated WebRTC calls with SDP and session config", async () => {
    const fetchImpl = vi.fn(async () => new Response("answer-sdp", { status: 200 }));

    const answer = await createAskVRealtimeCall({
      apiKey: "sk-test",
      userId: 42,
      model: "gpt-realtime-2",
      voice: "marin",
      instructions: "Keep it short.",
      tools: [{ type: "function", name: "query_tickets", description: "Query tickets", parameters: { type: "object" }, strict: true }],
      sdp: "offer-sdp",
      fetchImpl,
    });

    expect(answer).toBe("answer-sdp");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/calls",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "OpenAI-Safety-Identifier": hashSafetyIdentifier(42),
        }),
      }),
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as FormData;
    expect(body.get("sdp")).toBe("offer-sdp");
    expect(JSON.parse(String(body.get("session")))).toMatchObject({
      type: "realtime",
      model: "gpt-realtime-2",
      instructions: "Keep it short.",
      audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", create_response: true, interrupt_response: true } }, output: { voice: "marin" } },
      tool_choice: "auto",
      tools: [{ type: "function", name: "query_tickets" }],
    });
  });
});
