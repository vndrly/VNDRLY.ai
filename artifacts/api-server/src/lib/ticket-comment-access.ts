import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { canReadTicket } from "./field-ticket-access";
import { resolveContext } from "../routes/auth";

/** Notification candidates never grant thread access. Re-resolve every recipient. */
export async function authorizedTicketCommentRecipients(
  ticketId: number,
  candidates: number[],
): Promise<number[]> {
  const allowed: number[] = [];
  for (const userId of [...new Set(candidates)]) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user || user.suspendedAt || user.mustChangePassword) continue;
    const context = await resolveContext(user);
    if (
      await canReadTicket(
        { ...context, userId, sv: user.sessionVersion },
        ticketId,
      )
    )
      allowed.push(userId);
  }
  return allowed;
}
