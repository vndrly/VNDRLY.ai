import { describe, expect, it, vi } from "vitest";
import { RETENTION_CLASSES } from "@workspace/api-zod";
import {
  createEmptyRetentionPlanAggregates,
  createRetentionPlannerService,
  createRetentionPlannerWorker,
  type RetentionCandidate,
} from "./governance-retention-planner";

const owner = { type: "vendor" as const, id: 41 };
const actor = { userId: 7, source: "web" as const };
const operationId = "11111111-1111-4111-8111-111111111111";
const rules = Object.fromEntries(RETENTION_CLASSES.map((key) => [key, 30])) as Record<(typeof RETENTION_CLASSES)[number], number>;
const snapshotAt = new Date("2026-09-10T12:00:00.000Z");

function candidate(overrides: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    cursor: "2026-01-01T00:00:00.000Z:a",
    bytes: 10,
    graph: {
      subject: { type: "channel", id: "22222222-2222-4222-8222-222222222222" },
      ancestors: [{ type: "organization", id: "41" }],
    },
    referenceState: "clear",
    ...overrides,
  };
}

function harness(pages: Record<string, RetentionCandidate[][]> = {}) {
  const offsets = new Map<string, number>();
  const repository: any = {
    enqueue: vi.fn(async () => ({ replayed: false as const, resource: { id: "33333333-3333-4333-8333-333333333333", owner, status: "pending", policyVersion: 4, minimumPolicyVersion: 2, snapshotAt: snapshotAt.toISOString(), classAggregates: createEmptyRetentionPlanAggregates(), errorCodes: [], createdAt: snapshotAt.toISOString(), startedAt: null, finishedAt: null } })),
    claimNext: vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333", actor, owner, operationId, snapshotAt, policyId: "44444444-4444-4444-8444-444444444444", policyVersion: 4, minimumPolicyVersion: 2, attemptCount: 1, leaseExpiresAt: new Date(snapshotAt.getTime()+900_000) })),
    loadContext: vi.fn(async () => ({
      policy: { id: "44444444-4444-4444-8444-444444444444", version: 4, rules },
      minimum: { version: 2, rules },
      holds: [] as Array<{ subjectType: string; subjectId: string; active: boolean }>,
    })),
    readCandidates: vi.fn(async ({ retentionClass }: { retentionClass: string; afterCursor: string | null }) => {
      const offset = offsets.get(retentionClass) ?? 0;
      offsets.set(retentionClass, offset + 1);
      return pages[retentionClass]?.[offset] ?? [];
    }),
    complete: vi.fn(async (input) => ({
      replayed: false,
      resource: {
        id: input.planId,
        owner: input.owner,
        status: "completed" as const,
        policyVersion: input.policyVersion,
        minimumPolicyVersion: input.minimumPolicyVersion,
        snapshotAt: input.snapshotAt.toISOString(),
        classAggregates: input.classAggregates,
        errorCodes: input.errorCodes,
        createdAt: input.snapshotAt.toISOString(),
        startedAt: input.snapshotAt.toISOString(),
        finishedAt: input.snapshotAt.toISOString(),
      },
    })),
    fail: vi.fn(async () => undefined),
    read: vi.fn(async () => null),
  };
  const authorizeOwnerAdmin = vi.fn(async () => undefined);
  return {
    repository,
    authorizeOwnerAdmin,
    service: createRetentionPlannerService({ authorizeOwnerAdmin, repository, now: () => snapshotAt }),
    worker: createRetentionPlannerWorker({ repository, authorizeCurrent: authorizeOwnerAdmin, now: () => snapshotAt, chunkSize: 2 }),
  };
}

describe("retention dry-run planner", () => {
  it("fails closed without an explicit current policy and platform minimum", async () => {
    const h = harness();
    h.repository.loadContext.mockResolvedValueOnce({ policy: null, minimum: null, holds: [] } as never);
    await h.service.create({ actor, body: { operationId, owner } });
    await expect(h.worker.runOne()).resolves.toBe(true);
    expect(h.repository.readCandidates).not.toHaveBeenCalled();
    expect(h.repository.complete).not.toHaveBeenCalled();
  });

  it("counts a direct or ancestor legal hold without persisting candidate identity", async () => {
    const held = candidate();
    const h = harness({ messages: [[held], []] });
    h.repository.loadContext.mockResolvedValueOnce({
      policy: { id: "44444444-4444-4444-8444-444444444444", version: 4, rules },
      minimum: { version: 2, rules },
      holds: [{ subjectType: "organization", subjectId: "41", active: true }],
    });
    await h.service.create({ actor, body: { operationId, owner } });
    await h.worker.runOne();
    expect(h.repository.complete.mock.calls[0][0].classAggregates.messages).toEqual({
      eligibleCount: 0, eligibleBytes: 0, heldCount: 1, heldBytes: 10,
      referenceBlockedCount: 0, referenceBlockedBytes: 0,
    });
    expect(JSON.stringify(h.repository.complete.mock.calls[0]?.[0])).not.toContain(held.cursor);
    expect(JSON.stringify(h.repository.complete.mock.calls[0][0].classAggregates)).not.toContain(held.graph.subject.id);
  });

  it("keeps referenced and unknown-dependent candidates out of eligible aggregates", async () => {
    const h = harness({ notes_versions: [[
      candidate({ cursor: "1:a", bytes: 7, referenceState: "blocked" }),
      candidate({ cursor: "2:b", bytes: 11, referenceState: "unknown" }),
    ], []] });
    await h.service.create({ actor, body: { operationId, owner } });
    await h.worker.runOne();
    const completed = h.repository.complete.mock.calls[0][0];
    expect(completed.classAggregates.notes_versions.referenceBlockedCount).toBe(2);
    expect(completed.classAggregates.notes_versions.referenceBlockedBytes).toBe(18);
    expect(completed.errorCodes).toEqual(["reference_unresolved"]);
  });

  it("reads stable cursor pages and produces deterministic safe-integer aggregates", async () => {
    const h = harness({ messages: [[candidate({ cursor: "1:a", bytes: 5 }), candidate({ cursor: "2:b", bytes: 6 })], [candidate({ cursor: "3:c", bytes: 7 })], []] });
    await h.service.create({ actor, body: { operationId, owner } });
    await h.worker.runOne();
    expect(h.repository.readCandidates.mock.calls.filter((call: any[]) => call[0].retentionClass === "messages").map((call: any[]) => call[0].afterCursor)).toEqual([null, "2:b", "3:c"]);
    expect(h.repository.complete.mock.calls[0][0].classAggregates.messages.eligibleCount).toBe(3);
    expect(h.repository.complete.mock.calls[0][0].classAggregates.messages.eligibleBytes).toBe(18);
  });

  it("fails closed on aggregate byte overflow and never publishes partial evidence", async () => {
    const h = harness({ files_voice_notes: [[candidate({ cursor: "1:a", bytes: Number.MAX_SAFE_INTEGER }), candidate({ cursor: "2:b", bytes: 1 })]] });
    await h.service.create({ actor, body: { operationId, owner } });
    await expect(h.worker.runOne()).resolves.toBe(true);
    expect(h.repository.complete).not.toHaveBeenCalled();
    expect(h.repository.fail).toHaveBeenCalledWith(expect.objectContaining({ errorCodes: ["internal_failure"] }));
  });

  it("reauthorizes during the run and rejects policy or minimum races atomically", async () => {
    const h = harness({ attendance: [[candidate()], []] });
    h.repository.complete.mockRejectedValueOnce(Object.assign(new Error("changed"), { code: "retention.policy_changed", status: 409 }));
    await h.service.create({ actor, body: { operationId, owner } });
    await expect(h.worker.runOne()).resolves.toBe(true);
    expect(h.repository.fail).toHaveBeenCalledWith(expect.objectContaining({ errorCodes: ["policy_changed"] }));
    expect(h.authorizeOwnerAdmin.mock.calls.length).toBeGreaterThan(1);
  });

  it("publishes against a fingerprint of the active hold set so a new hold forces a retry", async () => {
    const h = harness({ messages: [[candidate()], []] });
    h.repository.loadContext.mockResolvedValueOnce({
      policy: { id: "44444444-4444-4444-8444-444444444444", version: 4, rules },
      minimum: { version: 2, rules },
      holds: [{ subjectType: "organization", subjectId: "41", active: true }],
    });
    await h.service.create({ actor, body: { operationId, owner } });
    await h.worker.runOne();
    expect(h.repository.complete).toHaveBeenCalledWith(expect.objectContaining({ activeHoldFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(JSON.stringify(h.repository.complete.mock.calls[0][0])).not.toContain('"subjectId"');
  });

  it("returns exact operation replay without recomputing candidates", async () => {
    const h = harness();
    const aggregates = createEmptyRetentionPlanAggregates();
    h.repository.enqueue.mockResolvedValueOnce({ replayed: true, resource: {
      id: "33333333-3333-4333-8333-333333333333", owner, status: "completed", policyVersion: 4,
      minimumPolicyVersion: 2, snapshotAt: snapshotAt.toISOString(), classAggregates: aggregates, errorCodes: [],
      createdAt: snapshotAt.toISOString(), startedAt: snapshotAt.toISOString(), finishedAt: snapshotAt.toISOString(),
    } });
    const result = await h.service.create({ actor, body: { operationId, owner } });
    expect(result.replayed).toBe(true);
    expect(h.repository.claimNext).not.toHaveBeenCalled();
    expect(h.repository.loadContext).not.toHaveBeenCalled();
    expect(h.repository.readCandidates).not.toHaveBeenCalled();
  });
});
