import { TicketLaborFinalizationInputSchema, TicketLaborFinalizationReceiptSchema } from "@workspace/api-zod";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { chatGptActionTools } from "./chatgpt-tool-access";

/** Resolve an uncertain approved freeze from its exact canonical receipt. Never resends. */
export async function recoverTicketLaborFinalizationAction(
  action: { toolName: string; tokenHash: string; arguments: Record<string, unknown> },
  session: SessionPayload, scopes: string[],
  request: typeof callNaturalVoiceDomainApi = callNaturalVoiceDomainApi,
) {
  if (action.toolName !== "manage_ticket_record" || action.arguments.action !== "finalize_labor"
    || !/^[a-f0-9]{64}$/.test(action.tokenHash)
    || !chatGptActionTools(session, scopes).some(tool => tool.name === action.toolName)) return null;
  try {
    const args = z.object({ action: z.literal("finalize_labor"), ticketId: z.number().int().positive(), payload: TicketLaborFinalizationInputSchema.omit({ operationId: true }) }).strict().parse(action.arguments);
    const hex = action.tokenHash.slice(0, 32);
    const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const result = z.object({ receipt: TicketLaborFinalizationReceiptSchema.nullable() }).strict().parse(await request(`/tickets/${args.ticketId}/close/operations/${operationId}`, "GET", {}, session));
    const saved = result.receipt;
    if (!saved || saved.operationId !== operationId || saved.ticketId !== args.ticketId || saved.actorUserId !== session.userId
      || saved.closedById !== session.userId || saved.expectedUpdatedAt !== args.payload.expectedUpdatedAt
      || Date.parse(saved.updatedAt) <= Date.parse(saved.expectedUpdatedAt)) return null;
    return saved;
  } catch { return null; }
}
