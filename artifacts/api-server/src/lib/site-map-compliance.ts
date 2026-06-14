import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  employeeCertificationsTable,
  ticketsTable,
  workTypesTable,
} from "@workspace/db";
import { LIVE_TRACKED_LIFECYCLE_STATES } from "@workspace/ticket-status-meta";

export type SiteMapComplianceIssue = {
  employeeId: number;
  employeeName: string;
  vendorName: string | null;
  ticketId: number;
  issueType: "missing" | "expired" | "expiring_soon";
  certName: string;
  expirationDate: string | null;
  recordedAt: string;
};

type NearbyEmployeeInput = {
  employeeId: number;
  employeeName: string;
  vendorName?: string | null;
  activeTicket?: { ticketId: number; lifecycleState: string | null } | null;
};

export async function buildSiteMapComplianceIssues(input: {
  siteLocationId: number;
  employees: NearbyEmployeeInput[];
  limit?: number;
}): Promise<SiteMapComplianceIssue[]> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 50);
  const activeEmployees = input.employees.filter(
    (e) =>
      e.activeTicket?.ticketId &&
      e.activeTicket.lifecycleState &&
      (LIVE_TRACKED_LIFECYCLE_STATES as readonly string[]).includes(
        e.activeTicket.lifecycleState,
      ),
  );
  if (activeEmployees.length === 0) return [];

  const ticketIds = activeEmployees
    .map((e) => e.activeTicket!.ticketId)
    .filter((id) => Number.isFinite(id));

  const ticketRows = await db
    .select({
      id: ticketsTable.id,
      workTypeId: ticketsTable.workTypeId,
    })
    .from(ticketsTable)
    .where(inArray(ticketsTable.id, ticketIds));

  const workTypeIds = [
    ...new Set(ticketRows.map((t) => t.workTypeId).filter((id): id is number => id != null)),
  ];
  const workTypes =
    workTypeIds.length === 0
      ? []
      : await db
          .select({
            id: workTypesTable.id,
            requiredCertifications: workTypesTable.requiredCertifications,
          })
          .from(workTypesTable)
          .where(inArray(workTypesTable.id, workTypeIds));

  const requiredByWorkType = new Map<number, string[]>();
  for (const wt of workTypes) {
    requiredByWorkType.set(
      wt.id,
      (wt.requiredCertifications as string[] | null) ?? [],
    );
  }

  const employeeIds = activeEmployees.map((e) => e.employeeId);
  const certRows =
    employeeIds.length === 0
      ? []
      : await db
          .select({
            employeeId: employeeCertificationsTable.employeeId,
            name: employeeCertificationsTable.name,
            expirationDate: employeeCertificationsTable.expirationDate,
          })
          .from(employeeCertificationsTable)
          .where(
            and(
              inArray(employeeCertificationsTable.employeeId, employeeIds),
              isNull(employeeCertificationsTable.deletedAt),
            ),
          );

  const today = new Date();
  const soonEnd = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const haveByEmp = new Map<number, Map<string, Date | null>>();
  for (const c of certRows) {
    const perEmp = haveByEmp.get(c.employeeId) ?? new Map<string, Date | null>();
    const exp = c.expirationDate ? new Date(c.expirationDate) : null;
    const prior = perEmp.get(c.name);
    if (!prior || (exp && prior && exp < prior) || (exp && !prior)) {
      perEmp.set(c.name, exp);
    }
    haveByEmp.set(c.employeeId, perEmp);
  }

  const issues: SiteMapComplianceIssue[] = [];
  const nowIso = new Date().toISOString();

  for (const emp of activeEmployees) {
    const ticket = ticketRows.find((t) => t.id === emp.activeTicket!.ticketId);
    if (!ticket?.workTypeId) continue;
    const required = requiredByWorkType.get(ticket.workTypeId) ?? [];
    if (required.length === 0) continue;
    const have = haveByEmp.get(emp.employeeId) ?? new Map<string, Date | null>();

    for (const certName of required) {
      if (!have.has(certName)) {
        issues.push({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          vendorName: emp.vendorName ?? null,
          ticketId: emp.activeTicket!.ticketId,
          issueType: "missing",
          certName,
          expirationDate: null,
          recordedAt: nowIso,
        });
        continue;
      }
      const exp = have.get(certName);
      if (exp && exp < today) {
        issues.push({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          vendorName: emp.vendorName ?? null,
          ticketId: emp.activeTicket!.ticketId,
          issueType: "expired",
          certName,
          expirationDate: exp.toISOString().slice(0, 10),
          recordedAt: nowIso,
        });
        continue;
      }
      if (exp && exp <= soonEnd) {
        issues.push({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          vendorName: emp.vendorName ?? null,
          ticketId: emp.activeTicket!.ticketId,
          issueType: "expiring_soon",
          certName,
          expirationDate: exp.toISOString().slice(0, 10),
          recordedAt: nowIso,
        });
      }
    }
  }

  return issues.slice(0, limit);
}

export async function assertSiteMapPartnerAccess(
  session: { role: string; partnerId: number | null; vendorId?: number | null },
  sitePartnerId: number,
): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role === "partner") {
    return session.partnerId != null && session.partnerId === sitePartnerId;
  }
  if (session.role === "vendor") return true;
  return false;
}
