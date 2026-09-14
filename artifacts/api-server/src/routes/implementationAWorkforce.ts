import { Router, type Request, type Response } from "express";
import { and, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod/v4";
import {
  AcknowledgeWorkforceAssignmentSchema,
  AssignWorkforceShiftSchema,
} from "@workspace/api-zod";
import {
  db,
  employeeCertificationsTable,
  managedSubcontractorRoleGrantsTable,
  managedSubcontractorWorkerSponsorshipsTable,
  usersTable,
  vendorPeopleTable,
  workforceCoverageRecordsTable,
  workforceStaffingRequirementsTable,
  workHubShiftAssignmentsTable,
  workHubShiftsTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { authorizeCapability, type AuthorityRole } from "../lib/authority-matrix";
import {
  acknowledgeAssignment,
  assignShift,
  databaseWorkforceAssignmentRepository,
  escalateCoverage,
  evaluateCoverage,
  WorkforceCoverageError,
} from "../services/workforce-coverage";

const router = Router();
const id = z.string().uuid();

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: "workforce.invalid_request" });
  if (error instanceof WorkforceCoverageError) return res.status(error.status).json({ code: error.code });
  console.error("Workforce request failed", error);
  return res.status(500).json({ code: "workforce.internal_error" });
}

async function schedulingAuthority(req: Request, shiftId: string) {
  const session = getSessionFromRequest(req);
  if (!session?.userId || !session.vendorId) throw new WorkforceCoverageError("workforce.not_found", 404);
  const [scope] = await db.select({ siteId: workforceStaffingRequirementsTable.siteId }).from(workforceCoverageRecordsTable).leftJoin(workforceStaffingRequirementsTable, eq(workforceStaffingRequirementsTable.id, workforceCoverageRecordsTable.requirementId)).where(eq(workforceCoverageRecordsTable.shiftId, shiftId)).limit(1);
  const grants = session.role === "admin" || session.membershipRole === "admin" ? [] : await db.select({ role: managedSubcontractorRoleGrantsTable.role, siteId: managedSubcontractorRoleGrantsTable.siteId, crewId: managedSubcontractorRoleGrantsTable.crewId }).from(managedSubcontractorRoleGrantsTable).innerJoin(managedSubcontractorWorkerSponsorshipsTable, eq(managedSubcontractorWorkerSponsorshipsTable.id, managedSubcontractorRoleGrantsTable.sponsorshipId)).where(and(eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, session.userId), eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, session.vendorId), eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"), eq(managedSubcontractorRoleGrantsTable.status, "active")));
  const isAdmin = session.role === "admin" || session.membershipRole === "admin";
  const decision = await authorizeCapability({ actor: {
    userId: session.userId,
    kind: isAdmin ? "organization_admin" : "managed_worker",
    activeOwner: { type: "vendor", id: session.vendorId },
    sponsorVendorId: isAdmin ? undefined : session.vendorId,
    roles: isAdmin ? ["admin"] : [...new Set(grants.map((grant) => grant.role as AuthorityRole))],
    siteIds: [...new Set(grants.flatMap((grant) => grant.siteId ? [grant.siteId] : []))],
    crewIds: [...new Set(grants.flatMap((grant) => grant.crewId ? [grant.crewId] : []))],
    explicitInvitations: [],
  }, resource: { type: "schedule", id: shiftId, owner: { type: "vendor", id: session.vendorId }, ...(scope?.siteId ? { siteId: scope.siteId } : {}) } }, "schedule.manage");
  if (!decision.allowed || (!isAdmin && !scope?.siteId)) throw new WorkforceCoverageError(decision.reasonCode, 403);
  return { session, decision };
}

async function eligibilityFor(workerUserId: number, shiftId: string) {
  const [shift] = await db.select().from(workHubShiftsTable).where(eq(workHubShiftsTable.id, shiftId)).limit(1);
  const [user] = await db.select({ suspendedAt: usersTable.suspendedAt }).from(usersTable).where(eq(usersTable.id, workerUserId)).limit(1);
  if (!shift || !user) throw new WorkforceCoverageError("workforce.shift_or_worker_not_found", 404);
  const [person] = await db.select({ id: vendorPeopleTable.id, isActive: vendorPeopleTable.isActive }).from(vendorPeopleTable).where(eq(vendorPeopleTable.userId, workerUserId)).limit(1);
  const [sponsorship] = await db.select({ status: managedSubcontractorWorkerSponsorshipsTable.status }).from(managedSubcontractorWorkerSponsorshipsTable).where(eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, workerUserId)).limit(1);
  const accountState = sponsorship?.status === "terminated" || person?.isActive === false ? "terminated" as const : sponsorship?.status === "paused" || user.suspendedAt ? "paused" as const : "active" as const;
  const qualificationCodes = shift.qualificationCodes ?? [];
  const certifications = person && qualificationCodes.length ? await db.select({ name: employeeCertificationsTable.name, expirationDate: employeeCertificationsTable.expirationDate }).from(employeeCertificationsTable).where(and(eq(employeeCertificationsTable.employeeId, person.id), isNull(employeeCertificationsTable.deletedAt))) : [];
  const today = new Date().toISOString().slice(0, 10);
  const currentNames = new Set(certifications.filter((certification) => !certification.expirationDate || certification.expirationDate >= today).map((certification) => certification.name.toLowerCase()));
  const credentialsCurrent = qualificationCodes.every((code) => currentNames.has(code.toLowerCase()));
  const windowStart = new Date(shift.startsAt.getTime() - 7 * 24 * 60 * 60_000);
  const windowEnd = new Date(shift.endsAt.getTime() + 7 * 24 * 60 * 60_000);
  const assigned = await db.select({ id: workHubShiftsTable.id, startsAt: workHubShiftsTable.startsAt, endsAt: workHubShiftsTable.endsAt }).from(workHubShiftAssignmentsTable).innerJoin(workHubShiftsTable, eq(workHubShiftsTable.id, workHubShiftAssignmentsTable.shiftId)).where(and(eq(workHubShiftAssignmentsTable.userId, workerUserId), ne(workHubShiftsTable.id, shiftId), gte(workHubShiftsTable.endsAt, windowStart), lt(workHubShiftsTable.startsAt, windowEnd)));
  const overlaps = assigned.some((item) => item.startsAt < shift.endsAt && item.endsAt > shift.startsAt);
  const restWindow = assigned.some((item) => Math.abs(item.endsAt.getTime() - shift.startsAt.getTime()) < 8 * 60 * 60_000 || Math.abs(shift.endsAt.getTime() - item.startsAt.getTime()) < 8 * 60 * 60_000);
  const weekHours = assigned.reduce((sum, item) => sum + Math.max(0, item.endsAt.getTime() - item.startsAt.getTime()), shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000;
  return { shift, eligibility: { accountState, credentialsCurrent, overlaps, overtime: weekHours > 40, restWindow } };
}

router.post("/implementation-a/workforce/assignments", async (req, res) => {
  try {
    const input = AssignWorkforceShiftSchema.parse(req.body);
    const [{ session, decision }, context] = await Promise.all([schedulingAuthority(req, input.shiftId), eligibilityFor(input.workerUserId, input.shiftId)]);
    const result = await assignShift({ ...input, assignedById: session.userId!, assignedAt: new Date(), shiftStartsAt: context.shift.startsAt, eligibility: context.eligibility, overrideAuthorized: decision.allowed }, databaseWorkforceAssignmentRepository);
    return res.status(result.allowed ? 201 : 409).json(result);
  } catch (error) { return sendError(res, error); }
});

router.patch("/implementation-a/workforce/assignments/:assignmentId/acknowledge", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session?.userId) throw new WorkforceCoverageError("workforce.not_found", 404);
    return res.json(await acknowledgeAssignment({ assignmentId: id.parse(req.params.assignmentId), workerUserId: session.userId, ...AcknowledgeWorkforceAssignmentSchema.parse(req.body) }, databaseWorkforceAssignmentRepository));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/workforce/coverage/:coverageId/evaluate", async (req, res) => {
  try {
    const input = z.object({ shiftId: z.string().uuid(), assignedCount: z.number().int().nonnegative(), requiredCount: z.number().int().positive(), expectedVersion: z.number().int().nonnegative() }).parse(req.body);
    await schedulingAuthority(req, input.shiftId);
    return res.json(await evaluateCoverage({ coverageId: id.parse(req.params.coverageId), ...input }, databaseWorkforceAssignmentRepository));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/workforce/coverage/:coverageId/escalate", async (req, res) => {
  try {
    const input = z.object({ shiftId: z.string().uuid(), expectedVersion: z.number().int().nonnegative() }).parse(req.body);
    await schedulingAuthority(req, input.shiftId);
    return res.json(await escalateCoverage({ coverageId: id.parse(req.params.coverageId), expectedVersion: input.expectedVersion }, databaseWorkforceAssignmentRepository));
  } catch (error) { return sendError(res, error); }
});

export default router;
