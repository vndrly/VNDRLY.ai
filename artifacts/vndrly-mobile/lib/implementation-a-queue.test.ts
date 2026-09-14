import { describe, expect, it } from "vitest";
import { createImplementationAQueue, type ImplementationAQueueStore } from "./implementation-a-queue";

function store(): ImplementationAQueueStore { let value: string | null = null; return { getItem: async () => value, setItem: async (_key, next) => { value = next; } }; }
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
    await expect(queue.inspect({ ...scope, ownerOrgId: 2 })).rejects.toThrow("scope mismatch");
  });
});
