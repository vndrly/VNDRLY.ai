import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { organizationKeyFromSession } from "./askv-pending-confirmation";

/** Scope bindings are immutable. Existing bindings need a current read, not a new write transaction. */
export async function readConversationCompanyBinding(
  session: SessionPayload,
  conversationId: number,
  actionTypes: string[],
): Promise<"missing" | "unbound" | "bound" | "different_company"> {
  const result = await pool.query<{ bindingId: number | null; parsedIntent: { organizationKey?: string } | null }>(
    `SELECT a.id AS "bindingId", a.parsed_intent AS "parsedIntent"
     FROM assistant_conversations c
     LEFT JOIN assistant_action_audit a
       ON a.conversation_id=c.id AND a.action_type=ANY($3::text[])
     WHERE c.id=$1 AND c.user_id=$2`,
    [conversationId, session.userId, actionTypes],
  );
  if (!result.rows.length) return "missing";
  const bindings = result.rows.filter(row => row.bindingId !== null);
  const organizationKey = organizationKeyFromSession(session);
  if (bindings.some(row => row.parsedIntent?.organizationKey !== organizationKey)) return "different_company";
  return bindings.length ? "bound" : "unbound";
}
