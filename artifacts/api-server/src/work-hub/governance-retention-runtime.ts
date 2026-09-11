import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  partnersTable,
  vendorsTable,
  usersTable,
  userOrgMembershipsTable,
  workHubAuditLogTable,
  workHubChannelsTable,
  workHubClientOperationsTable,
  workHubLegalHoldsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingsTable,
  workHubRetentionMinimumPoliciesTable,
  workHubRetentionPoliciesTable,
} from "@workspace/db";
import {
  validateOrganizationRetentionRules,
  type RetentionSubject,
  type WorkHubGovernanceOwner,
} from "@workspace/api-zod";
import { executeWorkHubCommand } from "./commands";
import { WorkHubAccessError } from "./context-access";
import {
  createGovernanceRetentionService,
  GovernanceRetentionError,
  projectMeetingSubjectGraph,
  type SubjectGraph,
} from "./governance-retention";
import { workHubRetentionPlannerService } from "./governance-retention-planner-runtime";
import { acquireGlobalRetentionLock, acquireRetentionPublicationLocks } from "./governance-locks";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
const rowsOf = <T>(result: unknown): T[] =>
  ((result as { rows?: T[] }).rows ?? result) as T[];
const sourceOf = (value: string): "web" | "ios" =>
  value === "ios" ? "ios" : "web";
const ownerProjection = (row: {
  ownerOrgType: string;
  ownerOrgId: number;
}) => ({ type: row.ownerOrgType as "vendor" | "partner", id: row.ownerOrgId });
const policyProjection = (
  row: typeof workHubRetentionPoliciesTable.$inferSelect,
) => ({
  id: row.id,
  owner: ownerProjection(row),
  policyVersion: row.policyVersion,
  rules: row.rules,
  createdAt: row.createdAt.toISOString(),
});
const minimumProjection = (
  row: typeof workHubRetentionMinimumPoliciesTable.$inferSelect,
) => ({
  id: row.id,
  policyVersion: row.policyVersion,
  rules: row.rules,
  createdAt: row.createdAt.toISOString(),
});
const holdProjection = (row: typeof workHubLegalHoldsTable.$inferSelect) => ({
  id: row.id,
  owner: ownerProjection(row),
  subject: {
    type: row.subjectType as RetentionSubject["type"],
    id: row.subjectId,
  },
  reason: row.reason,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
  releasedAt: row.releasedAt?.toISOString() ?? null,
});

async function ownerExists(
  owner: WorkHubGovernanceOwner,
  executor: Executor = db,
): Promise<boolean> {
  const table = owner.type === "vendor" ? vendorsTable : partnersTable;
  const [row] = await executor
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, owner.id))
    .limit(1);
  return Boolean(row);
}

async function authorizeOwnerAdmin(
  userId: number,
  owner: WorkHubGovernanceOwner,
  executor: Executor = db,
): Promise<void> {
  const [user] = await executor
    .select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || user.suspendedAt) throw new WorkHubAccessError("not_found");
  if (!(await ownerExists(owner, executor))) {
    throw new WorkHubAccessError("not_found");
  }
  if (user.role === "admin") return;
  const ownerColumn =
    owner.type === "vendor"
      ? userOrgMembershipsTable.vendorId
      : userOrgMembershipsTable.partnerId;
  const [membership] = await executor
    .select({ role: userOrgMembershipsTable.role })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, userId),
        eq(userOrgMembershipsTable.orgType, owner.type),
        eq(ownerColumn, owner.id),
      ),
    )
    .limit(1);
  if (!membership) throw new WorkHubAccessError("not_found");
  if (membership.role !== "admin") throw new WorkHubAccessError("forbidden");
}
async function authorizePlatformAdmin(
  userId: number,
  executor: Executor = db,
): Promise<void> {
  const [user] = await executor
    .select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || user.suspendedAt || user.role !== "admin")
    throw new WorkHubAccessError("forbidden");
}
async function audit(
  executor: Tx,
  input: {
    actorUserId: number;
    owner: { type: string; id: number };
    action: string;
    subjectType: string;
    subjectId: string;
    source: string;
    operationId: string;
    priorVersion?: number | null;
    newVersion?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  await executor.insert(workHubAuditLogTable).values({
    actorUserId: input.actorUserId,
    ownerOrgType: input.owner.type,
    ownerOrgId: input.owner.id,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    source: sourceOf(input.source),
    operationId: input.operationId,
    priorVersion: input.priorVersion ?? null,
    newVersion: input.newVersion ?? null,
    metadata: input.metadata ?? {},
  });
}

async function runPlatformCommand<T>(
  input: { actorUserId: number; source: string; operationId: string },
  apply: (tx: Tx) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await authorizePlatformAdmin(input.actorUserId, tx);
    const [claimed] = await tx
      .insert(workHubClientOperationsTable)
      .values({
        userId: input.actorUserId,
        commandKind: "retention.minimum.create",
        operationId: input.operationId,
        ownerOrgType: "platform",
        ownerOrgId: 1,
      })
      .onConflictDoNothing()
      .returning({ id: workHubClientOperationsTable.id });
    if (!claimed) {
      const [existing] = await tx
        .select()
        .from(workHubClientOperationsTable)
        .where(
          and(
            eq(workHubClientOperationsTable.userId, input.actorUserId),
            eq(
              workHubClientOperationsTable.commandKind,
              "retention.minimum.create",
            ),
            eq(workHubClientOperationsTable.operationId, input.operationId),
          ),
        )
        .limit(1);
      if (
        !existing?.resultJson ||
        !existing.appliedAt ||
        existing.ownerOrgType !== "platform"
      )
        throw new GovernanceRetentionError(
          "retention.operation_conflict",
          409,
          "Operation is unavailable",
        );
      return {
        operationId: input.operationId,
        appliedAt: existing.appliedAt.toISOString(),
        replayed: true,
        resource: existing.resultJson as T,
      };
    }
    const resource = await apply(tx);
    const appliedAt = new Date();
    await tx
      .update(workHubClientOperationsTable)
      .set({ resultJson: resource as Record<string, unknown>, appliedAt })
      .where(eq(workHubClientOperationsTable.id, claimed.id));
    return {
      operationId: input.operationId,
      appliedAt: appliedAt.toISOString(),
      replayed: false,
      resource,
    };
  });
}

export async function resolveRetentionSubjectGraph(
  owner: WorkHubGovernanceOwner,
  subject: RetentionSubject,
  executor: Executor = db,
): Promise<SubjectGraph | null> {
  const organization = {
    type: "organization" as const,
    id: String(owner.id),
  };
  if (subject.type === "organization") {
    if (subject.id !== organization.id) return null;
    const table = owner.type === "vendor" ? vendorsTable : partnersTable;
    const [row] = await executor
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, owner.id))
      .limit(1);
    return row ? { subject: organization, ancestors: [] } : null;
  }
  if (subject.type === "channel") {
    const [channel] = await executor
      .select({ id: workHubChannelsTable.id })
      .from(workHubChannelsTable)
      .where(
        and(
          eq(workHubChannelsTable.id, subject.id),
          eq(workHubChannelsTable.ownerOrgType, owner.type),
          eq(workHubChannelsTable.ownerOrgId, owner.id),
        ),
      )
      .limit(1);
    return channel
      ? {
          subject: { type: "channel", id: channel.id },
          ancestors: [organization],
        }
      : null;
  }
  const [occurrence] = await executor
    .select({
      id: workHubMeetingOccurrencesTable.id,
      channelId: workHubMeetingsTable.channelId,
      matchedChannelId: workHubChannelsTable.id,
    })
    .from(workHubMeetingOccurrencesTable)
    .innerJoin(
      workHubMeetingsTable,
      eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
    )
    .leftJoin(
      workHubChannelsTable,
      and(
        eq(workHubChannelsTable.id, workHubMeetingsTable.channelId),
        eq(workHubChannelsTable.ownerOrgType, owner.type),
        eq(workHubChannelsTable.ownerOrgId, owner.id),
      ),
    )
    .where(
      and(
        eq(workHubMeetingOccurrencesTable.id, subject.id),
        eq(workHubMeetingsTable.ownerOrgType, owner.type),
        eq(workHubMeetingsTable.ownerOrgId, owner.id),
      ),
    )
    .limit(1);
  if (occurrence && occurrence.channelId && !occurrence.matchedChannelId) {
    return null;
  }
  return occurrence ? projectMeetingSubjectGraph(owner, occurrence) : null;
}

const repository = {
  async currentMinimum() {
    const [row] = await db
      .select()
      .from(workHubRetentionMinimumPoliciesTable)
      .orderBy(desc(workHubRetentionMinimumPoliciesTable.policyVersion))
      .limit(1);
    return row ?? null;
  },
  async listMinimums() {
    return (
      await db
        .select()
        .from(workHubRetentionMinimumPoliciesTable)
        .orderBy(desc(workHubRetentionMinimumPoliciesTable.policyVersion))
    ).map(minimumProjection);
  },
  async createMinimum(input: any) {
    return runPlatformCommand(input, async (tx) => {
      await acquireGlobalRetentionLock(tx);
      await authorizePlatformAdmin(input.actorUserId, tx);
      const [prior] = await tx
        .select()
        .from(workHubRetentionMinimumPoliciesTable)
        .orderBy(desc(workHubRetentionMinimumPoliciesTable.policyVersion))
        .limit(1);
      const version = (prior?.policyVersion ?? 0) + 1;
      const [row] = await tx
        .insert(workHubRetentionMinimumPoliciesTable)
        .values({
          policyVersion: version,
          rules: input.rules,
          createdById: input.actorUserId,
        })
        .returning();
      await audit(tx, {
        actorUserId: input.actorUserId,
        owner: { type: "platform", id: 1 },
        action: "retention.minimum.created",
        subjectType: "platform_retention_minimum",
        subjectId: row!.id,
        source: input.source,
        operationId: input.operationId,
        priorVersion: prior?.policyVersion ?? null,
        newVersion: version,
        metadata: {},
      });
      return minimumProjection(row!);
    });
  },
  async currentPolicy(owner: WorkHubGovernanceOwner) {
    const [row] = await db
      .select()
      .from(workHubRetentionPoliciesTable)
      .where(
        and(
          eq(workHubRetentionPoliciesTable.ownerOrgType, owner.type),
          eq(workHubRetentionPoliciesTable.ownerOrgId, owner.id),
        ),
      )
      .orderBy(desc(workHubRetentionPoliciesTable.policyVersion))
      .limit(1);
    return row ? policyProjection(row) : null;
  },
  async listPolicies(owner: WorkHubGovernanceOwner) {
    return (
      await db
        .select()
        .from(workHubRetentionPoliciesTable)
        .where(
          and(
            eq(workHubRetentionPoliciesTable.ownerOrgType, owner.type),
            eq(workHubRetentionPoliciesTable.ownerOrgId, owner.id),
          ),
        )
        .orderBy(desc(workHubRetentionPoliciesTable.policyVersion))
    ).map(policyProjection);
  },
  async createPolicy(input: any) {
    return executeWorkHubCommand(
      { userId: input.actorUserId, source: input.source },
      "retention.policy.create",
      {
        operationId: input.operationId,
        owner: input.owner,
        context: { kind: "organization", id: input.owner.id },
        expectedVersion: null,
        payloadVersion: 1,
        payload: {},
      },
      async (tx) => {
        await acquireRetentionPublicationLocks(tx, input.owner);
        await authorizeOwnerAdmin(input.actorUserId, input.owner, tx);
        const [minimum] = await tx
          .select()
          .from(workHubRetentionMinimumPoliciesTable)
          .orderBy(desc(workHubRetentionMinimumPoliciesTable.policyVersion))
          .limit(1);
        if (!minimum || minimum.policyVersion !== input.minimumPolicyVersion)
          throw new GovernanceRetentionError(
            "retention.minimum_changed",
            409,
            "Platform retention minimum changed",
          );
        validateOrganizationRetentionRules(input.rules, minimum.rules);
        const [prior] = await tx
          .select()
          .from(workHubRetentionPoliciesTable)
          .where(
            and(
              eq(workHubRetentionPoliciesTable.ownerOrgType, input.owner.type),
              eq(workHubRetentionPoliciesTable.ownerOrgId, input.owner.id),
            ),
          )
          .orderBy(desc(workHubRetentionPoliciesTable.policyVersion))
          .limit(1);
        const version = (prior?.policyVersion ?? 0) + 1;
        const [row] = await tx
          .insert(workHubRetentionPoliciesTable)
          .values({
            ownerOrgType: input.owner.type,
            ownerOrgId: input.owner.id,
            policyVersion: version,
            rules: input.rules,
            createdById: input.actorUserId,
          })
          .returning();
        await audit(tx, {
          actorUserId: input.actorUserId,
          owner: input.owner,
          action: "retention.policy.created",
          subjectType: "retention_policy",
          subjectId: row!.id,
          source: input.source,
          operationId: input.operationId,
          priorVersion: prior?.policyVersion ?? null,
          newVersion: version,
          metadata: { minimumPolicyVersion: minimum.policyVersion },
        });
        return policyProjection(row!);
      },
      (tx) => authorizeOwnerAdmin(input.actorUserId, input.owner, tx),
    );
  },
  async listHolds(owner: WorkHubGovernanceOwner) {
    return (
      await db
        .select()
        .from(workHubLegalHoldsTable)
        .where(
          and(
            eq(workHubLegalHoldsTable.ownerOrgType, owner.type),
            eq(workHubLegalHoldsTable.ownerOrgId, owner.id),
          ),
        )
        .orderBy(desc(workHubLegalHoldsTable.createdAt))
    ).map(holdProjection);
  },
  async createHold(input: any) {
    return executeWorkHubCommand(
      { userId: input.actorUserId, source: input.source },
      "retention.hold.create",
      {
        operationId: input.operationId,
        owner: input.owner,
        context: { kind: "organization", id: input.owner.id },
        expectedVersion: null,
        payloadVersion: 1,
        payload: {},
      },
      async (tx) => {
        await acquireRetentionPublicationLocks(tx, input.owner);
        await authorizeOwnerAdmin(input.actorUserId, input.owner, tx);
        const graph = await resolveRetentionSubjectGraph(
          input.owner,
          input.subject,
          tx,
        );
        if (!graph) throw new WorkHubAccessError("not_found");
        const [active] = await tx
          .select({ id: workHubLegalHoldsTable.id })
          .from(workHubLegalHoldsTable)
          .where(
            and(
              eq(workHubLegalHoldsTable.ownerOrgType, input.owner.type),
              eq(workHubLegalHoldsTable.ownerOrgId, input.owner.id),
              eq(workHubLegalHoldsTable.subjectType, graph.subject.type),
              eq(workHubLegalHoldsTable.subjectId, graph.subject.id),
              eq(workHubLegalHoldsTable.active, true),
            ),
          )
          .limit(1);
        if (active)
          throw new GovernanceRetentionError(
            "retention.hold_active",
            409,
            "An active legal hold already exists",
          );
        const [row] = await tx
          .insert(workHubLegalHoldsTable)
          .values({
            ownerOrgType: input.owner.type,
            ownerOrgId: input.owner.id,
            subjectType: graph.subject.type,
            subjectId: graph.subject.id,
            reason: input.reason,
            createdById: input.actorUserId,
          })
          .returning();
        await audit(tx, {
          actorUserId: input.actorUserId,
          owner: input.owner,
          action: "retention.hold.created",
          subjectType: "legal_hold",
          subjectId: row!.id,
          source: input.source,
          operationId: input.operationId,
          metadata: input.auditMetadata,
        });
        return holdProjection(row!);
      },
      (tx) => authorizeOwnerAdmin(input.actorUserId, input.owner, tx),
    );
  },
  async releaseHold(input: any) {
    return executeWorkHubCommand(
      { userId: input.actorUserId, source: input.source },
      "retention.hold.release",
      {
        operationId: input.operationId,
        owner: input.owner,
        context: { kind: "organization", id: input.owner.id },
        expectedVersion: null,
        payloadVersion: 1,
        payload: {},
      },
      async (tx) => {
        await acquireRetentionPublicationLocks(tx, input.owner);
        await authorizeOwnerAdmin(input.actorUserId, input.owner, tx);
        const [row] = await tx
          .update(workHubLegalHoldsTable)
          .set({
            active: false,
            releasedById: input.actorUserId,
            releasedAt: new Date(),
          })
          .where(
            and(
              eq(workHubLegalHoldsTable.id, input.holdId),
              eq(workHubLegalHoldsTable.ownerOrgType, input.owner.type),
              eq(workHubLegalHoldsTable.ownerOrgId, input.owner.id),
              eq(workHubLegalHoldsTable.active, true),
            ),
          )
          .returning();
        if (!row) throw new WorkHubAccessError("not_found");
        await audit(tx, {
          actorUserId: input.actorUserId,
          owner: input.owner,
          action: "retention.hold.released",
          subjectType: "legal_hold",
          subjectId: row.id,
          source: input.source,
          operationId: input.operationId,
          metadata: {},
        });
        return holdProjection(row);
      },
      (tx) => authorizeOwnerAdmin(input.actorUserId, input.owner, tx),
    );
  },
  resolveSubject: resolveRetentionSubjectGraph,
};

const retentionAdministrationService = createGovernanceRetentionService({
  authorizeOwnerAdmin,
  authorizePlatformAdmin,
  repository,
});
export const workHubGovernanceService = {
  ...retentionAdministrationService,
  createPlan: workHubRetentionPlannerService.create,
  readPlan: workHubRetentionPlannerService.read,
};
