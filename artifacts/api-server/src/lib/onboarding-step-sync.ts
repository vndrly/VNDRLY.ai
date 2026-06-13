/**
 * When onboarding steps are marked complete, persist unlock-critical
 * fields to the org row so partial setup (Save & Quit) still enables
 * features like hotlist browsing/bidding without waiting for /complete.
 */
import { and, eq } from "drizzle-orm";
import {
  buildPlatformEulaAcceptancePatch,
  isPlatformEulaPayloadAccepted,
} from "./platform-eula-acceptance";
import {
  db,
  partnersTable,
  siteLocationsTable,
  vendorWorkTypesTable,
  vendorsTable,
} from "@workspace/db";

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function newlyCompletedSteps(
  before: string[],
  after: string[],
): string[] {
  const prev = new Set(before);
  return after.filter((s) => !prev.has(s));
}

export async function syncOnboardingStepSideEffects(args: {
  orgType: "partner" | "vendor";
  orgId: number;
  previousCompletedSteps: string[];
  nextCompletedSteps: string[];
  payload: Record<string, unknown>;
  acceptedByUserId?: number | null;
}): Promise<void> {
  const fresh = newlyCompletedSteps(
    args.previousCompletedSteps,
    args.nextCompletedSteps,
  );
  if (fresh.length === 0) return;

  if (args.orgType === "vendor") {
    for (const step of fresh) {
      if (step === "platform-eula") await syncPlatformEula(args.orgId, "vendor", args.payload, args.acceptedByUserId);
      if (step === "tax-ids") await syncVendorTaxIds(args.orgId, args.payload);
      if (step === "work-types") await syncVendorWorkTypes(args.orgId, args.payload);
      if (step === "branding") await syncVendorBranding(args.orgId, args.payload);
      if (step === "compliance") await syncVendorCompliance(args.orgId, args.payload);
    }
    return;
  }

  for (const step of fresh) {
    if (step === "platform-eula") await syncPlatformEula(args.orgId, "partner", args.payload, args.acceptedByUserId);
    if (step === "branding") await syncPartnerBranding(args.orgId, args.payload);
    if (step === "first-site") await syncPartnerFirstSite(args.orgId, args.payload);
    if (step === "tax-billing") await syncPartnerTaxBilling(args.orgId, args.payload);
  }
}

async function syncPlatformEula(
  orgId: number,
  orgType: "partner" | "vendor",
  payload: Record<string, unknown>,
  acceptedByUserId?: number | null,
): Promise<void> {
  if (!acceptedByUserId || !isPlatformEulaPayloadAccepted(payload)) return;
  const patch = buildPlatformEulaAcceptancePatch(acceptedByUserId);
  if (orgType === "partner") {
    await db.update(partnersTable).set(patch).where(eq(partnersTable.id, orgId));
  } else {
    await db.update(vendorsTable).set(patch).where(eq(vendorsTable.id, orgId));
  }
}

async function syncVendorTaxIds(
  vendorId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const tax = (payload.taxIds ?? {}) as Record<string, unknown>;
  const patch: Record<string, string> = {};
  if (trim(tax.federalTaxId)) patch.federalTaxId = trim(tax.federalTaxId);
  if (trim(tax.stateTaxId)) patch.stateTaxId = trim(tax.stateTaxId);
  if (trim(tax.physicalAddress)) patch.physicalAddress = trim(tax.physicalAddress);
  if (trim(tax.billingAddress)) patch.billingAddress = trim(tax.billingAddress);
  if (Object.keys(patch).length === 0) return;
  await db.update(vendorsTable).set(patch).where(eq(vendorsTable.id, vendorId));
}

async function syncVendorWorkTypes(
  vendorId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const sa = (payload.serviceArea ?? {}) as Record<string, unknown>;
  const radius = Number(sa.operatingRadiusMiles);
  const patch: Record<string, unknown> = {};
  if (Number.isFinite(radius) && radius > 0) {
    patch.operatingRadiusMiles = Math.round(radius);
  }
  const wtIds = Array.from(
    new Set(
      (Array.isArray(payload.workTypeIds) ? payload.workTypeIds : [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0),
    ),
  );
  if (Object.keys(patch).length > 0) {
    await db.update(vendorsTable).set(patch).where(eq(vendorsTable.id, vendorId));
  }
  if (wtIds.length === 0) return;
  await db
    .delete(vendorWorkTypesTable)
    .where(eq(vendorWorkTypesTable.vendorId, vendorId));
  await db
    .insert(vendorWorkTypesTable)
    .values(wtIds.map((workTypeId) => ({ vendorId, workTypeId })));
}

async function syncVendorBranding(
  vendorId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const branding = (payload.branding ?? {}) as Record<string, unknown>;
  const patch: Record<string, string> = {};
  if (trim(branding.brandPrimaryColor)) {
    patch.brandPrimaryColor = trim(branding.brandPrimaryColor);
  }
  if (trim(branding.logoUrl)) patch.logoUrl = trim(branding.logoUrl);
  if (Object.keys(patch).length === 0) return;
  await db.update(vendorsTable).set(patch).where(eq(vendorsTable.id, vendorId));
}

async function syncVendorCompliance(
  vendorId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const c = (payload.compliance ?? {}) as Record<string, unknown>;
  const patch: Record<string, string> = {};
  if (trim(c.carrier)) patch.insuranceCarrier = trim(c.carrier);
  if (trim(c.policyNumber)) patch.insurancePolicyNumber = trim(c.policyNumber);
  if (trim(c.expirationDate)) patch.insuranceExpirationDate = trim(c.expirationDate);
  if (trim(c.documentUrl)) patch.coiDocumentUrl = trim(c.documentUrl);
  if (Object.keys(patch).length === 0) return;
  await db.update(vendorsTable).set(patch).where(eq(vendorsTable.id, vendorId));
}

async function syncPartnerBranding(
  partnerId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const patch: Record<string, string> = {};
  if (trim(payload.brandPrimaryColor)) {
    patch.brandPrimaryColor = trim(payload.brandPrimaryColor);
  }
  if (trim(payload.brandAccentColor)) {
    patch.brandAccentColor = trim(payload.brandAccentColor);
  }
  if (trim(payload.logoUrl)) patch.logoUrl = trim(payload.logoUrl);
  if (trim(payload.logoSquareUrl)) patch.logoSquareUrl = trim(payload.logoSquareUrl);
  if (Object.keys(patch).length === 0) return;
  await db.update(partnersTable).set(patch).where(eq(partnersTable.id, partnerId));
}

async function syncPartnerFirstSite(
  partnerId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const site = (payload.firstSite ?? {}) as Record<string, unknown>;
  const siteCode = trim(site.siteCode);
  const name = trim(site.name);
  const address = trim(site.address);
  if (!siteCode || !name || !address) return;
  const [existing] = await db
    .select({ id: siteLocationsTable.id })
    .from(siteLocationsTable)
    .where(
      and(
        eq(siteLocationsTable.partnerId, partnerId),
        eq(siteLocationsTable.siteCode, siteCode),
      ),
    )
    .limit(1);
  if (existing) return;
  const radiusMeters = Math.max(
    1,
    Math.round(Number(site.siteRadiusMeters) || 152),
  );
  await db.insert(siteLocationsTable).values({
    partnerId,
    name,
    address,
    latitude: 0,
    longitude: 0,
    siteCode,
    siteRadiusMeters: radiusMeters,
  });
}

async function syncPartnerTaxBilling(
  partnerId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const tax = (payload.taxBilling ?? {}) as Record<string, unknown>;
  const patch: Record<string, string> = {};
  if (trim(tax.federalTaxId)) patch.federalTaxId = trim(tax.federalTaxId);
  if (trim(tax.stateTaxId)) patch.stateTaxId = trim(tax.stateTaxId);
  if (trim(tax.physicalAddress)) patch.physicalAddress = trim(tax.physicalAddress);
  if (trim(tax.billingAddress)) patch.billingAddress = trim(tax.billingAddress);
  if (Object.keys(patch).length === 0) return;
  await db.update(partnersTable).set(patch).where(eq(partnersTable.id, partnerId));
}

/** Exported for tests — detect steps newly marked complete. */
export { newlyCompletedSteps };
