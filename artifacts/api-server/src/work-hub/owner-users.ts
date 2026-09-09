import { and, eq, inArray } from "drizzle-orm";
import { db, userOrgMembershipsTable } from "@workspace/db";
import type { WorkHubOwner } from "@workspace/api-zod";
import { WorkHubAccessError } from "./context-access";

export async function assertOwnerUsers(
  owner: WorkHubOwner,
  requestedUserIds: readonly number[],
): Promise<void> {
  const userIds = [...new Set(requestedUserIds)];
  if (!userIds.length) return;
  const rows = await db
    .select({ userId: userOrgMembershipsTable.userId })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, owner.type),
        owner.type === "vendor"
          ? eq(userOrgMembershipsTable.vendorId, owner.id)
          : eq(userOrgMembershipsTable.partnerId, owner.id),
        inArray(userOrgMembershipsTable.userId, userIds),
      ),
    );
  const visible = new Set(rows.map((row) => row.userId));
  if (userIds.some((userId) => !visible.has(userId))) {
    throw new WorkHubAccessError("not_found");
  }
}

export function assertOwnerMatchesChannel(
  owner: WorkHubOwner,
  channel: { ownerOrgType: string; ownerOrgId: number },
): void {
  if (owner.type !== channel.ownerOrgType || owner.id !== channel.ownerOrgId) {
    throw new WorkHubAccessError("forbidden");
  }
}
