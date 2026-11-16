import { describe, expect, it, vi } from "vitest";
import {
  createNativeOperationJournal,
  type JournalEntry,
} from "./native-operation-journal";
const scope = {
  userId: 1,
  membershipId: 2,
  orgType: "vendor" as const,
  orgId: 3,
};
const entry = (n: number) => ({
  operationId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  domain: "gate" as const,
  capturedAt: "2026-10-08T01:00:00Z",
  payload: { direction: n === 1 ? "entry" : "exit" },
});
function setup() {
  const values = new Map<string, string>();
  return createNativeOperationJournal({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  });
}
describe("protected offline operation journal", () => {
  it("replays a two-hour outage after restart without duplicating a crossing whose receipt was lost", async () => {
    const values = new Map<string, string>();
    const store = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
    let journal = createNativeOperationJournal(store);
    const arrival = { ...entry(1), capturedAt: new Date(Date.now() - 7200_000).toISOString(), payload: { siteLocationId: 1, direction: "entry" } };
    await journal.enqueue(scope, arrival);
    await journal.flush(scope, async () => { throw Object.assign(new Error("server unavailable"), { status: 503 }); });
    journal = createNativeOperationJournal(store); // Simulated process restart, same durable store.
    await journal.enqueue(scope, { ...entry(2), capturedAt: new Date().toISOString(), payload: { siteLocationId: 1, direction: "exit", entryOperationId: arrival.operationId } });
    const saved = new Map<string, { id: number }>(); let loseReceipt = true;
    const send = vi.fn(async (event: JournalEntry) => {
      if (!saved.has(event.operationId)) saved.set(event.operationId, { id: 44 });
      if (loseReceipt) { loseReceipt = false; throw new Error("response lost after commit"); }
      return saved.get(event.operationId);
    });
    await journal.flush(scope, send, () => true, () => true);
    journal = createNativeOperationJournal(store);
    await journal.flush(scope, send, () => true, () => true);
    expect(saved.size).toBe(2);
    expect(send.mock.calls.map(([e]) => e.operationId)).toEqual([arrival.operationId, arrival.operationId, entry(2).operationId]);
    expect((await journal.inspect(scope))[0]).toMatchObject({ capturedAt: arrival.capturedAt, state: "synced" });
  });
  it("allows new durable crossings while the server is stalled and retains receipts across reload", async () => {
    const values = new Map<string, string>();
    const store = { getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); } };
    const journal = createNativeOperationJournal(store);
    await journal.enqueue(scope, entry(1));
    let acknowledge!: (value: { id: number }) => void;
    const stalled = new Promise<{ id: number }>(resolve => { acknowledge = resolve; });
    const upload = journal.flush(scope, () => stalled, () => true, () => true);
    await journal.enqueue(scope, { ...entry(2), payload: { direction: "exit", entryOperationId: entry(1).operationId } });
    expect(await createNativeOperationJournal(store).inspect(scope)).toHaveLength(2);
    acknowledge({ id: 44 });
    await upload;
    const reloaded = createNativeOperationJournal(store);
    expect((await reloaded.inspect(scope))[0]).toMatchObject({ state: "synced", receipt: { id: 44 } });
    const send = vi.fn(async () => ({ id: 44 }));
    await reloaded.flush(scope, send, () => true, () => true);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await reloaded.inspect(scope)).map(e => e.state)).toEqual(["synced", "synced"]);
  });
  it("keeps rate limited records retryable with the same operation identity", async () => {
    const journal = setup();
    await journal.enqueue(scope, entry(1));
    await journal.flush(scope, async () => { throw Object.assign(new Error("busy"), { status: 429 }); });
    expect((await journal.inspect(scope))[0]).toMatchObject({ state: "pending", operationId: entry(1).operationId });
  });
  it("only compacts receipts after a newer complete roster confirms departure", async () => {
    const journal = setup();
    await journal.enqueue(scope, { ...entry(1), payload: { siteLocationId: 1, direction: "entry" } });
    await journal.flush(scope, async () => ({ id: 7 }), () => true, () => true);
    const after = Date.now() + 1000;
    await journal.compactClosedGateReceipts(scope, 1, after, [7]);
    expect(await journal.inspect(scope)).toHaveLength(1);
    await journal.enqueue(scope, { ...entry(2), payload: { siteLocationId: 1, direction: "exit", entryOperationId: entry(1).operationId } });
    await journal.compactClosedGateReceipts(scope, 1, after, []);
    expect(await journal.inspect(scope)).toHaveLength(2);
    await journal.flush(scope, async () => ({ id: 7 }), () => true, () => true);
    await journal.compactClosedGateReceipts(scope, 1, after, []);
    expect(await journal.inspect(scope)).toEqual([]);
  });
  it("serializes simultaneous writes and isolates membership and company", async () => {
    const journal = setup();
    await Promise.all([
      journal.enqueue(scope, entry(1)),
      journal.enqueue(scope, entry(2)),
    ]);
    expect(await journal.inspect(scope)).toHaveLength(2);
    expect(await journal.inspect({ ...scope, membershipId: 7 })).toEqual([]);
    expect(await journal.inspect({ ...scope, orgId: 7 })).toEqual([]);
  });
  it("retains the original immutable operation when acknowledgment was lost", async () => {
    const journal = setup();
    await journal.enqueue(scope, entry(1));
    await journal.flush(scope, async () => {
      throw new Error("connection lost after save");
    });
    await expect(
      journal.enqueue(scope, {
        ...entry(1),
        payload: { direction: "changed" },
      }),
    ).rejects.toThrow("identity");
    const transport = vi.fn(async (_: JournalEntry) => undefined);
    await journal.flush(scope, transport);
    expect(transport.mock.calls[0][0]).toMatchObject(entry(1));
    expect(await journal.inspect(scope)).toEqual([]);
  });
  it("preserves entry-before-exit on network loss and quarantines conflicts and revoked access", async () => {
    const journal = setup();
    await journal.enqueue(scope, entry(1));
    await journal.enqueue(scope, entry(2));
    const unreachable = vi.fn(async () => {
      throw new Error("offline");
    });
    await journal.flush(scope, unreachable);
    expect(unreachable).toHaveBeenCalledTimes(1);
    expect(
      (await journal.inspect(scope)).map((item) => item.operationId),
    ).toEqual([entry(1).operationId, entry(2).operationId]);
    await journal.flush(scope, async (item) => {
      throw Object.assign(new Error("refused"), {
        status: item.operationId === entry(1).operationId ? 409 : 403,
      });
    });
    expect((await journal.inspect(scope)).map((item) => item.state)).toEqual([
      "conflict",
      "revoked",
    ]);
    const retry = vi.fn();
    await journal.flush(scope, retry);
    expect(retry).not.toHaveBeenCalled();
  });
});

it("retains excluded drafts unchanged while syncing Gate work", async () => {
  const journal = setup();
  await journal.enqueue(scope, { ...entry(3), domain: "custody" });
  await journal.enqueue(scope, entry(1));
  const sent = vi.fn(async () => {});
  await journal.flush(scope, sent, (e) => e.domain !== "custody");
  expect(sent).toHaveBeenCalledTimes(1);
  expect(
    (await journal.inspect(scope)).map((e) => ({
      domain: e.domain,
      attempts: e.attempts,
      state: e.state,
    })),
  ).toEqual([{ domain: "custody", attempts: 0, state: "pending" }]);
});
