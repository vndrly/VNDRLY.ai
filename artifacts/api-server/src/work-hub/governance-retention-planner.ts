import { createHash } from "node:crypto";
import {
  RETENTION_CLASSES,
  retentionPlanClassAggregatesSchema,
  retentionPlanErrorCodesSchema,
  validateOrganizationRetentionRules,
  workHubGovernanceOwnerSchema,
  type RetentionSubject,
  type WorkHubGovernanceOwner,
  type WorkHubRetentionPlanClassAggregates,
  type WorkHubRetentionPlanErrorCode,
  type WorkHubRetentionRules,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import {
  GovernanceRetentionError,
  isSubjectHeld,
  type SubjectGraph,
} from "./governance-retention";

const requestSchema = z.strictObject({
  operationId: z.uuid(),
  owner: workHubGovernanceOwnerSchema,
});

type Actor = { userId: number; source: "web" | "ios" };
type Hold = { subjectType: string; subjectId: string; active: boolean };
type PlanningContext = {
  policy: { id: string; version: number; rules: WorkHubRetentionRules } | null;
  minimum: { version: number; rules: WorkHubRetentionRules } | null;
  holds: Hold[];
};
type PlanResource = {
  id: string;
  owner: WorkHubGovernanceOwner;
  status: "pending" | "running" | "completed" | "failed";
  policyVersion: number;
  minimumPolicyVersion: number;
  snapshotAt: string;
  classAggregates: WorkHubRetentionPlanClassAggregates;
  errorCodes: WorkHubRetentionPlanErrorCode[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type RetentionCandidate = {
  /** Stable keyset cursor. It exists only during planning and is never persisted. */
  cursor: string;
  bytes: number;
  graph: SubjectGraph;
  /** Unknown relationships fail closed and are counted as reference-blocked. */
  referenceState: "clear" | "blocked" | "unknown";
};

type ServiceRepository = {
  enqueue(input: {
    actor: Actor;
    owner: WorkHubGovernanceOwner;
    operationId: string;
    snapshotAt: Date;
  }): Promise<{ replayed: boolean; resource: PlanResource }>;
  read(input: { actor: Actor; owner: WorkHubGovernanceOwner; planId: string }): Promise<PlanResource | null>;
};

export type RetentionPlanJob = {
  id: string;
  actor: Actor;
  owner: WorkHubGovernanceOwner;
  operationId: string;
  snapshotAt: Date;
  policyId: string;
  policyVersion: number;
  minimumPolicyVersion: number;
  attemptCount: number;
  leaseExpiresAt: Date;
};

type WorkerRepository = {
  claimNext(input: { now: Date; leaseExpiresAt: Date; maximumAttempts: number }): Promise<RetentionPlanJob | null>;
  loadContext(input: {
    owner: WorkHubGovernanceOwner;
    snapshotAt: Date;
  }): Promise<PlanningContext>;
  readCandidates(input: {
    owner: WorkHubGovernanceOwner;
    retentionClass: (typeof RETENTION_CLASSES)[number];
    cutoff: Date;
    snapshotAt: Date;
    afterCursor: string | null;
    limit: number;
  }): Promise<RetentionCandidate[]>;
  complete(input: {
    actor: Actor;
    owner: WorkHubGovernanceOwner;
    operationId: string;
    planId: string;
    policyId: string;
    policyVersion: number;
    minimumPolicyVersion: number;
    snapshotAt: Date;
    classAggregates: WorkHubRetentionPlanClassAggregates;
    errorCodes: WorkHubRetentionPlanErrorCode[];
    activeHoldFingerprint: string;
    leaseExpiresAt: Date;
    finishedAt: Date;
    durationMs: number;
    totalRows: number;
    chunkCount: number;
  }): Promise<unknown>;
  fail(input: {
    actor: Actor;
    owner: WorkHubGovernanceOwner;
    operationId: string;
    planId: string;
    errorCodes: WorkHubRetentionPlanErrorCode[];
    leaseExpiresAt: Date;
    observedAt: Date;
    attemptCount: number;
    maximumAttempts: number;
  }): Promise<unknown>;
  recoverStale?(input: { now: Date; maximumAttempts: number }): Promise<number>;
};

const emptyAggregate = () => ({
  eligibleCount: 0,
  eligibleBytes: 0,
  heldCount: 0,
  heldBytes: 0,
  referenceBlockedCount: 0,
  referenceBlockedBytes: 0,
});

export function createEmptyRetentionPlanAggregates(): WorkHubRetentionPlanClassAggregates {
  return retentionPlanClassAggregatesSchema.parse(
    Object.fromEntries(RETENTION_CLASSES.map((key) => [key, emptyAggregate()])),
  );
}

export function retentionHoldFingerprint(holds: ReadonlyArray<Hold>): string {
  const canonical = holds
    .filter((hold) => hold.active)
    .map((hold) => `${hold.subjectType}:${hold.subjectId}`)
    .sort();
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function safeAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0) {
    throw new GovernanceRetentionError(
      "retention.internal_failure",
      503,
      "Retention plan evidence is unavailable",
    );
  }
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new GovernanceRetentionError(
      "retention.internal_failure",
      503,
      "Retention plan evidence is unavailable",
    );
  }
  return sum;
}

export function validateRetentionPlanTotals(
  aggregates: WorkHubRetentionPlanClassAggregates,
  totalRows: number,
): { eligibleCount: number; heldCount: number; referenceBlockedCount: number } {
  let eligibleCount = 0;
  let heldCount = 0;
  let referenceBlockedCount = 0;
  for (const retentionClass of RETENTION_CLASSES) {
    eligibleCount = safeAdd(eligibleCount, aggregates[retentionClass].eligibleCount);
    heldCount = safeAdd(heldCount, aggregates[retentionClass].heldCount);
    referenceBlockedCount = safeAdd(referenceBlockedCount, aggregates[retentionClass].referenceBlockedCount);
  }
  const classifiedRows = safeAdd(safeAdd(eligibleCount, heldCount), referenceBlockedCount);
  if (!Number.isSafeInteger(totalRows) || totalRows < 0 || classifiedRows !== totalRows) {
    throw new GovernanceRetentionError(
      "retention.internal_failure",
      503,
      "Retention plan evidence is invalid",
    );
  }
  return { eligibleCount, heldCount, referenceBlockedCount };
}

function errorCode(error: unknown): WorkHubRetentionPlanErrorCode {
  const rawCode = (error as { code?: unknown })?.code;
  const code = typeof rawCode === "string" && rawCode.startsWith("retention.")
    ? rawCode.slice("retention.".length)
    : rawCode;
  return retentionPlanErrorCodesSchema.element.safeParse(code).success
    ? (code as WorkHubRetentionPlanErrorCode)
    : "internal_failure";
}

export function createRetentionPlannerService(deps: {
  authorizeOwnerAdmin(
    userId: number,
    owner: WorkHubGovernanceOwner,
  ): Promise<void>;
  repository: ServiceRepository;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return {
    async create(input: { actor: Actor; body: unknown }) {
      const body = requestSchema.parse(input.body);
      await deps.authorizeOwnerAdmin(input.actor.userId, body.owner);
      const snapshotAt = now();
      if (!Number.isFinite(snapshotAt.getTime()))
        throw new GovernanceRetentionError("retention.internal_failure", 503, "Retention plan clock is invalid");
      return deps.repository.enqueue({
        actor: input.actor,
        owner: body.owner,
        operationId: body.operationId,
        snapshotAt,
      });
    },

    async read(input: {
      actor: Actor;
      owner: WorkHubGovernanceOwner;
      planId: string;
    }) {
      await deps.authorizeOwnerAdmin(input.actor.userId, input.owner);
      const resource = await deps.repository.read(input);
      if (!resource)
        throw new GovernanceRetentionError(
          "work_hub.not_found",
          404,
          "Work Hub resource not found",
        );
      return resource;
    },
  };
}

export function retentionPlanStaleTransition(attemptCount: number, maximumAttempts: number, now: Date) {
  const retrying = Number.isSafeInteger(attemptCount) && attemptCount < maximumAttempts;
  return { retrying, status: retrying ? "pending" as const : "failed" as const, finishedAt: retrying ? null : now, errorCodes: ["lease_expired" as const] };
}

export function createRetentionPlannerWorker(deps: {
  repository: WorkerRepository;
  authorizeCurrent(userId: number, owner: WorkHubGovernanceOwner): Promise<void>;
  now?: () => Date;
  chunkSize?: number;
  maximumAttempts?: number;
  maximumChunks?: number;
  maximumTotalRows?: number;
  maximumRuntimeMs?: number;
  leaseMs?: number;
}) {
  const now = deps.now ?? (() => new Date());
  const chunkSize = deps.chunkSize ?? 250;
  const maximumAttempts = deps.maximumAttempts ?? 3;
  const maximumChunks = deps.maximumChunks ?? 10_000;
  const maximumTotalRows = deps.maximumTotalRows ?? 1_000_000;
  const maximumRuntimeMs = deps.maximumRuntimeMs ?? 10 * 60_000;
  const leaseMs = deps.leaseMs ?? 15 * 60_000;
  for (const [name, value] of Object.entries({ chunkSize, maximumAttempts, maximumChunks, maximumTotalRows, maximumRuntimeMs, leaseMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  }
  const fail = async (job: RetentionPlanJob, error: unknown, observedAt: Date) => {
    await deps.repository.fail({ actor: job.actor, owner: job.owner, operationId: job.operationId, planId: job.id, errorCodes: [errorCode(error)], leaseExpiresAt: job.leaseExpiresAt, observedAt, attemptCount: job.attemptCount, maximumAttempts });
  };
  return {
    async recoverStale() { return deps.repository.recoverStale?.({ now: now(), maximumAttempts }) ?? 0; },
    async runOne(): Promise<boolean> {
      const startedAt = now();
      if (!Number.isFinite(startedAt.getTime())) throw new Error("Retention planner clock is invalid");
      const leaseExpiresAt = new Date(startedAt.getTime() + leaseMs);
      const job = await deps.repository.claimNext({ now: startedAt, leaseExpiresAt, maximumAttempts });
      if (!job) return false;
      try {
        await deps.authorizeCurrent(job.actor.userId, job.owner);
        const context = await deps.repository.loadContext({ owner: job.owner, snapshotAt: job.snapshotAt });
        if (!context.policy) throw new GovernanceRetentionError("retention.policy_unavailable", 503, "Organization retention policy is not configured");
        if (!context.minimum) throw new GovernanceRetentionError("retention.minimum_policy_unavailable", 503, "Platform retention minimum is not configured");
        if (context.policy.id !== job.policyId || context.policy.version !== job.policyVersion) throw new GovernanceRetentionError("retention.policy_changed", 409, "Retention policy changed during planning");
        if (context.minimum.version !== job.minimumPolicyVersion) throw new GovernanceRetentionError("retention.minimum_policy_changed", 409, "Platform retention minimum changed during planning");
        validateOrganizationRetentionRules(context.policy.rules, context.minimum.rules);
        const aggregates = createEmptyRetentionPlanAggregates();
        const errors = new Set<WorkHubRetentionPlanErrorCode>();
        let totalRows = 0;
        let chunkCount = 0;
        for (const retentionClass of RETENTION_CLASSES) {
          let afterCursor: string | null = null;
          const cutoff = new Date(job.snapshotAt.getTime() - context.policy.rules[retentionClass] * 86_400_000);
          for (;;) {
            await deps.authorizeCurrent(job.actor.userId, job.owner);
            const checkpoint = now();
            const elapsed = checkpoint.getTime() - startedAt.getTime();
            if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > maximumRuntimeMs) throw new GovernanceRetentionError(elapsed > maximumRuntimeMs ? "retention.limit_exceeded" : "retention.internal_failure", 503, "Retention plan processing limit reached");
            chunkCount = safeAdd(chunkCount, 1);
            if (chunkCount > maximumChunks) throw new GovernanceRetentionError("retention.limit_exceeded", 503, "Retention plan processing limit reached");
            const rows = await deps.repository.readCandidates({ owner: job.owner, retentionClass, cutoff, snapshotAt: job.snapshotAt, afterCursor, limit: chunkSize });
            totalRows = safeAdd(totalRows, rows.length);
            if (totalRows > maximumTotalRows) throw new GovernanceRetentionError("retention.limit_exceeded", 503, "Retention plan processing limit reached");
            if (rows.length === 0) break;
            let priorCursor = afterCursor;
            for (const candidate of rows) {
              if (!candidate.cursor || (priorCursor !== null && candidate.cursor <= priorCursor)) throw new GovernanceRetentionError("retention.internal_failure", 503, "Retention plan candidate order is invalid");
              priorCursor = candidate.cursor;
              const aggregate = aggregates[retentionClass];
              if (isSubjectHeld(candidate.graph, context.holds).held) {
                aggregate.heldCount = safeAdd(aggregate.heldCount, 1); aggregate.heldBytes = safeAdd(aggregate.heldBytes, candidate.bytes);
              } else if (candidate.referenceState !== "clear") {
                aggregate.referenceBlockedCount = safeAdd(aggregate.referenceBlockedCount, 1); aggregate.referenceBlockedBytes = safeAdd(aggregate.referenceBlockedBytes, candidate.bytes);
                if (candidate.referenceState === "unknown") errors.add("reference_unresolved");
              } else {
                aggregate.eligibleCount = safeAdd(aggregate.eligibleCount, 1); aggregate.eligibleBytes = safeAdd(aggregate.eligibleBytes, candidate.bytes);
              }
            }
            afterCursor = rows.at(-1)!.cursor;
          }
        }
        await deps.authorizeCurrent(job.actor.userId, job.owner);
        const finishedAt = now();
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > maximumRuntimeMs) throw new GovernanceRetentionError(durationMs > maximumRuntimeMs ? "retention.limit_exceeded" : "retention.internal_failure", 503, "Retention plan processing limit reached");
        validateRetentionPlanTotals(aggregates, totalRows);
        await deps.repository.complete({ actor: job.actor, owner: job.owner, operationId: job.operationId, planId: job.id, policyId: context.policy.id, policyVersion: context.policy.version, minimumPolicyVersion: context.minimum.version, snapshotAt: job.snapshotAt, classAggregates: retentionPlanClassAggregatesSchema.parse(aggregates), errorCodes: retentionPlanErrorCodesSchema.parse([...errors]), activeHoldFingerprint: retentionHoldFingerprint(context.holds), leaseExpiresAt: job.leaseExpiresAt, finishedAt, durationMs, totalRows, chunkCount });
      } catch (error) {
        await fail(job, error, now());
      }
      return true;
    },
  };
}
