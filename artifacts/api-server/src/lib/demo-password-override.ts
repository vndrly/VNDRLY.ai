import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

export async function applyDemoPasswordOverride(): Promise<void> {
  const raw = process.env["DEMO_PASSWORD_OVERRIDE"];
  if (!raw || !raw.trim()) return;

  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const idx = entry.indexOf(":");
    if (idx <= 0 || idx === entry.length - 1) {
      logger.warn(
        { entryPreview: entry.slice(0, 40) },
        "DEMO_PASSWORD_OVERRIDE entry skipped (expected username:password)",
      );
      continue;
    }
    const username = entry.slice(0, idx);
    const password = entry.slice(idx + 1);

    try {
      const users = await db
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable)
        .where(sql`lower(${usersTable.username}) = lower(${username})`);

      if (users.length === 0) {
        logger.warn({ username }, "DEMO_PASSWORD_OVERRIDE: user not found");
        continue;
      }

      const passwordHash = bcrypt.hashSync(password, 10);
      for (const user of users) {
        await db
          .update(usersTable)
          .set({
            passwordHash,
            sessionVersion: sql`${usersTable.sessionVersion} + 1`,
          })
          .where(eq(usersTable.id, user.id));

        logger.warn(
          { username: user.username, userId: user.id },
          "DEMO_PASSWORD_OVERRIDE: password reset applied (sessions invalidated)",
        );
      }
    } catch (err) {
      logger.error(
        { err, username },
        "DEMO_PASSWORD_OVERRIDE: failed to apply override",
      );
    }
  }
}
