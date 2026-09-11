import { and, eq, gt, lte, sql } from "drizzle-orm";
import {
  db,
  platformSettingsTable,
  userOrgMembershipsTable,
  usersTable,
  workHubAuditLogTable,
  workHubExportJobsTable,
} from "@workspace/db";
import { WORK_HUB_EXPORT_AUDIT_ACTIONS, type WorkHubExportCreate } from "@workspace/api-zod";
import { getObjectStore } from "../lib/objectStore";
import { logger } from "../lib/logger";
import { appendWorkHubAudit, redactWorkHubAuditMetadata } from "./audit";
import { createWorkHubAccess, requireWorkHubCapability } from "./context-access";
import { buildWorkHubExportArtifact, readCompleteWorkHubExport } from "./governance-export-reader";
import { createExportLifecycle, ExportLifecycleError, type ExportJobRecord } from "./governance-export-lifecycle";
import { recordWorkHubOperationalMetric } from "./governance-operational-metrics-runtime";

type StaleRecoveryMetric = {
  owner: { type: "vendor" | "partner"; id: number };
  dataset: WorkHubExportCreate["export"]["dataset"];
  format: WorkHubExportCreate["export"]["format"];
  retrying: boolean;
};
type OperationalMetricRecorder = typeof recordWorkHubOperationalMetric;

export async function emitStaleRecoveryMetrics(metric: OperationalMetricRecorder, recoveries: StaleRecoveryMetric[], observedAt: Date): Promise<void> {
  for (const recovery of recoveries) {
    const dimensions = { dataset: recovery.dataset, format: recovery.format, phase: "generate" as const, source: "worker" as const, status: recovery.retrying ? "pending" as const : "failed" as const, errorCode: "lease_expired" as const };
    try { await metric({ owner: recovery.owner, metric: "export.failed", dimensions, value: 1, observedAt }); } catch { /* telemetry must not break stale recovery */ }
    if (recovery.retrying) {
      try { await metric({ owner: recovery.owner, metric: "export.retry_count", dimensions, value: 1, observedAt }); } catch { /* telemetry must not break stale recovery */ }
    }
  }
}

const rowsOf = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? result) as T[];
const EXPORT_AUDIT = WORK_HUB_EXPORT_AUDIT_ACTIONS;
const asJob = (row: typeof workHubExportJobsTable.$inferSelect): ExportJobRecord => ({ ...row, ownerOrgType: row.ownerOrgType as "vendor" | "partner", requestSource: row.requestSource === "ios" ? "ios" : "web", status: row.status as ExportJobRecord["status"], scope: row.scope });
const sameRequest = (job: ExportJobRecord, request: WorkHubExportCreate) => job.ownerOrgType === request.owner.type && job.ownerOrgId === request.owner.id && job.dataset === request.export.dataset && job.format === request.export.format && JSON.stringify(job.scope) === JSON.stringify(request.export.scope) && job.expiresAt?.toISOString() === request.expiresAt;
export function staleRecoveryTransition(attemptCount: number, maximumAttempts: number, now: Date) {
  const retrying = attemptCount < maximumAttempts;
  return { retrying, status: retrying ? "pending" as const : "failed" as const, finishedAt: retrying ? null : now };
}

async function currentAccess(job: ExportJobRecord) {
  if (!job.requesterUserId) throw new ExportLifecycleError("access_changed", 403, "Export access changed");
  const [user] = await db.select({ id: usersTable.id, role: usersTable.role, suspendedAt: usersTable.suspendedAt }).from(usersTable).where(eq(usersTable.id, job.requesterUserId)).limit(1);
  if (!user || user.suspendedAt) throw new ExportLifecycleError("access_changed", 403, "Export access changed");
  let membershipRole: string | null = null;
  if (user.role !== "admin") {
    const ownerColumn = job.ownerOrgType === "vendor" ? userOrgMembershipsTable.vendorId : userOrgMembershipsTable.partnerId;
    const [membership] = await db.select({ role: userOrgMembershipsTable.role }).from(userOrgMembershipsTable).where(and(eq(userOrgMembershipsTable.userId, user.id), eq(userOrgMembershipsTable.orgType, job.ownerOrgType), eq(ownerColumn, job.ownerOrgId))).limit(1);
    if (!membership) throw new ExportLifecycleError("access_changed", 403, "Export access changed");
    membershipRole = membership.role;
  }
  const access = createWorkHubAccess({ session: { userId: user.id, role: user.role === "admin" ? "admin" : job.ownerOrgType, membershipRole, vendorId: job.ownerOrgType === "vendor" ? job.ownerOrgId : null, partnerId: job.ownerOrgType === "partner" ? job.ownerOrgId : null }, owner: { type: job.ownerOrgType, id: job.ownerOrgId }, context: { kind: "organization", id: job.ownerOrgId }, participant: true });
  requireWorkHubCapability(access, "policy.manage");
  return access;
}

const repository = {
  async create(input: { requester: { userId: number; displayName: string; source: "web" | "ios" }; request: WorkHubExportCreate; snapshotAt: Date }) {
    return db.transaction(async (tx) => {
      const values = { ownerOrgType: input.request.owner.type, ownerOrgId: input.request.owner.id, requesterUserId: input.requester.userId, requesterIdSnapshot: String(input.requester.userId), requesterDisplaySnapshot: input.requester.displayName.slice(0, 200), requestSource: input.requester.source, operationId: input.request.operationId, dataset: input.request.export.dataset, format: input.request.export.format, scope: input.request.export.scope, snapshotAt: input.snapshotAt, expiresAt: new Date(input.request.expiresAt), availableAt: input.snapshotAt };
      const [inserted] = await tx.insert(workHubExportJobsTable).values(values).onConflictDoNothing({ target: [workHubExportJobsTable.requesterIdSnapshot, workHubExportJobsTable.operationId] }).returning();
      if (inserted) {
        await tx.insert(workHubAuditLogTable).values({ actorUserId: input.requester.userId, ownerOrgType: input.request.owner.type, ownerOrgId: input.request.owner.id, action: EXPORT_AUDIT.requested, subjectType: "work_hub_export", subjectId: inserted.id, source: input.requester.source, operationId: input.request.operationId, metadata: redactWorkHubAuditMetadata({ dataset: input.request.export.dataset, format: input.request.export.format, expiresAt: input.request.expiresAt }) });
        return { job: asJob(inserted), replayed: false };
      }
      const [existing] = await tx.select().from(workHubExportJobsTable).where(and(eq(workHubExportJobsTable.requesterIdSnapshot, String(input.requester.userId)), eq(workHubExportJobsTable.operationId, input.request.operationId))).limit(1);
      if (!existing || !sameRequest(asJob(existing), input.request)) throw new ExportLifecycleError("invalid_scope", 409, "Operation ID was already used for a different export");
      return { job: asJob(existing), replayed: true };
    });
  },
  async findForRequester(jobId: string, requesterUserId: number) {
    const [row] = await db.select().from(workHubExportJobsTable).where(and(eq(workHubExportJobsTable.id, jobId), eq(workHubExportJobsTable.requesterIdSnapshot, String(requesterUserId)))).limit(1);
    return row ? asJob(row) : null;
  },
  async claimNext(now: Date, leaseUntil: Date, maximumAttempts: number) {
    const result = await db.execute(sql`UPDATE work_hub_export_jobs SET status = 'running', attempt_count = attempt_count + 1, lease_expires_at = ${leaseUntil}, started_at = COALESCE(started_at, ${now}), updated_at = ${now}
      WHERE id = (SELECT id FROM work_hub_export_jobs WHERE status = 'pending' AND available_at <= ${now} AND attempt_count < ${maximumAttempts} AND expires_at > ${now} ORDER BY available_at, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`);
    const row = rowsOf<Record<string, unknown>>(result)[0];
    if (!row) return null;
    const [typed] = await db.select().from(workHubExportJobsTable).where(eq(workHubExportJobsTable.id, String(row.id))).limit(1);
    return typed ? asJob(typed) : null;
  },
  async complete(job: ExportJobRecord, leaseExpiresAt: Date, artifact: { artifactStorageKey: string; artifactFileName: string; artifactContentType: string; artifactSha256: string; rowCount: number; byteCount: number; generatedAt: Date }) {
    return db.transaction(async (tx) => {
      const rows = await tx.update(workHubExportJobsTable).set({ ...artifact, status: "completed", finishedAt: artifact.generatedAt, leaseExpiresAt: null, errorCode: null, failureDetail: null, updatedAt: artifact.generatedAt }).where(and(eq(workHubExportJobsTable.id, job.id), eq(workHubExportJobsTable.status, "running"), eq(workHubExportJobsTable.leaseExpiresAt, leaseExpiresAt), gt(workHubExportJobsTable.leaseExpiresAt, artifact.generatedAt), gt(workHubExportJobsTable.expiresAt, artifact.generatedAt))).returning({ id: workHubExportJobsTable.id });
      if (rows.length !== 1) return false;
      await tx.insert(workHubAuditLogTable).values({ actorUserId: null, ownerOrgType: job.ownerOrgType, ownerOrgId: job.ownerOrgId, action: EXPORT_AUDIT.generated, subjectType: "work_hub_export", subjectId: job.id, source: "worker", operationId: job.operationId, metadata: redactWorkHubAuditMetadata({ dataset: job.dataset, format: job.format, rowCount: artifact.rowCount, byteCount: artifact.byteCount }) });
      return true;
    });
  },
  async fail(job: ExportJobRecord, leaseExpiresAt: Date, failure: { status: "pending" | "failed"; observedAt: Date; availableAt: Date; errorCode: string; failureDetail: string }) {
    return db.transaction(async (tx) => {
      const { observedAt, ...persistedFailure } = failure;
      const finishedAt = failure.status === "failed" ? observedAt : null;
      const rows = await tx.update(workHubExportJobsTable).set({ ...persistedFailure, finishedAt, leaseExpiresAt: null, updatedAt: observedAt }).where(and(eq(workHubExportJobsTable.id, job.id), eq(workHubExportJobsTable.status, "running"), eq(workHubExportJobsTable.leaseExpiresAt, leaseExpiresAt), gt(workHubExportJobsTable.leaseExpiresAt, observedAt), gt(workHubExportJobsTable.expiresAt, observedAt))).returning({ id: workHubExportJobsTable.id });
      if (rows.length !== 1) return false;
      await tx.insert(workHubAuditLogTable).values({ actorUserId: null, ownerOrgType: job.ownerOrgType, ownerOrgId: job.ownerOrgId, action: EXPORT_AUDIT.failed, subjectType: "work_hub_export", subjectId: job.id, source: "worker", operationId: job.operationId, metadata: redactWorkHubAuditMetadata({ dataset: job.dataset, format: job.format, errorCode: failure.errorCode, retrying: failure.status === "pending" }) });
      return true;
    });
  },
  async recoverStale(now: Date, maximumAttempts: number) {
    const result = await db.transaction(async (tx) => {
      const locked = rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM work_hub_export_jobs WHERE status = 'running' AND lease_expires_at <= ${now} ORDER BY lease_expires_at, id FOR UPDATE SKIP LOCKED`));
      let recovered = 0;
      const metrics: StaleRecoveryMetric[] = [];
      for (const lockedRow of locked) {
        const [row] = await tx.select().from(workHubExportJobsTable).where(eq(workHubExportJobsTable.id, lockedRow.id)).limit(1);
        if (!row) continue;
        const { retrying, status, finishedAt } = staleRecoveryTransition(row.attemptCount, maximumAttempts, now);
        const [updated] = await tx.update(workHubExportJobsTable).set({ status, availableAt: now, leaseExpiresAt: null, finishedAt, errorCode: "lease_expired", failureDetail: "Export worker lease expired", updatedAt: now }).where(and(eq(workHubExportJobsTable.id, row.id), eq(workHubExportJobsTable.status, "running"), lte(workHubExportJobsTable.leaseExpiresAt, now))).returning({ id: workHubExportJobsTable.id });
        if (!updated) continue;
        await tx.insert(workHubAuditLogTable).values({ actorUserId: null, ownerOrgType: row.ownerOrgType, ownerOrgId: row.ownerOrgId, action: EXPORT_AUDIT.failed, subjectType: "work_hub_export", subjectId: row.id, source: "worker", operationId: row.operationId, metadata: redactWorkHubAuditMetadata({ dataset: row.dataset, format: row.format, errorCode: "lease_expired", retrying }) });
        metrics.push({ owner: { type: row.ownerOrgType as "vendor" | "partner", id: row.ownerOrgId }, dataset: row.dataset as WorkHubExportCreate["export"]["dataset"], format: row.format as WorkHubExportCreate["export"]["format"], retrying });
        recovered += 1;
      }
      return { recovered, metrics };
    });
    await emitStaleRecoveryMetrics(recordWorkHubOperationalMetric, result.metrics, now);
    return result.recovered;
  },
};

export const workHubExportLifecycle = createExportLifecycle({
  now: () => new Date(), repository, storage: getObjectStore(), authorize: currentAccess,
  readRows: async ({ job, access }) => readCompleteWorkHubExport({ execute: async (query) => rowsOf(await db.execute(query)), request: { dataset: job.dataset, format: job.format, scope: job.scope } as never, owner: { type: job.ownerOrgType, id: job.ownerOrgId }, access, snapshotAt: job.snapshotAt }),
  buildArtifact: ({ job, rows, generatedAt }) => buildWorkHubExportArtifact({ jobId: job.id, request: { dataset: job.dataset, format: job.format, scope: job.scope } as never, requester: { id: job.requesterIdSnapshot, display: job.requesterDisplaySnapshot }, generatedAt: generatedAt.toISOString(), snapshotAt: job.snapshotAt.toISOString(), rows }),
  audit: (input) => appendWorkHubAudit(input),
  metric: recordWorkHubOperationalMetric,
});

export async function areWorkHubExportsEnabled(): Promise<boolean> {
  if (process.env.WORK_HUB_EXPORTS_ENABLED === "1") return true;
  const [settings] = await db.select({ enabled: platformSettingsTable.workHubExportsEnabled }).from(platformSettingsTable).where(eq(platformSettingsTable.id, 1)).limit(1);
  return settings?.enabled ?? false;
}

let timer: NodeJS.Timeout | null = null;
export function createExportWorkerDrain(deps: { enabled(): Promise<boolean>; runOne(): Promise<boolean>; onError(error: unknown): void }) {
  let running = false;
  let generation = 0;
  let stopped = true;
  return {
    start(): number {
      stopped = false;
      generation += 1;
      return generation;
    },
    stop(): void {
      stopped = true;
      generation += 1;
    },
    isCurrent(candidate: number): boolean {
      return !stopped && candidate === generation;
    },
    async drain(): Promise<void> {
      if (running || stopped) return;
      const drainGeneration = generation;
      running = true;
      try {
        while (!stopped && drainGeneration === generation) {
          if (!(await deps.enabled())) break;
          if (stopped || drainGeneration !== generation) break;
          if (!(await deps.runOne())) break;
        }
      } catch (error) {
        deps.onError(error);
      } finally {
        running = false;
      }
    },
  };
}
const exportWorker = createExportWorkerDrain({ enabled: areWorkHubExportsEnabled, runOne: () => workHubExportLifecycle.runOne(), onError: (err) => logger.error({ err }, "Work Hub export worker tick failed") });
export async function recoverAndStartWorkHubExportWorker() {
  const startGeneration = exportWorker.start();
  try {
    if (await areWorkHubExportsEnabled()) await workHubExportLifecycle.recoverStale();
  } catch (err) {
    logger.error({ err }, "Work Hub export worker recovery failed");
  }
  if (!exportWorker.isCurrent(startGeneration)) return;
  if (!timer) {
    timer = setInterval(() => { void exportWorker.drain(); }, 5_000);
    timer.unref();
  }
  void exportWorker.drain();
}
export function stopWorkHubExportWorker() {
  exportWorker.stop();
  if (timer) clearInterval(timer);
  timer = null;
}
