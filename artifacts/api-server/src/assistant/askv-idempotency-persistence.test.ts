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
    expect(state.rows[0].toolOutput).toEqual({
      format: "askv-operation-result-v1",
      output: result.value,
    });
    vi.resetModules();
    const second = await import("./askv-idempotency");
    const replay = await second.runPersistentAskVMutation(scope, operation);
    expect(replay.value).toBe(result.value);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("replays a completed legacy JSON result without executing it again", async () => {
    const first = await import("./askv-idempotency");
    await first.runPersistentAskVMutation(scope, async () =>
      JSON.stringify({ ok: true, visitId: 44 }),
    );
    // The real PostgreSQL/Drizzle read path decodes legacy JSON strings into
    // objects; this is the shape that previously became outcomeUnknown.
    state.rows[0].toolOutput = { ok: true, visitId: 44 };
    vi.resetModules();
    const second = await import("./askv-idempotency");
    const retry = vi.fn(async () => "duplicate");
    const result = await second.runPersistentAskVMutation(scope, retry);
    expect(result.hit).toBe(true);
    expect(JSON.parse(result.value)).toEqual({ ok: true, visitId: 44 });
    expect(retry).not.toHaveBeenCalled();
  });
  it.each([null, false, 0, ["result"]].map((value) => ({ value })))(
    "replays a completed legacy JSON value %j",
    async ({ value }) => {
      const first = await import("./askv-idempotency");
      await first.runPersistentAskVMutation(scope, async () =>
        JSON.stringify(value),
      );
      state.rows[0].toolOutput = value;
      vi.resetModules();
      const second = await import("./askv-idempotency");
      const retry = vi.fn(async () => "duplicate");
      expect((await second.runPersistentAskVMutation(scope, retry)).value).toBe(
        JSON.stringify(value),
      );
      expect(retry).not.toHaveBeenCalled();
    },
  );
  it.each(
    ["assistant.action_pending", "assistant.tool_failed"].flatMap((errorCode) =>
      [
        "stored result",
        { format: "askv-operation-result-v1", output: "stored result" },
        { ok: true },
      ].map((toolOutput) => ({ errorCode, toolOutput })),
    ),
  )(
    "does not treat a $errorCode reservation with retained output as completed",
    async ({ errorCode, toolOutput }) => {
      const first = await import("./askv-idempotency");
      await first.runPersistentAskVMutation(
        scope,
        async () => "initial result",
      );
      Object.assign(state.rows[0], { errorCode, toolOutput });
      vi.resetModules();
      const second = await import("./askv-idempotency");
      const retry = vi.fn(async () => "duplicate");
      const result = await second.runPersistentAskVMutation(scope, retry);
      expect(JSON.parse(result.value).outcomeUnknown).toBe(true);
      expect(retry).not.toHaveBeenCalled();
    },
  );
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
