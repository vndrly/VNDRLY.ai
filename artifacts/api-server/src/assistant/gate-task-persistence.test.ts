import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ rows: [] as any[], owners: [{ id: 3, userId: 1 }], locked: false, failFinal: false, tail: Promise.resolve() }));
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: unknown) => (row: any) => row[key] === value,
  and: (...predicates: any[]) => (row: any) => predicates.every(p => p(row)),
  sql: (_strings: TemplateStringsArray, _column: unknown, version: string) => (row: any) => String(row.toolOutput.version) === version,
}));
vi.mock("./askv-pending-confirmation", () => ({ organizationKeyFromSession: (s: any) => `vendor:${s.vendorId}`, askvPendingConfirmations: { clear: vi.fn() }, askVConfirmationScopeId: (id: number) => String(id) }));
vi.mock("@workspace/db", () => {
  const audit = { id: "id", userId: "userId", actionType: "actionType", toolOutput: "toolOutput" };
  const conversations = { id: "id", userId: "userId" };
  const database: any = {
    select: () => ({ from: (table: any) => ({ where: (predicate: any) => {
      const read = () => (table === conversations ? store.owners : store.rows).filter(predicate).map(row => structuredClone(row));
      return { then: (resolve: any) => Promise.resolve(read()).then(resolve), for: async () => read(), limit: async (n: number) => read().slice(0, n) };
    } }) }),
    insert: () => ({ values: async (row: any) => { store.rows.push({ ...row, id: store.rows.length + 1 }); } }),
    update: () => ({ set: (value: any) => ({ where: async (predicate: any) => {
      if (!store.locked && store.failFinal) throw Error("storage unavailable");
      store.rows.filter(predicate).forEach(row => Object.assign(row, structuredClone(value)));
    } }) }),
    transaction: async (fn: any) => {
      const previous = store.tail;
      let release!: () => void;
      store.tail = new Promise<void>(resolve => { release = resolve; });
      await previous; store.locked = true;
      try { return await fn(database); } finally { store.locked = false; release(); }
    },
  };
  return { db: database, assistantActionAuditTable: audit, assistantConversationsTable: conversations };
});
import { accessGateTask, executeWithGateTask } from "./gate-task-state";
const actor = { userId: 1, role: "vendor", vendorId: 2 };
const fields = { firstName: "Fixture", lastName: "Worker", siteLocationId: 9 };
beforeEach(() => { store.rows = []; store.locked = false; store.failFinal = false; store.tail = Promise.resolve(); });
async function start() { return accessGateTask(actor, 3, { action: "start", expectedVersion: 0, taskType: "check_in", fields }); }
it("persists before the write and resumes the receipt without a second operation", async () => {
  await start();
  const operation = vi.fn(async () => {
    expect(store.locked).toBe(false);
    expect(store.rows[0].toolOutput.state).toBe("outcome_unknown");
    return JSON.stringify({ ok: true, visitId: 11 });
  });
  const result = await executeWithGateTask(actor, 3, "confirm_visitor_check_in", fields, operation);
  expect(await accessGateTask(actor, 3)).toMatchObject({ state: "saved", version: 3 });
  expect(await executeWithGateTask(actor, 3, "confirm_visitor_check_in", fields, operation)).toBe(result);
  expect(operation).toHaveBeenCalledTimes(1);
});
it("blocks simultaneous calls while the first save is in flight", async () => {
  await start();
  let finish!: (value: string) => void;
  let started!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const operation = vi.fn(() => { started(); return new Promise<string>(resolve => { finish = resolve; }); });
  const first = executeWithGateTask(actor, 3, "confirm_visitor_check_in", fields, operation);
  await begun;
  expect(JSON.parse(await executeWithGateTask(actor, 3, "confirm_visitor_check_in", fields, operation))).toMatchObject({ status: "outcome_unknown" });
  finish(JSON.stringify({ ok: true, visitId: 11 })); await first;
  expect(operation).toHaveBeenCalledTimes(1);
});
it("retains uncertainty if completion storage fails after the business save", async () => {
  await start(); store.failFinal = true;
  const operation = vi.fn(async () => JSON.stringify({ ok: true, visitId: 11 }));
  expect(JSON.parse(await executeWithGateTask(actor, 3, "confirm_visitor_check_in", fields, operation))).toMatchObject({ status: "outcome_unknown" });
  store.failFinal = false;
  await executeWithGateTask(actor, 3, "confirm_visitor_check_in", fields, operation);
  expect(operation).toHaveBeenCalledTimes(1);
});
it("isolates company drafts and rejects another user's conversation", async () => {
  await start();
  expect(await accessGateTask({ ...actor, vendorId: 4 }, 3)).toBeNull();
  await expect(accessGateTask({ ...actor, userId: 2 }, 3)).rejects.toThrow("Conversation unavailable");
});
it("does not overwrite a newer task when a delayed result arrives", async () => {
  await start();
  await executeWithGateTask(actor, 3, "confirm_visitor_check_in", fields, async () => {
    store.rows[0].toolOutput = { version: 5, taskType: "check_out", state: "draft", fields: { visitId: 11 } };
    return JSON.stringify({ ok: true, visitId: 11 });
  });
  expect(await accessGateTask(actor, 3)).toMatchObject({ version: 5, taskType: "check_out", state: "draft" });
});
