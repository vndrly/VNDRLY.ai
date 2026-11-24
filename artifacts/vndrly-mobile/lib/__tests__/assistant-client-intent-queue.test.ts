import { describe, expect, it } from "vitest";
import { createAssistantClientIntentQueue } from "../assistant-client-intent-queue";

describe("assistant client intent order", () => {
  it("waits for page navigation before running the next device action", async () => {
    const queue = createAssistantClientIntentQueue<string>();
    const calls: string[] = [];
    let finishNavigation!: () => void;
    const navigation = new Promise<void>(resolve => { finishNavigation = resolve; });
    queue.enqueue(async () => {
      calls.push("open page");
      await navigation;
      calls.push("page ready");
      return "opened";
    });
    queue.enqueue(async () => { calls.push("focus form"); return "focused"; });
    await Promise.resolve();
    expect(calls).toEqual(["open page"]);
    finishNavigation();
    expect(await queue.results()).toEqual(["opened", "focused"]);
    expect(calls).toEqual(["open page", "page ready", "focus form"]);
  });

  it("does not run later actions after an earlier device action throws", async () => {
    const queue = createAssistantClientIntentQueue<string>();
    const next = () => { throw new Error("must not run"); };
    queue.enqueue(async () => { throw new Error("navigation failed"); });
    queue.enqueue(async () => next());
    await expect(queue.results()).rejects.toThrow("navigation failed");
  });
});
