import { z } from "zod/v4";

export const WORK_HUB_FINANCE_RECORD_ACTIONS = ["issue", "share", "revoke_share", "record_outside_payment"] as const;
const empty = z.object({}).strict();
const payment = z.object({ amountCents: z.number().int().positive().max(1_000_000_000_000), method: z.enum(["cash", "check", "bank"]), reference: z.string().trim().min(1).max(100) }).strict();
const publicLink = z.object({ audience: z.literal("anyone_with_link"), expiresInDays: z.literal(30) }).strict();
/** Disclosure fields remain in the reviewed action, but are not canonical wire fields. */
export function financeRecordAction(input: Record<string, unknown>) {
  const action = z.enum(WORK_HUB_FINANCE_RECORD_ACTIONS).parse(input.action);
  const invoiceId = z.uuid().parse(input.recordId);
  const payload = action === "record_outside_payment" ? payment.parse(input.payload) : action === "share" ? publicLink.parse(input.payload) : empty.parse(input.payload ?? {});
  return { endpoint: action === "record_outside_payment" ? "payment" : action === "revoke_share" ? "revoke-share" : action, payload: { id: invoiceId, ...(action === "record_outside_payment" ? payload : {}) } };
}
