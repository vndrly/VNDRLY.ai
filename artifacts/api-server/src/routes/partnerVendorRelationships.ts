import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  partnersTable,
  vendorsTable,
  usersTable,
  userOrgMembershipsTable,
  partnerVendorRelationshipsTable,
  partnerVendorApprovalEventsTable,
  partnerEulaAcceptancesTable,
  vendorCatalogVersionsTable,
  PARTNER_VENDOR_RELATIONSHIP_STATUSES,
  type PartnerVendorRelationshipStatus,
} from "@workspace/db";
import {
  getSessionFromRequest,
  type SessionPayload,
} from "../lib/session";
import { logger } from "../lib/logger";
import { recomputeApproval } from "../lib/approval-derivation";
import { sha256Hex } from "../lib/hash";
import { resolveEulaDisplayText } from "@workspace/platform-eula";
import { sendApiError } from "../lib/apiError";

const router: IRouter = Router();

function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = getSessionFromRequest(req);
  if (!session) {
    res
      .status(401)
      .json({ error: "Authentication required", code: "auth.required" });
    return;
  }
  next();
}

// Mirror of orgMembers.requireOrgAdmin, scoped to a partner. System
// admins always pass; otherwise the caller must hold a partner-admin
// membership in the targeted partner org.
async function requirePartnerAdmin(
  req: Request,
  partnerId: number,
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
  const [active] = await db
    .select({ role: userOrgMembershipsTable.role })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, "partner"),
        eq(userOrgMembershipsTable.partnerId, partnerId),
      ),
    )
    .limit(1);
  if (active && active.role === "admin") {
    return { ok: true, session, isSystemAdmin: false };
  }
  return {
    ok: false,
    status: 403,
    body: {
      error: "Partner admin access required",
      code: "auth.partner_admin_required",
    },
  };
}

// Read-side authz helper: any member of the partner org can read its
// vendor-relationship list (for transparency to the whole partner team),
// but non-members are denied. System admins always pass.
async function requirePartnerMembership(
  req: Request,
  partnerId: number,
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
  const [member] = await db
    .select({ id: userOrgMembershipsTable.id })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, "partner"),
        eq(userOrgMembershipsTable.partnerId, partnerId),
      ),
    )
    .limit(1);
  if (member) return { ok: true, session, isSystemAdmin: false };
  return {
    ok: false,
    status: 403,
    body: {
      error: "Partner membership required",
      code: "auth.partner_member_required",
    },
  };
}

// List every vendor the given partner has a relationship with. Used by
// the partner-detail "Vendor Approvals" card. Restricted to members of
// the partner org so we don't leak (partner ↔ vendor, notes) tuples
// to arbitrary signed-in users from other orgs.
router.get(
  "/partners/:partnerId/vendor-relationships",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    if (isNaN(partnerId)) {
      sendApiError(res, 400, "partner.invalid_id", "Invalid partner id");
      return;
    }
    const auth = await requirePartnerMembership(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const [partner] = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.id, partnerId))
      .limit(1);
    if (!partner) {
      sendApiError(res, 404, "partner.not_found", "Partner not found");
      return;
    }

    const rows = await db
      .select({
        vendorId: partnerVendorRelationshipsTable.vendorId,
        vendorName: vendorsTable.name,
        status: partnerVendorRelationshipsTable.status,
        notes: partnerVendorRelationshipsTable.notes,
        ratedAt: partnerVendorRelationshipsTable.ratedAt,
        approvedAt: partnerVendorRelationshipsTable.approvedAt,
        approvedByUserId: partnerVendorRelationshipsTable.approvedByUserId,
        approvedByUsername: usersTable.username,
        approvedCatalogVersionId:
          partnerVendorRelationshipsTable.approvedCatalogVersionId,
        // Vendor's currently-published version (so the UI can flag
        // "version drift" without a second round-trip).
        currentCatalogVersionId: vendorsTable.currentCatalogVersionId,
        lastStatusReason: partnerVendorRelationshipsTable.lastStatusReason,
        lastStatusChangeAt:
          partnerVendorRelationshipsTable.lastStatusChangeAt,
        createdAt: partnerVendorRelationshipsTable.createdAt,
        updatedAt: partnerVendorRelationshipsTable.updatedAt,
      })
      .from(partnerVendorRelationshipsTable)
      .innerJoin(
        vendorsTable,
        eq(vendorsTable.id, partnerVendorRelationshipsTable.vendorId),
      )
      .leftJoin(
        usersTable,
        eq(usersTable.id, partnerVendorRelationshipsTable.approvedByUserId),
      )
      .where(eq(partnerVendorRelationshipsTable.partnerId, partnerId))
      .orderBy(asc(vendorsTable.name));

    res.json({ partnerId, items: rows });
  },
);

// List every partner the given vendor has a relationship with. Used by
// the vendor-detail "Partner Approvals" card so a vendor can see who
// has rated and/or approved them. Restricted to the vendor themselves
// or a system admin to prevent cross-tenant enumeration of approval
// relationships.
router.get(
  "/vendors/:vendorId/partner-relationships",
  requireSession,
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      sendApiError(res, 400, "vendor.invalid_id", "Invalid vendor id");
      return;
    }
    const session = getSessionFromRequest(req)!;
    if (
      session.role !== "admin" &&
      !(session.role === "vendor" && session.vendorId === vendorId)
    ) {
      sendApiError(res, 403, "auth.forbidden", "Forbidden");
      return;
    }
    const [vendor] = await db
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (!vendor) {
      sendApiError(res, 404, "vendor.not_found", "Vendor not found");
      return;
    }

    const rows = await db
      .select({
        partnerId: partnerVendorRelationshipsTable.partnerId,
        partnerName: partnersTable.name,
        status: partnerVendorRelationshipsTable.status,
        notes: partnerVendorRelationshipsTable.notes,
        ratedAt: partnerVendorRelationshipsTable.ratedAt,
        approvedAt: partnerVendorRelationshipsTable.approvedAt,
        approvedByUserId: partnerVendorRelationshipsTable.approvedByUserId,
        approvedByUsername: usersTable.username,
        approvedCatalogVersionId:
          partnerVendorRelationshipsTable.approvedCatalogVersionId,
        lastStatusReason: partnerVendorRelationshipsTable.lastStatusReason,
        lastStatusChangeAt:
          partnerVendorRelationshipsTable.lastStatusChangeAt,
        createdAt: partnerVendorRelationshipsTable.createdAt,
        updatedAt: partnerVendorRelationshipsTable.updatedAt,
      })
      .from(partnerVendorRelationshipsTable)
      .innerJoin(
        partnersTable,
        eq(partnersTable.id, partnerVendorRelationshipsTable.partnerId),
      )
      .leftJoin(
        usersTable,
        eq(usersTable.id, partnerVendorRelationshipsTable.approvedByUserId),
      )
      .where(eq(partnerVendorRelationshipsTable.vendorId, vendorId))
      .orderBy(asc(partnersTable.name));

    res.json({ vendorId, items: rows });
  },
);

// Return the most-recent approval-event log entries for a (partner,
// vendor) pair. Used by the partner-side approvals card to render the
// "what changed?" history below each row. Capped at 25 entries —
// older history can be hand-queried from the audit table when needed.
router.get(
  "/partners/:partnerId/vendor-relationships/:vendorId/events",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(partnerId) || isNaN(vendorId)) {
      res.status(400).json({ error: "Invalid partner or vendor id" });
      return;
    }
    const auth = await requirePartnerMembership(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const rows = await db
      .select({
        id: partnerVendorApprovalEventsTable.id,
        fromStatus: partnerVendorApprovalEventsTable.fromStatus,
        toStatus: partnerVendorApprovalEventsTable.toStatus,
        reason: partnerVendorApprovalEventsTable.reason,
        reasonDetail: partnerVendorApprovalEventsTable.reasonDetail,
        vendorCatalogVersionId:
          partnerVendorApprovalEventsTable.vendorCatalogVersionId,
        actorUserId: partnerVendorApprovalEventsTable.actorUserId,
        actorRole: partnerVendorApprovalEventsTable.actorRole,
        createdAt: partnerVendorApprovalEventsTable.createdAt,
      })
      .from(partnerVendorApprovalEventsTable)
      .where(
        and(
          eq(partnerVendorApprovalEventsTable.partnerId, partnerId),
          eq(partnerVendorApprovalEventsTable.vendorId, vendorId),
        ),
      )
      .orderBy(desc(partnerVendorApprovalEventsTable.createdAt))
      .limit(25);
    res.json({ items: rows });
  },
);

// Promote, downgrade, or revoke a (partner, vendor) relationship. The
// allowed targets are:
//
//   approved        — promotes from pending_review/auto_unapproved.
//                     REQUIRES the partner to have already accepted
//                     the EULA bound to the vendor's current catalog
//                     version (see POST .../accept-eula below). Stamps
//                     `approvedCatalogVersionId` so the
//                     approval-derivation engine can later detect a
//                     drift from the current vendor catalog version
//                     and auto-flip to `auto_unapproved`.
//   pending_review  — partner-admin-initiated reset to "I want to
//                     re-engage with this vendor" without revoking.
//   revoked         — partner pulls approval. Sticky: a revoked rel
//                     stays revoked through compliance / catalog
//                     changes until the partner explicitly resets.
//
// Idempotent: a no-change re-PUT returns the current row.
router.put(
  "/partners/:partnerId/vendor-relationships/:vendorId",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(partnerId) || isNaN(vendorId)) {
      sendApiError(res, 400, "validation.invalid_id", "Invalid partner or vendor id");
      return;
    }
    const auth = await requirePartnerAdmin(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }

    const body = req.body as { status?: string; notes?: string | null };
    const targetStatus = (body?.status ?? "").toString();
    const allowedTargets: PartnerVendorRelationshipStatus[] = [
      "approved",
      "pending_review",
      "revoked",
    ];
    if (
      !allowedTargets.includes(
        targetStatus as PartnerVendorRelationshipStatus,
      )
    ) {
      sendApiError(
        res,
        400,
        "approvals.invalid_target_status",
        `Target status must be one of ${allowedTargets.join(", ")}`,
      );
      return;
    }
    const notes =
      typeof body?.notes === "string" ? body.notes.trim() || null : null;

    const [existing] = await db
      .select()
      .from(partnerVendorRelationshipsTable)
      .where(
        and(
          eq(partnerVendorRelationshipsTable.partnerId, partnerId),
          eq(partnerVendorRelationshipsTable.vendorId, vendorId),
        ),
      )
      .limit(1);

    if (!existing) {
      sendApiError(
        res,
        409,
        "approvals.no_relationship",
        "Vendor must already have a relationship row before approval transitions",
      );
      return;
    }

    if (targetStatus === "approved") {
      // EULA gate: the partner must have signed the EULA bound to the
      // vendor's *current* catalog version. We refuse to promote until
      // that's on file — the partner UI shows the gating modal first
      // and only then PUTs status=approved.
      const [vendor] = await db
        .select({
          currentCatalogVersionId: vendorsTable.currentCatalogVersionId,
        })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vendorId))
        .limit(1);
      if (!vendor?.currentCatalogVersionId) {
        res.status(409).json({
          error:
            "Vendor has not published a catalog version yet — they must publish before partners can approve",
          code: "approvals.vendor_no_catalog",
        });
        return;
      }
      const [accept] = await db
        .select({ id: partnerEulaAcceptancesTable.id })
        .from(partnerEulaAcceptancesTable)
        .where(
          and(
            eq(partnerEulaAcceptancesTable.partnerId, partnerId),
            eq(partnerEulaAcceptancesTable.vendorId, vendorId),
            eq(
              partnerEulaAcceptancesTable.vendorCatalogVersionId,
              vendor.currentCatalogVersionId,
            ),
          ),
        )
        .limit(1);
      if (!accept) {
        res.status(409).json({
          error: "Partner must accept the vendor EULA before approving",
          code: "approvals.eula_not_accepted",
        });
        return;
      }
      const previousStatus = existing.status;
      const [row] = await db
        .update(partnerVendorRelationshipsTable)
        .set({
          status: "approved",
          notes: notes ?? existing.notes,
          approvedAt: existing.approvedAt ?? new Date(),
          approvedByUserId: auth.session.userId ?? existing.approvedByUserId,
          approvedCatalogVersionId: vendor.currentCatalogVersionId,
          lastStatusReason: "manual_approve",
          lastStatusChangeAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(partnerVendorRelationshipsTable.id, existing.id))
        .returning();
      await db.insert(partnerVendorApprovalEventsTable).values({
        partnerId,
        vendorId,
        fromStatus: previousStatus,
        toStatus: "approved",
        reason: "manual_approve",
        reasonDetail: { notes: notes ?? null },
        vendorCatalogVersionId: vendor.currentCatalogVersionId,
        actorUserId: auth.session.userId ?? null,
        actorRole: auth.isSystemAdmin ? "system_admin" : "partner_admin",
      });
      res.json(row);
      return;
    }

    if (targetStatus === "revoked") {
      const previousStatus = existing.status;
      const [row] = await db
        .update(partnerVendorRelationshipsTable)
        .set({
          status: "revoked",
          notes: notes ?? existing.notes,
          approvedCatalogVersionId: null,
          lastStatusReason: "manual_revoke",
          lastStatusChangeAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(partnerVendorRelationshipsTable.id, existing.id))
        .returning();
      await db.insert(partnerVendorApprovalEventsTable).values({
        partnerId,
        vendorId,
        fromStatus: previousStatus,
        toStatus: "revoked",
        reason: "manual_revoke",
        reasonDetail: { notes: notes ?? null },
        actorUserId: auth.session.userId ?? null,
        actorRole: auth.isSystemAdmin ? "system_admin" : "partner_admin",
      });
      res.json(row);
      return;
    }

    // pending_review: explicit re-engagement reset, used when a
    // partner wants to re-evaluate a `revoked` relationship.
    const previousStatus = existing.status;
    const [row] = await db
      .update(partnerVendorRelationshipsTable)
      .set({
        status: "pending_review",
        notes: notes ?? existing.notes,
        lastStatusReason: "manual_pending_review",
        lastStatusChangeAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(partnerVendorRelationshipsTable.id, existing.id))
      .returning();
    await db.insert(partnerVendorApprovalEventsTable).values({
      partnerId,
      vendorId,
      fromStatus: previousStatus,
      toStatus: "pending_review",
      reason: "manual_pending_review",
      reasonDetail: { notes: notes ?? null },
      actorUserId: auth.session.userId ?? null,
      actorRole: auth.isSystemAdmin ? "system_admin" : "partner_admin",
    });
    res.json(row);
  },
);

// Partner-side EULA acceptance. Records the partner-admin's signing
// of the vendor's currently-published catalog EULA. After this
// succeeds the caller may PUT status=approved to finish the flow. The
// two-step shape (accept, then promote) is intentional: it gives the
// UI a place to surface "you have signed but not yet approved" for
// review/audit and lets multiple partner-side users sign before a
// partner admin clicks the final Approve.
router.post(
  "/partners/:partnerId/vendor-relationships/:vendorId/accept-eula",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(partnerId) || isNaN(vendorId)) {
      res.status(400).json({ error: "Invalid partner or vendor id" });
      return;
    }
    const auth = await requirePartnerAdmin(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const [vendor] = await db
      .select({
        currentCatalogVersionId: vendorsTable.currentCatalogVersionId,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (!vendor?.currentCatalogVersionId) {
      res.status(409).json({
        error: "Vendor has not published a catalog version yet",
        code: "approvals.vendor_no_catalog",
      });
      return;
    }
    const [version] = await db
      .select({
        id: vendorCatalogVersionsTable.id,
        eulaText: vendorCatalogVersionsTable.eulaText,
        eulaHash: vendorCatalogVersionsTable.eulaHash,
      })
      .from(vendorCatalogVersionsTable)
      .where(eq(vendorCatalogVersionsTable.id, vendor.currentCatalogVersionId))
      .limit(1);
    if (!version) {
      res.status(409).json({
        error: "Current vendor catalog version not found",
        code: "approvals.vendor_no_catalog",
      });
      return;
    }
    const acceptedHash =
      version.eulaHash ?? sha256Hex(resolveEulaDisplayText(version.eulaText));
    await db.insert(partnerEulaAcceptancesTable).values({
      partnerId,
      vendorId,
      vendorCatalogVersionId: version.id,
      acceptedByUserId: auth.session.userId!,
      acceptedEulaHash: acceptedHash,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    await db.insert(partnerVendorApprovalEventsTable).values({
      partnerId,
      vendorId,
      fromStatus: null,
      toStatus: "pending_review",
      reason: "partner_eula_accepted",
      reasonDetail: { vendorCatalogVersionId: version.id },
      vendorCatalogVersionId: version.id,
      actorUserId: auth.session.userId ?? null,
      actorRole: auth.isSystemAdmin ? "system_admin" : "partner_admin",
    });
    res.json({
      ok: true,
      vendorCatalogVersionId: version.id,
    });
  },
);

// Bulk re-approve action — partner admin walks down a list of
// auto_unapproved rows that all need a fresh EULA accept + approve on
// the same vendor. The backend loops the per-row accept+promote so the
// caller doesn't pay round-trip latency on each row. EULA must already
// be on file for each (partner, vendor) — this endpoint does NOT
// auto-accept; call /accept-eula first.
router.post(
  "/partners/:partnerId/vendor-relationships/bulk-approve",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    if (isNaN(partnerId)) {
      res.status(400).json({ error: "Invalid partner id" });
      return;
    }
    const auth = await requirePartnerAdmin(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const body = req.body as { vendorIds?: number[] };
    const vendorIds = Array.isArray(body?.vendorIds)
      ? body.vendorIds
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (vendorIds.length === 0) {
      res
        .status(400)
        .json({ error: "vendorIds must be a non-empty array of integers" });
      return;
    }
    const results: Array<{
      vendorId: number;
      ok: boolean;
      reason?: string;
    }> = [];
    for (const vendorId of vendorIds) {
      try {
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
        if (!rel) {
          results.push({ vendorId, ok: false, reason: "no_relationship" });
          continue;
        }
        const [vendor] = await db
          .select({
            currentCatalogVersionId: vendorsTable.currentCatalogVersionId,
          })
          .from(vendorsTable)
          .where(eq(vendorsTable.id, vendorId))
          .limit(1);
        if (!vendor?.currentCatalogVersionId) {
          results.push({ vendorId, ok: false, reason: "vendor_no_catalog" });
          continue;
        }
        const [accept] = await db
          .select({ id: partnerEulaAcceptancesTable.id })
          .from(partnerEulaAcceptancesTable)
          .where(
            and(
              eq(partnerEulaAcceptancesTable.partnerId, partnerId),
              eq(partnerEulaAcceptancesTable.vendorId, vendorId),
              eq(
                partnerEulaAcceptancesTable.vendorCatalogVersionId,
                vendor.currentCatalogVersionId,
              ),
            ),
          )
          .limit(1);
        if (!accept) {
          results.push({ vendorId, ok: false, reason: "eula_not_accepted" });
          continue;
        }
        await db
          .update(partnerVendorRelationshipsTable)
          .set({
            status: "approved",
            approvedAt: rel.approvedAt ?? new Date(),
            approvedByUserId:
              auth.session.userId ?? rel.approvedByUserId ?? null,
            approvedCatalogVersionId: vendor.currentCatalogVersionId,
            lastStatusReason: "manual_approve",
            lastStatusChangeAt: new Date(),
            updatedAt: sql`now()`,
          })
          .where(eq(partnerVendorRelationshipsTable.id, rel.id));
        await db.insert(partnerVendorApprovalEventsTable).values({
          partnerId,
          vendorId,
          fromStatus: rel.status,
          toStatus: "approved",
          reason: "manual_approve",
          reasonDetail: { bulk: true },
          vendorCatalogVersionId: vendor.currentCatalogVersionId,
          actorUserId: auth.session.userId ?? null,
          actorRole: auth.isSystemAdmin ? "system_admin" : "partner_admin",
        });
        results.push({ vendorId, ok: true });
      } catch (err) {
        logger.warn(
          { err, partnerId, vendorId },
          "Bulk approve failed for pair",
        );
        results.push({ vendorId, ok: false, reason: "internal_error" });
      }
    }
    res.json({ results });
  },
);

// Re-derive a single (partner, vendor) status. Used by the partner UI
// after viewing a stale row, and by support tooling to manually
// trigger a recompute. Returns the recompute result.
router.post(
  "/partners/:partnerId/vendor-relationships/:vendorId/recompute",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(partnerId) || isNaN(vendorId)) {
      res.status(400).json({ error: "Invalid partner or vendor id" });
      return;
    }
    const auth = await requirePartnerMembership(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const result = await recomputeApproval(partnerId, vendorId, {
      triggerReason: "system_recompute",
      actorUserId: auth.session.userId ?? null,
      actorRole: auth.isSystemAdmin ? "system_admin" : "partner_member",
    });
    res.json(result ?? { changed: false });
  },
);

export const PARTNER_VENDOR_RELATIONSHIP_TARGET_STATUSES =
  PARTNER_VENDOR_RELATIONSHIP_STATUSES;
export default router;
