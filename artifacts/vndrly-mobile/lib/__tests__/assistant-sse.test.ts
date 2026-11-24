import { describe, expect, it } from "vitest";

import {
  consumeAssistantSseFromText,
  readAssistantStreamResponse,
} from "../assistant-sse";

describe("consumeAssistantSseFromText", () => {
  it("retains the exact prepared shift note arguments for voice readback", () => {
    const events: unknown[] = [];
    consumeAssistantSseFromText('event: confirmation\ndata: {"reference":"preview-1","toolName":"manage_gate_shift","arguments":{"action":"add_shift_note","text":"Barrier damaged at 5:15"}}\n\n', event => events.push(event));
    expect(events).toEqual([{ type: "confirmation", reference: "preview-1", toolName: "manage_gate_shift", arguments: { action: "add_shift_note", text: "Barrier damaged at 5:15" } }]);
  });
  it("retains bounded cooperative recovery and provider events without treating them as completion", () => {
    const events: unknown[] = [];
    const result = consumeAssistantSseFromText('event: provider_usage\ndata: {"provider":"openai","status":"consulted"}\n\nevent: recovery\ndata: {"completed":["saved exact note"],"remaining":["confirm arrival"],"needed":"Current permission is required","taskId":null}\n\n', event => events.push(event));
    expect(events).toEqual([{ type: "provider_usage", provider: "openai", status: "consulted" }, { type: "recovery", completed: ["saved exact note"], remaining: ["confirm arrival"], needed: ["Current permission is required"], taskId: null }]);
    expect(result.receivedDone).toBe(false);
  });
  it("parses token, tool, and done events", () => {
    const events: string[] = [];
    const result = consumeAssistantSseFromText(
      [
        "event: token",
        'data: {"delta":"Hello"}',
        "",
        "event: tool",
        'data: {"name":"lookup_tickets","status":"start"}',
        "",
        "event: tool",
        'data: {"name":"lookup_tickets","status":"end"}',
        "",
        "event: done",
        'data: {"content":"Hello world"}',
        "",
      ].join("\n"),
      (evt) => {
        events.push(evt.type);
      },
    );

    expect(events).toEqual(["token", "tool", "tool", "done"]);
    expect(result.receivedDone).toBe(true);
  });

  it("parses error events", () => {
    let message = "";
    const result = consumeAssistantSseFromText(
      ['event: error', 'data: {"message":"Tool chain failed"}', ""].join("\n"),
      (evt) => {
        if (evt.type === "error") message = evt.message;
      },
    );

    expect(message).toBe("Tool chain failed");
    expect(result.receivedError).toBe(true);
  });
});

describe("readAssistantStreamResponse", () => {
  it("finishes a completed reply without waiting for the HTTP stream to close", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    let finished = false;
    const reading = readAssistantStreamResponse({ body } as Response, new AbortController().signal, () => {}).then(() => { finished = true; });
    controller.enqueue(new TextEncoder().encode('event: done\ndata: {"content":"Ready"}\n\n'));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const finishedBeforeClose = finished;
    try { controller.close(); } catch { /* Reader may already have cancelled. */ }
    await reading;
    expect(finishedBeforeClose).toBe(true);
  });
  it("reads a streaming body when getReader is available", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'event: token\ndata: {"delta":"Hi"}\n\n',
      'event: done\ndata: {"content":"Hi"}\n\n',
    ];
    let i = 0;
    const body = {
      getReader: () => ({
        read: async () => {
          if (i >= chunks.length) return { done: true, value: undefined };
          const value = encoder.encode(chunks[i++]);
          return { done: false, value };
        },
      }),
    };

    const res = { ok: true, body } as unknown as Response;
    const tokens: string[] = [];
    const result = await readAssistantStreamResponse(res, new AbortController().signal, (evt) => {
      if (evt.type === "token") tokens.push(evt.delta);
    });

    expect(tokens).toEqual(["Hi"]);
    expect(result.receivedDone).toBe(true);
  });

  it("falls back to buffered text when response body is null", async () => {
    const res = {
      ok: true,
      body: null,
      text: async () => 'event: done\ndata: {"content":"Buffered reply"}\n\n',
    } as unknown as Response;

    let content = "";
    const result = await readAssistantStreamResponse(res, new AbortController().signal, (evt) => {
      if (evt.type === "done") content = evt.content;
    });

    expect(content).toBe("Buffered reply");
    expect(result.receivedDone).toBe(true);
  });

  it("delivers a React Native client action before the server completes the reply", async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, value: { product: "ReactNative" },
    });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    try {
      const events: string[] = [];
      let finished = false;
      const reading = readAssistantStreamResponse({ body } as Response, new AbortController().signal,
        event => events.push(event.type)).then(() => { finished = true; });
      stream.enqueue(encoder.encode('event: client_intent\ndata: {"intent":{"name":"open_screen","arguments":{"screen":"gate-map"}}}\n\n'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(events).toEqual(["client_intent"]);
      expect(finished).toBe(false);
      stream.enqueue(encoder.encode('event: done\ndata: {"content":"Opened Gate Map."}\n\n'));
      stream.close();
      await reading;
      expect(events).toEqual(["client_intent", "done"]);
    } finally {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
    }
  });
});
