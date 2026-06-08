import { and, eq, isNull } from "drizzle-orm";
import { db, vendorPeopleTable } from "@workspace/db";
import { userIsVendorOffice } from "./office-role";

export type VendorPeopleSession = {
  userId: number;
  role: string;
  vendorId: number | null;
  membershipRole?: string | null;
  vendorRole?: string | null;
  vendorPeopleId?: number | null;
};

export type VendorPersonRow = {
  id: number;
  vendorId: number;
  vendorRole: string | null;
  pecCertification?: boolean | null;
  pecExpirationDate?: string | null;
};

export function isPecCurrent(row: {
  pecCertification?: boolean | null;
  pecExpirationDate?: string | null;
}): boolean {
  if (row.pecExpirationDate) {
    const exp = new Date(`${row.pecExpirationDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return exp.getTime() >= today.getTime();
  }
  return !!row.pecCertification;
}

export function isForemanActor(session: VendorPeopleSession): boolean {
  return (
    session.role === "field_employee" &&
    (session.vendorRole === "foreman" || session.vendorRole === "both")
  );
}

export function isOfficeActor(session: VendorPeopleSession): boolean {
  if (session.role === "admin") return true;
  if (session.role === "vendor") {
    return session.membershipRole === "admin";
  }
  return false;
}

/** Office staff (vendor admin membership or platform admin). */
export async function isVendorOfficeStaff(
  session: VendorPeopleSession,
  vendorId: number,
): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role !== "vendor" || session.vendorId !== vendorId) return false;
  if (session.membershipRole === "admin") return true;
  return userIsVendorOffice(session.userId, vendorId);
}

export async function canManageVendorPeople(
  session: VendorPeopleSession,
  vendorId: number,
): Promise<boolean> {
  if (await isVendorOfficeStaff(session, vendorId)) return true;
  if (isForemanActor(session) && session.vendorId === vendorId) return true;
  return false;
}

export async function assertCanManageVendorPeople(
  session: VendorPeopleSession,
  vendorId: number,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!(await canManageVendorPeople(session, vendorId))) {
    return { ok: false, status: 403, message: "Not allowed to manage employees for this vendor" };
  }
  return { ok: true };
}

/**
 * Office can assign any role. Foremen may promote to admin only when PEC is
 * current; they cannot edit existing admin profiles.
 */
export async function validateVendorRoleAssignment(
  session: VendorPeopleSession,
  target: VendorPersonRow,
  nextRole: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (nextRole === undefined || nextRole === target.vendorRole) return { ok: true };

  const office = await isVendorOfficeStaff(session, target.vendorId);
  if (office) return { ok: true };

  if (!isForemanActor(session) || session.vendorId !== target.vendorId) {
    return { ok: false, status: 403, message: "Not allowed to change employee role" };
  }

  if (target.vendorRole === "admin") {
    return { ok: false, status: 403, message: "Foremen cannot edit admin profiles" };
  }

  if (nextRole === "admin") {
    if (!isPecCurrent(target)) {
      return {
        ok: false,
        status: 403,
        message: "Admin role requires current PEC certification",
      };
    }
    return { ok: true };
  }

  return { ok: false, status: 403, message: "Foremen may only assign the admin role" };
}

export function usesFieldEmployeeLogin(vendorRole: string | null | undefined): boolean {
  return vendorRole === "field" || vendorRole === "foreman" || vendorRole === "both";
}

export function membershipRoleForVendorPerson(vendorRole: string | null | undefined): "admin" | "member" | "field_employee" {
  if (vendorRole === "admin") return "admin";
  if (usesFieldEmployeeLogin(vendorRole)) return "field_employee";
  return "member";
}

export function sessionUserRoleForVendorPerson(vendorRole: string | null | undefined): "field_employee" | "vendor" {
  return usesFieldEmployeeLogin(vendorRole) ? "field_employee" : "vendor";
}

export async function loadVendorPerson(id: number): Promise<VendorPersonRow | null> {
  const [row] = await db
    .select({
      id: vendorPeopleTable.id,
      vendorId: vendorPeopleTable.vendorId,
      vendorRole: vendorPeopleTable.vendorRole,
      pecCertification: vendorPeopleTable.pecCertification,
      pecExpirationDate: vendorPeopleTable.pecExpirationDate,
    })
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.id, id), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  return row ?? null;
}
