import { createHash } from "node:crypto";
import { z } from "zod/v4";
export const ticketInvoicePreparationInputSchema = z.object({
  operationId: z.uuid(), basis: z.enum(["recorded_invoice_activity", "provider_acceptance"]),
  tickets: z.array(z.object({ ticketId: z.number().int().positive(), expectedUpdatedAt: z.iso.datetime() }).strict()).min(1).max(20),
}).strict().refine(value => new Set(value.tickets.map(ticket => ticket.ticketId)).size === value.tickets.length, "Select each ticket once");
export const ticketInvoicePreparationActorSchema = z.object({ userId: z.number().int().positive(), vendorId: z.number().int().positive(), membershipId: z.number().int().positive(), sessionVersion: z.number().int().positive() }).strict();
export const ticketInvoicePreparationReceiptSchema = z.object({
  operationId: z.uuid(), actorUserId: z.number().int().positive(), vendorId: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["prepared", "condition_not_met"]), basis: z.enum(["recorded_invoice_activity", "provider_acceptance"]),
  activityObservedAt: z.iso.datetime(), lastRecordedInvoiceAt: z.iso.datetime(), acceptedAt: z.iso.datetime(),
  invoices: z.array(z.object({ ticketId: z.number().int().positive(), invoiceId: z.number().int().positive(), lineCount: z.number().int().nonnegative() }).strict()).max(20),
  emailSent: z.literal(false), issued: z.literal(false), paymentRecorded: z.literal(false),
}).strict();
export type TicketInvoicePreparationInput = z.infer<typeof ticketInvoicePreparationInputSchema>;
export type TicketInvoicePreparationActor = z.infer<typeof ticketInvoicePreparationActorSchema>;
export type TicketInvoicePreparationReceipt = z.infer<typeof ticketInvoicePreparationReceiptSchema>;
type Activity = { basis: string; state: string; latestAt: string | null; observedAt: string; exceeds15Days: boolean | null; company: { type: string; id: number } };
export interface TicketInvoicePreparationDependencies {
  withLockedBatch<T>(command: TicketInvoicePreparationInput, actor: TicketInvoicePreparationActor, run: (locked: {
    authorize(): Promise<void>; activity(basis: TicketInvoicePreparationInput["basis"]): Promise<Activity>;
    eligible(tickets: TicketInvoicePreparationInput["tickets"]): Promise<void>;
    generate(ticketId: number): Promise<{ invoiceId: number; lineCount: number }>;
    prior(): unknown; save(receipt: TicketInvoicePreparationReceipt): Promise<void>;
  }) => Promise<T>): Promise<T>;
  now(): Date;
}
function fingerprint(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : item;
  return createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
}
/** Only canonical approved-ticket generation; no arbitrary line items, issuance or sending. */
export function createTicketInvoicePreparation(deps: TicketInvoicePreparationDependencies) {
  async function run(raw: unknown, supplied: TicketInvoicePreparationActor, readback: boolean) {
    const command = ticketInvoicePreparationInputSchema.parse(raw), actor = ticketInvoicePreparationActorSchema.parse(supplied);
    const exact = fingerprint({ command, actor });
    return deps.withLockedBatch(command, actor, async locked => {
      await locked.authorize();
      if (locked.prior() != null) {
        const prior = ticketInvoicePreparationReceiptSchema.parse(locked.prior());
        if (prior.operationId !== command.operationId || prior.actorUserId !== actor.userId || prior.vendorId !== actor.vendorId || prior.fingerprint !== exact || prior.basis !== command.basis) throw Error("invoice_preparation.operation_conflict");
        return prior;
      }
      if (readback) return null;
      const activity = await locked.activity(command.basis), now = deps.now();
      const observedAge = now.getTime() - Date.parse(activity.observedAt);
      const elapsed = Date.parse(activity.observedAt) - Date.parse(activity.latestAt ?? "");
      if (activity.basis !== command.basis || activity.company.type !== "vendor" || activity.company.id !== actor.vendorId || activity.state !== "observed" || !activity.latestAt || !Number.isFinite(observedAge) || observedAge < -5000 || observedAge > 300000 || !Number.isFinite(elapsed) || elapsed < 0 || activity.exceeds15Days !== (elapsed > 15 * 86400000)) throw Error("invoice_preparation.condition_unknown");
      const invoices: TicketInvoicePreparationReceipt["invoices"] = [];
      if (activity.exceeds15Days) {
        await locked.eligible(command.tickets);
        for (const ticket of command.tickets) {
          const generated = z.object({ invoiceId: z.number().int().positive(), lineCount: z.number().int().nonnegative() }).strict().parse(await locked.generate(ticket.ticketId));
          invoices.push({ ticketId: ticket.ticketId, ...generated });
        }
      }
      const receipt = ticketInvoicePreparationReceiptSchema.parse({ operationId: command.operationId, actorUserId: actor.userId, vendorId: actor.vendorId, fingerprint: exact, status: activity.exceeds15Days ? "prepared" : "condition_not_met", basis: command.basis, activityObservedAt: activity.observedAt, lastRecordedInvoiceAt: activity.latestAt, acceptedAt: now.toISOString(), invoices, emailSent: false, issued: false, paymentRecorded: false });
      await locked.save(receipt); return receipt;
    });
  }
  return { execute: (raw: unknown, actor: TicketInvoicePreparationActor) => run(raw, actor, false), readback: (raw: unknown, actor: TicketInvoicePreparationActor) => run(raw, actor, true) };
}
