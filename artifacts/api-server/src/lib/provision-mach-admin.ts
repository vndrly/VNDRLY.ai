import bcrypt from "bcryptjs";
import { db, usersTable, userOrgMembershipsTable, partnersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const TARGET_USERNAME = "mach@vndrly.com";
const TARGET_DISPLAY_NAME = "Mach Admin";
const TARGET_PARTNER_NAME = "Mach Natural Resources";
const TARGET_PASSWORD = "mach1";

export async function provisionMachAdmin(): Promise<void> {
  try {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower(${TARGET_USERNAME})`)
      .limit(1);
    if (existing) return;

    const [partner] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(sql`lower(${partnersTable.name}) = lower(${TARGET_PARTNER_NAME})`)
      .limit(1);
    if (!partner) {
      logger.warn(
        { partnerName: TARGET_PARTNER_NAME },
        "provisionMachAdmin: target partner not found, skipping",
      );
      return;
    }

    const passwordHash = bcrypt.hashSync(TARGET_PASSWORD, 10);

    // Create the user, the matching membership row, and pin
    // `activeMembershipId` in one transaction so the user is never
    // visible without a membership (and so an interrupted boot leaves
    // nothing behind to backfill).
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(usersTable)
        .values({
          username: TARGET_USERNAME,
          email: TARGET_USERNAME,
          passwordHash,
          role: "partner",
          displayName: TARGET_DISPLAY_NAME,
          mustChangePassword: false,
        })
        .returning({ id: usersTable.id });
      if (!user) return null;

      const [membership] = await tx
        .insert(userOrgMembershipsTable)
        .values({
          userId: user.id,
          orgType: "partner",
          partnerId: partner.id,
          role: "admin",
        })
        .returning({ id: userOrgMembershipsTable.id });
      if (!membership) return null;

      await tx
        .update(usersTable)
        .set({ activeMembershipId: membership.id })
        .where(eq(usersTable.id, user.id));

      return { userId: user.id, membershipId: membership.id };
    });

    if (!created) return;

    logger.warn(
      {
        userId: created.userId,
        membershipId: created.membershipId,
        partnerId: partner.id,
        username: TARGET_USERNAME,
      },
      "provisionMachAdmin: created Mach Natural Resources admin login",
    );
  } catch (err) {
    logger.error({ err }, "provisionMachAdmin: failed");
  }
}
