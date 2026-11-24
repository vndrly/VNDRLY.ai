import { describe, expect, it, vi } from "vitest";
import { postAssistantClientReceipts } from "../assistant-client-receipts";

describe("AskV native action receipts", () => {
  it("waits for the server to accept the actual device result", async () => {
    const post = vi.fn(async (_path: string, _init: RequestInit) => ({ ok: true } as Response));
    expect(await postAssistantClientReceipts(42, [{ ok: true, message: "Focused the task title." }], post)).toBe(true);
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0][0]).toBe("/api/assistant/messages/42/client-receipts");
    expect(JSON.parse(String(post.mock.calls[0][1].body))).toEqual({ receipts: [{ ok: true, message: "Focused the task title." }] });
  });

  it("keeps a failed receipt eligible for retry and bounds a stalled request", async () => {
    const rejected = vi.fn(async (_path: string, _init: RequestInit) => ({ ok: false } as Response));
    expect(await postAssistantClientReceipts(42, [{ ok: false, message: "Screen unavailable." }], rejected)).toBe(false);
    const stalled = vi.fn((_path: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    expect(await postAssistantClientReceipts(42, [{ ok: false, message: "Screen unavailable." }], stalled, 5)).toBe(false);
    expect(stalled.mock.calls[0][1].signal?.aborted).toBe(true);
  });
});
