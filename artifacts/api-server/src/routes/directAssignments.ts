import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  directAssignmentsTable,
  partnersTable,
  siteLocationsTable,
  vendorsTable,
} from "@workspace/db";
import {
  CreateSiteDirectAssignmentBody,
  PassDirectAssignmentBody,
  ListDirectAssignmentsQueryParams,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { findPartnerUserIds, findVendorUserIds, notifyUsers } from "./notifications";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Direct (Partner→Vendor) Work Assignments
//
// A lightweight, time-bound work offer flow that lives alongside the
// static `site_work_assignments` (work-type/AFE catalog) and the full
// ticket workflow:
//
//   partner picks vendor + start/end + scope  ──▶  pending
//                                                  ├─▶ vendor commits  ──▶ committed   (partner notified)
//                                                  ├─▶ vendor passes   ──▶ passed      (partner notified to re-assign)
//                                                  └─▶ partner cancels ──▶ cancelled   (vendor notified)
//
// All transitions out of `pending` go through this router so a single
// place owns the response/notification fan-out. We reuse `notifyUsers`
// for in-app + push + branded email (it already gates on per-user opt-ins
// via `TYPE_TO_CATEGORY`), so this file does not call SendGrid directly.
// ─────────────────────────────────────────────────────────────────────────────

const SiteIdParam = z.object({ siteId: z.coerce.number().int().positive() });
const IdParam = z.object({ id: z.coerce.number().int().positive() });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Validate that the request body's start/end dates are real ISO dates and
 * that start ≤ end. Codegen tags the columns as plain strings, so we
 * enforce the date shape here instead of relying on the schema.
 */
function validateDateRange(startDate: string, endDate: string): string | null {
  const sd = IsoDate.safeParse(startDate);
  const ed = IsoDate.safeParse(endDate);
  if (!sd.success) return "startDate must be YYYY-MM-DD";
  if (!ed.success) return "endDate must be YYYY-MM-DD";
  if (startDate > endDate) return "startDate must be on or before endDate";
  return null;
}

/**
 * SELECT projection that hydrates the `DirectAssignment` schema (the
 * generated zod type — joined siteName/partnerName/vendorName included).
 * Centralised so list, create, and respond endpoints all return the
 * same shape without having to repeat the joins.
 */
function selectDirectAssignment() {
  return db
    .select({
      id: directAssignmentsTable.id,
      partnerId: directAssignmentsTable.partnerId,
      siteLocationId: directAssignmentsTable.siteLocationId,
      vendorId: directAssignmentsTable.vendorId,
      siteName: siteLocationsTable.name,
      partnerName: partnersTable.name,
      vendorName: vendorsTable.name,
      scopeOfWork: directAssignmentsTable.scopeOfWork,
      startDate: directAssignmentsTable.startDate,
      endDate: directAssignmentsTable.endDate,
      status: directAssignmentsTable.status,
      passReason: directAssignmentsTable.passReason,
      respondedAt: directAssignmentsTable.respondedAt,
      createdAt: directAssignmentsTable.createdAt,
      updatedAt: directAssignmentsTable.updatedAt,
    })
    .from(directAssignmentsTable)
    .innerJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, directAssignmentsTable.siteLocationId),
    )
    .innerJoin(
      partnersTable,
      eq(partnersTable.id, directAssignmentsTable.partnerId),
    )
    .innerJoin(
      vendorsTable,
      eq(vendorsTable.id, directAssignmentsTable.vendorId),
    );
}

/** Marshal a SELECT row into the generated `DirectAssignment` shape. */
function toResponseRow(row: {
  id: number;
  partnerId: number;
  siteLocationId: number;
  vendorId: number;
  siteName: string;
  partnerName: string;
  vendorName: string;
  scopeOfWork: string | null;
  startDate: string;
  endDate: string;
  status: string;
  passReason: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    partnerId: row.partnerId,
    siteLocationId: row.siteLocationId,
    vendorId: row.vendorId,
    siteName: row.siteName,
    partnerName: row.partnerName,
    vendorName: row.vendorName,
    scopeOfWork: row.scopeOfWork,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    passReason: row.passReason,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Authority gate for partner-initiated mutations (create, cancel).
 * Admin always passes; partner role must own the site (matching
 * partnerId on the site row). Returns the resolved partnerId on
 * success or `null` after sending the appropriate 4xx response.
 */
async function requirePartnerForSite(
  session: SessionPayload | null,
  siteId: number,
  res: import("express").Response,
): Promise<number | null> {
  if (!session || !session.role || session.role === "guest") {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const [site] = await db
    .select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteId))
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "Site location not found" });
    return null;
  }
  if (session.role === "admin") return site.partnerId;
  if (session.role !== "partner") {
    res.status(403).json({ error: "Partner role required" });
    return null;
  }
  if (session.partnerId == null || session.partnerId !== site.partnerId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return site.partnerId;
}

// ── POST /site-locations/:siteId/direct-assignments ──────────────────────────
// Partner offers a direct work assignment to a single vendor for the given
// site over a date range. Notifies every vendor admin/member tied to the
// vendor org (in-app + push + branded email).
router.post(
  "/site-locations/:siteId/direct-assignments",
  async (req, res): Promise<void> => {
    const session = getSessionFromRequest(req);
    const params = SiteIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const partnerId = await requirePartnerForSite(session, params.data.siteId, res);
    if (partnerId == null) return;
    if (!session?.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const body = CreateSiteDirectAssignmentBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const dateErr = validateDateRange(body.data.startDate, body.data.endDate);
    if (dateErr) {
      res.status(400).json({ error: dateErr });
      return;
    }

    // Vendor must exist before we offer them work — the FK would catch it,
    // but a friendly 400 is much nicer than a Postgres FK violation 500.
    const [vendor] = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, body.data.vendorId))
      .limit(1);
    if (!vendor) {
      res.status(400).json({ error: "Vendor not found" });
      return;
    }

    const [inserted] = await db
      .insert(directAssignmentsTable)
      .values({
        partnerId,
        siteLocationId: params.data.siteId,
        vendorId: body.data.vendorId,
        scopeOfWork: body.data.scopeOfWork ?? null,
        startDate: body.data.startDate,
        endDate: body.data.endDate,
        createdByUserId: session.userId,
      })
      .returning({ id: directAssignmentsTable.id });
    if (!inserted) {
      res.status(500).json({ error: "Failed to create assignment" });
      return;
    }

    const [row] = await selectDirectAssignment().where(
      eq(directAssignmentsTable.id, inserted.id),
    );
    if (!row) {
      res.status(500).json({ error: "Failed to load assignment" });
      return;
    }
    const dto = toResponseRow(row);

    // Fan out to every user attached to the recipient vendor org. The
    // notify helper is best-effort and already swallows individual user
    // failures — if it throws we still want to return the row to the
    // partner so the UI shows it pending.
    try {
      const vendorUserIds = await findVendorUserIds(body.data.vendorId);
      if (vendorUserIds.length) {
        await notifyUsers(vendorUserIds, {
          type: "direct_assignment_offered",
          title: `New work assignment from ${dto.partnerName}`,
          body: `${dto.partnerName} offered ${dto.vendorName} work at ${dto.siteName} from ${dto.startDate} to ${dto.endDate}. Tap to commit or pass.`,
          link: `/`,
          dedupeKey: `direct_assignment_offered:${dto.id}`,
          pushData: { directAssignmentId: dto.id, type: "direct_assignment_offered" },
        });
      }
    } catch (err) {
      req.log?.warn?.({ err, id: dto.id }, "direct_assignment offer notify failed");
    }

    res.status(201).json(dto);
  },
);

// ── GET /site-locations/:siteId/direct-assignments ───────────────────────────
// Partner-side list of every direct assignment offered for this site,
// most recent first. Returns an empty array for sites with none.
router.get(
  "/site-locations/:siteId/direct-assignments",
  async (req, res): Promise<void> => {
    const session = getSessionFromRequest(req);
    const params = SiteIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const partnerId = await requirePartnerForSite(session, params.data.siteId, res);
    if (partnerId == null) return;

    const rows = await selectDirectAssignment()
      .where(eq(directAssignmentsTable.siteLocationId, params.data.siteId))
      .orderBy(desc(directAssignmentsTable.createdAt));
    res.json(rows.map(toResponseRow));
  },
);

// ── GET /direct-assignments ──────────────────────────────────────────────────
// Caller-scoped inbox/outbox:
//   • role=vendor  → offers made TO their org
//   • role=partner → offers made BY their org
//   • role=admin   → all rows (no scoping)
// `?status=pending|committed|passed|cancelled` narrows to a single state
// (used by the vendor dashboard "pending offers" card).
router.get("/direct-assignments", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  // Hard allow-list: only the three roles below have a defined,
  // tenant-scoped view of the inbox. Anything else (e.g. office /
  // operator / future roles) MUST be rejected; falling through to the
  // unscoped query below would leak every direct assignment in the
  // database across tenants.
  if (
    session.role !== "admin" &&
    session.role !== "partner" &&
    session.role !== "vendor"
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const q = ListDirectAssignmentsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }

  const where = [];
  if (q.data.status) where.push(eq(directAssignmentsTable.status, q.data.status));
  if (session.role === "vendor") {
    if (session.vendorId == null) {
      res.json([]);
      return;
    }
    where.push(eq(directAssignmentsTable.vendorId, session.vendorId));
  } else if (session.role === "partner") {
    if (session.partnerId == null) {
      res.json([]);
      return;
    }
    where.push(eq(directAssignmentsTable.partnerId, session.partnerId));
  }
  // admin sees all rows — no extra filter.

  const rows = await selectDirectAssignment()
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(directAssignmentsTable.createdAt));
  res.json(rows.map(toResponseRow));
});

/**
 * Shared transition handler for the three pending → terminal moves
 * (commit / pass / cancel). Each one validates the actor, flips the
 * row, then notifies the OTHER party. Wrapped here so the three route
 * bodies stay tiny and consistent.
 */
async function transitionAssignment(
  req: import("express").Request,
  res: import("express").Response,
  action: "commit" | "pass" | "cancel",
): Promise<void> {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(directAssignmentsTable)
    .where(eq(directAssignmentsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Direct assignment not found" });
    return;
  }
  if (existing.status !== "pending") {
    res
      .status(409)
      .json({ error: `Assignment is already ${existing.status}`, code: "not_pending" });
    return;
  }

  // Authority: vendor can commit/pass own offers; partner can cancel own
  // offers. Admin can do anything.
  if (action === "commit" || action === "pass") {
    if (
      session.role !== "admin" &&
      !(session.role === "vendor" && session.vendorId === existing.vendorId)
    ) {
      res.status(403).json({ error: "Only the offered vendor can respond" });
      return;
    }
  } else {
    if (
      session.role !== "admin" &&
      !(session.role === "partner" && session.partnerId === existing.partnerId)
    ) {
      res.status(403).json({ error: "Only the offering partner can cancel" });
      return;
    }
  }

  // Pass action accepts an optional reason in the body. Commit/cancel
  // ignore the body entirely.
  let passReason: string | null = null;
  if (action === "pass") {
    const body = PassDirectAssignmentBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    passReason = body.data.reason?.trim() || null;
  }

  const newStatus =
    action === "commit" ? "committed" : action === "pass" ? "passed" : "cancelled";

  await db
    .update(directAssignmentsTable)
    .set({
      status: newStatus,
      passReason,
      respondedByUserId: session.userId ?? null,
      respondedAt: new Date(),
    })
    .where(eq(directAssignmentsTable.id, existing.id));

  const [row] = await selectDirectAssignment().where(
    eq(directAssignmentsTable.id, existing.id),
  );
  if (!row) {
    res.status(500).json({ error: "Failed to load assignment" });
    return;
  }
  const dto = toResponseRow(row);

  try {
    if (action === "commit") {
      const partnerUserIds = await findPartnerUserIds(existing.partnerId);
      if (partnerUserIds.length) {
        await notifyUsers(partnerUserIds, {
          type: "direct_assignment_committed",
          title: `${dto.vendorName} committed to your assignment`,
          body: `${dto.vendorName} accepted the work at ${dto.siteName} (${dto.startDate} – ${dto.endDate}).`,
          link: `/site-locations/${dto.siteLocationId}`,
          dedupeKey: `direct_assignment_committed:${dto.id}`,
          pushData: { directAssignmentId: dto.id, type: "direct_assignment_committed" },
        });
      }
    } else if (action === "pass") {
      const partnerUserIds = await findPartnerUserIds(existing.partnerId);
      if (partnerUserIds.length) {
        const reasonSuffix = passReason ? ` Reason: ${passReason}` : "";
        await notifyUsers(partnerUserIds, {
          type: "direct_assignment_passed",
          title: `${dto.vendorName} passed on your assignment`,
          body: `${dto.vendorName} declined the work at ${dto.siteName} (${dto.startDate} – ${dto.endDate}). Try another vendor.${reasonSuffix}`,
          link: `/site-locations/${dto.siteLocationId}`,
          dedupeKey: `direct_assignment_passed:${dto.id}`,
          pushData: { directAssignmentId: dto.id, type: "direct_assignment_passed" },
        });
      }
    } else {
      const vendorUserIds = await findVendorUserIds(existing.vendorId);
      if (vendorUserIds.length) {
        await notifyUsers(vendorUserIds, {
          type: "direct_assignment_cancelled",
          title: `${dto.partnerName} cancelled an assignment offer`,
          body: `The offer for ${dto.siteName} (${dto.startDate} – ${dto.endDate}) was cancelled before you responded.`,
          link: `/`,
          dedupeKey: `direct_assignment_cancelled:${dto.id}`,
          pushData: { directAssignmentId: dto.id, type: "direct_assignment_cancelled" },
        });
      }
    }
  } catch (err) {
    logger.warn(
      { err, id: dto.id, action },
      "direct_assignment transition notify failed",
    );
  }

  res.json(dto);
}

router.post("/direct-assignments/:id/commit", (req, res) =>
  transitionAssignment(req, res, "commit"),
);
router.post("/direct-assignments/:id/pass", (req, res) =>
  transitionAssignment(req, res, "pass"),
);
router.post("/direct-assignments/:id/cancel", (req, res) =>
  transitionAssignment(req, res, "cancel"),
);

export default router;
