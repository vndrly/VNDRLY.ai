/**
 * Idempotent POC wiring for Send-to recipient pickers.
 *
 * Links demo partner contacts (Exxon ops/AP) and vendor field/office POCs
 * to their login users. Safe to re-run — upserts by email/username only.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run seed:send-to-pocs
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  partnerContactsTable,
  partnersTable,
  pool,
  userOrgMembershipsTable,
  usersTable,
  vendorPeopleTable,
  vendorsTable,
} from "@workspace/db";
import { ACCOUNTS_PAYABLE_ROLE } from "../src/lib/ap-role";

async function findUserByLogin(logins: string[]) {
  const lowered = logins.map((l) => l.toLowerCase());
  const [row] = await db
    .select({ id: usersTable.id, username: usersTable.username, email: usersTable.email })
    .from(usersTable)
    .where(
      or(
        ...lowered.map((l) => sql`lower(${usersTable.username}) = ${l}`),
        ...lowered.map((l) => sql`lower(coalesce(${usersTable.email}, '')) = ${l}`),
      ),
    );
  return row ?? null;
}

async function upsertPartnerContact(input: {
  partnerId: number;
  email: string;
  name: string;
  jobTitle: string;
  roles: string[];
  userId: number | null;
}) {
  const [existing] = await db
    .select({ id: partnerContactsTable.id })
    .from(partnerContactsTable)
    .where(
      and(
        eq(partnerContactsTable.partnerId, input.partnerId),
        sql`lower(${partnerContactsTable.email}) = lower(${input.email})`,
        isNull(partnerContactsTable.deletedAt),
      ),
    );

  if (existing) {
    await db
      .update(partnerContactsTable)
      .set({
        name: input.name,
        jobTitle: input.jobTitle,
        roles: input.roles,
        userId: input.userId,
      })
      .where(eq(partnerContactsTable.id, existing.id));
    return { action: "updated" as const, id: existing.id };
  }

  const [inserted] = await db
    .insert(partnerContactsTable)
    .values({
      partnerId: input.partnerId,
      email: input.email,
      name: input.name,
      jobTitle: input.jobTitle,
      roles: input.roles,
      userId: input.userId,
    })
    .returning({ id: partnerContactsTable.id });
  return { action: "inserted" as const, id: inserted.id };
}

async function ensureVendorPersonLogin(input: {
  vendorId: number;
  email: string;
  firstName: string;
  lastName: string;
  vendorRole: "field" | "foreman" | "both" | "office";
  jobTitle: string;
  userId: number;
}) {
  const [existing] = await db
    .select({ id: vendorPeopleTable.id })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, input.vendorId),
        sql`lower(${vendorPeopleTable.email}) = lower(${input.email})`,
        isNull(vendorPeopleTable.deletedAt),
      ),
    );

  if (existing) {
    await db
      .update(vendorPeopleTable)
      .set({
        userId: input.userId,
        vendorRole: input.vendorRole,
        jobTitle: input.jobTitle,
        firstName: input.firstName,
        lastName: input.lastName,
        isActive: true,
      })
      .where(eq(vendorPeopleTable.id, existing.id));
    return { action: "updated" as const, id: existing.id };
  }

  const [inserted] = await db
    .insert(vendorPeopleTable)
    .values({
      vendorId: input.vendorId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      vendorRole: input.vendorRole,
      jobTitle: input.jobTitle,
      userId: input.userId,
      isActive: true,
      roles: [],
    })
    .returning({ id: vendorPeopleTable.id });
  return { action: "inserted" as const, id: inserted.id };
}

async function main() {
  const [exxon] = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(sql`lower(${partnersTable.name}) LIKE '%exxon%'`)
    .limit(1);
  const [winchester] = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(sql`lower(${vendorsTable.name}) LIKE '%winchester%'`)
    .limit(1);
  const [baker] = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(sql`lower(${vendorsTable.name}) LIKE '%baker%'`)
    .limit(1);

  const exxonUser = await findUserByLogin(["exxon", "exxon@vndrly.com"]);
  const exxonOps = await findUserByLogin(["exxon.ops"]);
  const exxonAp = await findUserByLogin(["exxon.ap", "exxon.finance"]);
  const winchesterUser = await findUserByLogin(["winchester", "winchester@vndrly.com"]);
  const bakerUser = await findUserByLogin(["baker", "baker@vndrly.com"]);
  const joeBoggs = await findUserByLogin(["joe.boggs@winchester.com"]);

  const results: {
    exxonContacts?: { action: string; id: number }[];
    winchesterForeman?: { action: string; id: number };
    winchesterAdminMembership?: string;
    bakerAdminMembership?: string;
  } = {};

  if (exxon?.id) {
    results.exxonContacts = [];
    if (exxonUser) {
      results.exxonContacts.push(
        await upsertPartnerContact({
          partnerId: exxon.id,
          email: exxonUser.email ?? "exxon@vndrly.com",
          name: exxonUser.username,
          jobTitle: "Operations Manager",
          roles: ["Operations Manager", "Ticket Approver"],
          userId: exxonUser.id,
        }),
      );
    }
    if (exxonOps) {
      results.exxonContacts.push(
        await upsertPartnerContact({
          partnerId: exxon.id,
          email: `${exxonOps.username}@vndrly.com`,
          name: exxonOps.username,
          jobTitle: "Field Superintendent",
          roles: ["Field Superintendent", "Ticket Approver"],
          userId: exxonOps.id,
        }),
      );
    }
    if (exxonAp) {
      results.exxonContacts.push(
        await upsertPartnerContact({
          partnerId: exxon.id,
          email: `${exxonAp.username}@vndrly.com`,
          name: exxonAp.username,
          jobTitle: "Accounts Payable",
          roles: [ACCOUNTS_PAYABLE_ROLE],
          userId: exxonAp.id,
        }),
      );
    }
  }

  if (winchester?.id && joeBoggs) {
    results.winchesterForeman = await ensureVendorPersonLogin({
      vendorId: winchester.id,
      email: "joe.boggs@winchester.com",
      firstName: "Joe",
      lastName: "Boggs",
      vendorRole: "foreman",
      jobTitle: "Foreman",
      userId: joeBoggs.id,
    });
  }

  if (winchester?.id && winchesterUser) {
    const [membership] = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, winchesterUser.id),
          eq(userOrgMembershipsTable.vendorId, winchester.id),
        ),
      );
    if (!membership) {
      await db.insert(userOrgMembershipsTable).values({
        userId: winchesterUser.id,
        orgType: "vendor",
        vendorId: winchester.id,
        role: "admin",
      });
      results.winchesterAdminMembership = "inserted";
    }
  }

  if (baker?.id && bakerUser) {
    const [membership] = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, bakerUser.id),
          eq(userOrgMembershipsTable.vendorId, baker.id),
        ),
      );
    if (!membership) {
      await db.insert(userOrgMembershipsTable).values({
        userId: bakerUser.id,
        orgType: "vendor",
        vendorId: baker.id,
        role: "admin",
      });
      results.bakerAdminMembership = "inserted";
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
