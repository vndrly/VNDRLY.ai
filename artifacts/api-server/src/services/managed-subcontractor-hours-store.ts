import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  db,
  fieldTripsTable,
  managedSubcontractorOrganizationsTable,
  managedSubcontractorSponsorsTable,
  managedSubcontractorWorkerSponsorshipsTable,
  siteLocationsTable,
  usersTable,
  vendorsTable,
  workHubFinanceRecordsTable,
  workHubShiftAssignmentsTable,
  workHubShiftsTable,
} from "@workspace/db";
import {
  buildManagedSubcontractorHoursReport,
  type HoursApprovalPolicy,
} from "./managed-subcontractor-hours";
import { ManagedSubcontractorError } from "./managed-subcontractors";

export type HoursReportState = {
  approvals?: { contractor?: { by: number; at: string }; subcontractor?: { by: number; at: string } };
  corrections?: Array<{ shiftId: string; userId: number; actualStart: string; actualEnd: string; reason: string; correctedByUserId: number; correctedAt: string }>;
};

const keyFor = (organizationId: string, start: string, end: string) => `${organizationId}:${start}:${end}`;

async function relationship(vendorId: number, organizationId: string) {
  const [row] = await db.select({
    organizationId: managedSubcontractorOrganizationsTable.id,
    organizationName: managedSubcontractorOrganizationsTable.name,
    sponsorName: vendorsTable.name,
    policy: managedSubcontractorSponsorsTable.hoursApprovalPolicy,
    recipients: managedSubcontractorSponsorsTable.hoursRecipientEmails,
  }).from(managedSubcontractorSponsorsTable)
    .innerJoin(managedSubcontractorOrganizationsTable, eq(managedSubcontractorOrganizationsTable.id, managedSubcontractorSponsorsTable.managedOrganizationId))
    .innerJoin(vendorsTable, eq(vendorsTable.id, managedSubcontractorSponsorsTable.sponsorVendorId))
    .where(and(
      eq(managedSubcontractorSponsorsTable.sponsorVendorId, vendorId),
      eq(managedSubcontractorSponsorsTable.managedOrganizationId, organizationId),
      eq(managedSubcontractorSponsorsTable.status, "active"),
    )).limit(1);
  if (!row) throw new ManagedSubcontractorError("Managed organization not found", 404, "managed_subcontractor.not_found");
  return row;
}

async function stateFor(vendorId: number, organizationId: string, start: string, end: string): Promise<HoursReportState> {
  const [row] = await db.select({ data: workHubFinanceRecordsTable.data }).from(workHubFinanceRecordsTable).where(and(
    eq(workHubFinanceRecordsTable.orgType, "vendor"),
    eq(workHubFinanceRecordsTable.orgId, vendorId),
    eq(workHubFinanceRecordsTable.kind, "approved_hours_report"),
    eq(workHubFinanceRecordsTable.recordKey, keyFor(organizationId, start, end)),
  )).limit(1);
  return (row?.data ?? {}) as HoursReportState;
}

export async function getManagedSubcontractorHoursReport(input: { vendorId: number; organizationId: string; start: string; end: string }) {
  const relation = await relationship(input.vendorId, input.organizationId);
  const workerRows = await db.select({ userId: managedSubcontractorWorkerSponsorshipsTable.workerUserId })
    .from(managedSubcontractorWorkerSponsorshipsTable)
    .where(and(
      eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, input.vendorId),
      eq(managedSubcontractorWorkerSponsorshipsTable.managedOrganizationId, input.organizationId),
      eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
    ));
  const workerIds = workerRows.map((row) => row.userId);
  const assigned = workerIds.length ? await db.select({
    id: workHubShiftsTable.id,
    userId: workHubShiftAssignmentsTable.userId,
    workerName: usersTable.displayName,
    title: workHubShiftsTable.title,
    projectName: workHubShiftsTable.projectName,
    startsAt: workHubShiftsTable.startsAt,
    endsAt: workHubShiftsTable.endsAt,
  }).from(workHubShiftAssignmentsTable)
    .innerJoin(workHubShiftsTable, eq(workHubShiftsTable.id, workHubShiftAssignmentsTable.shiftId))
    .innerJoin(usersTable, eq(usersTable.id, workHubShiftAssignmentsTable.userId))
    .where(and(
      inArray(workHubShiftAssignmentsTable.userId, workerIds),
      eq(workHubShiftsTable.ownerOrgType, "vendor"),
      eq(workHubShiftsTable.ownerOrgId, input.vendorId),
      gte(workHubShiftsTable.startsAt, new Date(input.start)),
      lt(workHubShiftsTable.startsAt, new Date(input.end)),
    )) : [];
  const shiftIds = assigned.map((row) => row.id);
  const trips = shiftIds.length ? await db.select({
    shiftId: fieldTripsTable.activeShiftId,
    userId: fieldTripsTable.driverUserId,
    startedAt: fieldTripsTable.startedAt,
    completedAt: fieldTripsTable.completedAt,
    siteName: siteLocationsTable.name,
  }).from(fieldTripsTable)
    .innerJoin(siteLocationsTable, eq(siteLocationsTable.id, fieldTripsTable.siteLocationId))
    .where(inArray(fieldTripsTable.activeShiftId, shiftIds)) : [];
  const state = await stateFor(input.vendorId, input.organizationId, input.start, input.end);
  const siteByShift = new Map(trips.flatMap((row) => row.shiftId ? [[row.shiftId, row.siteName] as const] : []));
  return {
    ...buildManagedSubcontractorHoursReport({
      organization: { id: relation.organizationId, name: relation.organizationName },
      sponsor: { id: input.vendorId, name: relation.sponsorName },
      approvalPolicy: relation.policy as HoursApprovalPolicy,
      approvals: { contractor: Boolean(state.approvals?.contractor), subcontractor: Boolean(state.approvals?.subcontractor) },
      range: { start: input.start, end: input.end },
      shifts: assigned.map((row) => ({ id: row.id, userId: row.userId, workerName: row.workerName, siteName: siteByShift.get(row.id) ?? row.projectName ?? row.title, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })),
      trips: trips.map((row) => ({ shiftId: row.shiftId, userId: row.userId, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })),
      corrections: state.corrections,
    }),
    recipients: relation.recipients,
    approvalDetails: state.approvals ?? {},
  };
}

async function saveState(input: { vendorId: number; organizationId: string; start: string; end: string; userId: number }, data: HoursReportState) {
  await db.insert(workHubFinanceRecordsTable).values({
    orgType: "vendor", orgId: input.vendorId, kind: "approved_hours_report",
    recordKey: keyFor(input.organizationId, input.start, input.end), data: data as Record<string, unknown>, createdBy: input.userId,
  }).onConflictDoUpdate({
    target: [workHubFinanceRecordsTable.orgType, workHubFinanceRecordsTable.orgId, workHubFinanceRecordsTable.kind, workHubFinanceRecordsTable.recordKey],
    set: { data: data as Record<string, unknown>, updatedAt: new Date() },
  });
}

export async function approveManagedSubcontractorHours(input: { vendorId: number; organizationId: string; start: string; end: string; userId: number; side: "contractor" | "subcontractor" }) {
  await relationship(input.vendorId, input.organizationId);
  const state = await stateFor(input.vendorId, input.organizationId, input.start, input.end);
  state.approvals = { ...state.approvals, [input.side]: { by: input.userId, at: new Date().toISOString() } };
  await saveState(input, state);
  return getManagedSubcontractorHoursReport(input);
}

export async function correctManagedSubcontractorHours(input: { vendorId: number; organizationId: string; start: string; end: string; userId: number; correction: Omit<NonNullable<HoursReportState["corrections"]>[number], "correctedByUserId" | "correctedAt"> }) {
  await relationship(input.vendorId, input.organizationId);
  const state = await stateFor(input.vendorId, input.organizationId, input.start, input.end);
  state.corrections = [...(state.corrections ?? []).filter((row) => !(row.shiftId === input.correction.shiftId && row.userId === input.correction.userId)), { ...input.correction, correctedByUserId: input.userId, correctedAt: new Date().toISOString() }];
  state.approvals = {};
  await saveState(input, state);
  return getManagedSubcontractorHoursReport(input);
}

export async function updateManagedSubcontractorHoursSettings(input: { vendorId: number; organizationId: string; policy: HoursApprovalPolicy; recipients: string[] }) {
  await relationship(input.vendorId, input.organizationId);
  await db.update(managedSubcontractorSponsorsTable).set({ hoursApprovalPolicy: input.policy, hoursRecipientEmails: [...new Set(input.recipients.map((value) => value.trim().toLowerCase()).filter(Boolean))] }).where(and(
    eq(managedSubcontractorSponsorsTable.sponsorVendorId, input.vendorId),
    eq(managedSubcontractorSponsorsTable.managedOrganizationId, input.organizationId),
    eq(managedSubcontractorSponsorsTable.status, "active"),
  ));
  return { policy: input.policy, recipients: input.recipients };
}
