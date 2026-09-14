import { and, eq } from "drizzle-orm";
import {
  db,
  workforceAssignmentStatesTable,
  workforceCoverageRecordsTable,
  workHubShiftAssignmentsTable,
  workHubShiftsTable,
} from "@workspace/db";
export type WorkerAccountState = "active" | "paused" | "terminated";
export type AssignmentWarning = "workforce.overtime_warning" | "workforce.rest_window_warning";
export type ReminderKind = "assignment" | "t24" | "t1" | "start" | "no_show";

export type AssignmentEligibility =
  | { allowed: false; code: string; warnings: []; overrideRequired: false }
  | { allowed: true; code: "workforce.assignment_allowed" | "workforce.override_required"; warnings: AssignmentWarning[]; overrideRequired: boolean };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function assignmentAcknowledgementDeadline(assignedAt: Date, shiftStartsAt: Date): Date {
  const untilShift = shiftStartsAt.getTime() - assignedAt.getTime();
  if (!Number.isFinite(untilShift) || untilShift <= 0) throw new Error("workforce.invalid_shift_start");
  if (untilShift <= 24 * HOUR) return new Date(assignedAt.getTime() + 30 * MINUTE);
  return new Date(Math.min(assignedAt.getTime() + 4 * HOUR, shiftStartsAt.getTime() - 24 * HOUR));
}

export function coverageEscalationDelayMs(now: Date, shiftStartsAt: Date): number {
  const untilShift = shiftStartsAt.getTime() - now.getTime();
  if (untilShift <= 4 * HOUR) return 15 * MINUTE;
  if (untilShift <= 24 * HOUR) return HOUR;
  return 4 * HOUR;
}

export function evaluateAssignmentEligibility(input: {
  accountState: WorkerAccountState;
  credentialsCurrent: boolean;
  overlaps: boolean;
  overtime: boolean;
  restWindow: boolean;
}): AssignmentEligibility {
  if (input.accountState === "paused") return { allowed: false, code: "workforce.account_paused", warnings: [], overrideRequired: false };
  if (input.accountState === "terminated") return { allowed: false, code: "workforce.account_terminated", warnings: [], overrideRequired: false };
  if (!input.credentialsCurrent) return { allowed: false, code: "workforce.credentials_expired", warnings: [], overrideRequired: false };
  if (input.overlaps) return { allowed: false, code: "workforce.shift_overlap", warnings: [], overrideRequired: false };
  const warnings: AssignmentWarning[] = [];
  if (input.overtime) warnings.push("workforce.overtime_warning");
  if (input.restWindow) warnings.push("workforce.rest_window_warning");
  return warnings.length
    ? { allowed: true, code: "workforce.override_required", warnings, overrideRequired: true }
    : { allowed: true, code: "workforce.assignment_allowed", warnings, overrideRequired: false };
}

export function evaluateNoShow(now: Date, shiftStartsAt: Date, checkedInAt: Date | null): boolean {
  return checkedInAt === null && now.getTime() >= shiftStartsAt.getTime() + 15 * MINUTE;
}

export function workforceReminderSchedule(shiftStartsAt: Date, assignedAt: Date): Array<{ kind: ReminderKind; at: Date }> {
  const candidates: Array<{ kind: ReminderKind; at: Date }> = [
    { kind: "assignment", at: assignedAt },
    { kind: "t24", at: new Date(shiftStartsAt.getTime() - 24 * HOUR) },
    { kind: "t1", at: new Date(shiftStartsAt.getTime() - HOUR) },
    { kind: "start", at: shiftStartsAt },
    { kind: "no_show", at: new Date(shiftStartsAt.getTime() + 15 * MINUTE) },
  ];
  return candidates.filter((reminder) => reminder.kind === "assignment" || reminder.at >= assignedAt);
}

export interface WorkforceAssignmentRepository {
  createAssignment(input: {
    shiftId: string;
    workerUserId: number;
    assignedById: number;
    operationId: string;
    acknowledgementDueAt: Date;
    reminders: Array<{ kind: ReminderKind; at: Date }>;
    warnings: AssignmentWarning[];
    overrideReason: string | null;
    expectedVersion: number;
  }): Promise<{ id: string; version: number }>;
  acknowledge(input: { assignmentId: string; workerUserId: number; response: "acknowledged" | "declined"; expectedVersion: number; at: Date }): Promise<{ id: string; version: number; state: string }>;
  setCoverageState(input: { coverageId: string; state: "covered" | "uncovered" | "at_risk" | "escalated" | "resolved"; expectedVersion: number; at: Date }): Promise<{ id: string; version: number; state: string }>;
}

export async function assignShift(input: {
  shiftId: string;
  workerUserId: number;
  assignedById: number;
  operationId: string;
  expectedVersion: number;
  assignedAt: Date;
  shiftStartsAt: Date;
  eligibility: Parameters<typeof evaluateAssignmentEligibility>[0];
  overrideAuthorized: boolean;
  overrideReason?: string;
}, repository: WorkforceAssignmentRepository) {
  const eligibility = evaluateAssignmentEligibility(input.eligibility);
  if (!eligibility.allowed) return eligibility;
  if (eligibility.overrideRequired && (!input.overrideAuthorized || !input.overrideReason?.trim())) {
    return { allowed: false as const, code: "workforce.override_reason_required", warnings: eligibility.warnings, overrideRequired: true };
  }
  const resource = await repository.createAssignment({
    shiftId: input.shiftId,
    workerUserId: input.workerUserId,
    assignedById: input.assignedById,
    operationId: input.operationId,
    expectedVersion: input.expectedVersion,
    acknowledgementDueAt: assignmentAcknowledgementDeadline(input.assignedAt, input.shiftStartsAt),
    reminders: workforceReminderSchedule(input.shiftStartsAt, input.assignedAt),
    warnings: eligibility.warnings,
    overrideReason: input.overrideReason?.trim() || null,
  });
  return { allowed: true as const, code: eligibility.code, warnings: eligibility.warnings, overrideRequired: eligibility.overrideRequired, resource };
}

export async function acknowledgeAssignment(input: { assignmentId: string; workerUserId: number; response: "acknowledged" | "declined"; expectedVersion: number; at?: Date }, repository: WorkforceAssignmentRepository) {
  return repository.acknowledge({ ...input, at: input.at ?? new Date() });
}

export async function evaluateCoverage(input: { coverageId: string; assignedCount: number; requiredCount: number; expectedVersion: number; at?: Date }, repository: WorkforceAssignmentRepository) {
  return repository.setCoverageState({ coverageId: input.coverageId, state: input.assignedCount >= input.requiredCount ? "covered" : "uncovered", expectedVersion: input.expectedVersion, at: input.at ?? new Date() });
}

export async function escalateCoverage(input: { coverageId: string; expectedVersion: number; at?: Date }, repository: WorkforceAssignmentRepository) {
  return repository.setCoverageState({ coverageId: input.coverageId, state: "escalated", expectedVersion: input.expectedVersion, at: input.at ?? new Date() });
}

export async function reviewHours<T>(input: T, persist: (value: T) => Promise<unknown>) {
  return persist(input);
}
export class WorkforceCoverageError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
  }
}

export const databaseWorkforceAssignmentRepository: WorkforceAssignmentRepository = {
  async createAssignment(input) {
    return db.transaction(async (tx) => {
      const [shift] = await tx.select({ id: workHubShiftsTable.id, version: workHubShiftsTable.version }).from(workHubShiftsTable).where(eq(workHubShiftsTable.id, input.shiftId)).limit(1);
      if (!shift) throw new WorkforceCoverageError("workforce.shift_not_found", 404);
      if (shift.version !== input.expectedVersion) throw new WorkforceCoverageError("workforce.version_conflict");
      await tx.insert(workHubShiftAssignmentsTable).values({ shiftId: input.shiftId, userId: input.workerUserId, assignedById: input.assignedById, warningSnapshot: input.warnings }).onConflictDoNothing({ target: [workHubShiftAssignmentsTable.shiftId, workHubShiftAssignmentsTable.userId] });
      const [created] = await tx.insert(workforceAssignmentStatesTable).values({
        shiftId: input.shiftId,
        workerUserId: input.workerUserId,
        assignedById: input.assignedById,
        operationId: input.operationId,
        acknowledgementDueAt: input.acknowledgementDueAt,
        reminderSchedule: input.reminders.map((reminder) => ({ kind: reminder.kind, at: reminder.at.toISOString() })),
        warningSnapshot: input.warnings,
        overrideReason: input.overrideReason,
      }).onConflictDoNothing({ target: workforceAssignmentStatesTable.operationId }).returning({ id: workforceAssignmentStatesTable.id, version: workforceAssignmentStatesTable.version });
      if (created) return created;
      const [replayed] = await tx.select({ id: workforceAssignmentStatesTable.id, version: workforceAssignmentStatesTable.version }).from(workforceAssignmentStatesTable).where(eq(workforceAssignmentStatesTable.operationId, input.operationId)).limit(1);
      if (!replayed) throw new WorkforceCoverageError("workforce.assignment_conflict");
      return replayed;
    });
  },
  async acknowledge(input) {
    const [updated] = await db.update(workforceAssignmentStatesTable).set({ state: input.response, acknowledgedAt: input.at, version: input.expectedVersion + 1, updatedAt: input.at }).where(and(eq(workforceAssignmentStatesTable.id, input.assignmentId), eq(workforceAssignmentStatesTable.workerUserId, input.workerUserId), eq(workforceAssignmentStatesTable.state, "pending"), eq(workforceAssignmentStatesTable.version, input.expectedVersion))).returning({ id: workforceAssignmentStatesTable.id, version: workforceAssignmentStatesTable.version, state: workforceAssignmentStatesTable.state });
    if (!updated) throw new WorkforceCoverageError("workforce.version_conflict");
    return updated;
  },
  async setCoverageState(input) {
    const [updated] = await db.update(workforceCoverageRecordsTable).set({ state: input.state, version: input.expectedVersion + 1, updatedAt: input.at, ...(input.state === "escalated" ? { escalatedAt: input.at } : {}), ...(input.state === "resolved" ? { resolvedAt: input.at } : {}) }).where(and(eq(workforceCoverageRecordsTable.id, input.coverageId), eq(workforceCoverageRecordsTable.version, input.expectedVersion))).returning({ id: workforceCoverageRecordsTable.id, version: workforceCoverageRecordsTable.version, state: workforceCoverageRecordsTable.state });
    if (!updated) throw new WorkforceCoverageError("workforce.version_conflict");
    return updated;
  },
};