import { describe, expect, it, vi } from "vitest";
import { RETENTION_CLASSES } from "@workspace/api-zod";
import {
  createRetentionPlannerService,
  createRetentionPlannerWorker,
  retentionPlanStaleTransition,
  validateRetentionPlanTotals,
  type RetentionCandidate,
  type RetentionPlanJob,
} from "./governance-retention-planner";
import { createRetentionPlannerDrain } from "./governance-retention-planner-runtime";

const owner = { type: "vendor" as const, id: 41 };
const actor = { userId: 7, source: "web" as const };
const operationId = "11111111-1111-4111-8111-111111111111";
const at = new Date("2026-09-10T12:00:00.000Z");
const rules = Object.fromEntries(RETENTION_CLASSES.map((key) => [key, 30])) as Record<(typeof RETENTION_CLASSES)[number], number>;
const job: RetentionPlanJob = { id: "33333333-3333-4333-8333-333333333333", actor, owner, operationId, snapshotAt: at, policyId: "44444444-4444-4444-8444-444444444444", policyVersion: 4, minimumPolicyVersion: 2, attemptCount: 1, leaseExpiresAt: new Date(at.getTime() + 90_000) };
const resource = { id: job.id, owner, status: "pending" as const, policyVersion: 4, minimumPolicyVersion: 2, snapshotAt: at.toISOString(), classAggregates: Object.fromEntries(RETENTION_CLASSES.map((key) => [key, { eligibleCount: 0, eligibleBytes: 0, heldCount: 0, heldBytes: 0, referenceBlockedCount: 0, referenceBlockedBytes: 0 }])), errorCodes: [], createdAt: at.toISOString(), startedAt: null, finishedAt: null } as any;

function row(cursor: string, bytes = 1): RetentionCandidate { return { cursor, bytes, graph: { subject: { type: "organization", id: "41" }, ancestors: [] }, referenceState: "clear" }; }

describe("retention plan queue and leased worker", () => {
  it("POST only enqueues and performs no candidate scan", async () => {
    const repository: any = { enqueue: vi.fn(async () => ({ replayed: false, resource })), read: vi.fn(), readCandidates: vi.fn() };
    const service = createRetentionPlannerService({ authorizeOwnerAdmin: vi.fn(async () => undefined), repository, now: () => at });
    await expect(service.create({ actor, body: { operationId, owner } })).resolves.toMatchObject({ resource: { status: "pending" } });
    expect(repository.enqueue).toHaveBeenCalledOnce();
    expect(repository.readCandidates).not.toHaveBeenCalled();
  });

  it("allows two workers to observe one atomic claim only", async () => {
    let claimed = false;
    const repository: any = {
      claimNext: vi.fn(async () => claimed ? null : (claimed = true, job)),
      loadContext: vi.fn(async () => ({ policy: { id: job.policyId, version: 4, rules }, minimum: { version: 2, rules }, holds: [] })),
      readCandidates: vi.fn(async () => []), complete: vi.fn(async () => true), fail: vi.fn(async () => true), recoverStale: vi.fn(),
    };
    const worker = createRetentionPlannerWorker({ repository, authorizeCurrent: vi.fn(async () => undefined), now: () => at });
    const results = await Promise.all([worker.runOne(), worker.runOne()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it("fails with aggregate-only limit_exceeded before publication when total rows exceed the ceiling", async () => {
    const repository: any = {
      claimNext: vi.fn(async () => job), loadContext: vi.fn(async () => ({ policy: { id: job.policyId, version: 4, rules }, minimum: { version: 2, rules }, holds: [] })),
      readCandidates: vi.fn(async ({ retentionClass }: any) => retentionClass === "messages" ? [row("1:a"), row("2:b")] : []),
      complete: vi.fn(), fail: vi.fn(async () => true), recoverStale: vi.fn(),
    };
    const worker = createRetentionPlannerWorker({ repository, authorizeCurrent: vi.fn(async () => undefined), now: () => at, maximumTotalRows: 1 });
    await expect(worker.runOne()).resolves.toBe(true);
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({ errorCodes: ["limit_exceeded"] }));
    expect(JSON.stringify(repository.fail.mock.calls[0][0])).not.toContain("1:a");
  });

  it("fails closed before audit publication if the clock moves backwards", async () => {
    const times = [at, new Date(at.getTime() - 1)];
    const repository: any = { claimNext: vi.fn(async () => job), loadContext: vi.fn(async () => ({ policy: { id: job.policyId, version: 4, rules }, minimum: { version: 2, rules }, holds: [] })), readCandidates: vi.fn(async () => []), complete: vi.fn(), fail: vi.fn(async () => true), recoverStale: vi.fn() };
    const worker = createRetentionPlannerWorker({ repository, authorizeCurrent: vi.fn(async () => undefined), now: () => times.shift() ?? at });
    await worker.runOne();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({ errorCodes: ["internal_failure"] }));
  });

  it("recovers stale leases until attempts are exhausted", () => {
    expect(retentionPlanStaleTransition(1, 3, at)).toEqual({ retrying: true, status: "pending", finishedAt: null, errorCodes: ["lease_expired"] });
    expect(retentionPlanStaleTransition(3, 3, at)).toEqual({ retrying: false, status: "failed", finishedAt: at, errorCodes: ["lease_expired"] });
  });
});

describe("retention planner drain", () => {
  it("allows only one drain and stops between bounded jobs", async () => {
    let drain!: ReturnType<typeof createRetentionPlannerDrain>;
    const runOne = vi.fn(async () => { drain.stop(); return true; });
    drain = createRetentionPlannerDrain({ runOne, recoverStale: vi.fn(async () => 0), onError: vi.fn() });
    drain.start();
    await Promise.all([drain.drain(), drain.drain()]);
    expect(runOne).toHaveBeenCalledOnce();
  });

  it("contains recovery failure and can drain later", async () => {
    const onError = vi.fn();
    const drain = createRetentionPlannerDrain({ runOne: vi.fn(async () => false), recoverStale: vi.fn().mockRejectedValueOnce(new Error("recover")), onError });
    await expect(drain.start()).resolves.toBeUndefined();
    await expect(drain.drain()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("awaits the active job before stop resolves and never starts another job", async () => {
    let release!: () => void;
    const active = new Promise<void>((resolve) => { release = resolve; });
    const runOne = vi.fn()
      .mockImplementationOnce(async () => { await active; return true; })
      .mockResolvedValue(false);
    const drain = createRetentionPlannerDrain({ runOne, recoverStale: vi.fn(async () => 0), onError: vi.fn() });
    const starting = drain.start();
    await vi.waitFor(() => expect(runOne).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = drain.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([starting, stopping]);
    expect(runOne).toHaveBeenCalledOnce();
  });
});

describe("retention plan aggregate reconciliation", () => {
  it("rejects a total that does not equal eligible plus held plus reference-blocked", () => {
    const aggregates = resource.classAggregates;
    aggregates.messages.eligibleCount = 1;
    expect(() => validateRetentionPlanTotals(aggregates, 2)).toThrow(/evidence/i);
  });

  it("rejects safe-integer overflow while summing publication totals", () => {
    const aggregates = resource.classAggregates;
    aggregates.messages.heldCount = Number.MAX_SAFE_INTEGER;
    aggregates.deleted_messages.referenceBlockedCount = 1;
    expect(() => validateRetentionPlanTotals(aggregates, Number.MAX_SAFE_INTEGER)).toThrow(/evidence/i);
  });
});
