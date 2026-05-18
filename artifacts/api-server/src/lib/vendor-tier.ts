// Task #495: three-tier vendor model used by hotlist bid gating and the
// Direct Award endpoint.
//
//   pre_onboarded  – vendor account exists but has not crossed the
//                    onboarding threshold (no rows in vendor_work_types).
//   unapproved     – onboarded (has at least one vendor_work_types row)
//                    but has no preferred|approved partner_vendor_relationships
//                    row with the partner in question.
//   approved       – has a preferred|approved partner_vendor_relationships
//                    row with the partner.
//
// The helpers are pure-ish (they only read from already-existing tables) so
// they can be unit-tested by mocking the @workspace/db proxy.

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  partnerVendorRelationshipsTable,
  vendorWorkTypesTable,
  vendorsTable,
  type Vendor,
} from "@workspace/db";

export type VendorTier = "pre_onboarded" | "unapproved" | "approved";

const APPROVED_REL_STATUSES = new Set(["approved", "preferred"]);

/**
 * Decide which tier the (vendor, partner) pair falls into.
 *
 * The "onboarding crossed" signal we use is "has at least one
 * vendor_work_types row", because:
 *   - That row is what makes the vendor showable on a portal as able to
 *     take work.
 *   - The onboarding-progress table also tracks this, but a vendor can be
 *     onboarded outside the wizard (admin-created), so reading work-types
 *     coverage avoids spurious pre_onboarded misses for those cases.
 */
export async function getVendorTier(
  vendorId: number,
  partnerId: number,
): Promise<VendorTier> {
  // Approval check first — short-circuits regardless of work-type coverage,
  // because the partner has explicitly trusted this vendor.
  const [rel] = await db
    .select({ status: partnerVendorRelationshipsTable.status })
    .from(partnerVendorRelationshipsTable)
    .where(
      and(
        eq(partnerVendorRelationshipsTable.partnerId, partnerId),
        eq(partnerVendorRelationshipsTable.vendorId, vendorId),
      ),
    );
  if (rel && APPROVED_REL_STATUSES.has(rel.status)) {
    return "approved";
  }

  const [anyWorkType] = await db
    .select({ id: vendorWorkTypesTable.id })
    .from(vendorWorkTypesTable)
    .where(eq(vendorWorkTypesTable.vendorId, vendorId))
    .limit(1);
  if (!anyWorkType) return "pre_onboarded";
  return "unapproved";
}

/**
 * Batched form of {@link getVendorTier}: returns the tier for every
 * `(vendorId, partnerId)` pair in `vendorIds` using exactly two SELECTs
 * total (one against `partner_vendor_relationships`, one against
 * `vendor_work_types`) instead of two-per-vendor. Callers like the
 * Direct Award candidates endpoint, which annotate hundreds of vendors
 * at a time, can then resolve tiers from the returned map in memory.
 *
 * The decision logic is identical to `getVendorTier`:
 *   - approved relationship row → "approved"
 *   - else has any vendor_work_types row → "unapproved"
 *   - else → "pre_onboarded"
 *
 * The returned map always contains an entry for every input vendor id
 * (even unknown / no-row vendors land at "pre_onboarded"), so the caller
 * can `map.get(id) ?? "pre_onboarded"` defensively without re-checking
 * presence. Duplicate ids in the input are collapsed before querying.
 */
export async function getVendorTiersBatch(
  vendorIds: number[],
  partnerId: number,
): Promise<Map<number, VendorTier>> {
  const tiers = new Map<number, VendorTier>();
  // Dedupe + drop non-positive ids so the IN-list is minimal and the
  // SQL never sees a `WHERE vendorId IN ()` (which Drizzle would
  // collapse to `1=0`, but skipping the query entirely is cheaper).
  const uniqueIds = Array.from(
    new Set(vendorIds.filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (uniqueIds.length === 0) return tiers;

  // Seed every requested id at the most-restrictive tier, then upgrade
  // as the two batched queries report evidence of onboarding /
  // approval. This keeps the "always has an entry" contract above.
  for (const id of uniqueIds) tiers.set(id, "pre_onboarded");

  const [relRows, workTypeRows] = await Promise.all([
    db
      .select({
        vendorId: partnerVendorRelationshipsTable.vendorId,
        status: partnerVendorRelationshipsTable.status,
      })
      .from(partnerVendorRelationshipsTable)
      .where(
        and(
          eq(partnerVendorRelationshipsTable.partnerId, partnerId),
          inArray(partnerVendorRelationshipsTable.vendorId, uniqueIds),
        ),
      ),
    db
      .selectDistinct({ vendorId: vendorWorkTypesTable.vendorId })
      .from(vendorWorkTypesTable)
      .where(inArray(vendorWorkTypesTable.vendorId, uniqueIds)),
  ]);

  // Onboarded set first, so the approved override below wins regardless
  // of whether the vendor also has work types (which they typically do,
  // but the approval gate short-circuits the check in `getVendorTier`).
  for (const row of workTypeRows) {
    if (tiers.has(row.vendorId)) tiers.set(row.vendorId, "unapproved");
  }
  for (const row of relRows) {
    if (APPROVED_REL_STATUSES.has(row.status) && tiers.has(row.vendorId)) {
      tiers.set(row.vendorId, "approved");
    }
  }
  return tiers;
}

export type DirectAwardEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "vendor_not_found"
        | "missing_work_type"
        | "missing_coi_document"
        | "missing_insurance_expiration"
        | "expired_insurance"
        | "missing_federal_tax_id";
      message: string;
    };

/**
 * Check whether a vendor satisfies the minimum compliance floor required
 * to receive a Direct Award ticket from a partner.
 *
 * Floor (per Task #495):
 *   - has a vendor_work_types row matching the requested work type
 *   - coiDocumentUrl is non-empty
 *   - insuranceExpirationDate parses to a date >= today (UTC)
 *   - federalTaxId is non-empty
 *
 * License fields are deliberately deferred for v1.
 *
 * `today` is injectable for tests so we can pin the COI edge case.
 */
export async function isDirectAwardEligible(
  vendorId: number,
  workTypeId: number,
  options?: { today?: Date },
): Promise<DirectAwardEligibility> {
  const [vendor] = await db
    .select({
      id: vendorsTable.id,
      coiDocumentUrl: vendorsTable.coiDocumentUrl,
      insuranceExpirationDate: vendorsTable.insuranceExpirationDate,
      federalTaxId: vendorsTable.federalTaxId,
    })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, vendorId));
  if (!vendor) {
    return {
      eligible: false,
      reason: "vendor_not_found",
      message: "Vendor not found",
    };
  }

  const [workTypeRow] = await db
    .select({ id: vendorWorkTypesTable.id })
    .from(vendorWorkTypesTable)
    .where(
      and(
        eq(vendorWorkTypesTable.vendorId, vendorId),
        eq(vendorWorkTypesTable.workTypeId, workTypeId),
      ),
    )
    .limit(1);
  if (!workTypeRow) {
    return {
      eligible: false,
      reason: "missing_work_type",
      message:
        "Vendor does not have the required work type checked in their profile",
    };
  }

  return checkComplianceFloor(
    {
      coiDocumentUrl: vendor.coiDocumentUrl,
      insuranceExpirationDate: vendor.insuranceExpirationDate,
      federalTaxId: vendor.federalTaxId,
    },
    options?.today ?? new Date(),
  );
}

/**
 * Pure compliance-floor check, separated from the DB read so it can be unit
 * tested without any DB mocking.
 */
export function checkComplianceFloor(
  vendor: Pick<
    Vendor,
    "coiDocumentUrl" | "insuranceExpirationDate" | "federalTaxId"
  >,
  today: Date,
): DirectAwardEligibility {
  if (!vendor.coiDocumentUrl || vendor.coiDocumentUrl.trim() === "") {
    return {
      eligible: false,
      reason: "missing_coi_document",
      message: "Vendor has no Certificate of Insurance on file",
    };
  }
  if (!vendor.insuranceExpirationDate) {
    return {
      eligible: false,
      reason: "missing_insurance_expiration",
      message: "Vendor has no insurance expiration date on file",
    };
  }
  // Both the stored insuranceExpirationDate (date-only string) and "today"
  // are normalized to UTC-midnight so the boundary comparison is
  // timezone-independent. `new Date("YYYY-MM-DD")` already parses as UTC
  // midnight; for "today" we strip H/M/S/ms in UTC instead of local.
  const exp = new Date(vendor.insuranceExpirationDate);
  if (!Number.isFinite(exp.getTime())) {
    return {
      eligible: false,
      reason: "missing_insurance_expiration",
      message: "Vendor's insurance expiration date is not a valid date",
    };
  }
  const todayUtcMidnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (exp.getTime() < todayUtcMidnight) {
    return {
      eligible: false,
      reason: "expired_insurance",
      message: "Vendor's Certificate of Insurance has expired",
    };
  }
  if (!vendor.federalTaxId || vendor.federalTaxId.trim() === "") {
    return {
      eligible: false,
      reason: "missing_federal_tax_id",
      message: "Vendor has no federal tax ID on file",
    };
  }
  return { eligible: true };
}
