import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * One-shot, idempotent backfill that mirrors `users.username` into
 * `users.email` for every login whose `username` looks like an email
 * address (contains `@`) and whose `email` column is still null. The
 * `users.email` column was added later than the original org-member /
 * field-employee onboarding flows, so existing rows in the dev and
 * prod databases were created without it and the visitor-check-in
 * notifier helper (`findPartnerVisitNotifierUserIds`) silently
 * matched zero users for them.
 *
 * Safe to call on every boot: the WHERE clause restricts the update
 * to rows where `email IS NULL`, so once a row is filled the next
 * boot is a no-op. Demo logins like `admin` or `exxon` (no `@` in
 * the username) are intentionally left with `email = NULL` since
 * they were never real email addresses.
 */
export async function backfillUserEmailsFromUsername(): Promise<number> {
  try {
    const result = await db.execute<{ id: number }>(sql`
      update users
         set email = username
       where email is null
         and position('@' in username) > 0
       returning id
    `);
    const rows =
      (result as unknown as { rows?: { id: number }[] }).rows ??
      (result as unknown as { id: number }[]);
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count > 0) {
      logger.info({ count }, "Backfilled users.email from users.username");
    }
    return count;
  } catch (err) {
    logger.warn({ err }, "users.email backfill skipped (column may be missing)");
    return 0;
  }
}
