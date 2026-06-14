import { describe, expect, it } from "vitest";

import {
  consumeAssistantSseFromText,
  readAssistantStreamResponse,
} from "../assistant-sse";

describe("consumeAssistantSseFromText", () => {
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
});
