import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  partnerContactsTable,
  userOrgMembershipsTable,
  vendorPeopleTable,
} from "@workspace/db";
import type { SessionPayload } from "./session";

export const HSE_COMPANY_ROLE = "HSE / Safety Officer";

export async function findPartnerHseUserIds(partnerId: number): Promise<number[]> {
  const fromContacts = await db
    .select({ userId: partnerContactsTable.userId })
    .from(partnerContactsTable)
    .where(
      and(
        eq(partnerContactsTable.partnerId, partnerId),
        isNull(partnerContactsTable.deletedAt),
        isNotNull(partnerContactsTable.userId),
        sql`${HSE_COMPANY_ROLE} = ANY(${partnerContactsTable.roles})`,
      ),
    );

  const fromMemberships = await db
    .select({ userId: partnerContactsTable.userId })
    .from(partnerContactsTable)
    .innerJoin(
      userOrgMembershipsTable,
      and(
        eq(partnerContactsTable.userId, userOrgMembershipsTable.userId),
        eq(userOrgMembershipsTable.partnerId, partnerId),
      ),
    )
    .where(
      and(
        eq(partnerContactsTable.partnerId, partnerId),
        isNull(partnerContactsTable.deletedAt),
        isNotNull(partnerContactsTable.userId),
        sql`${HSE_COMPANY_ROLE} = ANY(${partnerContactsTable.roles})`,
      ),
    );

  const ids = new Set<number>();
  for (const row of [...fromContacts, ...fromMemberships]) {
    if (row.userId != null) ids.add(row.userId);
  }
  return [...ids];
}

export async function findVendorHseUserIds(vendorId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: vendorPeopleTable.userId })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendorId),
        eq(vendorPeopleTable.isActive, true),
        isNotNull(vendorPeopleTable.userId),
        sql`${HSE_COMPANY_ROLE} = ANY(${vendorPeopleTable.roles})`,
      ),
    );
  return rows.map((r) => r.userId!).filter(Boolean);
}

async function userHasHseOnPartner(userId: number, partnerId: number): Promise<boolean> {
  const [contact] = await db
    .select({ id: partnerContactsTable.id })
    .from(partnerContactsTable)
    .where(
      and(
        eq(partnerContactsTable.partnerId, partnerId),
        eq(partnerContactsTable.userId, userId),
        isNull(partnerContactsTable.deletedAt),
        sql`${HSE_COMPANY_ROLE} = ANY(${partnerContactsTable.roles})`,
      ),
    )
    .limit(1);
  if (contact) return true;

  const [membershipContact] = await db
    .select({ id: partnerContactsTable.id })
    .from(partnerContactsTable)
    .innerJoin(
      userOrgMembershipsTable,
      eq(partnerContactsTable.userId, userOrgMembershipsTable.userId),
    )
    .where(
      and(
        eq(userOrgMembershipsTable.userId, userId),
        eq(userOrgMembershipsTable.partnerId, partnerId),
        eq(partnerContactsTable.partnerId, partnerId),
        isNull(partnerContactsTable.deletedAt),
        sql`${HSE_COMPANY_ROLE} = ANY(${partnerContactsTable.roles})`,
      ),
    )
    .limit(1);
  return Boolean(membershipContact);
}

async function userHasHseOnVendor(userId: number, vendorId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: vendorPeopleTable.id })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendorId),
        eq(vendorPeopleTable.userId, userId),
        eq(vendorPeopleTable.isActive, true),
        sql`${HSE_COMPANY_ROLE} = ANY(${vendorPeopleTable.roles})`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function sessionHasPartnerHse(session: SessionPayload): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role !== "partner" || !session.userId || !session.partnerId) return false;
  return userHasHseOnPartner(session.userId, session.partnerId);
}

export async function sessionHasVendorHse(session: SessionPayload): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role !== "vendor" || !session.userId || !session.vendorId) return false;
  return userHasHseOnVendor(session.userId, session.vendorId);
}

export async function sessionCanCloseSafetyEvent(session: SessionPayload): Promise<boolean> {
  return sessionHasPartnerHse(session);
}

export async function sessionCanReactivateSite(session: SessionPayload): Promise<boolean> {
  return sessionHasPartnerHse(session);
}
