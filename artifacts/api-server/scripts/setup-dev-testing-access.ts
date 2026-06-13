/**
 * Dev/testing prep:
 * 1. Ensure platform EULA columns exist (chunk_386)
 * 2. Backfill platform EULA acceptance on all partners/vendors
 * 3. Mark platform-eula complete in onboarding_progress payloads
 * 4. Create {slug}@vndrly.com / testing123 admin logins per org
 *    (exempt canonical demo orgs: Exxon, Mach, Winchester, VNDRLY)
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run setup:dev-testing-access
 */
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  onboardingProgressTable,
  partnersTable,
  pool,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
} from "@workspace/db";
import { PLATFORM_EULA_VERSION } from "@workspace/platform-eula";
import {
  buildPlatformEulaAcceptancePatch,
  platformEulaContentHash,
} from "../src/lib/platform-eula-acceptance";

const TEST_PASSWORD = "testing123";

/** Canonical demo accounts — never create or overwrite these. */
const CANONICAL_USERNAMES = new Set([
  "admin@vndrly.com",
  "admin",
  "baker@vndrly.com",
  "baker",
  "winchester@vndrly.com",
  "winchester",
  "mach@vndrly.com",
  "mach",
  "exxon@vndrly.com",
  "exxon",
  "joe.boggs@winchester.com",
]);

/** Org names matching these substrings are skipped for test login creation. */
const EXEMPT_ORG_NAME_PATTERNS = [
  "vndrly",
  "exxon",
  "mach",
  "winchester",
];

/** Exact org name → preferred test email when slug collision or short alias is desired. */
const MANUAL_EMAIL_OVERRIDES: Record<string, string> = {
  "vendor:Acme Logistics": "acme@vndrly.com",
};

function manualEmailOverride(
  orgType: "partner" | "vendor",
  orgName: string,
): string | undefined {
  return MANUAL_EMAIL_OVERRIDES[`${orgType}:${orgName}`];
}

type OrgRow = { id: number; name: string };

function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
  return slug || "org";
}

function isExemptOrg(name: string): boolean {
  const lower = name.toLowerCase();
  return EXEMPT_ORG_NAME_PATTERNS.some((p) => lower.includes(p));
}

async function ensureMigration(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(here, "../../../lib/db/drizzle/chunk_386_platform_eula_acceptance.sql");
  const migrationSql = readFileSync(sqlPath, "utf8");
  await db.execute(sql.raw(migrationSql));
  console.log("✓ platform EULA columns ensured (chunk_386)");
}

async function backfillPartnerEula(): Promise<number> {
  const rows = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(isNull(partnersTable.platformEulaAcceptedAt));

  if (rows.length === 0) {
    console.log("✓ all partners already have platform EULA acceptance");
    return 0;
  }

  const patch = {
    platformEulaAcceptedAt: new Date(),
    platformEulaVersion: PLATFORM_EULA_VERSION,
    platformEulaHash: platformEulaContentHash(),
    platformEulaAcceptedByUserId: null as number | null,
  };

  await db.update(partnersTable).set(patch).where(isNull(partnersTable.platformEulaAcceptedAt));
  console.log(`✓ backfilled platform EULA on ${rows.length} partner(s)`);
  return rows.length;
}

async function backfillVendorEula(): Promise<number> {
  const rows = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(isNull(vendorsTable.platformEulaAcceptedAt));

  if (rows.length === 0) {
    console.log("✓ all vendors already have platform EULA acceptance");
    return 0;
  }

  const patch = {
    platformEulaAcceptedAt: new Date(),
    platformEulaVersion: PLATFORM_EULA_VERSION,
    platformEulaHash: platformEulaContentHash(),
    platformEulaAcceptedByUserId: null as number | null,
  };

  await db.update(vendorsTable).set(patch).where(isNull(vendorsTable.platformEulaAcceptedAt));
  console.log(`✓ backfilled platform EULA on ${rows.length} vendor(s)`);
  return rows.length;
}

async function backfillOnboardingProgress(orgType: "partner" | "vendor"): Promise<number> {
  const rows = await db
    .select({
      id: onboardingProgressTable.id,
      completedSteps: onboardingProgressTable.completedSteps,
      payload: onboardingProgressTable.payload,
    })
    .from(onboardingProgressTable)
    .where(eq(onboardingProgressTable.orgType, orgType));

  let updated = 0;
  for (const row of rows) {
    const completed = new Set(row.completedSteps ?? []);
    const payload = { ...((row.payload ?? {}) as Record<string, unknown>) };
    const eula = (payload.platformEula ?? {}) as Record<string, unknown>;
    const needsStep = !completed.has("platform-eula");
    const needsPayload = eula.accepted !== true || eula.version !== PLATFORM_EULA_VERSION;
    if (!needsStep && !needsPayload) continue;

    completed.add("platform-eula");
    payload.platformEula = { accepted: true, version: PLATFORM_EULA_VERSION };

    await db
      .update(onboardingProgressTable)
      .set({
        completedSteps: Array.from(completed),
        payload,
      })
      .where(eq(onboardingProgressTable.id, row.id));
    updated++;
  }

  console.log(`✓ updated onboarding_progress for ${updated} ${orgType}(s)`);
  return updated;
}

async function findExistingUser(email: string) {
  const [row] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = lower(${email})`)
    .limit(1);
  return row ?? null;
}

async function createTestLogin(args: {
  orgType: "partner" | "vendor";
  org: OrgRow;
  email: string;
}): Promise<"created" | "updated" | "skipped" | "conflict"> {
  const { orgType, org, email } = args;
  const lowerEmail = email.toLowerCase();

  if (CANONICAL_USERNAMES.has(lowerEmail)) {
    return "skipped";
  }

  if (isExemptOrg(org.name)) {
    return "skipped";
  }

  const existing = await findExistingUser(lowerEmail);
  const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
  const displayName = `${org.name} Admin`;
  const sessionRole = orgType;

  if (existing) {
    const [membership] = await db
      .select({
        id: userOrgMembershipsTable.id,
        partnerId: userOrgMembershipsTable.partnerId,
        vendorId: userOrgMembershipsTable.vendorId,
        orgType: userOrgMembershipsTable.orgType,
      })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, existing.id),
          eq(userOrgMembershipsTable.role, "admin"),
        ),
      );

    const belongsToOrg =
      orgType === "partner"
        ? membership?.partnerId === org.id
        : membership?.vendorId === org.id;

    if (!belongsToOrg) {
      return "conflict";
    }

    await db
      .update(usersTable)
      .set({
        passwordHash,
        mustChangePassword: false,
        email: lowerEmail,
        displayName,
        role: sessionRole,
      })
      .where(eq(usersTable.id, existing.id));

    return "updated";
  }

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({
        username: lowerEmail,
        email: lowerEmail,
        passwordHash,
        role: sessionRole,
        displayName,
        mustChangePassword: false,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: usersTable.id });
    if (!user) return null;

    const [membership] = await tx
      .insert(userOrgMembershipsTable)
      .values({
        userId: user.id,
        orgType,
        partnerId: orgType === "partner" ? org.id : null,
        vendorId: orgType === "vendor" ? org.id : null,
        role: "admin",
      })
      .returning({ id: userOrgMembershipsTable.id });
    if (!membership) return null;

    await tx
      .update(usersTable)
      .set({ activeMembershipId: membership.id })
      .where(eq(usersTable.id, user.id));

    const eulaPatch = buildPlatformEulaAcceptancePatch(user.id);
    if (orgType === "partner") {
      await tx.update(partnersTable).set(eulaPatch).where(eq(partnersTable.id, org.id));
    } else {
      await tx.update(vendorsTable).set(eulaPatch).where(eq(vendorsTable.id, org.id));
    }

    return { userId: user.id, membershipId: membership.id };
  });

  return created ? "created" : "conflict";
}

async function provisionOrgLogins(
  orgType: "partner" | "vendor",
  orgs: OrgRow[],
): Promise<void> {
  const usedSlugs = new Map<string, number>();
  const created: { org: string; email: string }[] = [];
  const updated: { org: string; email: string }[] = [];
  const skipped: { org: string; reason: string }[] = [];
  const conflicts: { org: string; email: string; reason: string }[] = [];

  for (const org of orgs) {
    if (isExemptOrg(org.name)) {
      skipped.push({ org: org.name, reason: "exempt org (canonical demo)" });
      continue;
    }

    let slug = slugFromName(org.name);
    const prev = usedSlugs.get(slug) ?? 0;
    usedSlugs.set(slug, prev + 1);
    if (prev > 0) slug = `${slug}${prev + 1}`;

    const email = manualEmailOverride(orgType, org.name) ?? `${slug}@vndrly.com`;

    if (CANONICAL_USERNAMES.has(email)) {
      conflicts.push({
        org: org.name,
        email,
        reason: "email reserved for canonical demo account",
      });
      continue;
    }

    const result = await createTestLogin({ orgType, org, email });
    if (result === "created") created.push({ org: org.name, email });
    else if (result === "updated") updated.push({ org: org.name, email });
    else if (result === "skipped") skipped.push({ org: org.name, reason: "exempt or canonical" });
    else {
      conflicts.push({
        org: org.name,
        email,
        reason: "email already belongs to a different org",
      });
    }
  }

  console.log(`\n── ${orgType} test logins (${TEST_PASSWORD}) ──`);
  if (created.length) {
    console.log("Created:");
    for (const r of created) console.log(`  ${r.email}  →  ${r.org}`);
  }
  if (updated.length) {
    console.log("Updated password:");
    for (const r of updated) console.log(`  ${r.email}  →  ${r.org}`);
  }
  if (skipped.length) {
    console.log("Skipped:");
    for (const r of skipped) console.log(`  ${r.org}  (${r.reason})`);
  }
  if (conflicts.length) {
    console.log("CONFLICTS — pick alternate login names:");
    for (const r of conflicts) console.log(`  ${r.org}: ${r.email}  (${r.reason})`);
  }
}

async function main(): Promise<void> {
  await ensureMigration();
  await backfillPartnerEula();
  await backfillVendorEula();
  await backfillOnboardingProgress("partner");
  await backfillOnboardingProgress("vendor");

  const partners = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable)
    .orderBy(partnersTable.name);
  const vendors = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .orderBy(vendorsTable.name);

  await provisionOrgLogins("partner", partners);
  await provisionOrgLogins("vendor", vendors);

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
