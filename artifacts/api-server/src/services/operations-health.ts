import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  fieldTripsTable,
  notificationsTable,
  operationsDisplaysTable,
  safetyEscalationChainsTable,
  userOrgMembershipsTable,
  workHubAuditLogTable,
  workHubClientOperationsTable,
  workHubMeetingReplayAudioChunksTable,
} from "@workspace/db";
import {
  workHubMeetingRecordingHoldsTable,
  workHubMeetingRecordingRetentionTable,
} from "@workspace/db/schema";
import { getObjectStore } from "../lib/objectStore";
import { assemblyAIStreamingAvailable } from "../work-hub/assemblyai-streaming";

export type OperationsOwner = { type: "vendor" | "partner"; id: number };
export type OperationsHealthCounts = {
  offlineBacklog: number;
  terminalConflicts: number;
  permissionDenials: number;
  staleLocations: number;
  failedAlerts: number;
  unhealthyDisplays: number;
  supervisorExceptions: number;
  missingSafetyChain: boolean;
  transcriptionAvailable: boolean;
};

export type OperationsHealth = {
  status: "healthy" | "attention_required";
  checkedAt: string;
  signals: OperationsHealthCounts;
  attention: string[];
};

export function buildOperationsHealth(counts: OperationsHealthCounts, now = new Date()): OperationsHealth {
  const attention = [
    counts.offlineBacklog > 0 && "offline_backlog",
    counts.terminalConflicts > 0 && "terminal_conflicts",
    counts.permissionDenials > 0 && "permission_denials",
    counts.staleLocations > 0 && "stale_locations",
    counts.failedAlerts > 0 && "failed_alerts",
    !counts.transcriptionAvailable && "transcription_unavailable",
    counts.unhealthyDisplays > 0 && "unhealthy_displays",
    counts.supervisorExceptions > 0 && "supervisor_exceptions",
    counts.missingSafetyChain && "missing_safety_chain",
  ].filter((value): value is string => Boolean(value));
  return { status: attention.length ? "attention_required" : "healthy", checkedAt: now.toISOString(), signals: counts, attention };
}

async function countRows(query: Promise<Array<{ count: number }>>): Promise<number> {
  return Number((await query)[0]?.count ?? 0);
}

export async function getOperationsHealth(owner: OperationsOwner, now = new Date()): Promise<OperationsHealth> {
  const recent = new Date(now.getTime() - 24 * 60 * 60_000);
  const stale = new Date(now.getTime() - 2 * 60_000);
  const membershipScope = owner.type === "vendor"
    ? eq(userOrgMembershipsTable.vendorId, owner.id)
    : eq(userOrgMembershipsTable.partnerId, owner.id);
  const [offlineBacklog, terminalConflicts, permissionDenials, staleLocations, failedAlerts, unhealthyDisplays, supervisorExceptions, safetyChains] = await Promise.all([
    countRows(db.select({ count: sql<number>`count(*)::int` }).from(workHubClientOperationsTable).where(and(
      eq(workHubClientOperationsTable.ownerOrgType, owner.type), eq(workHubClientOperationsTable.ownerOrgId, owner.id), isNull(workHubClientOperationsTable.appliedAt),
    ))),
    countRows(db.select({ count: sql<number>`count(*)::int` }).from(workHubAuditLogTable).where(and(
      eq(workHubAuditLogTable.ownerOrgType, owner.type), eq(workHubAuditLogTable.ownerOrgId, owner.id), gte(workHubAuditLogTable.createdAt, recent),
      or(eq(workHubAuditLogTable.action, "operation.conflict"), eq(workHubAuditLogTable.action, "offline.conflict")),
    ))),
    countRows(db.select({ count: sql<number>`count(*)::int` }).from(workHubAuditLogTable).where(and(
      eq(workHubAuditLogTable.ownerOrgType, owner.type), eq(workHubAuditLogTable.ownerOrgId, owner.id), gte(workHubAuditLogTable.createdAt, recent),
      or(eq(workHubAuditLogTable.action, "authorization.denied"), eq(workHubAuditLogTable.action, "permission.denied")),
    ))),
    countRows(db.select({ count: sql<number>`count(*)::int` }).from(fieldTripsTable).where(and(
      eq(fieldTripsTable.ownerOrgType, owner.type), eq(fieldTripsTable.ownerOrgId, owner.id), eq(fieldTripsTable.trackingState, "active"),
      or(isNull(fieldTripsTable.lastRecordedAt), lte(fieldTripsTable.lastRecordedAt, stale)),
    ))),
    countRows(db.select({ count: sql<number>`count(distinct ${notificationsTable.id})::int` }).from(notificationsTable)
      .innerJoin(userOrgMembershipsTable, eq(userOrgMembershipsTable.userId, notificationsTable.userId)).where(and(
        eq(userOrgMembershipsTable.orgType, owner.type), membershipScope, gte(notificationsTable.finalDeliveryFailureAt, recent),
      ))),
    countRows(db.select({ count: sql<number>`count(*)::int` }).from(operationsDisplaysTable).where(and(
      eq(operationsDisplaysTable.ownerOrgType, owner.type), eq(operationsDisplaysTable.ownerOrgId, owner.id), isNull(operationsDisplaysTable.revokedAt), lte(operationsDisplaysTable.tokenExpiresAt, now),
    ))),
    countRows(db.select({ count: sql<number>`count(*)::int` }).from(workHubAuditLogTable).where(and(
      eq(workHubAuditLogTable.ownerOrgType, owner.type), eq(workHubAuditLogTable.ownerOrgId, owner.id), gte(workHubAuditLogTable.createdAt, recent),
      eq(workHubAuditLogTable.action, "supervisor.exception"),
    ))),
    countRows(db.select({ count: sql<number>`count(*)::int` }).from(safetyEscalationChainsTable).where(and(
      eq(safetyEscalationChainsTable.ownerType, owner.type), eq(safetyEscalationChainsTable.ownerId, owner.id), eq(safetyEscalationChainsTable.isActive, true),
    ))),
  ]);
  return buildOperationsHealth({
    offlineBacklog, terminalConflicts, permissionDenials, staleLocations, failedAlerts, unhealthyDisplays, supervisorExceptions,
    missingSafetyChain: safetyChains === 0,
    transcriptionAvailable: assemblyAIStreamingAvailable(process.env),
  }, now);
}

export type RecordingRetentionCandidate = {
  retentionId: string;
  rawMediaExpiresAt: Date;
  rawMediaDeletedAt: Date | null;
  activeHoldCount: number;
  storageKeys: string[];
};

export type RecordingRetentionResult = {
  deleted: boolean;
  reason: "expired" | "active_hold" | "not_expired" | "already_deleted";
  deletedObjectCount: number;
  transcriptRetained: true;
  summaryRetained: true;
};

export async function processRecordingRetention(candidate: RecordingRetentionCandidate, deps: {
  now?: Date;
  deleteObject: (storageKey: string) => Promise<unknown>;
  markDeleted: (retentionId: string, deletedAt: Date) => Promise<unknown>;
}): Promise<RecordingRetentionResult> {
  const now = deps.now ?? new Date();
  const base = { deletedObjectCount: 0, transcriptRetained: true as const, summaryRetained: true as const };
  if (candidate.rawMediaDeletedAt) return { deleted: false, reason: "already_deleted", ...base };
  if (candidate.activeHoldCount > 0) return { deleted: false, reason: "active_hold", ...base };
  if (candidate.rawMediaExpiresAt.getTime() > now.getTime()) return { deleted: false, reason: "not_expired", ...base };
  for (const storageKey of candidate.storageKeys) await deps.deleteObject(storageKey);
  await deps.markDeleted(candidate.retentionId, now);
  return { deleted: true, reason: "expired", deletedObjectCount: candidate.storageKeys.length, transcriptRetained: true, summaryRetained: true };
}

export async function runImplementationARetention(now = new Date(), limit = 100): Promise<{ inspected: number; deleted: number; held: number }> {
  const candidates = await db.select({ id: workHubMeetingRecordingRetentionTable.id })
    .from(workHubMeetingRecordingRetentionTable)
    .where(and(isNull(workHubMeetingRecordingRetentionTable.rawMediaDeletedAt), lte(workHubMeetingRecordingRetentionTable.rawMediaExpiresAt, now)))
    .limit(limit);
  let deleted = 0; let held = 0;
  for (const candidate of candidates) {
    const result = await db.transaction(async (tx) => {
      const [retention] = await tx.select().from(workHubMeetingRecordingRetentionTable)
        .where(eq(workHubMeetingRecordingRetentionTable.id, candidate.id)).for("update");
      if (!retention) return null;
      const holds = await tx.select({ id: workHubMeetingRecordingHoldsTable.id }).from(workHubMeetingRecordingHoldsTable)
        .where(and(eq(workHubMeetingRecordingHoldsTable.retentionId, retention.id), isNull(workHubMeetingRecordingHoldsTable.releasedAt)));
      const chunks = await tx.select({ storageKey: workHubMeetingReplayAudioChunksTable.storageKey }).from(workHubMeetingReplayAudioChunksTable)
        .where(eq(workHubMeetingReplayAudioChunksTable.manifestId, retention.manifestId));
      return processRecordingRetention({
        retentionId: retention.id,
        rawMediaExpiresAt: retention.rawMediaExpiresAt,
        rawMediaDeletedAt: retention.rawMediaDeletedAt,
        activeHoldCount: holds.length,
        storageKeys: chunks.map((chunk) => chunk.storageKey),
      }, {
        now,
        deleteObject: (key) => getObjectStore().deleteObject(key),
        markDeleted: async (retentionId, deletedAt) => {
          await tx.update(workHubMeetingRecordingRetentionTable).set({ rawMediaDeletedAt: deletedAt, updatedAt: deletedAt })
            .where(eq(workHubMeetingRecordingRetentionTable.id, retentionId));
        },
      });
    });
    if (result?.deleted) deleted += 1;
    if (result?.reason === "active_hold") held += 1;
  }
  return { inspected: candidates.length, deleted, held };
}

let retentionTimer: ReturnType<typeof setInterval> | undefined;
export function startImplementationARetentionWorker(intervalMs = 5 * 60_000): void {
  if (retentionTimer) return;
  void runImplementationARetention().catch((error) => console.error("Implementation A recording retention failed", error));
  retentionTimer = setInterval(() => { void runImplementationARetention().catch((error) => console.error("Implementation A recording retention failed", error)); }, intervalMs);
  retentionTimer.unref?.();
}
export function stopImplementationARetentionWorker(): void {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = undefined;
}
