/**
 * Set the shared Majik team password for roster logins.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run set:majik-team-passwords
 */
import bcrypt from "bcryptjs";
import { db, pool, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const PASSWORD = "Bingos1029!";
const LOGINS = [
  "john@elerick.com",
  "v@vndrly.ai",
  "matt@elerick.com",
  "chad@elerick.com",
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  let updated = 0;

  for (const login of LOGINS) {
    const key = login.toLowerCase();
    const [user] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        role: usersTable.role,
      })
      .from(usersTable)
      .where(
        sql`lower(coalesce(${usersTable.email}, ${usersTable.username})) = ${key}`,
      )
      .limit(1);

    if (!user) {
      console.log(`MISSING: ${login}`);
      continue;
    }

    await db
      .update(usersTable)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(usersTable.id, user.id));

    const ok = await bcrypt.compare(PASSWORD, passwordHash);
    console.log(
      `UPDATED: ${user.username}${user.email ? ` (${user.email})` : ""} role=${user.role} id=${user.id} verify=${ok ? "ok" : "FAIL"}`,
    );
    updated += 1;
  }

  console.log(`Done. Updated ${updated} user(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
