import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  partnersTable,
  vendorsTable,
  usersTable,
  userOrgMembershipsTable,
  workHubAuditLogTable,
  workHubLegalHoldsTable,
  workHubRetentionMinimumPoliciesTable,
  workHubRetentionPlanRunsTable,
  workHubRetentionPoliciesTable,
} from "@workspace/db";
import {
  RETENTION_CLASSES,
  retentionPlanClassAggregatesSchema,
  retentionPlanErrorCodesSchema,
  retentionPlanViewSchema,
  retentionRulesSchema,
  type WorkHubGovernanceOwner,
  type WorkHubRetentionPlanErrorCode,
} from "@workspace/api-zod";
import { WorkHubAccessError } from "./context-access";
import { GovernanceRetentionError } from "./governance-retention";
import { acquireRetentionPublicationLocks } from "./governance-locks";
import { logger } from "../lib/logger";
import {
  createEmptyRetentionPlanAggregates,
  createRetentionPlannerService,
  createRetentionPlannerWorker,
  retentionHoldFingerprint,
  retentionPlanStaleTransition,
  validateRetentionPlanTotals,
  type RetentionCandidate,
} from "./governance-retention-planner";
import { recordWorkHubOperationalMetric } from "./governance-operational-metrics-runtime";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
const rowsOf = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? result) as T[];
export const RETENTION_PLAN_CHUNK_LIMIT = 250;

async function ownerExists(owner: WorkHubGovernanceOwner, executor: Executor): Promise<boolean> {
  const table = owner.type === "vendor" ? vendorsTable : partnersTable;
  const [row] = await executor.select({ id: table.id }).from(table).where(eq(table.id, owner.id)).limit(1);
  return Boolean(row);
}
async function authorizeOwnerAdmin(userId: number, owner: WorkHubGovernanceOwner, executor: Executor = db): Promise<void> {
  const [user] = await executor.select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user || user.suspendedAt || !(await ownerExists(owner, executor))) throw new WorkHubAccessError("not_found");
  if (user.role === "admin") return;
  const ownerColumn = owner.type === "vendor" ? userOrgMembershipsTable.vendorId : userOrgMembershipsTable.partnerId;
  const [membership] = await executor.select({ role: userOrgMembershipsTable.role }).from(userOrgMembershipsTable).where(and(eq(userOrgMembershipsTable.userId, userId), eq(userOrgMembershipsTable.orgType, owner.type), eq(ownerColumn, owner.id))).limit(1);
  if (!membership) throw new WorkHubAccessError("not_found");
  if (membership.role !== "admin") throw new WorkHubAccessError("forbidden");
}

function project(row: typeof workHubRetentionPlanRunsTable.$inferSelect) {
  return retentionPlanViewSchema.parse({
    id: row.id,
    owner: { type: row.ownerOrgType, id: row.ownerOrgId },
    status: row.status,
    policyVersion: row.policyVersion,
    minimumPolicyVersion: row.minimumPolicyVersion,
    snapshotAt: row.snapshotAt.toISOString(),
    classAggregates: row.classAggregates,
    errorCodes: row.errorCodes,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

function parseCursor(value: string | null): { time: Date; id: string } {
  if (!value) return { time: new Date(0), id: "00000000-0000-0000-0000-000000000000" };
  const separator = value.lastIndexOf("|");
  const time = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (separator < 1 || Number.isNaN(time.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new GovernanceRetentionError("retention.internal_failure", 503, "Retention plan cursor is invalid");
  return { time, id };
}

type CandidateRow = { candidateTime: Date | string; candidateId: string; byteSize: number | string; subjectType: "organization" | "channel" | "meeting_occurrence"; subjectId: string; ancestorChannelId: string | null; referenceState: "clear" | "blocked" | "unknown" };
type QueryInput = { owner: WorkHubGovernanceOwner; cutoff: Date; snapshotAt: Date; afterCursor: string | null; limit: number };
function queryFor(retentionClass: (typeof RETENTION_CLASSES)[number], input: QueryInput): SQL {
  const after = parseCursor(input.afterCursor);
  const values = [input.owner.type, input.owner.id, input.cutoff, input.snapshotAt, after.time, after.id, input.limit] as const;
  const [ownerType, ownerId, cutoff, snapshotAt, afterTime, afterId, limit] = values;
  switch (retentionClass) {
    case "messages":
    case "deleted_messages": {
      const deleted = retentionClass === "deleted_messages";
      return sql`SELECT ${deleted ? sql`m.deleted_at` : sql`m.created_at`} AS "candidateTime", m.id AS "candidateId", octet_length(m.body) AS "byteSize", 'channel' AS "subjectType", m.channel_id::text AS "subjectId", m.channel_id::text AS "ancestorChannelId",
        CASE WHEN EXISTS (SELECT 1 FROM work_hub_message_versions v WHERE v.message_id=m.id) OR EXISTS (SELECT 1 FROM work_hub_messages child JOIN work_hub_channels child_channel ON child_channel.id=child.channel_id WHERE (child.root_message_id=m.id OR child.parent_message_id=m.id) AND child_channel.owner_org_type=${ownerType} AND child_channel.owner_org_id=${ownerId}) OR EXISTS (SELECT 1 FROM work_hub_mentions x WHERE x.message_id=m.id) OR EXISTS (SELECT 1 FROM work_hub_reactions x WHERE x.message_id=m.id) OR EXISTS (SELECT 1 FROM work_hub_read_cursors x JOIN work_hub_channels cursor_channel ON cursor_channel.id=x.channel_id WHERE x.last_message_id=m.id AND cursor_channel.owner_org_type=${ownerType} AND cursor_channel.owner_org_id=${ownerId}) OR EXISTS (SELECT 1 FROM work_hub_message_metadata x WHERE x.message_id=m.id) OR EXISTS (SELECT 1 FROM work_hub_acknowledgements x WHERE x.owner_org_type=${ownerType} AND x.owner_org_id=${ownerId} AND x.subject_type='message' AND x.subject_id=m.id::text) OR EXISTS (SELECT 1 FROM work_hub_approval_requests x WHERE x.owner_org_type=${ownerType} AND x.owner_org_id=${ownerId} AND x.subject_type='message' AND x.subject_id=m.id::text) OR EXISTS (SELECT 1 FROM work_hub_audit_log x WHERE x.owner_org_type=${ownerType} AND x.owner_org_id=${ownerId} AND x.subject_id=m.id::text) THEN 'blocked' ELSE 'clear' END AS "referenceState"
        FROM work_hub_messages m JOIN work_hub_channels c ON c.id=m.channel_id
        WHERE c.owner_org_type=${ownerType} AND c.owner_org_id=${ownerId} AND ${deleted ? sql`m.deleted_at IS NOT NULL` : sql`m.deleted_at IS NULL`} AND ${deleted ? sql`m.deleted_at` : sql`m.created_at`} < ${cutoff} AND ${deleted ? sql`m.deleted_at` : sql`m.created_at`} <= ${snapshotAt} AND ((${deleted ? sql`m.deleted_at` : sql`m.created_at`}, m.id) > (${afterTime}, ${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    }
    case "files_voice_notes":
      return sql`SELECT f.created_at AS "candidateTime", f.id AS "candidateId", f.byte_size AS "byteSize", CASE WHEN f.channel_id IS NULL OR c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId} THEN 'organization' ELSE 'channel' END AS "subjectType", CASE WHEN f.channel_id IS NULL OR c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId} THEN ${String(ownerId)} ELSE f.channel_id::text END AS "subjectId", CASE WHEN c.owner_org_type=${ownerType} AND c.owner_org_id=${ownerId} THEN c.id::text ELSE NULL::text END AS "ancestorChannelId", 'unknown' AS "referenceState"
        FROM work_hub_files f LEFT JOIN work_hub_channels c ON c.id=f.channel_id
        WHERE f.owner_org_type=${ownerType} AND f.owner_org_id=${ownerId} AND f.created_at < ${cutoff} AND f.created_at <= ${snapshotAt} AND ((f.created_at, f.id) > (${afterTime}, ${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    case "notes_versions":
      return sql`SELECT v.created_at AS "candidateTime", v.id AS "candidateId", octet_length(v.title)+octet_length(v.body) AS "byteSize", 'channel' AS "subjectType", n.channel_id::text AS "subjectId", n.channel_id::text AS "ancestorChannelId",
        CASE WHEN v.version=n.version OR EXISTS (SELECT 1 FROM work_hub_acknowledgements a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.subject_type='note' AND a.subject_id=n.id::text AND a.subject_version=v.version) OR EXISTS (SELECT 1 FROM work_hub_approval_requests a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.subject_type='note' AND a.subject_id=n.id::text AND a.subject_version=v.version) OR EXISTS (SELECT 1 FROM work_hub_audit_log a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.subject_id=n.id::text AND (a.new_version=v.version OR a.prior_version=v.version)) THEN 'blocked' ELSE 'clear' END AS "referenceState"
        FROM work_hub_note_versions v JOIN work_hub_notes n ON n.id=v.note_id JOIN work_hub_channels c ON c.id=n.channel_id
        WHERE c.owner_org_type=${ownerType} AND c.owner_org_id=${ownerId} AND v.created_at < ${cutoff} AND v.created_at <= ${snapshotAt} AND ((v.created_at, v.id) > (${afterTime}, ${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    case "form_submissions":
      return sql`SELECT s.submitted_at AS "candidateTime", s.id AS "candidateId", octet_length(s.values::text) AS "byteSize", CASE WHEN i.channel_id IS NULL OR c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId} THEN 'organization' ELSE 'channel' END AS "subjectType", CASE WHEN i.channel_id IS NULL OR c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId} THEN ${String(ownerId)} ELSE i.channel_id::text END AS "subjectId", CASE WHEN c.owner_org_type=${ownerType} AND c.owner_org_id=${ownerId} THEN c.id::text ELSE NULL::text END AS "ancestorChannelId",
        CASE WHEN i.channel_id IS NOT NULL AND (c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId}) THEN 'unknown' WHEN NOT EXISTS (SELECT 1 FROM work_hub_form_submissions newer WHERE newer.instance_id=s.instance_id AND newer.version>s.version) OR EXISTS (SELECT 1 FROM work_hub_form_submissions child JOIN work_hub_form_instances child_instance ON child_instance.id=child.instance_id JOIN work_hub_form_templates child_template ON child_template.id=child_instance.template_id LEFT JOIN work_hub_channels child_channel ON child_channel.id=child_instance.channel_id WHERE child.prior_submission_id=s.id AND child_template.owner_org_type=${ownerType} AND child_template.owner_org_id=${ownerId} AND (child_instance.channel_id IS NULL OR (child_channel.owner_org_type=${ownerType} AND child_channel.owner_org_id=${ownerId}))) OR EXISTS (SELECT 1 FROM work_hub_acknowledgements a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.subject_type='form_submission' AND a.subject_id=s.id::text) OR EXISTS (SELECT 1 FROM work_hub_approval_requests a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.subject_type='form_submission' AND a.subject_id=s.id::text) OR EXISTS (SELECT 1 FROM work_hub_audit_log a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.subject_id=s.id::text) THEN 'blocked' ELSE 'clear' END AS "referenceState"
        FROM work_hub_form_submissions s JOIN work_hub_form_instances i ON i.id=s.instance_id JOIN work_hub_form_templates t ON t.id=i.template_id LEFT JOIN work_hub_channels c ON c.id=i.channel_id
        WHERE t.owner_org_type=${ownerType} AND t.owner_org_id=${ownerId} AND s.submitted_at < ${cutoff} AND s.submitted_at <= ${snapshotAt} AND ((s.submitted_at, s.id) > (${afterTime}, ${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    case "meeting_recordings":
      return sql`SELECT a.created_at AS "candidateTime", a.id AS "candidateId", COALESCE((a.metadata->>'byteSize')::bigint,0) AS "byteSize", 'meeting_occurrence' AS "subjectType", o.id::text AS "subjectId", CASE WHEN c.owner_org_type=${ownerType} AND c.owner_org_id=${ownerId} THEN c.id::text ELSE NULL::text END AS "ancestorChannelId", CASE WHEN m.channel_id IS NOT NULL AND (c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId}) THEN 'unknown' ELSE 'blocked' END AS "referenceState"
        FROM work_hub_meeting_artifacts a JOIN work_hub_meeting_occurrences o ON o.id=a.occurrence_id JOIN work_hub_meetings m ON m.id=o.meeting_id LEFT JOIN work_hub_channels c ON c.id=m.channel_id
        WHERE m.owner_org_type=${ownerType} AND m.owner_org_id=${ownerId} AND a.artifact_type='recording' AND a.created_at < ${cutoff} AND a.created_at <= ${snapshotAt} AND ((a.created_at,a.id)>(${afterTime},${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    case "transcripts":
      return sql`SELECT a.created_at AS "candidateTime", s.id AS "candidateId", octet_length(s.text) AS "byteSize", 'meeting_occurrence' AS "subjectType", o.id::text AS "subjectId", CASE WHEN c.owner_org_type=${ownerType} AND c.owner_org_id=${ownerId} THEN c.id::text ELSE NULL::text END AS "ancestorChannelId", CASE WHEN m.channel_id IS NOT NULL AND (c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId}) THEN 'unknown' ELSE 'blocked' END AS "referenceState"
        FROM work_hub_transcript_segments s JOIN work_hub_meeting_artifacts a ON a.id=s.artifact_id JOIN work_hub_meeting_occurrences o ON o.id=a.occurrence_id JOIN work_hub_meetings m ON m.id=o.meeting_id LEFT JOIN work_hub_channels c ON c.id=m.channel_id
        WHERE m.owner_org_type=${ownerType} AND m.owner_org_id=${ownerId} AND a.created_at < ${cutoff} AND a.created_at <= ${snapshotAt} AND ((a.created_at,s.id)>(${afterTime},${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    case "attendance":
      return sql`SELECT a.joined_at AS "candidateTime", a.id AS "candidateId", 0 AS "byteSize", 'meeting_occurrence' AS "subjectType", o.id::text AS "subjectId", CASE WHEN c.owner_org_type=${ownerType} AND c.owner_org_id=${ownerId} THEN c.id::text ELSE NULL::text END AS "ancestorChannelId", CASE WHEN m.channel_id IS NOT NULL AND (c.id IS NULL OR c.owner_org_type<>${ownerType} OR c.owner_org_id<>${ownerId}) THEN 'unknown' ELSE 'blocked' END AS "referenceState"
        FROM work_hub_meeting_attendance a JOIN work_hub_meeting_occurrences o ON o.id=a.occurrence_id JOIN work_hub_meetings m ON m.id=o.meeting_id LEFT JOIN work_hub_channels c ON c.id=m.channel_id
        WHERE m.owner_org_type=${ownerType} AND m.owner_org_id=${ownerId} AND a.joined_at < ${cutoff} AND a.joined_at <= ${snapshotAt} AND ((a.joined_at,a.id)>(${afterTime},${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    case "external_calendar_cache":
      return sql`SELECT e.synced_at AS "candidateTime", e.id AS "candidateId", octet_length(e.title)+COALESCE(octet_length(e.location),0)+COALESCE(octet_length(e.organizer),0) AS "byteSize", 'organization' AS "subjectType", ${String(ownerId)} AS "subjectId", NULL::text AS "ancestorChannelId", CASE WHEN EXISTS (SELECT 1 FROM work_hub_audit_log a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.subject_id=e.id::text) THEN 'blocked' ELSE 'clear' END AS "referenceState"
        FROM work_hub_external_events e JOIN work_hub_external_calendars c ON c.id=e.calendar_id JOIN work_hub_calendar_connections x ON x.id=c.connection_id
        WHERE x.owner_org_type=${ownerType} AND x.owner_org_id=${ownerId} AND e.synced_at < ${cutoff} AND e.synced_at <= ${snapshotAt} AND ((e.synced_at,e.id)>(${afterTime},${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
    case "audit_logs":
      return sql`SELECT a.created_at AS "candidateTime", a.id AS "candidateId", octet_length(COALESCE(a.metadata::text,'')) AS "byteSize", 'organization' AS "subjectType", ${String(ownerId)} AS "subjectId", NULL::text AS "ancestorChannelId", 'clear' AS "referenceState"
        FROM work_hub_audit_log a WHERE a.owner_org_type=${ownerType} AND a.owner_org_id=${ownerId} AND a.created_at < ${cutoff} AND a.created_at <= ${snapshotAt} AND ((a.created_at,a.id)>(${afterTime},${afterId}::uuid))
        ORDER BY "candidateTime" ASC, "candidateId" ASC LIMIT ${limit}`;
  }
}

function rowToCandidate(owner: WorkHubGovernanceOwner, row: CandidateRow): RetentionCandidate {
  const time = row.candidateTime instanceof Date ? row.candidateTime : new Date(row.candidateTime);
  const bytes = Number(row.byteSize);
  const subject = { type: row.subjectType, id: row.subjectId } as const;
  return {
    cursor: `${time.toISOString()}|${row.candidateId}`,
    bytes,
    graph: {
      subject,
      ancestors: [
        { type: "organization", id: String(owner.id) },
        ...(row.ancestorChannelId && !(subject.type === "channel" && subject.id === row.ancestorChannelId) ? [{ type: "channel" as const, id: row.ancestorChannelId }] : []),
      ],
    },
    referenceState: row.referenceState,
  };
}

async function currentContext(owner: WorkHubGovernanceOwner, executor: Executor = db) {
  const [policy] = await executor.select().from(workHubRetentionPoliciesTable).where(and(eq(workHubRetentionPoliciesTable.ownerOrgType, owner.type), eq(workHubRetentionPoliciesTable.ownerOrgId, owner.id))).orderBy(desc(workHubRetentionPoliciesTable.policyVersion)).limit(1);
  const [minimum] = await executor.select().from(workHubRetentionMinimumPoliciesTable).orderBy(desc(workHubRetentionMinimumPoliciesTable.policyVersion)).limit(1);
  const holds = await executor.select({ subjectType: workHubLegalHoldsTable.subjectType, subjectId: workHubLegalHoldsTable.subjectId, active: workHubLegalHoldsTable.active }).from(workHubLegalHoldsTable).where(and(eq(workHubLegalHoldsTable.ownerOrgType, owner.type), eq(workHubLegalHoldsTable.ownerOrgId, owner.id), eq(workHubLegalHoldsTable.active, true)));
  return { policy: policy ? { id: policy.id, version: policy.policyVersion, rules: retentionRulesSchema.parse(policy.rules) } : null, minimum: minimum ? { version: minimum.policyVersion, rules: retentionRulesSchema.parse(minimum.rules) } : null, holds };
}

async function insertMetrics(tx: Tx, input: { owner: WorkHubGovernanceOwner; finishedAt: Date; durationMs: number; heldCount: number; referenceBlockedCount: number }) {
  for (const [metricName, value] of [["retention_plan.duration_ms", input.durationMs], ["retention_plan.held_count", input.heldCount], ["retention_plan.reference_blocked_count", input.referenceBlockedCount]] as const) {
    await recordWorkHubOperationalMetric({ owner: input.owner, metric: metricName, dimensions: { phase: "plan", source: "worker", status: "completed" }, value, observedAt: input.finishedAt }, tx);
  }
}

const repository = {
  async enqueue(input: { actor: { userId: number; source: "web"|"ios" }; owner: WorkHubGovernanceOwner; operationId: string; snapshotAt: Date }) {
    return db.transaction(async (tx) => {
      await acquireRetentionPublicationLocks(tx, input.owner);
      await authorizeOwnerAdmin(input.actor.userId, input.owner, tx);
      const context = await currentContext(input.owner, tx);
      if (!context.policy) throw new GovernanceRetentionError("retention.policy_unavailable", 503, "Organization retention policy is not configured");
      if (!context.minimum) throw new GovernanceRetentionError("retention.minimum_policy_unavailable", 503, "Platform retention minimum is not configured");
      const empty = createEmptyRetentionPlanAggregates();
      const [inserted] = await tx.insert(workHubRetentionPlanRunsTable).values({ ownerOrgType: input.owner.type, ownerOrgId: input.owner.id, retentionPolicyId: context.policy.id, policyVersion: context.policy.version, minimumPolicyVersion: context.minimum.version, requesterUserId: input.actor.userId, requesterIdSnapshot: String(input.actor.userId), requestSource: input.actor.source, operationId: input.operationId, snapshotAt: input.snapshotAt, status: "pending", attemptCount: 0, availableAt: input.snapshotAt, classAggregates: empty, errorCodes: [], updatedAt: input.snapshotAt }).onConflictDoNothing({ target: [workHubRetentionPlanRunsTable.requesterIdSnapshot, workHubRetentionPlanRunsTable.operationId] }).returning();
      if (inserted) {
        await tx.insert(workHubAuditLogTable).values({ actorUserId: input.actor.userId, ownerOrgType: input.owner.type, ownerOrgId: input.owner.id, action: "retention.plan.requested", subjectType: "retention_plan", subjectId: inserted.id, source: input.actor.source, operationId: input.operationId, metadata: { policyVersion: context.policy.version, minimumPolicyVersion: context.minimum.version } });
        return { replayed: false as const, resource: project(inserted) };
      }
      const [existing] = await tx.select().from(workHubRetentionPlanRunsTable).where(and(eq(workHubRetentionPlanRunsTable.requesterIdSnapshot, String(input.actor.userId)), eq(workHubRetentionPlanRunsTable.operationId, input.operationId))).limit(1);
      if (!existing || existing.ownerOrgType !== input.owner.type || existing.ownerOrgId !== input.owner.id) throw new GovernanceRetentionError("retention.operation_conflict", 409, "Operation ID was already used for a different request");
      return { replayed: true as const, resource: project(existing) };
    });
  },
  async claimNext(input: { now: Date; leaseExpiresAt: Date; maximumAttempts: number }) {
    return db.transaction(async (tx) => {
      const rows = rowsOf<typeof workHubRetentionPlanRunsTable.$inferSelect>(await tx.execute(sql`
        WITH candidate AS (
          SELECT id FROM work_hub_retention_plan_runs
          WHERE status='pending' AND available_at<=${input.now} AND attempt_count<${input.maximumAttempts}
          ORDER BY available_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE work_hub_retention_plan_runs p SET status='running', attempt_count=p.attempt_count+1,
          lease_expires_at=${input.leaseExpiresAt}, started_at=COALESCE(p.started_at,${input.now}), updated_at=${input.now}
        FROM candidate WHERE p.id=candidate.id RETURNING p.*
      `));
      const row = rows[0] as any;
      if (!row) return null;
      const requesterUserId = Number(row.requester_user_id ?? row.requesterUserId);
      const attemptCount = Number(row.attempt_count ?? row.attemptCount);
      if (!Number.isSafeInteger(requesterUserId) || requesterUserId < 1 || !Number.isSafeInteger(attemptCount) || attemptCount < 1) throw new GovernanceRetentionError("retention.internal_failure", 503, "Retention plan claim is invalid");
      return {
        id: row.id, actor: { userId: requesterUserId, source: (row.request_source ?? row.requestSource) === "ios" ? "ios" as const : "web" as const },
        owner: { type: row.owner_org_type ?? row.ownerOrgType, id: Number(row.owner_org_id ?? row.ownerOrgId) }, operationId: row.operation_id ?? row.operationId,
        snapshotAt: new Date(row.snapshot_at ?? row.snapshotAt), policyId: row.retention_policy_id ?? row.retentionPolicyId,
        policyVersion: Number(row.policy_version ?? row.policyVersion), minimumPolicyVersion: Number(row.minimum_policy_version ?? row.minimumPolicyVersion),
        attemptCount, leaseExpiresAt: new Date(row.lease_expires_at ?? row.leaseExpiresAt),
      };
    });
  },
  loadContext(input: { owner: WorkHubGovernanceOwner }) { return currentContext(input.owner); },
  async readCandidates(input: QueryInput & { retentionClass: (typeof RETENTION_CLASSES)[number] }) {
    const result = await db.execute(queryFor(input.retentionClass, input));
    return rowsOf<CandidateRow>(result).map((row) => rowToCandidate(input.owner, row));
  },
  async complete(input: { actor: { userId: number; source: "web"|"ios" }; owner: WorkHubGovernanceOwner; operationId: string; planId: string; policyId: string; policyVersion: number; minimumPolicyVersion: number; snapshotAt: Date; classAggregates: ReturnType<typeof createEmptyRetentionPlanAggregates>; errorCodes: WorkHubRetentionPlanErrorCode[]; activeHoldFingerprint: string; leaseExpiresAt: Date; finishedAt: Date; durationMs: number; totalRows: number; chunkCount: number }) {
    return db.transaction(async (tx) => {
      await acquireRetentionPublicationLocks(tx, input.owner);
      await authorizeOwnerAdmin(input.actor.userId, input.owner, tx);
      for (const value of [input.durationMs, input.totalRows, input.chunkCount]) if (!Number.isSafeInteger(value) || value < 0) throw new GovernanceRetentionError("retention.internal_failure", 503, "Retention plan evidence is invalid");
      const context = await currentContext(input.owner, tx);
      if (!context.policy || context.policy.id !== input.policyId || context.policy.version !== input.policyVersion) throw new GovernanceRetentionError("retention.policy_changed", 409, "Retention policy changed during planning");
      if (!context.minimum || context.minimum.version !== input.minimumPolicyVersion) throw new GovernanceRetentionError("retention.minimum_policy_changed", 409, "Platform retention minimum changed during planning");
      if (retentionHoldFingerprint(context.holds) !== input.activeHoldFingerprint) throw new GovernanceRetentionError("retention.reference_unresolved", 409, "Legal holds changed during planning");
      const finishedAt = input.finishedAt;
      const [row] = await tx.update(workHubRetentionPlanRunsTable).set({ status: "completed", finishedAt, leaseExpiresAt: null, updatedAt: finishedAt, classAggregates: retentionPlanClassAggregatesSchema.parse(input.classAggregates), errorCodes: retentionPlanErrorCodesSchema.parse(input.errorCodes) }).where(and(eq(workHubRetentionPlanRunsTable.id, input.planId), eq(workHubRetentionPlanRunsTable.ownerOrgType, input.owner.type), eq(workHubRetentionPlanRunsTable.ownerOrgId, input.owner.id), eq(workHubRetentionPlanRunsTable.policyVersion, input.policyVersion), eq(workHubRetentionPlanRunsTable.minimumPolicyVersion, input.minimumPolicyVersion), eq(workHubRetentionPlanRunsTable.status, "running"), eq(workHubRetentionPlanRunsTable.leaseExpiresAt, input.leaseExpiresAt), sql`${workHubRetentionPlanRunsTable.leaseExpiresAt}>${finishedAt}`)).returning();
      if (!row) throw new GovernanceRetentionError("retention.policy_changed", 409, "Retention plan state changed");
      const { heldCount, referenceBlockedCount } = validateRetentionPlanTotals(input.classAggregates, input.totalRows);
      await tx.insert(workHubAuditLogTable).values({ actorUserId: input.actor.userId, ownerOrgType: input.owner.type, ownerOrgId: input.owner.id, action: "retention.plan.completed", subjectType: "retention_plan", subjectId: row.id, source: input.actor.source, operationId: input.operationId, metadata: { policyVersion: input.policyVersion, minimumPolicyVersion: input.minimumPolicyVersion, heldCount, referenceBlockedCount, totalRows: input.totalRows, chunkCount: input.chunkCount, attemptCount: row.attemptCount, durationMs: input.durationMs } });
      await insertMetrics(tx, { owner: input.owner, finishedAt, durationMs: input.durationMs, heldCount, referenceBlockedCount });
      return { replayed: false, resource: project(row) };
    });
  },
  async fail(input: { actor: { userId: number; source: "web"|"ios" }; owner: WorkHubGovernanceOwner; operationId: string; planId: string; errorCodes: WorkHubRetentionPlanErrorCode[]; leaseExpiresAt: Date; observedAt: Date; attemptCount: number; maximumAttempts: number }) {
    await db.transaction(async (tx) => {
      await acquireRetentionPublicationLocks(tx, input.owner);
      const codes = retentionPlanErrorCodesSchema.parse(input.errorCodes);
      const retrying = codes.length === 1 && codes[0] === "internal_failure" && input.attemptCount < input.maximumAttempts;
      const status = retrying ? "pending" as const : "failed" as const;
      const finishedAt = retrying ? null : input.observedAt;
      const [row] = await tx.update(workHubRetentionPlanRunsTable).set({ status, availableAt: input.observedAt, finishedAt, leaseExpiresAt: null, updatedAt: input.observedAt, errorCodes: codes }).where(and(eq(workHubRetentionPlanRunsTable.id, input.planId), eq(workHubRetentionPlanRunsTable.ownerOrgType, input.owner.type), eq(workHubRetentionPlanRunsTable.ownerOrgId, input.owner.id), eq(workHubRetentionPlanRunsTable.status, "running"), eq(workHubRetentionPlanRunsTable.leaseExpiresAt, input.leaseExpiresAt), sql`${workHubRetentionPlanRunsTable.leaseExpiresAt}>${input.observedAt}`)).returning({ id: workHubRetentionPlanRunsTable.id });
      if (row) await tx.insert(workHubAuditLogTable).values({ actorUserId: null, ownerOrgType: input.owner.type, ownerOrgId: input.owner.id, action: "retention.plan.failed", subjectType: "retention_plan", subjectId: row.id, source: "worker", operationId: input.operationId, metadata: { errorCodes: codes, retrying, attemptCount: input.attemptCount } });
    });
  },
  async recoverStale(input: { now: Date; maximumAttempts: number }) {
    const stale = await db.select().from(workHubRetentionPlanRunsTable).where(and(eq(workHubRetentionPlanRunsTable.status, "running"), sql`${workHubRetentionPlanRunsTable.leaseExpiresAt}<=${input.now}`)).orderBy(workHubRetentionPlanRunsTable.leaseExpiresAt, workHubRetentionPlanRunsTable.id).limit(25);
    let recovered = 0;
    for (const candidate of stale) await db.transaction(async (tx) => {
      const owner = { type: candidate.ownerOrgType as "vendor"|"partner", id: candidate.ownerOrgId };
      await acquireRetentionPublicationLocks(tx, owner);
      await tx.execute(sql`SELECT id FROM work_hub_retention_plan_runs WHERE id=${candidate.id} AND status='running' AND lease_expires_at<=${input.now} FOR UPDATE`);
      const transition = retentionPlanStaleTransition(candidate.attemptCount, input.maximumAttempts, input.now);
      const [updated] = await tx.update(workHubRetentionPlanRunsTable).set({ status: transition.status, availableAt: input.now, leaseExpiresAt: null, finishedAt: transition.finishedAt, errorCodes: transition.errorCodes, updatedAt: input.now }).where(and(eq(workHubRetentionPlanRunsTable.id, candidate.id), eq(workHubRetentionPlanRunsTable.status, "running"), sql`${workHubRetentionPlanRunsTable.leaseExpiresAt}<=${input.now}`)).returning({ id: workHubRetentionPlanRunsTable.id });
      if (!updated) return;
      await tx.insert(workHubAuditLogTable).values({ actorUserId: null, ownerOrgType: owner.type, ownerOrgId: owner.id, action: "retention.plan.failed", subjectType: "retention_plan", subjectId: candidate.id, source: "worker", operationId: candidate.operationId, metadata: { errorCodes: transition.errorCodes, retrying: transition.retrying, attemptCount: candidate.attemptCount } });
      recovered += 1;
    });
    return recovered;
  },
  async read(input: { actor: { userId: number }; owner: WorkHubGovernanceOwner; planId: string }) {
    await authorizeOwnerAdmin(input.actor.userId, input.owner);
    const [row] = await db.select().from(workHubRetentionPlanRunsTable).where(and(eq(workHubRetentionPlanRunsTable.id, input.planId), eq(workHubRetentionPlanRunsTable.ownerOrgType, input.owner.type), eq(workHubRetentionPlanRunsTable.ownerOrgId, input.owner.id))).limit(1);
    return row ? project(row) : null;
  },
};

export const workHubRetentionPlannerService = createRetentionPlannerService({ authorizeOwnerAdmin, repository });
export const workHubRetentionPlannerWorker = createRetentionPlannerWorker({ repository, authorizeCurrent: authorizeOwnerAdmin, chunkSize: RETENTION_PLAN_CHUNK_LIMIT });

export function createRetentionPlannerDrain(deps: { runOne(): Promise<boolean>; recoverStale(): Promise<number>; onError(error: unknown): void }) {
  let running = false;
  let stopped = true;
  let generation = 0;
  let active: Promise<void> | null = null;
  return {
    async start(): Promise<void> {
      stopped = false;
      generation += 1;
      try { await deps.recoverStale(); } catch (error) { deps.onError(error); }
      await this.drain();
    },
    async stop(): Promise<void> { stopped = true; generation += 1; await active; },
    async drain(): Promise<void> {
      if (running) return active ?? undefined;
      if (stopped) return;
      const current = generation;
      running = true;
      active = (async () => {
        try {
          while (!stopped && current === generation && await deps.runOne()) { /* bounded jobs only */ }
        } catch (error) { deps.onError(error); }
        finally { running = false; active = null; }
      })();
      return active;
    },
  };
}

let retentionPlannerTimer: NodeJS.Timeout | null = null;
const retentionPlannerDrain = createRetentionPlannerDrain({
  runOne: () => workHubRetentionPlannerWorker.runOne(),
  recoverStale: () => workHubRetentionPlannerWorker.recoverStale(),
  onError: (err) => logger.error({ err }, "Work Hub retention planner worker failed"),
});
export async function recoverAndStartWorkHubRetentionPlannerWorker(): Promise<void> {
  await retentionPlannerDrain.start();
  if (!retentionPlannerTimer) {
    retentionPlannerTimer = setInterval(() => { void retentionPlannerDrain.drain(); }, 5_000);
    retentionPlannerTimer.unref();
  }
}
export async function stopWorkHubRetentionPlannerWorker(): Promise<void> {
  if (retentionPlannerTimer) clearInterval(retentionPlannerTimer);
  retentionPlannerTimer = null;
  await retentionPlannerDrain.stop();
}
