import { describe, expect, it } from "vitest";
import { createImplementationAQueue, type ImplementationAQueueStore } from "./implementation-a-queue";

function store(): ImplementationAQueueStore { const values = new Map<string, string>(); return { getItem: async key => values.get(key) ?? null, setItem: async (key, next) => { values.set(key, next); } }; }
const scope = { userId: 7, ownerOrgType: "vendor" as const, ownerOrgId: 1, deviceId: "phone-1" };

describe("Implementation A offline queue", () => {
  it.each(["gate", "custody", "schedule", "task", "incident"] as const)("replays %s exactly once across repeated flushes", async domain => {
    const effects: string[] = []; const queue = createImplementationAQueue(store());
    const command = await queue.enqueue(scope, { domain, domainVersion: 1, operationId: `${domain}-operation`, originalEventAt: "2026-09-14T12:00:00Z", path: `/api/implementation-a/${domain}`, method: "POST", payload: { value: domain } });
    await queue.flush(scope, async item => { if (!effects.includes(item.operationId)) effects.push(item.operationId); });
    await queue.flush(scope, async item => { effects.push(item.operationId); });
    expect(effects).toEqual([command.operationId]);
  });

  it("surfaces a custody conflict and does not retry it forever", async () => {
    const queue = createImplementationAQueue(store()); let attempts = 0;
    await queue.enqueue(scope, { domain: "custody", domainVersion: 3, operationId: "stale-custody", originalEventAt: "2026-09-14T12:00:00Z", path: "/api/implementation-a/assets/a1/checkout", method: "POST", payload: { expectedVersion: 2 } });
    await queue.flush(scope, async () => { attempts += 1; throw Object.assign(new Error("conflict"), { status: 409 }); });
    await queue.flush(scope, async () => { attempts += 1; });
    expect(attempts).toBe(1);
    await expect(queue.inspect(scope)).resolves.toMatchObject({ items: [{ state: "conflict", visibleResolution: "Review the latest custody history before retrying." }] });
  });

  it("never replays into a different authenticated scope", async () => {
    const queue = createImplementationAQueue(store());
    await queue.enqueue(scope, { domain: "task", domainVersion: 1, operationId: "scoped", originalEventAt: "2026-09-14T12:00:00Z", path: "/api/implementation-a/task", method: "POST", payload: {} });
    await expect(queue.inspect({ ...scope, ownerOrgId: 2 })).resolves.toMatchObject({ items: [] });
    await expect(queue.inspect(scope)).resolves.toMatchObject({ items: [{ operationId: "scoped" }] });
  });
  it("migrates the original legacy scope without deleting or resurrecting its operations", async () => {
    const storage = store(), queue = createImplementationAQueue(storage);
    const item = { operationId: "original", domain: "gate", domainVersion: 1, path: "/api/implementation-a/gate", method: "POST", payload: { reviewed: true }, originalEventAt: "2026-10-08T01:00:00Z", authScope: scope, deviceId: scope.deviceId, state: "pending", attempts: 0 };
    const legacy = JSON.stringify({ version: 1, scope, items: [item] });
    await storage.setItem("implementation-a-offline-queue-v1", legacy);
    expect((await queue.inspect({ ...scope, ownerOrgId: 2 })).items).toEqual([]);
    expect((await queue.inspect(scope)).items[0]).toMatchObject({ operationId: "original", payload: { reviewed: true } });
    await queue.flush(scope, async () => undefined);
    expect((await queue.inspect(scope)).items).toEqual([]);
    expect(await storage.getItem("implementation-a-offline-queue-v1")).toBe(legacy);
  });
  it("serializes concurrent enqueue and rejects replacement of the original operation body", async () => {
    const queue = createImplementationAQueue(store());
    const input = { domain: "task" as const, domainVersion: 1, operationId: "first", originalEventAt: "2026-10-08T01:00:00Z", path: "/api/implementation-a/task", method: "POST" as const, payload: { exact: 1 } };
    await Promise.all([queue.enqueue(scope, input), queue.enqueue(scope, { ...input, operationId: "second" })]);
    expect((await queue.inspect(scope)).items).toHaveLength(2);
    await expect(queue.enqueue(scope, { ...input, payload: { exact: 2 } })).rejects.toThrow("operation changed");
  });
});
