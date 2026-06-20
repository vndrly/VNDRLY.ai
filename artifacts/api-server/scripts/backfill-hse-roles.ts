/**
 * Ensures every partner and vendor has at least one person tagged
 * `HSE / Safety Officer` in their company-role pills (partner_contacts.roles
 * or vendor_people.roles). Idempotent — skips orgs that already have HSE.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/backfill-hse-roles.ts
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  partnerContactsTable,
  partnersTable,
  vendorPeopleTable,
  vendorsTable,
} from "@workspace/db";

export const HSE_COMPANY_ROLE = "HSE / Safety Officer";

function pickPartnerContact(
  contacts: Array<typeof partnerContactsTable.$inferSelect>,
) {
  if (contacts.length === 0) return null;
  const withUser = contacts.find((c) => c.userId != null);
  if (withUser) return withUser;
  const ops = contacts.find((c) =>
    c.roles.some((r) => r === "Operations Manager" || r === "Field Superintendent"),
  );
  if (ops) return ops;
  return contacts[0] ?? null;
}

function pickVendorPerson(
  people: Array<typeof vendorPeopleTable.$inferSelect>,
) {
  if (people.length === 0) return null;
  const office = people.filter((p) => p.vendorRole === "office");
  const pool = office.length > 0 ? office : people;
  const withUser = pool.find((p) => p.userId != null);
  if (withUser) return withUser;
  const ops = pool.find((p) =>
    p.roles.some((r) => r === "Operations Manager" || r === "Field Superintendent"),
  );
  if (ops) return ops;
  return pool[0] ?? null;
}

async function main() {
  let partnerUpdates = 0;
  let partnerSkipped = 0;
  let partnerMissingContacts = 0;

  const partners = await db.select({ id: partnersTable.id, name: partnersTable.name }).from(partnersTable);

  for (const partner of partners) {
    const contacts = await db
      .select()
      .from(partnerContactsTable)
      .where(
        and(
          eq(partnerContactsTable.partnerId, partner.id),
          isNull(partnerContactsTable.deletedAt),
        ),
      );

    if (contacts.some((c) => c.roles.includes(HSE_COMPANY_ROLE))) {
      partnerSkipped += 1;
      continue;
    }

    const target = pickPartnerContact(contacts);
    if (!target) {
      partnerMissingContacts += 1;
      console.warn(`Partner ${partner.id} (${partner.name}): no contacts — cannot assign HSE`);
      continue;
    }

    const roles = Array.from(new Set([...target.roles, HSE_COMPANY_ROLE]));
    await db
      .update(partnerContactsTable)
      .set({ roles })
      .where(eq(partnerContactsTable.id, target.id));
    partnerUpdates += 1;
    console.log(
      `Partner ${partner.id} (${partner.name}): HSE → contact ${target.id} (${target.email})`,
    );
  }

  let vendorUpdates = 0;
  let vendorSkipped = 0;
  let vendorMissingPeople = 0;

  const vendors = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable);

  for (const vendor of vendors) {
    const people = await db
      .select()
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.vendorId, vendor.id),
          isNull(vendorPeopleTable.deletedAt),
          eq(vendorPeopleTable.isActive, true),
        ),
      );

    if (people.some((p) => p.roles.includes(HSE_COMPANY_ROLE))) {
      vendorSkipped += 1;
      continue;
    }

    const target = pickVendorPerson(people);
    if (!target) {
      vendorMissingPeople += 1;
      console.warn(`Vendor ${vendor.id} (${vendor.name}): no active people — cannot assign HSE`);
      continue;
    }

    const roles = Array.from(new Set([...target.roles, HSE_COMPANY_ROLE]));
    await db
      .update(vendorPeopleTable)
      .set({ roles })
      .where(eq(vendorPeopleTable.id, target.id));
    vendorUpdates += 1;
    console.log(
      `Vendor ${vendor.id} (${vendor.name}): HSE → person ${target.id} (${target.email})`,
    );
  }

  console.log("");
  console.log("HSE backfill complete:");
  console.log(`  Partners: ${partnerUpdates} updated, ${partnerSkipped} already had HSE, ${partnerMissingContacts} missing contacts`);
  console.log(`  Vendors:  ${vendorUpdates} updated, ${vendorSkipped} already had HSE, ${vendorMissingPeople} missing people`);
  process.exit(0);
}

main().catch((err) => {
  console.error("HSE backfill failed:", err);
  process.exit(1);
});
