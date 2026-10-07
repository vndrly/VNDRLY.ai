import { z } from "zod/v4";

export const GateShiftStaffingCandidateEvidenceSchema = z.object({
  shiftId: z.uuid(), shiftVersion: z.number().int().positive(), siteId: z.number().int().positive(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), observedAt: z.iso.datetime(),
  candidates: z.array(z.object({
    vendorPeopleId: z.number().int().positive(), userId: z.number().int().positive(), name: z.string().max(401),
    requirements: z.array(z.object({ code: z.string().max(100), currentRecorded: z.boolean(), vendorVerified: z.boolean(), sourceIds: z.array(z.number().int().positive()).max(100) }).strict()).max(50),
    qualificationState: z.enum(["recorded_requirements_verified", "missing_or_unverified", "unknown_no_configured_requirements"]),
    availability: z.enum(["recorded_conflict", "unknown_recurrence", "recorded_available", "unknown_no_window"]),
    eligibility: z.object({ allowed: z.boolean(), code: z.enum(["workforce.account_paused", "workforce.account_terminated", "workforce.credentials_expired", "workforce.shift_overlap", "workforce.override_required", "workforce.assignment_allowed"]), warnings: z.array(z.enum(["workforce.overtime_warning", "workforce.rest_window_warning"])).max(2), overrideRequired: z.boolean() }).strict(),
    contact: z.object({ workHubUserId: z.number().int().positive(), reachability: z.literal("unknown") }).strict(), sourceReference: z.string().regex(/^vendor_people:[1-9]\d*$/),
  }).strict()).max(25), truncated: z.boolean(),
  coverage: z.object({ state: z.string().max(100), required: z.number().int().nonnegative(), assigned: z.number().int().nonnegative(), recordedActual: z.number().int().nonnegative() }).strict().nullable(),
  assignmentMade: z.literal(false), messageSent: z.literal(false), limitations: z.array(z.string().max(1500)).max(10),
}).strict();

export const GateShiftStaffingCandidatesSchema = GateShiftStaffingCandidateEvidenceSchema.extend({
  qualificationConfiguration: z.enum(["unknown", "none_configured", "configured"]),
}).strict();
export const GateShiftAssignmentInputSchema = z.object({
  operationId: z.uuid(), expectedVersion: z.number().int().positive(),
  assigneeUserIds: z.array(z.number().int().positive()).max(20),
}).strict();
export const GateShiftClaimInputSchema = GateShiftAssignmentInputSchema.omit({ assigneeUserIds: true }).strict();
export const GateShiftAssignmentReceiptSchema = z.object({
  operationId: z.uuid(), actorUserId: z.number().int().positive(), shiftId: z.uuid(),
  previousVersion: z.number().int().positive(), resultingVersion: z.number().int().positive(),
  assigneeUserIds: z.array(z.number().int().positive()).max(20),
  commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/), recordedAt: z.iso.datetime(),
  assignmentRecorded: z.literal(true), physicalAttendanceVerified: z.literal(false),
}).strict();
export const GateShiftAssignmentReadbackSchema = z.object({receipt: GateShiftAssignmentReceiptSchema.nullable()}).strict();
export type GateShiftAssignmentInput = z.infer<typeof GateShiftAssignmentInputSchema>;
export type GateShiftAssignmentReceipt = z.infer<typeof GateShiftAssignmentReceiptSchema>;
export type GateShiftStaffingCandidates = z.infer<typeof GateShiftStaffingCandidatesSchema>;
export function gateShiftAssignmentFingerprintValues(shiftId: string, actorUserId: number, vendorId: number, input: GateShiftAssignmentInput) {
  return { shiftId, actorUserId, vendorId, ...GateShiftAssignmentInputSchema.parse(input), assigneeUserIds: [...new Set(input.assigneeUserIds)].sort((a, b) => a - b) };
}
