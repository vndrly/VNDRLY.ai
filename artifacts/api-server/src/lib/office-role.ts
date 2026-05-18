import { and, eq, isNull, sql } from "drizzle-orm";
import { db, vendorPeopleTable } from "@workspace/db";

// Returns true when the user is allowed to act as a vendor "office" operator
// for the given vendor — i.e. open phone-intake tickets on the vendor's
// behalf. Authoritative rule:
//   1. The user has an org-admin row in user_org_memberships for this vendor
//      (vendor admins are office-eligible by default — they have full org
//      control).
//   2. OR the user is linked to a vendor_people row on this vendor with
//      vendor_role IN ('office','both') AND is_active = true AND not soft-
//      deleted.
//
// Tenancy (does the user even belong to this vendor) is the caller's
// responsibility — this function only answers the role question.
export async function userIsVendorOffice(
  userId: number,
  vendorId: number,
): Promise<boolean> {
  const rows = await db.execute<{ has_role: boolean }>(sql`
    select exists (
      select 1
      from user_org_memberships m
      where m.user_id = ${userId}
        and m.org_type = 'vendor'
        and m.vendor_id = ${vendorId}
        and m.role = 'admin'
    )
    or exists (
      select 1
      from vendor_people vp
      where vp.user_id = ${userId}
        and vp.vendor_id = ${vendorId}
        and vp.is_active = true
        and vp.deleted_at is null
        and vp.vendor_role IN ('office','both')
    ) as has_role
  `);
  return rows.rows?.[0]?.has_role === true;
}

// Resolves a foreman user to their vendor_people row id, but only if that
// user is an active member of the given vendor. Returns null when the user
// has no active vendor_people row for that vendor — i.e. the foreman does
// not belong to the ticket's vendor and the attribution must be rejected
// (Task #507). Used by POST /tickets to validate body.foremanUserId before
// it is written to the new ticket row.
export async function getForemanVendorPersonId(
  userId: number,
  vendorId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: vendorPeopleTable.id })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.userId, userId),
        eq(vendorPeopleTable.vendorId, vendorId),
        eq(vendorPeopleTable.isActive, true),
        isNull(vendorPeopleTable.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
