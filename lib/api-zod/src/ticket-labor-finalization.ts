import { z } from "zod/v4";

export const TicketLaborFinalizationInputSchema = z.object({
  operationId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict();
export const TicketLaborFinalizationReceiptSchema = z.object({
  ticketId: z.number().int().positive(),
  operationId: z.uuid(),
  actorUserId: z.number().int().positive(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime(),
  closedAt: z.iso.datetime(),
  closedById: z.number().int().positive(),
  autoLaborLineCount: z.number().int().nonnegative(),
  status: z.literal("applied"),
  physicalWorkVerified: z.literal(false),
  submitted: z.literal(false),
}).strict();
export type TicketLaborFinalizationInput = z.infer<typeof TicketLaborFinalizationInputSchema>;
export type TicketLaborFinalizationReceipt = z.infer<typeof TicketLaborFinalizationReceiptSchema>;
export const TicketLaborFinalizationSnapshotSchema = z.object({
  id: z.number().int().positive(), updatedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(), viewerCanFinalizeLabor: z.boolean(),
});
/** Exact readback precedes every retained retry; absence alone permits the original request. */
export async function finalizeTicketLaborAttempt(
  ticketId: number, actorUserId: number, input: TicketLaborFinalizationInput,
  request: (path: string, body?: TicketLaborFinalizationInput) => Promise<unknown>,
  current: () => boolean,
) {
  const guard = () => { if (!current()) throw Error("ticket.account_changed"); };
  const verify = (raw: unknown) => {
    const saved = TicketLaborFinalizationReceiptSchema.parse(raw);
    if (saved.ticketId !== ticketId || saved.actorUserId !== actorUserId || saved.closedById !== actorUserId || saved.operationId !== input.operationId || saved.expectedUpdatedAt !== input.expectedUpdatedAt || Date.parse(saved.updatedAt) <= Date.parse(input.expectedUpdatedAt)) throw Error("ticket.finalization_receipt_mismatch");
    return saved;
  };
  guard();
  const read = z.object({ receipt: TicketLaborFinalizationReceiptSchema.nullable() }).strict().parse(await request(`/tickets/${ticketId}/close/operations/${input.operationId}`));
  guard();
  if (read.receipt) return verify(read.receipt);
  const result = await request(`/tickets/${ticketId}/close`, input);
  guard();
  return verify(result);
}
