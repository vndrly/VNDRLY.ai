/**
 * Fill Flywheel Energy partner onboarding from published company facts.
 *
 * Idempotent. Fill-blanks only — never overwrites user-typed values,
 * never invents a password / tax ID, and never marks the platform EULA
 * or privacy/SMS consent as accepted.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-flywheel-energy.ts
 */
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  onboardingProgressTable,
  partnerContactsTable,
  partnersTable,
  siteLocationsTable,
} from "@workspace/db";
import {
  FLYWHEEL_DISPLAY_NAME,
  FLYWHEEL_NAME_ALIASES,
  FLYWHEEL_PUBLIC_CONTACTS,
  FLYWHEEL_PUBLIC_PROFILE,
  FLYWHEEL_SPUR_SITE_CODE,
  buildOnboardingPayload,
  buildPartnerPatch,
  type PartnerOnboardingPayload,
} from "../src/lib/flywheel-energy-public-onboarding.js";

export type FlywheelSeedCounts = {
  partnerInserted: boolean;
  partnerEnrichedFields: string[];
  partnerMissing: boolean;
  payloadUpdated: boolean;
  contactsInserted: number;
  contactsSkipped: number;
};

async function loadFlywheelPartner() {
  for (const alias of FLYWHEEL_NAME_ALIASES) {
    const [existing] = await db
      .select()
      .from(partnersTable)
      .where(sql`lower(btrim(${partnersTable.name})) = ${alias.toLowerCase()}`)
      .limit(1);
    if (existing) return existing;
  }
  return null;
}

export async function seedFlywheelEnergy(): Promise<FlywheelSeedCounts> {
  let partner = await loadFlywheelPartner();
  let partnerInserted = false;
  if (!partner) {
    const [created] = await db
      .insert(partnersTable)
      .values({
        name: FLYWHEEL_PUBLIC_PROFILE.name,
        contactName: FLYWHEEL_PUBLIC_PROFILE.contactName,
        contactEmail: FLYWHEEL_PUBLIC_PROFILE.contactEmail,
        contactPhone: FLYWHEEL_PUBLIC_PROFILE.contactPhone,
        businessPhone: FLYWHEEL_PUBLIC_PROFILE.businessPhone,
        physicalAddress: FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
        billingAddress: FLYWHEEL_PUBLIC_PROFILE.billingAddress,
        blurb: FLYWHEEL_PUBLIC_PROFILE.blurb,
        brandPrimaryColor: FLYWHEEL_PUBLIC_PROFILE.brandPrimaryColor,
        brandAccentColor: FLYWHEEL_PUBLIC_PROFILE.brandAccentColor,
      })
      .returning();
    partner = created;
    partnerInserted = true;
    console.log(`  + inserted partner: ${FLYWHEEL_DISPLAY_NAME} (#${partner.id})`);
  }

  const patch = buildPartnerPatch(partner);
  const partnerEnrichedFields = Object.keys(patch);
  if (partnerEnrichedFields.length > 0) {
    await db.update(partnersTable).set(patch).where(eq(partnersTable.id, partner.id));
    partner = { ...partner, ...patch };
    console.log(
      `  ~ enriched partner #${partner.id}: ${partner.name}  (${partnerEnrichedFields.join(", ")})`,
    );
  } else {
    console.log(`  · partner #${partner.id} already has public profile fields`);
  }

  const sites = await db
    .select()
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.partnerId, partner.id));
  const spur =
    sites.find((s) => s.siteCode === FLYWHEEL_SPUR_SITE_CODE) ??
    sites.find((s) => /spur/i.test(s.name)) ??
    sites[0] ??
    null;

  const [progress] = await db
    .select()
    .from(onboardingProgressTable)
    .where(eq(onboardingProgressTable.partnerId, partner.id))
    .limit(1);

  const existingPayload = ((progress?.payload ?? {}) as PartnerOnboardingPayload) ?? {};
  const nextPayload = buildOnboardingPayload({
    existingPayload,
    partner,
    firstSite: spur
      ? {
          name: spur.name,
          address: spur.address,
          siteCode: spur.siteCode,
          siteRadiusMeters: spur.siteRadiusMeters ?? 1609,
        }
      : {
          name: "Flywheel Energy Spur",
          siteCode: FLYWHEEL_SPUR_SITE_CODE,
        },
  });
  const payloadUpdated = JSON.stringify(existingPayload) !== JSON.stringify(nextPayload);
  if (!progress) {
    await db.insert(onboardingProgressTable).values({
      orgType: "partner",
      partnerId: partner.id,
      currentStep: "platform-eula",
      completedSteps: ["company-basics"],
      skippedSteps: [],
      payload: nextPayload,
    });
    console.log(`  + created onboarding progress for partner #${partner.id}`);
  } else if (payloadUpdated) {
    await db
      .update(onboardingProgressTable)
      .set({ payload: nextPayload })
      .where(eq(onboardingProgressTable.id, progress.id));
    console.log(`  ~ merged public facts into onboarding payload #${progress.id}`);
  } else {
    console.log(`  · onboarding payload already has public facts`);
  }

  const existingContacts = await db
    .select()
    .from(partnerContactsTable)
    .where(
      and(
        eq(partnerContactsTable.partnerId, partner.id),
      ),
    );
  const existingEmails = new Set(
    existingContacts
      .filter((c) => !c.deletedAt)
      .map((c) => c.email.trim().toLowerCase()),
  );
  let contactsInserted = 0;
  let contactsSkipped = 0;
  for (const contact of FLYWHEEL_PUBLIC_CONTACTS) {
    if (existingEmails.has(contact.email.toLowerCase())) {
      contactsSkipped++;
      continue;
    }
    await db.insert(partnerContactsTable).values({
      partnerId: partner.id,
      jobTitle: contact.jobTitle,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      roles: contact.roles,
    });
    contactsInserted++;
    existingEmails.add(contact.email.toLowerCase());
    console.log(`  + contact ${contact.email}`);
  }

  return {
    partnerInserted,
    partnerEnrichedFields,
    partnerMissing: false,
    payloadUpdated: !progress || payloadUpdated,
    contactsInserted,
    contactsSkipped,
  };
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (await import("node:url"))
    .pathToFileURL(process.argv[1])
    .href === import.meta.url;

if (invokedDirectly) {
  seedFlywheelEnergy()
    .then((counts) => {
      console.log("Flywheel Energy public onboarding seed:", counts);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Flywheel Energy seed failed:", err);
      process.exit(1);
    });
}
