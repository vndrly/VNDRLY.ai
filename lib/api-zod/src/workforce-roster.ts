import { z } from "zod/v4";

export const WorkforceRosterSchema = z.object({
  owner: z.object({ type: z.literal("vendor"), id: z.number().int().positive() }).strict(),
  observedAt: z.iso.datetime(), scope: z.enum(["company", "managed_sites", "self"]),
  employees: z.array(z.object({
    userId: z.number().int().positive(), vendorPeopleId: z.number().int().positive(), name: z.string(),
    onCall: z.enum(["active", "inactive", "unknown"]), onShift: z.boolean().nullable(),
    shiftStartedAt: z.iso.datetime().nullable(), assignment: z.string().nullable(),
    profileHref: z.string().nullable(), canMessage: z.boolean(),
  }).strict()), canManageOffers: z.boolean(),
}).strict();
export type WorkforceRoster = z.infer<typeof WorkforceRosterSchema>;
export const WorkforceOfferInputSchema = z.object({
  operationId: z.uuid(), expectedVersion: z.number().int().positive(), workerUserId: z.number().int().positive(),
}).strict();
export const WorkforceOfferResponseInputSchema = z.object({
  operationId: z.uuid(), expectedVersion: z.number().int().positive(), decision: z.enum(["accepted", "declined"]),
}).strict();
export const WorkforceOfferSchema = z.object({
  id: z.uuid(), shiftId: z.uuid(), workerUserId: z.number().int().positive(), workerName: z.string(),
  status: z.enum(["pending", "accepted", "declined"]), createdAt: z.iso.datetime(), decidedAt: z.iso.datetime().nullable(),
}).strict();
export const WorkforceOfferReceiptSchema = z.object({
  operationId: z.uuid(), actorUserId: z.number().int().positive(), shiftId: z.uuid(), offerId: z.uuid(), workerUserId: z.number().int().positive(),
  status: z.enum(["pending", "accepted", "declined"]), previousVersion: z.number().int().positive(), resultingVersion: z.number().int().positive(),
  assignmentRecorded: z.boolean(), commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/), recordedAt: z.iso.datetime(),
}).strict();
export const WorkforceOffersSchema = z.object({ shiftVersion: z.number().int().positive(), offers: z.array(WorkforceOfferSchema) }).strict();
export const WorkforceIncomingOffersSchema = z.object({ offers: z.array(WorkforceOfferSchema.extend({
  shiftTitle: z.string(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), shiftVersion: z.number().int().positive(),
})) }).strict();
export type WorkforceOfferReceipt = z.infer<typeof WorkforceOfferReceiptSchema>;
export function workforceOfferFingerprintValues(shiftId: string, actorUserId: number, vendorId: number, input: z.infer<typeof WorkforceOfferInputSchema>) {
  return { kind: "shift.gate.offer", shiftId, actorUserId, vendorId, operationId: input.operationId, expectedVersion: input.expectedVersion, workerUserId: input.workerUserId };
}
export function workforceOfferResponseFingerprintValues(shiftId: string, offerId: string, actorUserId: number, vendorId: number, input: z.infer<typeof WorkforceOfferResponseInputSchema>) {
  return { kind: "shift.gate.offer.respond", shiftId, offerId, actorUserId, vendorId, operationId: input.operationId, expectedVersion: input.expectedVersion, decision: input.decision };
}
