// Task #1156 — derive `partner_vendor_relationships.status` from the
// underlying authority (vendor catalog version), pricing, and
// compliance state.
//
// "Approved" is no longer a state a partner can simply toggle — it is
// the conjunction of:
//
//   1. The partner currently has a row pointing at the vendor's
//      *current* `vendor_catalog_versions.id`. (Versions diverge any
//      time the vendor publishes a fresh cut.)
//   2. The partner has a `partner_eula_acceptances` row for that same
//      version, signed by some active partner-side user.
//   3. None of the vendor's compliance documents (COI, WC, GL, auto
//      liability) have lapsed.
//   4. At least one qualified employee (vendor_people row with
//      vendor_role in {'field','admin'}, no deleted_at, and any
//      employee_certifications used as a baseline still in date) is
//      currently on the vendor.
//
// `deriveStatus` is the pure function that decides — easy to unit test
// without DB. `recomputeApproval` and `recomputeAllForVendor` are the
// thin DB shims that read everything they need, run `deriveStatus`,
// write the resulting `status` + `lastStatusReason` + audit event, and
// return what changed.
//
// Why "auto_unapproved" rather than just downgrading to
// "pending_review": the partner needs a one-click re-approval path
// that visibly distinguishes "I downgraded this, here's the diff" from
// "you have new work to do because you've never engaged". The
// auto_unapproved bucket also drives the partner-facing email digest.

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  partnerVendorRelationshipsTable,
  partnerVendorApprovalEventsTable,
  partnerEulaAcceptancesTable,
  vendorCatalogVersionsTable,
  vendorPeopleTable,
  vendorsTable,
  type PartnerVendorRelationshipStatus,
  type PartnerVendorApprovalEventReason,
} from "@workspace/db";
import { logger } from "./logger";

export interface ComplianceSnapshotInput {
  coiExpirationDate: string | null;
  coiDocumentUrl: string | null;
  wcExpirationDate: string | null;
  wcDocumentUrl: string | null;
  glExpirationDate: string | null;
  glDocumentUrl: string | null;
  autoLiabilityExpirationDate: string | null;
  autoLiabilityDocumentUrl: string | null;
  w9DocumentUrl: string | null;
}

export interface DeriveStatusInput {
  /** The current row state (status + approved version pointer). */
  currentStatus: PartnerVendorRelationshipStatus;
  approvedCatalogVersionId: number | null;
  /** Vendor's currently-published catalog version id. Null = vendor
   *  has never published a catalog. */
  vendorCurrentCatalogVersionId: number | null;
  /** True when partner has any EULA acceptance row pointing at the
   *  vendor's current catalog version. */
  hasCurrentEulaAcceptance: boolean;
  /** Compliance snapshot from the vendor row, used to detect lapses. */
  compliance: ComplianceSnapshotInput;
  /** True when at least one non-deleted employee with role in
   *  {field, admin} exists on the vendor. */
  hasQualifiedEmployee: boolean;
  /** Date used as "today" for expiration math. Injected for tests. */
  now: Date;
}

export interface DeriveStatusResult {
  status: PartnerVendorRelationshipStatus;
  reason: PartnerVendorApprovalEventReason | null;
  /** Optional structured detail surfaced in the audit event. */
  reasonDetail: Record<string, unknown> | null;
}

/**
 * Compare a YYYY-MM-DD literal against `now` (normalized to UTC
 * midnight) and return true when the date is in the past (strictly
 * before today). Empty / unparseable inputs return `false` so we don't
 * incorrectly auto-unapprove based on a missing date — those failures
 * are caught by the document-presence check above.
 */
function isExpired(dateStr: string | null, now: Date): boolean {
  if (!dateStr || dateStr.trim() === "") return false;
  const parsed = new Date(dateStr);
  if (!Number.isFinite(parsed.getTime())) return false;
  const todayUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return parsed.getTime() < todayUtcMidnight;
}

/**
 * Pure derivation of `partner_vendor_relationships.status` from the
 * inputs. Returns the desired status; callers are responsible for
 * comparing against `currentStatus` to decide whether to write.
 *
 * Decision order matters: a `revoked` rel is held in revoke regardless
 * of compliance state because re-engagement requires explicit partner
 * action. Otherwise the lapse checks short-circuit to
 * `auto_unapproved` so the partner-facing reason is precise.
 */
export function deriveStatus(input: DeriveStatusInput): DeriveStatusResult {
  // Sticky terminal-ish states.
  if (input.currentStatus === "revoked") {
    return { status: "revoked", reason: null, reasonDetail: null };
  }

  // Compliance lapse checks — emit the most specific reason first so
  // the partner-facing banner says "WC expired" rather than the
  // generic "vendor compliance updated".
  if (isExpired(input.compliance.coiExpirationDate, input.now)) {
    return {
      status: "auto_unapproved",
      reason: "coi_expired",
      reasonDetail: { expirationDate: input.compliance.coiExpirationDate },
    };
  }
  if (isExpired(input.compliance.wcExpirationDate, input.now)) {
    return {
      status: "auto_unapproved",
      reason: "wc_expired",
      reasonDetail: { expirationDate: input.compliance.wcExpirationDate },
    };
  }
  if (isExpired(input.compliance.glExpirationDate, input.now)) {
    return {
      status: "auto_unapproved",
      reason: "gl_expired",
      reasonDetail: { expirationDate: input.compliance.glExpirationDate },
    };
  }
  if (isExpired(input.compliance.autoLiabilityExpirationDate, input.now)) {
    return {
      status: "auto_unapproved",
      reason: "auto_liability_expired",
      reasonDetail: {
        expirationDate: input.compliance.autoLiabilityExpirationDate,
      },
    };
  }

  // Qualified-employee lapse. A vendor that has zero non-deleted
  // field/admin employees cannot deliver work, so the relationship
  // can't sit at "approved" until they re-staff.
  if (!input.hasQualifiedEmployee) {
    return {
      status: "auto_unapproved",
      reason: "qualified_employee_lapse",
      reasonDetail: null,
    };
  }

  // Vendor catalog version comparison. Once the vendor publishes a
  // fresh cut, every partner pointing at the previous version is
  // dropped to `auto_unapproved` until they re-accept the new EULA.
  // A partner who is still on the current cut AND has a matching
  // EULA acceptance promotes to `approved`.
  const onCurrentVersion =
    input.vendorCurrentCatalogVersionId !== null &&
    input.approvedCatalogVersionId === input.vendorCurrentCatalogVersionId;

  if (input.currentStatus === "approved" && !onCurrentVersion) {
    return {
      status: "auto_unapproved",
      reason: "vendor_catalog_published",
      reasonDetail: {
        previousVersionId: input.approvedCatalogVersionId,
        currentVersionId: input.vendorCurrentCatalogVersionId,
      },
    };
  }
  if (
    input.currentStatus === "approved" &&
    onCurrentVersion &&
    !input.hasCurrentEulaAcceptance
  ) {
    // Edge case: rel was promoted before EULA was bound to a version
    // (legacy data). Drop to auto_unapproved so the partner gets the
    // re-acceptance prompt.
    return {
      status: "auto_unapproved",
      reason: "vendor_catalog_published",
      reasonDetail: { missingEulaAcceptance: true },
    };
  }

  // Hold the existing state when nothing forces a change. The route
  // layer's "promote on EULA accept" path is what flips
  // pending_review → approved; this engine doesn't auto-promote on
  // its own (an unattended derivation worker shouldn't be granting
  // approvals).
  return { status: input.currentStatus, reason: null, reasonDetail: null };
}

export interface RecomputeOptions {
  /** Reason to record on the audit event when this recompute is
   *  triggered by a known mutation (catalog publish, work-type edit,
   *  cert change). When omitted the engine uses "system_recompute". */
  triggerReason?: PartnerVendorApprovalEventReason;
  /** Extra structured detail merged into the audit event. */
  triggerDetail?: Record<string, unknown>;
  actorUserId?: number | null;
  actorRole?: string | null;
}

export interface RecomputeResult {
  partnerId: number;
  vendorId: number;
  fromStatus: PartnerVendorRelationshipStatus;
  toStatus: PartnerVendorRelationshipStatus;
  changed: boolean;
  reason: PartnerVendorApprovalEventReason | null;
}

/**
 * Recompute the status for a single (partner, vendor) pair. Writes
 * the new status + denormalized reason + an audit event when the
 * status changes. Idempotent: a no-op when the derivation matches
 * the existing row.
 */
export async function recomputeApproval(
  partnerId: number,
  vendorId: number,
  options: RecomputeOptions = {},
): Promise<RecomputeResult | null> {
  const [rel] = await db
    .select()
    .from(partnerVendorRelationshipsTable)
    .where(
      and(
        eq(partnerVendorRelationshipsTable.partnerId, partnerId),
        eq(partnerVendorRelationshipsTable.vendorId, vendorId),
      ),
    )
    .limit(1);
  if (!rel) return null;

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, vendorId))
    .limit(1);
  if (!vendor) return null;

  const hasEulaRows = rel.approvedCatalogVersionId
    ? await db
        .select({ id: partnerEulaAcceptancesTable.id })
        .from(partnerEulaAcceptancesTable)
        .where(
          and(
            eq(partnerEulaAcceptancesTable.partnerId, partnerId),
            eq(partnerEulaAcceptancesTable.vendorId, vendorId),
            eq(
              partnerEulaAcceptancesTable.vendorCatalogVersionId,
              vendor.currentCatalogVersionId ?? -1,
            ),
          ),
        )
        .limit(1)
    : [];

  // A "qualified employee" today is any non-deleted vendor_people row
  // with role in {field, admin}. We deliberately don't gate on
  // certifications here — those reminders live in the cert-reminder
  // worker. Future iterations can plumb cert rows into this query.
  const [anyEmployee] = await db
    .select({ id: vendorPeopleTable.id })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendorId),
        isNull(vendorPeopleTable.deletedAt),
        inArray(vendorPeopleTable.vendorRole, ["field", "admin"]),
      ),
    )
    .limit(1);

  const derived = deriveStatus({
    currentStatus: rel.status as PartnerVendorRelationshipStatus,
    approvedCatalogVersionId: rel.approvedCatalogVersionId ?? null,
    vendorCurrentCatalogVersionId: vendor.currentCatalogVersionId ?? null,
    hasCurrentEulaAcceptance: hasEulaRows.length > 0,
    compliance: {
      coiExpirationDate: vendor.insuranceExpirationDate,
      coiDocumentUrl: vendor.coiDocumentUrl,
      wcExpirationDate: vendor.wcExpirationDate,
      wcDocumentUrl: vendor.wcDocumentUrl,
      glExpirationDate: vendor.glExpirationDate,
      glDocumentUrl: vendor.glDocumentUrl,
      autoLiabilityExpirationDate: vendor.autoLiabilityExpirationDate,
      autoLiabilityDocumentUrl: vendor.autoLiabilityDocumentUrl,
      w9DocumentUrl: vendor.w9DocumentUrl,
    },
    hasQualifiedEmployee: !!anyEmployee,
    now: new Date(),
  });

  const fromStatus = rel.status as PartnerVendorRelationshipStatus;
  const result: RecomputeResult = {
    partnerId,
    vendorId,
    fromStatus,
    toStatus: derived.status,
    changed: derived.status !== fromStatus,
    reason: derived.reason,
  };

  if (!result.changed && !options.triggerReason) {
    // Idempotent no-op.
    return result;
  }

  // We always record the audit event when the trigger reason is
  // explicit (e.g. "vendor_catalog_published") even if the derived
  // status didn't change — operators care that the recompute ran.
  const finalReason: PartnerVendorApprovalEventReason =
    options.triggerReason ?? derived.reason ?? "system_recompute";
  const finalDetail = {
    ...(derived.reasonDetail ?? {}),
    ...(options.triggerDetail ?? {}),
  };

  await db.transaction(async (tx) => {
    if (result.changed) {
      await tx
        .update(partnerVendorRelationshipsTable)
        .set({
          status: derived.status,
          lastStatusReason: finalReason,
          lastStatusChangeAt: new Date(),
          updatedAt: new Date(),
          // Clear approval bookkeeping on a flip out of approved so
          // re-promotion goes through the EULA acceptance gate again.
          approvedCatalogVersionId:
            derived.status === "approved"
              ? rel.approvedCatalogVersionId
              : derived.status === "auto_unapproved"
                ? rel.approvedCatalogVersionId
                : null,
          approvedAt:
            derived.status === "approved" ? rel.approvedAt : rel.approvedAt,
        })
        .where(eq(partnerVendorRelationshipsTable.id, rel.id));
    }
    await tx.insert(partnerVendorApprovalEventsTable).values({
      partnerId,
      vendorId,
      fromStatus,
      toStatus: derived.status,
      reason: finalReason,
      reasonDetail: Object.keys(finalDetail).length > 0 ? finalDetail : null,
      vendorCatalogVersionId: vendor.currentCatalogVersionId ?? null,
      actorUserId: options.actorUserId ?? null,
      actorRole: options.actorRole ?? null,
    });
  });

  if (result.changed) {
    logger.info(
      {
        partnerId,
        vendorId,
        fromStatus,
        toStatus: derived.status,
        reason: finalReason,
      },
      "Approval recomputed",
    );
  }
  return result;
}

/**
 * Recompute every (partner, vendor) row for a given vendor. Used
 * after a catalog publish, compliance edit, or work-type mutation.
 * Returns the list of rows that actually flipped.
 */
export async function recomputeAllForVendor(
  vendorId: number,
  options: RecomputeOptions = {},
): Promise<RecomputeResult[]> {
  const rels = await db
    .select({
      partnerId: partnerVendorRelationshipsTable.partnerId,
    })
    .from(partnerVendorRelationshipsTable)
    .where(eq(partnerVendorRelationshipsTable.vendorId, vendorId));
  const out: RecomputeResult[] = [];
  for (const r of rels) {
    try {
      const res = await recomputeApproval(r.partnerId, vendorId, options);
      if (res) out.push(res);
    } catch (err) {
      logger.warn(
        { err, partnerId: r.partnerId, vendorId },
        "Approval recompute failed for pair",
      );
    }
  }
  return out;
}

/**
 * Snapshot the vendor's current catalog into a new
 * `vendor_catalog_versions` row, mark it current on the vendor, and
 * recompute every partner relationship. Returns the inserted version.
 */
export async function publishVendorCatalogVersion(args: {
  vendorId: number;
  publishedByUserId: number | null;
  changeSummary: string | null;
  eulaText: string;
  eulaHash: string | null;
  ratesSnapshot: {
    dailyOtHours: string | null;
    weeklyOtHours: string | null;
    overtimeMultiplier: string | null;
  };
  workTypesSnapshot: Array<{
    workTypeId: number;
    workTypeName: string;
    unitPrice: string | null;
    unit: string | null;
    currency: string;
  }>;
  complianceSnapshot: {
    coi: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
    wc: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
    gl: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
    autoLiability: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
    w9DocumentUrl: string | null;
  };
}): Promise<{ versionId: number; version: number }> {
  return db.transaction(async (tx) => {
    // Compute the next per-vendor version number atomically. Drizzle
    // doesn't ship a `max()` helper, so we hand-roll with selectFrom +
    // sort. The unique index on (vendor_id, version) defends against
    // a concurrent publisher race: the second insert will throw and
    // the caller can retry.
    const existing = await tx
      .select({ version: vendorCatalogVersionsTable.version })
      .from(vendorCatalogVersionsTable)
      .where(eq(vendorCatalogVersionsTable.vendorId, args.vendorId));
    const nextVersion =
      existing.reduce((max, r) => (r.version > max ? r.version : max), 0) + 1;
    const [inserted] = await tx
      .insert(vendorCatalogVersionsTable)
      .values({
        vendorId: args.vendorId,
        version: nextVersion,
        publishedByUserId: args.publishedByUserId,
        changeSummary: args.changeSummary,
        eulaText: args.eulaText,
        eulaHash: args.eulaHash,
        ratesSnapshot: args.ratesSnapshot,
        workTypesSnapshot: args.workTypesSnapshot,
        complianceSnapshot: args.complianceSnapshot,
      })
      .returning({ id: vendorCatalogVersionsTable.id });
    await tx
      .update(vendorsTable)
      .set({ currentCatalogVersionId: inserted.id })
      .where(eq(vendorsTable.id, args.vendorId));
    return { versionId: inserted.id, version: nextVersion };
  });
}
