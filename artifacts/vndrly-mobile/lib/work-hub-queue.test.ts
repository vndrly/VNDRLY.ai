import { describe, expect, it, vi } from "vitest";
import {
  enqueueWorkHubCommand,
  enqueueWorkHubUpload,
  flushWorkHubCommands,
  inspectWorkHubQueue,
  type QueueStore,
  type WorkHubQueueScope,
} from "./work-hub-queue";

const memoryStore = (): QueueStore & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
};

const susie: WorkHubQueueScope = { userId: 7, ownerOrgType: "vendor", ownerOrgId: 11 };
const bob: WorkHubQueueScope = { userId: 8, ownerOrgType: "vendor", ownerOrgId: 11 };

describe("Work Hub offline queue", () => {
  it("keeps stable operation IDs across retries and scopes data by user and organization", async () => {
    const store = memoryStore();
    const queued = await enqueueWorkHubCommand(store, susie, {
      path: "/api/work-hub/tasks",
      method: "POST",
      payload: { title: "Inspect" },
    }, { now: () => new Date("2026-09-11T11:59:59Z") });
    await enqueueWorkHubCommand(store, bob, {
      path: "/api/work-hub/tasks",
      method: "POST",
      payload: { title: "Other user" },
    }, { now: () => new Date("2026-09-11T11:59:59Z") });

    const sent: string[] = [];
    await flushWorkHubCommands(store, susie, async (item) => {
      sent.push(item.operationId);
      throw Object.assign(new Error("offline"), { code: "network.unreachable" });
    }, { now: () => new Date("2026-09-11T12:00:00Z") });
    await flushWorkHubCommands(store, susie, async (item) => {
      sent.push(item.operationId);
    }, { now: () => new Date("2026-09-11T12:00:03Z") });

    expect(sent).toEqual([queued.operationId, queued.operationId]);
    expect((await inspectWorkHubQueue(store, bob)).items).toHaveLength(1);
  });

  it("never adopts the legacy global queue into a signed-in user's scope", async () => {
    const store = memoryStore();
    store.values.set("vndrly.workHub.commandQueue.v1", JSON.stringify([
      { idempotencyKey: "legacy", path: "/api/work-hub/tasks", payload: { secret: true } },
    ]));
    expect((await inspectWorkHubQueue(store, susie)).items).toEqual([]);
    expect(store.values.get("vndrly.workHub.commandQueue.v1")).toContain("legacy");
  });

  it("serializes concurrent enqueues without dropping either command", async () => {
    const store = memoryStore();
    await Promise.all([
      enqueueWorkHubCommand(store, susie, { path: "/api/work-hub/tasks", method: "POST", payload: { title: "A" } }),
      enqueueWorkHubCommand(store, susie, { path: "/api/work-hub/tasks", method: "POST", payload: { title: "B" } }),
    ]);
    expect((await inspectWorkHubQueue(store, susie)).items).toHaveLength(2);
  });

  it("honors Retry-After, preserves conflicts for resolution, and stops revoked scopes", async () => {
    const store = memoryStore();
    await enqueueWorkHubCommand(
      store,
      susie,
      { path: "/api/work-hub/tasks", method: "POST", payload: { title: "Rate limited" } },
      { now: () => new Date("2026-09-11T11:59:59Z") },
    );
    await flushWorkHubCommands(store, susie, async () => {
      throw Object.assign(new Error("slow down"), { status: 429, retryAfterMs: 30_000 });
    }, { now: () => new Date("2026-09-11T12:00:00Z") });
    const delayed = await inspectWorkHubQueue(store, susie);
    expect(delayed.items[0]).toMatchObject({ state: "pending", attempts: 1, nextAttemptAt: "2026-09-11T12:00:30.000Z" });

    const send = vi.fn();
    await flushWorkHubCommands(store, susie, send, { now: () => new Date("2026-09-11T12:00:29Z") });
    expect(send).not.toHaveBeenCalled();
    await flushWorkHubCommands(store, susie, async () => { throw Object.assign(new Error("changed"), { status: 409 }); }, { now: () => new Date("2026-09-11T12:00:31Z") });
    expect((await inspectWorkHubQueue(store, susie)).items[0].state).toBe("conflict");

    const revoked = memoryStore();
    await enqueueWorkHubCommand(revoked, susie, { path: "/api/work-hub/tasks", method: "POST", payload: {} });
    await enqueueWorkHubCommand(revoked, susie, { path: "/api/work-hub/channels", method: "POST", payload: {} });
    const revokedSend = vi.fn(async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); });
    const result = await flushWorkHubCommands(revoked, susie, revokedSend);
    expect(revokedSend).toHaveBeenCalledTimes(1);
    expect(result.revoked).toBe(true);
    expect((await inspectWorkHubQueue(revoked, susie)).items.every((item) => item.state === "revoked")).toBe(true);
  });

  it("supports bounded uploads and dependency ordering", async () => {
    const store = memoryStore();
    const command = await enqueueWorkHubCommand(store, susie, {
      path: "/api/work-hub/tasks", method: "POST", payload: { title: "Inspection" },
    });
    await enqueueWorkHubUpload(store, susie, {
      path: "/api/work-hub/files",
      fileUri: "file:///private/inspection.jpg",
      contentType: "image/jpeg",
      dependsOn: [command.operationId],
    });
    const order: string[] = [];
    await flushWorkHubCommands(store, susie, async (item) => { order.push(item.kind); });
    expect(order).toEqual(["command", "upload"]);

    const tiny = memoryStore();
    await enqueueWorkHubCommand(tiny, susie, { path: "/api/work-hub/tasks", method: "POST", payload: {} }, { maxItems: 1 });
    await expect(enqueueWorkHubCommand(tiny, susie, { path: "/api/work-hub/tasks", method: "POST", payload: {} }, { maxItems: 1 }))
      .rejects.toThrow("queue is full");
  });

  it("rejects routes outside Work Hub and oversized payloads", async () => {
    const store = memoryStore();
    await expect(enqueueWorkHubCommand(store, susie, { path: "/api/admin/users", method: "POST", payload: {} }))
      .rejects.toThrow("Work Hub API path");
    await expect(enqueueWorkHubCommand(store, susie, { path: "/api/work-hub/tasks", method: "POST", payload: { body: "x".repeat(1_100_000) } }))
      .rejects.toThrow("too large");
  });

  it("preserves corrupt scoped data for recovery and rejects credential metadata", async () => {
    const store = memoryStore();
    store.values.set("vndrly.workHub.queue.v2.vendor.11.user.7", "not-json");
    await expect(inspectWorkHubQueue(store, susie)).rejects.toThrow("could not be read");
    expect(store.values.get("vndrly.workHub.queue.v2.vendor.11.user.7")).toBe("not-json");
    const clean = memoryStore();
    await expect(enqueueWorkHubUpload(clean, susie, {
      path: "/api/work-hub/files", fileUri: "file:///private/a", contentType: "image/jpeg", headers: { authorization: "secret" },
    })).rejects.toThrow("Unsupported offline upload metadata");
  });
});
