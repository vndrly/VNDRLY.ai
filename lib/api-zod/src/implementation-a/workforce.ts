import { z } from "zod/v4";

export const WorkerAccountStateSchema = z.enum(["active", "paused", "terminated"]);
export const WorkforceReminderKindSchema = z.enum(["assignment", "t24", "t1", "start", "no_show"]);
export const WorkforceAssignmentStateSchema = z.enum(["pending", "acknowledged", "declined", "no_show", "cancelled"]);
export const WorkforceCoverageStateSchema = z.enum(["covered", "uncovered", "at_risk", "escalated", "resolved"]);

export const AssignWorkforceShiftSchema = z.object({
  shiftId: z.string().uuid(),
  workerUserId: z.number().int().positive(),
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  overrideReason: z.string().trim().min(3).max(1_000).optional(),
});

export const AcknowledgeWorkforceAssignmentSchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  response: z.enum(["acknowledged", "declined"]),
});

export const ReviewWorkforceHoursSchema = z.object({
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  state: z.enum(["approved", "needs_changes"]),
  note: z.string().trim().max(2_000).optional(),
});

export type AssignWorkforceShift = z.infer<typeof AssignWorkforceShiftSchema>;
export type AcknowledgeWorkforceAssignment = z.infer<typeof AcknowledgeWorkforceAssignmentSchema>;
export type ReviewWorkforceHours = z.infer<typeof ReviewWorkforceHoursSchema>;
export type WorkforceReminderKind = z.infer<typeof WorkforceReminderKindSchema>;
