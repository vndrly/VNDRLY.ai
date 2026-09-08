import { describe, expect, it } from "vitest";
import { enqueueWorkHubCommand, flushWorkHubCommands, type QueueStore } from "./work-hub-queue";

const memoryStore = (): QueueStore & { values: Map<string, string> } => { const values = new Map<string, string>(); return { values, getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } }; };
describe("Work Hub offline queue", () => {
  it("keeps stable idempotency keys across retries", async () => { const store = memoryStore(); const queued = await enqueueWorkHubCommand(store, "/api/work-hub/tasks", { title: "Inspect" }); expect(queued.idempotencyKey).toMatch(/^mobile-/); const sent: string[] = []; await flushWorkHubCommands(store, async (item) => { sent.push(item.idempotencyKey); throw new Error("offline"); }); await flushWorkHubCommands(store, async (item) => { sent.push(item.idempotencyKey); }); expect(sent).toEqual([queued.idempotencyKey, queued.idempotencyKey]); });
});
