#!/usr/bin/env tsx
/**
 * Remove Majik members whose login is not in MAJIK_MEMBER_LOGINS.
 * Default keep-list matches ensure-majik-members.ts.
 */
import { MAJIK_DEFAULT_CIRCLE_ID } from "@workspace/majik";
import {
  db,
  majikCircleMembersTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

const DEFAULT_LOGINS = ["admin@vndrly.com", "admin"];

function targetLogins(): string[] {
  const raw = process.env.MAJIK_MEMBER_LOGINS?.trim();
  if (!raw) return DEFAULT_LOGINS;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  const logins = targetLogins();
  const keepUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      inArray(
        sql`lower(coalesce(${usersTable.email}, ${usersTable.username}))`,
        logins,
      ),
    );
  const keepIds = keepUsers.map((u) => u.id);

  if (keepIds.length === 0) {
    throw new Error("No users matched MAJIK_MEMBER_LOGINS; refusing to prune.");
  }

  const removed = await db
    .delete(majikCircleMembersTable)
    .where(
      and(
        eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID),
        notInArray(majikCircleMembersTable.userId, keepIds),
      ),
    )
    .returning({ userId: majikCircleMembersTable.userId });

  console.log(
    `Pruned ${removed.length} Majik member(s) not in keep-list: ${logins.join(", ")}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
