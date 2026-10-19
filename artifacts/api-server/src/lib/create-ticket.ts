import type { db } from "@workspace/db";
import { ticketsTable } from "@workspace/db/schema";
import { recordTicketTransition } from "./ticket-transitions";
import {
  computeInitialLifecycleState,
  type InitialTicketStatus,
} from "./intake-status";

/** Shared transactional insert: every new ticket gets coherent GPS state and creation history. */
export async function createTicketWithHistory(
  tx: Pick<typeof db, "insert">,
  values: typeof ticketsTable.$inferInsert & { status: InitialTicketStatus },
  actor: { userId: number | null; role: string | null; reason: string },
) {
  const [ticket] = await tx
    .insert(ticketsTable)
    .values({
      ...values,
      lifecycleState: computeInitialLifecycleState(
        values.status,
        values.checkInTime != null,
      ),
    })
    .returning();
  await recordTicketTransition({
    tx,
    ticketId: ticket.id,
    fromStatus: null,
    toStatus: values.status,
    actorUserId: actor.userId,
    actorRole: actor.role,
    reason: actor.reason,
  });
  return ticket;
}
