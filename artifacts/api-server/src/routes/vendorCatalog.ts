// Task #1156 — endpoints that produce + read vendor catalog versions.
//
// A "catalog publish" is the act that turns the vendor's currently-
// edited rates / work-types / compliance docs into an immutable
// snapshot every approved partner is bound to. After publish:
//
//   - vendors.current_catalog_version_id points at the new row
//   - every partner_vendor_relationships row for this vendor is
//     re-derived (recomputeAllForVendor), which typically flips
//     `approved` → `auto_unapproved` for everyone who was on the
//     previous version (catalog-publish detector in deriveStatus).
//   - we send a per-partner notification (handled in the
//     notifications layer) so partner admins can re-approve.
//
// EULA text required on every publish. We do NOT mutate the EULA
// behind the partner's back — they always re-accept the verbatim text
// they're being held to.

import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  vendorsTable,
  vendorWorkTypesTable,
  vendorCatalogVersionsTable,
  workTypesTable,
  userOrgMembershipsTable,
} from "@workspace/db";
import {
  getSessionFromRequest,
  type SessionPayload,
} from "../lib/session";
import { logger } from "../lib/logger";
import {
  publishVendorCatalogVersion,
  recomputeAllForVendor,
} from "../lib/approval-derivation";
import { sha256Hex } from "../lib/hash";

const router: IRouter = Router();

async function requireVendorAdmin(
  req: Request,
  vendorId: number,
): Promise<
  | { ok: true; session: SessionPayload; isSystemAdmin: boolean }
  | { ok: false; status: number; body: { error: string; code: string } }
> {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    return {
      ok: false,
      status: 401,
      body: { error: "Authentication required", code: "auth.required" },
    };
  }
  if (session.role === "admin") {
    return { ok: true, session, isSystemAdmin: true };
  }
  const [m] = await db
    .select({ role: userOrgMembershipsTable.role })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, vendorId),
      ),
    )
    .limit(1);
  if (m && m.role === "admin") return { ok: true, session, isSystemAdmin: false };
  return {
    ok: false,
    status: 403,
    body: {
      error: "Vendor admin access required",
      code: "auth.vendor_admin_required",
    },
  };
}

// Compute how many partner relationships will be flipped to
// `auto_unapproved` if the vendor publishes a new catalog version.
// Surfaced in the publish-confirm dialog as a friction warning.
router.get(
  "/vendors/:vendorId/catalog/publish-impact",
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      res.status(400).json({ error: "Invalid vendor id" });
      return;
    }
    const auth = await requireVendorAdmin(req, vendorId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    // This is best-effort: we don't simulate a full deriveStatus run
    // here; we just count the rows currently sitting at "approved" or
    // "pending_review" on this vendor. Either way they will need to
    // re-accept the new EULA.
    const result = await db.execute<{
      approved_count: string;
      pending_count: string;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
        COUNT(*) FILTER (WHERE status = 'pending_review') AS pending_count
      FROM partner_vendor_relationships
      WHERE vendor_id = ${vendorId}
    `);
    const r = result.rows?.[0];
    const approvedCount = Number(r?.approved_count ?? 0);
    const pendingCount = Number(r?.pending_count ?? 0);

    // Mirror the server-side hard-gate in POST /catalog/publish so the
    // UI can show a friendly "compliance details required" banner
    // instead of waiting for the server to 409 on submit.
    const [vendor] = await db
      .select({
        federalTaxId: vendorsTable.federalTaxId,
        coiDocumentUrl: vendorsTable.coiDocumentUrl,
        insuranceExpirationDate: vendorsTable.insuranceExpirationDate,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    const missingCompliance: string[] = [];
    if (vendor) {
      if (!vendor.federalTaxId) missingCompliance.push("federalTaxId");
      if (!vendor.coiDocumentUrl) missingCompliance.push("coiDocumentUrl");
      if (!vendor.insuranceExpirationDate)
        missingCompliance.push("insuranceExpirationDate");
    }

    res.json({
      vendorId,
      approvedCount,
      pendingCount,
      willAutoUnapprove: approvedCount,
      willStayPending: pendingCount,
      missingCompliance,
    });
  },
);

// Get the current catalog version for a vendor (the snapshot that
// approved partners are bound to). Used by the partner-side diff
// modal to render "what's currently in force" alongside the new
// proposed version. Read-allowed for any signed-in user.
router.get(
  "/vendors/:vendorId/catalog/current",
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      res.status(400).json({ error: "Invalid vendor id" });
      return;
    }
    const session = getSessionFromRequest(req);
    if (!session) {
      res
        .status(401)
        .json({ error: "Authentication required", code: "auth.required" });
      return;
    }
    const [vendor] = await db
      .select({
        id: vendorsTable.id,
        currentCatalogVersionId: vendorsTable.currentCatalogVersionId,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    if (!vendor.currentCatalogVersionId) {
      res.json({ version: null });
      return;
    }
    const [v] = await db
      .select()
      .from(vendorCatalogVersionsTable)
      .where(eq(vendorCatalogVersionsTable.id, vendor.currentCatalogVersionId))
      .limit(1);
    res.json({ version: v ?? null });
  },
);

// Read a specific historical catalog version (used by the partner-side
// diff to render "this is what you previously approved").
router.get(
  "/vendor-catalog-versions/:versionId",
  async (req, res): Promise<void> => {
    const versionId = parseInt(String(req.params.versionId), 10);
    if (isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version id" });
      return;
    }
    const session = getSessionFromRequest(req);
    if (!session) {
      res
        .status(401)
        .json({ error: "Authentication required", code: "auth.required" });
      return;
    }
    const [v] = await db
      .select()
      .from(vendorCatalogVersionsTable)
      .where(eq(vendorCatalogVersionsTable.id, versionId))
      .limit(1);
    if (!v) {
      res.status(404).json({ error: "Catalog version not found" });
      return;
    }
    res.json(v);
  },
);

// Publish a new catalog version. Snapshots the vendor's current
// pricing + work-types + compliance state into an immutable row, marks
// the new row as current on the vendor, recomputes every partner
// relationship, and stamps the catalog-authority attestation
// timestamp on the vendor.
//
// Refuses to publish when:
//   - any of insurance/W-9 attestation fields are missing
//   - the vendor admin hasn't supplied an EULA text body
//   - the vendor has zero work-type rows (catalog would be empty)
router.post(
  "/vendors/:vendorId/catalog/publish",
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      res.status(400).json({ error: "Invalid vendor id" });
      return;
    }
    const auth = await requireVendorAdmin(req, vendorId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const body = req.body as {
      eulaText?: string;
      changeSummary?: string | null;
      attestAuthority?: boolean;
    };
    const eulaText =
      typeof body?.eulaText === "string" ? body.eulaText.trim() : "";
    if (eulaText.length === 0) {
      res.status(400).json({
        error: "eulaText is required",
        code: "vendor_catalog.eula_required",
      });
      return;
    }
    if (body?.attestAuthority !== true) {
      res.status(400).json({
        error:
          "Vendor admin must attest authority to publish (set attestAuthority=true)",
        code: "vendor_catalog.attestation_required",
      });
      return;
    }

    const [vendor] = await db
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    // Refuse to publish without the minimum compliance + tax-id
    // declaration. Vendor admins should never reach this branch in the
    // happy-path UI — the publish button is disabled — but the server
    // must enforce regardless.
    const missing: string[] = [];
    if (!vendor.federalTaxId) missing.push("federalTaxId");
    if (!vendor.coiDocumentUrl) missing.push("coiDocumentUrl");
    if (!vendor.insuranceExpirationDate) missing.push("insuranceExpirationDate");
    if (missing.length > 0) {
      res.status(409).json({
        error: "Required compliance fields are missing",
        code: "vendor_catalog.compliance_incomplete",
        missing,
      });
      return;
    }

    const workTypes = await db
      .select({
        workTypeId: vendorWorkTypesTable.workTypeId,
        workTypeName: workTypesTable.name,
        unitPrice: vendorWorkTypesTable.unitPrice,
        unit: vendorWorkTypesTable.unit,
        currency: vendorWorkTypesTable.currency,
      })
      .from(vendorWorkTypesTable)
      .innerJoin(
        workTypesTable,
        eq(workTypesTable.id, vendorWorkTypesTable.workTypeId),
      )
      .where(eq(vendorWorkTypesTable.vendorId, vendorId))
      .orderBy(asc(workTypesTable.name));
    if (workTypes.length === 0) {
      res.status(409).json({
        error:
          "Vendor has no work types selected — add at least one before publishing",
        code: "vendor_catalog.empty_catalog",
      });
      return;
    }

    const eulaHash = sha256Hex(eulaText);
    let publishResult: { versionId: number; version: number };
    try {
      publishResult = await publishVendorCatalogVersion({
        vendorId,
        publishedByUserId: auth.session.userId ?? null,
        changeSummary:
          typeof body?.changeSummary === "string"
            ? body.changeSummary.trim() || null
            : null,
        eulaText,
        eulaHash,
        ratesSnapshot: {
          dailyOtHours: vendor.dailyOtHours,
          weeklyOtHours: vendor.weeklyOtHours,
          overtimeMultiplier: vendor.overtimeMultiplier,
        },
        workTypesSnapshot: workTypes.map((w) => ({
          workTypeId: w.workTypeId,
          workTypeName: w.workTypeName,
          unitPrice: w.unitPrice,
          unit: w.unit,
          currency: w.currency,
        })),
        complianceSnapshot: {
          coi: {
            carrier: vendor.insuranceCarrier,
            policyNumber: vendor.insurancePolicyNumber,
            expirationDate: vendor.insuranceExpirationDate,
            documentUrl: vendor.coiDocumentUrl,
          },
          wc: {
            carrier: vendor.wcCarrier,
            policyNumber: vendor.wcPolicyNumber,
            expirationDate: vendor.wcExpirationDate,
            documentUrl: vendor.wcDocumentUrl,
          },
          gl: {
            carrier: vendor.glCarrier,
            policyNumber: vendor.glPolicyNumber,
            expirationDate: vendor.glExpirationDate,
            documentUrl: vendor.glDocumentUrl,
          },
          autoLiability: {
            carrier: vendor.autoLiabilityCarrier,
            policyNumber: vendor.autoLiabilityPolicyNumber,
            expirationDate: vendor.autoLiabilityExpirationDate,
            documentUrl: vendor.autoLiabilityDocumentUrl,
          },
          w9DocumentUrl: vendor.w9DocumentUrl,
        },
      });
    } catch (err) {
      logger.error({ err, vendorId }, "publishVendorCatalogVersion failed");
      res.status(500).json({
        error: "Failed to publish vendor catalog",
        code: "vendor_catalog.publish_failed",
      });
      return;
    }

    // Stamp the authority attestation on the vendor + ack each
    // work-type's pricing.
    await db
      .update(vendorsTable)
      .set({
        catalogAuthorityAttestedAt: new Date(),
        catalogAuthorityAttestedByUserId: auth.session.userId ?? null,
      })
      .where(eq(vendorsTable.id, vendorId));
    await db
      .update(vendorWorkTypesTable)
      .set({ priceAuthorityAcknowledgedAt: new Date() })
      .where(eq(vendorWorkTypesTable.vendorId, vendorId));

    // Re-derive every partner relationship — most "approved" rels
    // will flip to "auto_unapproved" because their EULA acceptance
    // points at the previous catalog version.
    const recomputeResults = await recomputeAllForVendor(vendorId, {
      triggerReason: "vendor_catalog_published",
      triggerDetail: {
        newVersionId: publishResult.versionId,
        newVersion: publishResult.version,
      },
      actorUserId: auth.session.userId ?? null,
      actorRole: auth.isSystemAdmin ? "system_admin" : "vendor_admin",
    });

    // Best-effort notification fanout. Don't block the response on
    // SendGrid latency; queue a microtask so the publish endpoint
    // returns quickly and the digest goes out asynchronously.
    void (async () => {
      try {
        const { sendVendorCatalogPublishedDigest } = await import(
          "../lib/vendor-catalog-notifications"
        );
        await sendVendorCatalogPublishedDigest({
          vendorId,
          newVersionId: publishResult.versionId,
          newVersion: publishResult.version,
          flippedPartners: recomputeResults
            .filter((r) => r.toStatus === "auto_unapproved")
            .map((r) => r.partnerId),
        });
      } catch (err) {
        logger.warn(
          { err, vendorId },
          "vendor catalog published digest failed",
        );
      }
    })();

    res.json({
      vendorId,
      versionId: publishResult.versionId,
      version: publishResult.version,
      flippedPartners: recomputeResults
        .filter((r) => r.toStatus === "auto_unapproved")
        .map((r) => r.partnerId),
      recomputeResults,
    });
  },
);

export default router;
