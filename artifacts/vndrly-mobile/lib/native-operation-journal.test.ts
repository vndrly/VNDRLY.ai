import { describe, expect, it, vi } from "vitest";
import { createNativeOperationJournal, type JournalEntry } from "./native-operation-journal";
const scope = { userId: 1, membershipId: 2, orgType: "vendor" as const, orgId: 3 };
const entry = (n: number) => ({ operationId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, domain: "gate" as const, capturedAt: "2026-10-08T01:00:00Z", payload: { direction: n === 1 ? "entry" : "exit" } });
function setup() { const values = new Map<string, string>(); return createNativeOperationJournal({ getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } }); }
describe("protected offline operation journal", () => {
  it("serializes simultaneous writes and isolates membership and company", async () => {
    const journal = setup(); await Promise.all([journal.enqueue(scope, entry(1)), journal.enqueue(scope, entry(2))]);
    expect(await journal.inspect(scope)).toHaveLength(2);
    expect(await journal.inspect({ ...scope, membershipId: 7 })).toEqual([]);
    expect(await journal.inspect({ ...scope, orgId: 7 })).toEqual([]);
  });
  it("retains the original immutable operation when acknowledgment was lost", async () => {
    const journal = setup(); await journal.enqueue(scope, entry(1));
    await journal.flush(scope, async () => { throw new Error("connection lost after save"); });
    await expect(journal.enqueue(scope, { ...entry(1), payload: { direction: "changed" } })).rejects.toThrow("identity");
    const transport = vi.fn(async (_: JournalEntry) => undefined); await journal.flush(scope, transport);
    expect(transport.mock.calls[0][0]).toMatchObject(entry(1)); expect(await journal.inspect(scope)).toEqual([]);
  });
  it("preserves entry-before-exit on network loss and quarantines conflicts and revoked access", async () => {
    const journal = setup(); await journal.enqueue(scope, entry(1)); await journal.enqueue(scope, entry(2));
    const unreachable = vi.fn(async () => { throw new Error("offline"); }); await journal.flush(scope, unreachable);
    expect(unreachable).toHaveBeenCalledTimes(1); expect((await journal.inspect(scope)).map(item => item.operationId)).toEqual([entry(1).operationId, entry(2).operationId]);
    await journal.flush(scope, async item => { throw Object.assign(new Error("refused"), { status: item.operationId === entry(1).operationId ? 409 : 403 }); });
    expect((await journal.inspect(scope)).map(item => item.state)).toEqual(["conflict", "revoked"]);
    const retry = vi.fn(); await journal.flush(scope, retry); expect(retry).not.toHaveBeenCalled();
  });
});
