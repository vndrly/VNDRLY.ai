#!/usr/bin/env tsx
/**
 * Idempotent bootstrap: add Majik team members by login (email or username).
 *
 * Default logins: admin@vndrly.com, admin
 * Override: MAJIK_MEMBER_LOGINS=admin@vndrly.com,admin,other@company.com
 *
 * Skips users already on the team and respects the 8-member cap.
 */
import {
  MAJIK_DEFAULT_CIRCLE_ID,
  MAJIK_MAX_MEMBERS,
} from "@workspace/majik";
import {
  db,
  majikCircleMembersTable,
  majikCirclesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

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
  const [circle] = await db
    .select()
    .from(majikCirclesTable)
    .where(eq(majikCirclesTable.id, MAJIK_DEFAULT_CIRCLE_ID));

  if (!circle) {
    throw new Error(
      "Majik circle missing. Run `pnpm --filter @workspace/api-server run ensure:majik-circle` first.",
    );
  }

  const logins = targetLogins();
  const users = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      username: usersTable.username,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(
      inArray(
        sql`lower(coalesce(${usersTable.email}, ${usersTable.username}))`,
        logins,
      ),
    );

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(majikCircleMembersTable)
    .where(eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID));
  let memberCount = countRow?.n ?? 0;

  const added: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const login of logins) {
    const user = users.find(
      (u) =>
        u.username.toLowerCase() === login ||
        (u.email?.toLowerCase() ?? "") === login,
    );
    if (!user) {
      missing.push(login);
      continue;
    }

    const [existing] = await db
      .select({ userId: majikCircleMembersTable.userId })
      .from(majikCircleMembersTable)
      .where(
        and(
          eq(majikCircleMembersTable.circleId, MAJIK_DEFAULT_CIRCLE_ID),
          eq(majikCircleMembersTable.userId, user.id),
        ),
      )
      .limit(1);

    if (existing) {
      skipped.push(`${user.displayName} (${login})`);
      continue;
    }

    if (memberCount >= MAJIK_MAX_MEMBERS) {
      console.warn(`Cap of ${MAJIK_MAX_MEMBERS} reached; not adding ${login}`);
      break;
    }

    await db.insert(majikCircleMembersTable).values({
      circleId: MAJIK_DEFAULT_CIRCLE_ID,
      userId: user.id,
    });
    memberCount += 1;
    added.push(`${user.displayName} (${login})`);
  }

  console.log(`Majik team "${circle.name}" — ${memberCount} member(s)`);
  if (added.length) console.log("Added:", added.join(", "));
  if (skipped.length) console.log("Already members:", skipped.join(", "));
  if (missing.length) console.log("Not found in users table:", missing.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
