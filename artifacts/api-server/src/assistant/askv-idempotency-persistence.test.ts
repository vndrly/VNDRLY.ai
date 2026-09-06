import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  inTransaction: false,
}));
vi.mock("@workspace/db", () => {
  const transaction = {
    execute: vi.fn(async () => undefined),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => state.rows.slice(0, 1) }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          const row = { ...value, id: state.rows.length + 1 };
          state.rows.push(row);
          return [row];
        },
      }),
    }),
  };
  return {
    assistantActionAuditTable: {
      userId: "user",
      actionType: "action",
      id: "id",
    },
    db: {
      transaction: async (
        operation: (tx: typeof transaction) => Promise<unknown>,
      ) => {
        state.inTransaction = true;
        try {
          return await operation(transaction);
        } finally {
          state.inTransaction = false;
        }
      },
      update: () => ({
        set: (value: Record<string, unknown>) => ({
          where: async () => {
            Object.assign(state.rows[0], value);
          },
        }),
      }),
    },
  };
});
const scope = {
  userId: 10,
  organizationKey: "vendor:22",
  sessionId: "s1",
  key: "c1",
  fingerprint: "same-args",
};
beforeEach(() => {
  state.rows = [];
  state.inTransaction = false;
  vi.resetModules();
});
describe("AskV durable replay reservations", () => {
  it("commits its reservation before writing and replays after module/process state is lost", async () => {
    const first = await import("./askv-idempotency");
    const operation = vi.fn(async () => {
      expect(state.inTransaction).toBe(false);
      expect(state.rows).toHaveLength(1);
      return JSON.stringify({ ok: true, visitId: 44 });
    });
    const result = await first.runPersistentAskVMutation(scope, operation);
    vi.resetModules();
    const second = await import("./askv-idempotency");
    const replay = await second.runPersistentAskVMutation(scope, operation);
    expect(replay.value).toBe(result.value);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("does not retry a write with an unknown outcome after interruption", async () => {
    const first = await import("./askv-idempotency");
    await expect(
      first.runPersistentAskVMutation(scope, async () => {
        throw new Error("connection lost after write");
      }),
    ).rejects.toThrow();
    vi.resetModules();
    const second = await import("./askv-idempotency");
    const retry = vi.fn(async () => "duplicate");
    expect(
      JSON.parse((await second.runPersistentAskVMutation(scope, retry)).value)
        .outcomeUnknown,
    ).toBe(true);
    expect(retry).not.toHaveBeenCalled();
  });
  it("refuses an explicit key reused with a different intent after restart", async () => {
    const first = await import("./askv-idempotency");
    await first.runPersistentAskVMutation(scope, async () => "first");
    vi.resetModules();
    const second = await import("./askv-idempotency");
    const retry = vi.fn(async () => "duplicate");
    await expect(
      second.runPersistentAskVMutation(
        { ...scope, fingerprint: "changed-args" },
        retry,
      ),
    ).rejects.toThrow(/different/);
    expect(retry).not.toHaveBeenCalled();
  });
});
