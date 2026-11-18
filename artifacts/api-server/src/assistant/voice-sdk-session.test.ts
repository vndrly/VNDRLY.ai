import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceSdkSecret, voiceSdkTools } from "./voice-sdk-session";

afterEach(() => vi.unstubAllGlobals());
describe("official SDK token exchange", () => {
  it("retains Gate operations without copying the old shadow-task prerequisites into the SDK", () => {
    const tools = ["read_gate_task", "update_gate_task", "prepare_visitor_check_in", "confirm_visitor_check_in", "query_gate_stations"]
      .map(name => ({ name })) as never;
    expect(voiceSdkTools(tools).map(tool => tool.name))
      .toEqual(["prepare_visitor_check_in", "confirm_visitor_check_in", "query_gate_stations"]);
  });
  it("mints one ephemeral key with the configured model and voice", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ value: "ek_test", expires_at: 900 })));
    vi.stubGlobal("fetch", fetch);
    expect(await createVoiceSdkSecret({ apiKey: "server-secret", model: "gpt-realtime-2.1", voice: "marin" }))
      .toEqual({ value: "ek_test", expires_at: 900 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(JSON.parse(request.body as string)).toEqual({
      session: { type: "realtime", model: "gpt-realtime-2.1", audio: { output: { voice: "marin" } } },
    });
  });
  it("does not return a permanent credential or an unusable provider result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ value: "sk_permanent" }))));
    await expect(createVoiceSdkSecret({ apiKey: "server-secret", model: "gpt-realtime-2.1", voice: "marin" }))
      .rejects.toThrow("ephemeral");
  });
  it("surfaces a provider failure without retry waits", async () => {
    const fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(createVoiceSdkSecret({ apiKey: "server-secret", model: "gpt-realtime-2.1", voice: "marin" }))
      .rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
