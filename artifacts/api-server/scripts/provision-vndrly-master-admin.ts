/**
 * Ensure the VNDRLY platform master admin login exists (production handoff).
 *
 * Usage:
 *   node --import ../../scripts/load-env-local.mjs ./node_modules/tsx/dist/cli.mjs scripts/provision-vndrly-master-admin.ts
 */
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";

const EMAIL = "v@vndrly.ai";
const DISPLAY_NAME = "VNDRLY Admin";
const PASSWORD = "Bingos1029!";

async function main(): Promise<void> {
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  const [existing] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      displayName: usersTable.displayName,
      suspendedAt: usersTable.suspendedAt,
    })
    .from(usersTable)
    .where(sql`lower(coalesce(${usersTable.email}, ${usersTable.username})) = lower(${EMAIL})`)
    .limit(1);

  if (existing) {
    if (existing.role !== "admin") {
      console.error(`${EMAIL} exists but role is "${existing.role}", not admin — aborting`);
      process.exitCode = 1;
      return;
    }

    await db
      .update(usersTable)
      .set({
        username: EMAIL,
        email: EMAIL,
        displayName: DISPLAY_NAME,
        passwordHash,
        role: "admin",
        mustChangePassword: false,
        suspendedAt: null,
        suspendedBy: null,
        emailVerifiedAt: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
      })
      .where(eq(usersTable.id, existing.id));

    console.log(`Updated master admin ${EMAIL} (${DISPLAY_NAME})`);
    return;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      username: EMAIL,
      email: EMAIL,
      passwordHash,
      role: "admin",
      displayName: DISPLAY_NAME,
      mustChangePassword: false,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: usersTable.id });

  if (!created) {
    console.error("Insert failed");
    process.exitCode = 1;
    return;
  }

  console.log(`Created master admin ${EMAIL} (id ${created.id}, ${DISPLAY_NAME})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
