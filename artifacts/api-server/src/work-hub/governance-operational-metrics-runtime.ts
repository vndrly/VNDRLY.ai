import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, partnersTable, userOrgMembershipsTable, usersTable, vendorsTable, workHubOperationalMetricBucketsTable } from "@workspace/db";
import type { WorkHubGovernanceOwner, WorkHubOperationalMetricEvent } from "@workspace/api-zod";
import { WorkHubAccessError } from "./context-access";
import { createOperationalMetricRecorder, createOperationalMetricsService, type OperationalMetricBucketRow } from "./governance-operational-metrics";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

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
async function authorizePlatformAdmin(userId: number): Promise<void> {
  const [user] = await db.select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user || user.suspendedAt) throw new WorkHubAccessError("not_found");
  if (user.role !== "admin") throw new WorkHubAccessError("forbidden");
}

function columns() {
  return { metricName: workHubOperationalMetricBucketsTable.metricName, intervalStart: workHubOperationalMetricBucketsTable.intervalStart, dimensions: workHubOperationalMetricBucketsTable.dimensions, count: workHubOperationalMetricBucketsTable.count, sum: workHubOperationalMetricBucketsTable.sum, max: workHubOperationalMetricBucketsTable.max };
}

function recorder(executor: Executor) { return createOperationalMetricRecorder({
  async upsert(input) {
    await executor.insert(workHubOperationalMetricBucketsTable).values({ ownerOrgType: input.owner.type, ownerOrgId: input.owner.id, metricName: input.metric, intervalStart: input.intervalStart, dimensions: input.dimensions, dimensionHash: input.dimensionHash, count: input.count, sum: input.sum, max: input.max, updatedAt: input.observedAt }).onConflictDoUpdate({
      target: [workHubOperationalMetricBucketsTable.ownerOrgType, workHubOperationalMetricBucketsTable.ownerOrgId, workHubOperationalMetricBucketsTable.metricName, workHubOperationalMetricBucketsTable.intervalStart, workHubOperationalMetricBucketsTable.dimensionHash],
      set: { count: sql`${workHubOperationalMetricBucketsTable.count}+1`, sum: sql`${workHubOperationalMetricBucketsTable.sum}+${input.sum}`, max: sql`GREATEST(${workHubOperationalMetricBucketsTable.max},${input.max})`, updatedAt: input.observedAt },
    });
  },
}); }

export async function recordWorkHubOperationalMetric(input: Omit<WorkHubOperationalMetricEvent, "observedAt"> & { observedAt: Date }, executor: Executor = db): Promise<void> { await recorder(executor)(input); }

export const workHubOperationalMetricsService = createOperationalMetricsService({
  authorizeOwnerAdmin,
  authorizePlatformAdmin,
  async readOwner(input) {
    return db.select(columns()).from(workHubOperationalMetricBucketsTable).where(and(eq(workHubOperationalMetricBucketsTable.ownerOrgType, input.owner.type), eq(workHubOperationalMetricBucketsTable.ownerOrgId, input.owner.id), gte(workHubOperationalMetricBucketsTable.intervalStart, input.from), lt(workHubOperationalMetricBucketsTable.intervalStart, input.to))).orderBy(workHubOperationalMetricBucketsTable.intervalStart, workHubOperationalMetricBucketsTable.metricName).limit(10_001) as Promise<OperationalMetricBucketRow[]>;
  },
  async readPlatform(input) {
    return db.select({ metricName: workHubOperationalMetricBucketsTable.metricName, intervalStart: workHubOperationalMetricBucketsTable.intervalStart, dimensions: workHubOperationalMetricBucketsTable.dimensions, count: sql<number>`sum(${workHubOperationalMetricBucketsTable.count})`, sum: sql<number>`sum(${workHubOperationalMetricBucketsTable.sum})`, max: sql<number>`max(${workHubOperationalMetricBucketsTable.max})` }).from(workHubOperationalMetricBucketsTable).where(and(gte(workHubOperationalMetricBucketsTable.intervalStart, input.from), lt(workHubOperationalMetricBucketsTable.intervalStart, input.to))).groupBy(workHubOperationalMetricBucketsTable.metricName, workHubOperationalMetricBucketsTable.intervalStart, workHubOperationalMetricBucketsTable.dimensions, workHubOperationalMetricBucketsTable.dimensionHash).orderBy(workHubOperationalMetricBucketsTable.intervalStart, workHubOperationalMetricBucketsTable.metricName).limit(10_001) as Promise<OperationalMetricBucketRow[]>;
  },
});
