import { describe, expect, it, vi } from "vitest";
import { executeIdempotentOperation } from "./operation-ledger";

const operationId = "11111111-1111-4111-8111-111111111111";
const envelope = {
  operationId,
  occurredAt: "2026-09-13T12:00:00.000Z",
  deviceId: "device-1",
  expectedVersion: 3,
  payload: { title: "Shift A" },
};

describe("Implementation A operation ledger", () => {
  it("maps a newly applied command to an authoritative receipt", async () => {
    const execute = vi.fn(async (_actor, _kind, _legacyEnvelope, apply) => ({
      operationId,
      appliedAt: "2026-09-13T12:00:01.000Z",
      replayed: false,
      resource: await apply({}),
    }));

    const result = await executeIdempotentOperation({
      actor: { userId: 7, source: "web" },
      kind: "implementation-a.shift.assign",
      owner: { type: "vendor", id: 41 },
      context: { kind: "site", id: 9 },
      envelope,
      execute,
      apply: async () => ({ id: "shift-1", version: 4 }),
    });

    expect(result).toEqual({
      operationId,
      status: "applied",
      resource: { id: "shift-1", version: 4 },
      authoritativeVersion: 4,
    });
  });

  it("returns duplicate without reapplying a replayed command", async () => {
    const apply = vi.fn(async () => ({ id: "shift-1", version: 4 }));
    const execute = vi.fn(async () => ({
      operationId,
      appliedAt: "2026-09-13T12:00:01.000Z",
      replayed: true,
      resource: { id: "shift-1", version: 4 },
    }));

    await expect(
      executeIdempotentOperation({
        actor: { userId: 7, source: "ios" },
        kind: "implementation-a.shift.assign",
        owner: { type: "vendor", id: 41 },
        context: { kind: "site", id: 9 },
        envelope,
        execute,
        apply,
      }),
    ).resolves.toMatchObject({ status: "duplicate", authoritativeVersion: 4 });
    expect(apply).not.toHaveBeenCalled();
  });
});
