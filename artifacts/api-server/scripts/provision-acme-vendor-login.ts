/**
 * One-off: Acme Logistics vendor → acme@vndrly.com / testing123
 * (partner Acme Logistics keeps acmelogistics@vndrly.com)
 */
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
} from "@workspace/db";
import { buildPlatformEulaAcceptancePatch } from "../src/lib/platform-eula-acceptance";

const EMAIL = "acme@vndrly.com";
const PASSWORD = "testing123";
const VENDOR_NAME = "Acme Logistics";

async function main(): Promise<void> {
  const [vendor] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(sql`lower(${vendorsTable.name}) = lower(${VENDOR_NAME})`)
    .limit(1);

  if (!vendor) {
    console.error(`Vendor "${VENDOR_NAME}" not found`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = lower(${EMAIL})`)
    .limit(1);

  if (existing) {
    const [membership] = await db
      .select({ vendorId: userOrgMembershipsTable.vendorId })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, existing.id),
          eq(userOrgMembershipsTable.role, "admin"),
        ),
      )
      .limit(1);

    if (membership?.vendorId !== vendor.id) {
      console.error(`${EMAIL} already belongs to a different org`);
      process.exitCode = 1;
      return;
    }

    await db
      .update(usersTable)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(usersTable.id, existing.id));
    console.log(`Updated ${EMAIL} → ${vendor.name} (${PASSWORD})`);
    return;
  }

  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({
        username: EMAIL,
        email: EMAIL,
        passwordHash,
        role: "vendor",
        displayName: `${vendor.name} Admin`,
        mustChangePassword: false,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: usersTable.id });
    if (!user) throw new Error("user insert failed");

    const [membership] = await tx
      .insert(userOrgMembershipsTable)
      .values({
        userId: user.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "admin",
      })
      .returning({ id: userOrgMembershipsTable.id });
    if (!membership) throw new Error("membership insert failed");

    await tx
      .update(usersTable)
      .set({ activeMembershipId: membership.id })
      .where(eq(usersTable.id, user.id));

    await tx
      .update(vendorsTable)
      .set(buildPlatformEulaAcceptancePatch(user.id))
      .where(eq(vendorsTable.id, vendor.id));
  });

  console.log(`Created ${EMAIL} → ${vendor.name} (${PASSWORD})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
