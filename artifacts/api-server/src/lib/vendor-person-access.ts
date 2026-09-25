import {
  db,
  partnerVendorRelationshipsTable,
  siteLocationsTable,
  siteWorkAssignmentsTable,
  vendorPeopleTable,
  vendorPersonOperationalRolesTable,
  vendorPersonSiteAccessTable,
  type VendorPersonOperationalRole,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { SessionPayload } from "./session.js";

export type VendorPersonSiteScope =
  | { kind: "all_authorized" }
  | { kind: "selected"; siteIds: number[] };

export type VendorPersonAccess = {
  vendorId: number;
  vendorPeopleId: number | null;
  isVendorAdmin: boolean;
  operationalRoles: VendorPersonOperationalRole[];
  siteScope: VendorPersonSiteScope;
  siteIds: number[];
  legacyVendorRole: string | null;
};

export function legacyOperationalRoles(
  role: string | null | undefined,
): VendorPersonOperationalRole[] {
  switch (role) {
    case "both":
      return ["office", "field_employee"];
    case "office":
      return ["office"];
    case "field":
    case "field_employee":
      return ["field_employee"];
    case "foreman":
      return ["foreman"];
    case "gatekeeper":
      return ["gatekeeper"];
    case "gate_supervisor":
      return ["gate_supervisor"];
    default:
      return [];
  }
}

export function projectLegacyVendorRole(
  roles: readonly VendorPersonOperationalRole[],
): string | null {
  const set = new Set(roles);
  if (set.has("office") && set.has("field_employee")) return "both";
  if (set.has("gate_supervisor")) return "gate_supervisor";
  if (set.has("gatekeeper")) return "gatekeeper";
  if (set.has("foreman")) return "foreman";
  if (set.has("field_employee")) return "field";
  if (set.has("office")) return "office";
  return null;
}

export function mayPerformGateAction(
  access: VendorPersonAccess,
  siteId: number,
  requiredRole: "gatekeeper" | "gate_supervisor",
): boolean {
  if (!access.siteIds.includes(siteId)) return false;
  return access.isVendorAdmin || access.operationalRoles.includes(requiredRole);
}

export async function loadAuthorizedVendorSiteIds(vendorId: number): Promise<number[]> {
  const rows = await db
    .select({ id: siteLocationsTable.id })
    .from(siteWorkAssignmentsTable)
    .innerJoin(
      siteLocationsTable,
      eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id),
    )
    .innerJoin(
      partnerVendorRelationshipsTable,
      and(
        eq(partnerVendorRelationshipsTable.partnerId, siteLocationsTable.partnerId),
        eq(partnerVendorRelationshipsTable.vendorId, vendorId),
        eq(partnerVendorRelationshipsTable.status, "approved"),
      ),
    )
    .where(
      and(
        eq(siteWorkAssignmentsTable.vendorId, vendorId),
        eq(siteLocationsTable.isActive, true),
        eq(siteLocationsTable.hidden, false),
      ),
    );
  return [...new Set(rows.map((row) => row.id))].sort((a, b) => a - b);
}

export async function loadOperationalRoles(
  vendorPeopleId: number,
  legacyVendorRole?: string | null,
): Promise<VendorPersonOperationalRole[]> {
  const rows = await db
    .select({ role: vendorPersonOperationalRolesTable.role })
    .from(vendorPersonOperationalRolesTable)
    .where(
      and(
        eq(vendorPersonOperationalRolesTable.vendorPeopleId, vendorPeopleId),
        eq(vendorPersonOperationalRolesTable.isActive, true),
      ),
    );
  return rows.length > 0
    ? [...new Set(rows.map((row) => row.role))]
    : legacyOperationalRoles(legacyVendorRole);
}

export async function loadSelectedSiteIds(vendorPeopleId: number): Promise<number[]> {
  const rows = await db
    .select({ siteLocationId: vendorPersonSiteAccessTable.siteLocationId })
    .from(vendorPersonSiteAccessTable)
    .where(
      and(
        eq(vendorPersonSiteAccessTable.vendorPeopleId, vendorPeopleId),
        eq(vendorPersonSiteAccessTable.isActive, true),
      ),
    );
  return [...new Set(rows.map((row) => row.siteLocationId))].sort((a, b) => a - b);
}

export async function resolveVendorPersonAccess(
  session: SessionPayload,
): Promise<VendorPersonAccess | null> {
  const vendorId = Number(session.vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) return null;

  const isVendorAdmin =
    session.role === "admin" ||
    (session.role === "vendor" && session.membershipRole === "admin");
  const authorizedSiteIds = await loadAuthorizedVendorSiteIds(vendorId);

  if (session.managedSubcontractor) {
    const siteGrants = session.managedSubcontractor.siteGrants.filter((grant) =>
      authorizedSiteIds.includes(grant.siteId),
    );
    const roles = [...new Set(siteGrants.map((grant) => grant.role))];
    const siteIds = [...new Set(siteGrants.map((grant) => grant.siteId))].sort((a, b) => a - b);
    return {
      vendorId,
      vendorPeopleId: session.vendorPeopleId ?? null,
      isVendorAdmin: false,
      operationalRoles: roles,
      siteScope: { kind: "selected", siteIds },
      siteIds,
      legacyVendorRole: session.vendorRole ?? null,
    };
  }

  let vendorPeopleId = session.vendorPeopleId ?? null;
  let legacyVendorRole = session.vendorRole ?? null;
  if (!vendorPeopleId && session.userId) {
    const [person] = await db
      .select({ id: vendorPeopleTable.id, vendorRole: vendorPeopleTable.vendorRole })
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.userId, session.userId),
          eq(vendorPeopleTable.vendorId, vendorId),
          eq(vendorPeopleTable.isActive, true),
          isNull(vendorPeopleTable.deletedAt),
        ),
      )
      .limit(1);
    vendorPeopleId = person?.id ?? null;
    legacyVendorRole = person?.vendorRole ?? legacyVendorRole;
  }

  const operationalRoles = vendorPeopleId
    ? await loadOperationalRoles(vendorPeopleId, legacyVendorRole)
    : legacyOperationalRoles(legacyVendorRole);
  if (isVendorAdmin) {
    return {
      vendorId,
      vendorPeopleId,
      isVendorAdmin: true,
      operationalRoles,
      siteScope: { kind: "all_authorized" },
      siteIds: authorizedSiteIds,
      legacyVendorRole,
    };
  }

  const selected = vendorPeopleId ? await loadSelectedSiteIds(vendorPeopleId) : [];
  const authorized = new Set(authorizedSiteIds);
  const siteIds = selected.filter((siteId) => authorized.has(siteId));
  return {
    vendorId,
    vendorPeopleId,
    isVendorAdmin: false,
    operationalRoles,
    siteScope: { kind: "selected", siteIds },
    siteIds,
    legacyVendorRole,
  };
}

export async function loadPeopleAccess(
  vendorPeopleIds: number[],
): Promise<Map<number, { operationalRoles: VendorPersonOperationalRole[]; siteLocationIds: number[] }>> {
  const result = new Map<number, { operationalRoles: VendorPersonOperationalRole[]; siteLocationIds: number[] }>();
  if (vendorPeopleIds.length === 0) return result;
  const [roleRows, siteRows] = await Promise.all([
    db.select({ personId: vendorPersonOperationalRolesTable.vendorPeopleId, role: vendorPersonOperationalRolesTable.role })
      .from(vendorPersonOperationalRolesTable)
      .where(and(inArray(vendorPersonOperationalRolesTable.vendorPeopleId, vendorPeopleIds), eq(vendorPersonOperationalRolesTable.isActive, true))),
    db.select({ personId: vendorPersonSiteAccessTable.vendorPeopleId, siteId: vendorPersonSiteAccessTable.siteLocationId })
      .from(vendorPersonSiteAccessTable)
      .where(and(inArray(vendorPersonSiteAccessTable.vendorPeopleId, vendorPeopleIds), eq(vendorPersonSiteAccessTable.isActive, true))),
  ]);
  for (const id of vendorPeopleIds) result.set(id, { operationalRoles: [], siteLocationIds: [] });
  for (const row of roleRows) result.get(row.personId)?.operationalRoles.push(row.role);
  for (const row of siteRows) result.get(row.personId)?.siteLocationIds.push(row.siteId);
  return result;
}
