import { Router, type IRouter } from "express";
import { eq, sql, and, isNull, inArray } from "drizzle-orm";
import { db, siteLocationsTable, partnersTable, siteWorkAssignmentsTable, workTypesTable, vendorsTable, vendorWorkTypesTable, vendorPeopleTable, ticketsTable, ticketCrewTable, siteLocationAdminAuditLogTable } from "@workspace/db";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { notifyUsers } from "./notifications";
import { publishTicketUnblocked } from "../lib/ticket-events";
import { logger } from "../lib/logger";
import {
  CreateSiteLocationBody,
  GetSiteLocationParams,
  GetSiteLocationResponse,
  UpdateSiteLocationParams,
  UpdateSiteLocationBody,
  UpdateSiteLocationResponse,
  ListSiteLocationsQueryParams,
  ListSiteLocationsResponse,
  ListSiteLocationsResponseItem,
  GetSiteLocationQrCodeParams,
  GetSiteLocationQrCodeResponse,
  ListSiteAssignmentsParams,
  ListSiteAssignmentsResponse,
  CreateSiteAssignmentParams,
  CreateSiteAssignmentBody,
  DeleteSiteAssignmentParams,
  UpdateSiteAssignmentParams,
  UpdateSiteAssignmentBody,
  DeleteSiteLocationParams,
} from "@workspace/api-zod";
import { sendResponse, sendResponseStatus } from "../lib/typed-response";
import { randomBytes } from "crypto";
import QRCode from "qrcode";
import { getStateFromCoordinates } from "../utils/latlong-to-state";
import { sendApiError } from "../lib/apiError";

import { sendValidationFailed } from "../lib/validation-error";
const router: IRouter = Router();

function generateSiteCode(): string {
  return "SITE-" + randomBytes(4).toString("hex").toUpperCase();
}

// Verifies the caller has read access to a specific site.
// Admin sees any; partner sees their own sites; vendor and field_employee see
// any site (matches the GET /site-locations list policy — vendors can pick up
// new work, not just sites they're already pre-assigned to).
// Returns true to continue, false if a response was already sent.
async function verifySiteReadAccess(
  session: SessionPayload,
  _req: any,
  res: any,
  sitePartnerId: number | null,
  _siteId: number,
): Promise<boolean> {
  if (session.role === "admin") return true;

  if (session.role === "partner") {
    if (sitePartnerId !== (session.partnerId ?? null)) {
      sendApiError(res, 403, "auth.forbidden", "Access denied");
      return false;
    }
    return true;
  }

  if (session.role === "vendor" && session.vendorId != null) {
    return true;
  }

  if (session.role === "field_employee" && session.userId != null) {
    const [vp] = await db
      .select({ vendorId: vendorPeopleTable.vendorId })
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.userId, session.userId),
          eq(vendorPeopleTable.isActive, true),
          isNull(vendorPeopleTable.deletedAt),
        ),
      );
    if (!vp) {
      sendApiError(res, 403, "field.account_inactive", "Field account not active");
      return false;
    }
    return true;
  }

  sendApiError(res, 403, "auth.forbidden", "Access denied");
  return false;
}

router.get("/site-locations", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }

  const query = ListSiteLocationsQueryParams.safeParse(req.query);
  let vendorId = session.role === "vendor" ? (session.vendorId ?? null) : null;
  const sessionPartnerId = session.role === "partner" ? (session.partnerId ?? null) : null;

  // Field employees do not have vendorId stored in their session cookie.
  // Look it up via vendor_people and scope the list to their vendor's assigned sites.
  if (session.role === "field_employee" && session.userId != null) {
    const [vp] = await db
      .select({ vendorId: vendorPeopleTable.vendorId })
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.userId, session.userId),
          eq(vendorPeopleTable.isActive, true),
          isNull(vendorPeopleTable.deletedAt),
        ),
      );
    if (!vp) {
      sendApiError(res, 403, "field.account_inactive", "Field account not active");
      return;
    }
    vendorId = vp.vendorId;
  }

  const siteSelect = {
    id: siteLocationsTable.id,
    partnerId: siteLocationsTable.partnerId,
    name: siteLocationsTable.name,
    address: siteLocationsTable.address,
    latitude: siteLocationsTable.latitude,
    longitude: siteLocationsTable.longitude,
    siteCode: siteLocationsTable.siteCode,
    state: siteLocationsTable.state,
    isActive: siteLocationsTable.isActive,
    status: siteLocationsTable.status,
    partnerName: partnersTable.name,
    siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
    afe: siteLocationsTable.afe,
    photoUrl: siteLocationsTable.photoUrl,
    createdAt: siteLocationsTable.createdAt,
  };

  let results;

  const isAdmin = session?.role === "admin";
  // Vendors (and field employees, whose vendorId is resolved above) see
  // every visible site location, not just the ones their vendor already has
  // an assignment on. Per-product decision: the site picker on "start a
  // ticket" is supposed to surface the entire site catalog so a vendor can
  // pick up new work, not be limited to the sites they're already
  // pre-assigned to. Partners remain scoped to their own partner's sites.
  const isVendorScoped = vendorId != null;

  if (isVendorScoped) {
    results = await db
      .select(siteSelect)
      .from(siteLocationsTable)
      .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
      .where(sql`${siteLocationsTable.hidden} = false`)
      .orderBy(siteLocationsTable.createdAt);
  } else if (sessionPartnerId) {
    results = await db
      .select(siteSelect)
      .from(siteLocationsTable)
      .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
      .where(sql`${siteLocationsTable.partnerId} = ${sessionPartnerId} AND ${siteLocationsTable.hidden} = false`)
      .orderBy(siteLocationsTable.createdAt);
  } else if (query.success && query.data.partnerId) {
    results = await db
      .select(siteSelect)
      .from(siteLocationsTable)
      .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
      .where(sql`${siteLocationsTable.partnerId} = ${query.data.partnerId} AND ${siteLocationsTable.hidden} = false`)
      .orderBy(siteLocationsTable.createdAt);
  } else if (isAdmin) {
    results = await db
      .select(siteSelect)
      .from(siteLocationsTable)
      .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
      .orderBy(siteLocationsTable.createdAt);
  } else {
    // Unknown or unscoped role — deny by default (least privilege).
    sendApiError(res, 403, "auth.forbidden", "Insufficient permissions");
    return;
  }
  sendResponse(res, ListSiteLocationsResponse, results);
});

router.post("/site-locations", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    sendApiError(res, 403, "auth.forbidden", "Insufficient permissions");
    return;
  }
  if (session.role === "partner" && session.membershipRole !== "admin") {
    sendApiError(res, 403, "auth.partner_admin_required", "Partner admin access required");
    return;
  }

  const parsed = CreateSiteLocationBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  // Partners may only create sites under their own partnerId.
  if (session.role === "partner" && parsed.data.partnerId !== (session.partnerId ?? null)) {
    sendApiError(res, 403, "site_location.partner_mismatch", "Cannot create sites for another partner");
    return;
  }
  const siteCode = generateSiteCode();
  const autoState = parsed.data.state || getStateFromCoordinates(parsed.data.latitude, parsed.data.longitude);
  // Strip the auto-assign flag before insert — it's a request-only hint
  // that drives the secondary site_work_assignments fan-out below; not a
  // column on site_locations.
  const { autoAssignAllVendors, ...siteValues } = parsed.data;
  // 1-mile default if the caller didn't pass a radius. Mirrors the
  // partner-portal create form's DEFAULT_RADIUS_METERS so API-direct
  // creators (assistant flows, scripts) get the same field-ops
  // default a human partner would.
  const radiusToWrite =
    siteValues.siteRadiusMeters == null ? 1609 : siteValues.siteRadiusMeters;
  const [site] = await db
    .insert(siteLocationsTable)
    .values({
      ...siteValues,
      siteRadiusMeters: radiusToWrite,
      siteCode,
      state: autoState,
    })
    .returning();

  // Hybrid auto-assign (caller opt-in): clone every (vendor, work_type)
  // pair already approved on this partner into site_work_assignments so
  // every approved vendor's field crews see the new site on mobile
  // without the partner having to re-assign each one. The unique index
  // on (vendor_id, work_type_id, site_location_id) is a hard guard, so we
  // ON CONFLICT DO NOTHING to stay idempotent under retry.
  if (autoAssignAllVendors === true) {
    await db.execute(sql`
      INSERT INTO site_work_assignments (site_location_id, work_type_id, vendor_id)
      SELECT ${site.id}, work_type_id, vendor_id
      FROM partner_vendor_work_type_approvals
      WHERE partner_id = ${parsed.data.partnerId}
      ON CONFLICT (vendor_id, work_type_id, site_location_id) DO NOTHING
    `);
  }

  const [result] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteCode: siteLocationsTable.siteCode,
      state: siteLocationsTable.state,
      isActive: siteLocationsTable.isActive,
      status: siteLocationsTable.status,
      partnerName: partnersTable.name,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
      afe: siteLocationsTable.afe,
      photoUrl: siteLocationsTable.photoUrl,
      createdAt: siteLocationsTable.createdAt,
    })
    .from(siteLocationsTable)
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .where(eq(siteLocationsTable.id, site.id));

  // Task #583: POST /site-locations returns the same SiteLocation shape
  // as the list endpoint (per openapi.yaml), so we route through the
  // generated list-item schema to enforce the projection at compile time.
  sendResponseStatus(res, 201, ListSiteLocationsResponseItem, result);
});

router.get("/site-locations/:id", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }

  const params = GetSiteLocationParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteCode: siteLocationsTable.siteCode,
      state: siteLocationsTable.state,
      isActive: siteLocationsTable.isActive,
      status: siteLocationsTable.status,
      partnerName: partnersTable.name,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
      afe: siteLocationsTable.afe,
      photoUrl: siteLocationsTable.photoUrl,
      hidden: siteLocationsTable.hidden,
      supersededAt: siteLocationsTable.supersededAt,
      sourceType: siteLocationsTable.sourceType,
      createdAt: siteLocationsTable.createdAt,
    })
    .from(siteLocationsTable)
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .where(eq(siteLocationsTable.id, params.data.id));

  if (!site) {
    sendApiError(res, 404, "site_location.not_found", "Site location not found");
    return;
  }
  if (!(await verifySiteReadAccess(session, req, res, site.partnerId, site.id))) return;

  // Task #583: workTypeId / vendorId on siteWorkAssignments are NOT NULL
  // FKs (a row can't exist without an existing work type and vendor), so
  // an INNER join is correct here — and matches the response schema,
  // which declares workTypeName / workTypeCategory / vendorName as
  // required strings rather than nullable. The previous LEFT joins
  // produced rows with nullable strings that could only round-trip
  // through the schema by accident.
  const assignments = await db
    .select({
      id: siteWorkAssignmentsTable.id,
      siteLocationId: siteWorkAssignmentsTable.siteLocationId,
      workTypeId: siteWorkAssignmentsTable.workTypeId,
      vendorId: siteWorkAssignmentsTable.vendorId,
      workTypeName: workTypesTable.name,
      workTypeCategory: workTypesTable.category,
      vendorName: vendorsTable.name,
      afe: siteWorkAssignmentsTable.afe,
    })
    .from(siteWorkAssignmentsTable)
    .innerJoin(workTypesTable, eq(siteWorkAssignmentsTable.workTypeId, workTypesTable.id))
    .innerJoin(vendorsTable, eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id))
    .where(eq(siteWorkAssignmentsTable.siteLocationId, params.data.id));

  sendResponse(res, GetSiteLocationResponse, { ...site, assignments });
});

router.patch("/site-locations/:id", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    sendApiError(res, 403, "auth.forbidden", "Insufficient permissions");
    return;
  }
  if (session.role === "partner" && session.membershipRole !== "admin") {
    sendApiError(res, 403, "auth.partner_admin_required", "Partner admin access required");
    return;
  }

  const params = UpdateSiteLocationParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  // Partners may only modify sites belonging to their own org.
  if (session.role === "partner") {
    const [existing] = await db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, params.data.id));
    if (!existing) {
      sendApiError(res, 404, "site_location.not_found", "Site location not found");
      return;
    }
    if (existing.partnerId !== (session.partnerId ?? null)) {
      sendApiError(res, 403, "auth.forbidden", "Access denied");
      return;
    }
  }

  const parsed = UpdateSiteLocationBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  // Toggling `hidden` (e.g. un-hiding a county-area anchor that the
  // ingest pipeline marked superseded) is an admin-only override.
  // Partners can soft-delete their own sites via DELETE which sets
  // hidden=true, but flipping the flag arbitrarily — especially
  // un-hiding rows the pipeline wrote off — needs admin review and
  // an audit row.
  if (parsed.data.hidden !== undefined && session.role !== "admin") {
    sendApiError(res, 403, "site_location.admin_only_toggle_hidden", "Admin role required to toggle hidden state");
    return;
  }

  const [existing] = await db
    .select()
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, params.data.id));
  if (!existing) {
    sendApiError(res, 404, "site_location.not_found", "Site location not found");
    return;
  }

  const updateData = { ...parsed.data } as Record<string, unknown>;
  if (parsed.data.latitude !== undefined && parsed.data.longitude !== undefined) {
    updateData.state = parsed.data.state || getStateFromCoordinates(parsed.data.latitude, parsed.data.longitude);
  }
  // When un-hiding a row, also clear `supersededAt` so the field UI
  // treats it as a real anchor again. The pipeline's "this site was
  // replaced by more specific wells" timestamp no longer applies once
  // an admin has explicitly chosen to keep the broader anchor.
  if (parsed.data.hidden === false) {
    updateData.supersededAt = null;
  }

  // Run the row update and the audit insert atomically when a hidden
  // toggle is involved, so we never end up with the row flipped but
  // no audit trail (or vice-versa).
  const isHiddenChange =
    parsed.data.hidden !== undefined && parsed.data.hidden !== existing.hidden;
  // Narrow once for the transaction closure — the request gate above
  // already rejects sessions without a role.
  const actorRole: string = session.role;

  const site = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(siteLocationsTable)
      .set(updateData)
      .where(eq(siteLocationsTable.id, params.data.id))
      .returning();
    if (!updated) return null;

    if (isHiddenChange) {
      const fwd = req.headers["x-forwarded-for"];
      const ip =
        (Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0]?.trim()) ||
        req.socket?.remoteAddress ||
        null;
      const ua = (req.headers["user-agent"] as string | undefined) ?? null;
      await tx.insert(siteLocationAdminAuditLogTable).values({
        siteLocationId: updated.id,
        action: parsed.data.hidden ? "hide" : "unhide",
        changes: {
          hidden: { before: existing.hidden, after: updated.hidden },
          supersededAt: {
            before: existing.supersededAt ? existing.supersededAt.toISOString() : null,
            after: updated.supersededAt ? updated.supersededAt.toISOString() : null,
          },
        },
        actorUserId: session.userId ?? null,
        actorRole,
        actorIp: ip,
        actorUserAgent: ua,
      });
    }
    return updated;
  });
  if (!site) {
    sendApiError(res, 404, "site_location.not_found", "Site location not found");
    return;
  }

  const [result] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteCode: siteLocationsTable.siteCode,
      state: siteLocationsTable.state,
      isActive: siteLocationsTable.isActive,
      status: siteLocationsTable.status,
      partnerName: partnersTable.name,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
      afe: siteLocationsTable.afe,
      photoUrl: siteLocationsTable.photoUrl,
      createdAt: siteLocationsTable.createdAt,
    })
    .from(siteLocationsTable)
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .where(eq(siteLocationsTable.id, site.id));

  sendResponse(res, UpdateSiteLocationResponse, result);
});

router.delete("/site-locations/:id", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    sendApiError(res, 403, "auth.forbidden", "Insufficient permissions");
    return;
  }
  if (session.role === "partner" && session.membershipRole !== "admin") {
    sendApiError(res, 403, "auth.partner_admin_required", "Partner admin access required");
    return;
  }

  const params = DeleteSiteLocationParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  // Partners may only delete sites belonging to their own org.
  if (session.role === "partner") {
    const [existing] = await db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, params.data.id));
    if (!existing) {
      sendApiError(res, 404, "site_location.not_found", "Site location not found");
      return;
    }
    if (existing.partnerId !== (session.partnerId ?? null)) {
      sendApiError(res, 403, "auth.forbidden", "Access denied");
      return;
    }
  }
  const [updated] = await db.update(siteLocationsTable).set({ hidden: true }).where(eq(siteLocationsTable.id, params.data.id)).returning();
  if (!updated) {
    sendApiError(res, 404, "site_location.not_found", "Site location not found");
    return;
  }
  res.sendStatus(204);
});

router.get("/site-locations/:id/qr-code", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }

  const params = GetSiteLocationQrCodeParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const [site] = await db.select().from(siteLocationsTable).where(eq(siteLocationsTable.id, params.data.id));
  if (!site) {
    sendApiError(res, 404, "site_location.not_found", "Site location not found");
    return;
  }
  if (!(await verifySiteReadAccess(session, req, res, site.partnerId, site.id))) return;

  const host = process.env.REPLIT_DEV_DOMAIN || "localhost";
  const portalUrl = `https://${host}/portal/${site.siteCode}`;
  const qrCodeUrl = await QRCode.toDataURL(portalUrl, { width: 300, margin: 2 });

  sendResponse(res, GetSiteLocationQrCodeResponse, {
    siteCode: site.siteCode,
    qrCodeUrl,
    portalUrl,
  });
});

router.get("/site-locations/:siteId/assignments", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }

  const params = ListSiteAssignmentsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  const [siteForCheck] = await db
    .select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, params.data.siteId));
  if (!siteForCheck) {
    sendApiError(res, 404, "site_location.not_found", "Site location not found");
    return;
  }
  if (!(await verifySiteReadAccess(session, req, res, siteForCheck.partnerId, siteForCheck.id))) return;

  // Task #583: same FK reasoning as the GET /:id assignments embed —
  // workTypeId / vendorId are NOT NULL, so an INNER join cannot drop
  // rows and lets the workTypeName / vendorName columns line up with
  // the schema's required strings.
  const assignments = await db
    .select({
      id: siteWorkAssignmentsTable.id,
      siteLocationId: siteWorkAssignmentsTable.siteLocationId,
      workTypeId: siteWorkAssignmentsTable.workTypeId,
      vendorId: siteWorkAssignmentsTable.vendorId,
      workTypeName: workTypesTable.name,
      workTypeCategory: workTypesTable.category,
      vendorName: vendorsTable.name,
      afe: siteWorkAssignmentsTable.afe,
    })
    .from(siteWorkAssignmentsTable)
    .innerJoin(workTypesTable, eq(siteWorkAssignmentsTable.workTypeId, workTypesTable.id))
    .innerJoin(vendorsTable, eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id))
    .where(eq(siteWorkAssignmentsTable.siteLocationId, params.data.siteId));

  sendResponse(res, ListSiteAssignmentsResponse, assignments);
});

async function verifySitePartnerAccess(session: SessionPayload, siteId: number, res: any): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role !== "partner") {
    sendApiError(res, 403, "auth.forbidden", "Insufficient permissions");
    return false;
  }
  if (session.membershipRole !== "admin") {
    sendApiError(res, 403, "auth.partner_admin_required", "Partner admin access required");
    return false;
  }
  const [site] = await db
    .select({ partnerId: siteLocationsTable.partnerId })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteId));
  if (!site) {
    sendApiError(res, 404, "site_location.not_found", "Site location not found");
    return false;
  }
  if (site.partnerId !== (session.partnerId ?? null)) {
    sendApiError(res, 403, "auth.forbidden", "Access denied");
    return false;
  }
  return true;
}

// Task #592: when an office user re-adds a (vendor, site, work-type)
// assignment that was previously missing, every field worker who is on
// an open ticket affected by that change deserves a push so they know
// they can resume — Task #572 set up a "blocked" banner on the mobile
// detail screen, but the worker had to manually pull-to-refresh to see
// it clear. This helper is the proactive counterpart.
//
// Task #614 extends the fan-out beyond `tickets.fieldEmployeeId` (the
// ticket lead) to every active row in `ticket_crew` for the affected
// ticket. Crew members see the same blocked banner and were silently
// stuck on it before; now they get the push too.
//
// "Open" means the worker still has actions to take — anything in the
// mutable lifecycle states. We deliberately exclude `awaiting_payment`,
// `paid`, `closed`, `cancelled`, `denied`, and `awaiting_acceptance`:
// either the worker has already finished their part, or no field
// employee is engaged yet.
//
// Idempotency: `notifyUsers` writes to `notifications` which carries a
// unique index on `(user_id, dedupe_key)`. We pass
// `dedupeKey=ticket_unblocked:<ticketId>` so each (worker, ticket) pair
// is notified at most once, even if the assignment is removed and
// re-added repeatedly. We also de-dupe in-memory before calling
// `notifyUsers` so a worker who is both lead and crew on the same
// ticket only triggers one push (not two that race the unique index).
const TICKET_UNBLOCK_OPEN_STATUSES: ReadonlySet<string> = new Set([
  "initiated",
  "draft",
  "in_progress",
  "pending_review",
  "kicked_back",
]);

async function notifyWorkersOfUnblockedTickets(input: {
  siteLocationId: number;
  vendorId: number;
  workTypeId: number;
}): Promise<void> {
  const { siteLocationId, vendorId, workTypeId } = input;
  // Pull every open ticket affected by the new assignment. We do NOT
  // require `fieldEmployeeId IS NOT NULL` here any more — a ticket can
  // legitimately have crew without a lead (e.g. foreman is staffing it
  // before assigning a lead) and those crew members are just as stuck.
  const affected = await db
    .select({
      ticketId: ticketsTable.id,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      siteName: siteLocationsTable.name,
      // Task #622: pulled in for the SSE side-channel so the
      // `/api/tickets/events` endpoint can role-scope the unblock event
      // to the right partner without an extra DB hit per subscriber.
      sitePartnerId: siteLocationsTable.partnerId,
    })
    .from(ticketsTable)
    .leftJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, ticketsTable.siteLocationId),
    )
    .where(
      and(
        eq(ticketsTable.siteLocationId, siteLocationId),
        eq(ticketsTable.vendorId, vendorId),
        eq(ticketsTable.workTypeId, workTypeId),
        inArray(ticketsTable.status, Array.from(TICKET_UNBLOCK_OPEN_STATUSES)),
      ),
    );
  if (affected.length === 0) return;

  // Look up active crew assignments for those tickets. `removed_at IS
  // NULL` matches the partial unique index used everywhere else for
  // "currently on the crew".
  const ticketIds = affected.map((r) => r.ticketId);
  const crewRows = await db
    .select({
      ticketId: ticketCrewTable.ticketId,
      employeeId: ticketCrewTable.employeeId,
    })
    .from(ticketCrewTable)
    .where(
      and(
        inArray(ticketCrewTable.ticketId, ticketIds),
        isNull(ticketCrewTable.removedAt),
      ),
    );

  // Build per-ticket recipient sets of vendor_people IDs (lead + crew).
  const personIdsByTicket = new Map<number, Set<number>>();
  for (const t of affected) {
    const set = new Set<number>();
    if (typeof t.fieldEmployeeId === "number") set.add(t.fieldEmployeeId);
    personIdsByTicket.set(t.ticketId, set);
  }
  for (const c of crewRows) {
    const set = personIdsByTicket.get(c.ticketId);
    if (set) set.add(c.employeeId);
  }

  // Resolve every distinct vendor_people ID across all tickets to its
  // user account in one query.
  const allPersonIds = Array.from(
    new Set(
      Array.from(personIdsByTicket.values()).flatMap((s) => Array.from(s)),
    ),
  );
  if (allPersonIds.length === 0) return;
  const peopleRows = await db
    .select({
      id: vendorPeopleTable.id,
      userId: vendorPeopleTable.userId,
    })
    .from(vendorPeopleTable)
    .where(inArray(vendorPeopleTable.id, allPersonIds));
  const userIdByPersonId = new Map<number, number | null>();
  for (const p of peopleRows) userIdByPersonId.set(p.id, p.userId);

  for (const t of affected) {
    // Task #622: publish to the in-process / pg LISTEN-NOTIFY
    // ticket-events bus FIRST, before the per-recipient push fan-out
    // and crucially before any of its `continue` short-circuits below.
    // Any open web ticket-detail tab on the affected ticket should
    // silently re-fetch and dismiss its assignment-removed banner the
    // moment the office restored the assignment — that's a
    // ticket-scoped concern, not a recipient-scoped one. Tickets whose
    // lead/crew have no linked user accounts (or no `vendor_people`
    // rows at all) skip the mobile push below but must still emit
    // here, otherwise a vendor-office user with that ticket open in
    // the browser stays stuck on the 7s poll fallback. Web subscribers
    // filter by ticketId so the duplicate vendor+crew push paths
    // don't translate into duplicate refetches.
    publishTicketUnblocked({
      ticketId: t.ticketId,
      vendorId,
      partnerId: t.sitePartnerId ?? null,
    });

    const personIds = personIdsByTicket.get(t.ticketId);
    if (!personIds || personIds.size === 0) continue;
    const userIds = new Set<number>();
    for (const pid of personIds) {
      const uid = userIdByPersonId.get(pid);
      if (typeof uid === "number") userIds.add(uid);
    }
    if (userIds.size === 0) continue;
    const tracking = formatTicketTrackingNumber(t.ticketId);
    const where = t.siteName ? ` at ${t.siteName}` : "";
    for (const userId of userIds) {
      try {
        await notifyUsers([userId], {
          type: "ticket_unblocked",
          title: "Your ticket is unblocked",
          body: `Tracking ${tracking}${where} is ready again — tap to continue.`,
          link: `/tickets/${t.ticketId}`,
          dedupeKey: `ticket_unblocked:${t.ticketId}`,
          // Mobile deep-link routing reads `data.ticketId`; without this
          // the push opens the app but doesn't navigate to the ticket.
          pushData: { ticketId: t.ticketId, type: "ticket_unblocked" },
        });
      } catch (err) {
        // One worker's failure must not skip the others — `notifyUsers`
        // already logs internally, but rethrows are still possible from
        // the schema validation layer. Swallow + log per-ticket here.
        logger.warn(
          { err, ticketId: t.ticketId, userId },
          "ticket_unblocked notify failed",
        );
      }
    }
  }
}

router.post("/site-locations/:siteId/assignments", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }

  const params = CreateSiteAssignmentParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  if (!(await verifySitePartnerAccess(session, params.data.siteId, res))) return;
  const parsed = CreateSiteAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  // Task #727 — vendor catalog is the source of truth: a vendor can
  // only be pinned to a site for a work type they've put on their
  // catalog. The UI catches this 400 and offers to add it to the
  // catalog before retrying.
  const [catalogRow] = await db
    .select({ id: vendorWorkTypesTable.id })
    .from(vendorWorkTypesTable)
    .where(
      and(
        eq(vendorWorkTypesTable.vendorId, parsed.data.vendorId),
        eq(vendorWorkTypesTable.workTypeId, parsed.data.workTypeId),
      ),
    )
    .limit(1);
  if (!catalogRow) {
    const [wt] = await db
      .select({ name: workTypesTable.name })
      .from(workTypesTable)
      .where(eq(workTypesTable.id, parsed.data.workTypeId))
      .limit(1);
    const [v] = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, parsed.data.vendorId))
      .limit(1);
    res.status(400).json({
      error: "work_type_not_in_vendor_catalog",
      message: "Work type is not in the vendor's catalog.",
      code: "site_location.work_type_not_in_vendor_catalog",
      vendorId: parsed.data.vendorId,
      workTypeId: parsed.data.workTypeId,
      vendorName: v?.name ?? null,
      workTypeName: wt?.name ?? null,
    });
    return;
  }

  // A vendor may only be pinned to a given (site, work type) once. The DB
  // enforces this with a unique index, but we check explicitly so the
  // client gets a structured error instead of a raw 500. The previous
  // behaviour silently created a duplicate row, which let an admin attach
  // more than one AFE to a single site location for the same work type
  // and broke downstream AFE joins.
  const [existing] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.siteLocationId, params.data.siteId),
        eq(siteWorkAssignmentsTable.vendorId, parsed.data.vendorId),
        eq(siteWorkAssignmentsTable.workTypeId, parsed.data.workTypeId),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({
      error: "vendor_work_type_already_assigned_to_site",
      code: "vendor_work_type_already_assigned_to_site",
      assignmentId: existing.id,
    });
    return;
  }

  const [assignment] = await db
    .insert(siteWorkAssignmentsTable)
    .values({ ...parsed.data, siteLocationId: params.data.siteId })
    .returning();

  const [result] = await db
    .select({
      id: siteWorkAssignmentsTable.id,
      siteLocationId: siteWorkAssignmentsTable.siteLocationId,
      workTypeId: siteWorkAssignmentsTable.workTypeId,
      vendorId: siteWorkAssignmentsTable.vendorId,
      workTypeName: workTypesTable.name,
      workTypeCategory: workTypesTable.category,
      vendorName: vendorsTable.name,
      afe: siteWorkAssignmentsTable.afe,
    })
    .from(siteWorkAssignmentsTable)
    .leftJoin(workTypesTable, eq(siteWorkAssignmentsTable.workTypeId, workTypesTable.id))
    .leftJoin(vendorsTable, eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id))
    .where(eq(siteWorkAssignmentsTable.id, assignment.id));

  // Task #592: tell affected field workers their stuck ticket is unblocked.
  // Fire-and-forget so the response stays fast even if Expo or the
  // notifications insert is slow; failures are logged inside the helper.
  void notifyWorkersOfUnblockedTickets({
    siteLocationId: assignment.siteLocationId,
    vendorId: assignment.vendorId,
    workTypeId: assignment.workTypeId,
  }).catch((err) => {
    logger.warn(
      { err, assignmentId: assignment.id },
      "ticket_unblocked fan-out failed",
    );
  });

  res.status(201).json(result);
});

router.patch("/site-locations/:siteId/assignments/:assignmentId", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }

  const params = UpdateSiteAssignmentParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  if (!(await verifySitePartnerAccess(session, params.data.siteId, res))) return;

  const parsed = UpdateSiteAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  const [updated] = await db
    .update(siteWorkAssignmentsTable)
    .set(parsed.data)
    .where(
      and(
        eq(siteWorkAssignmentsTable.id, params.data.assignmentId),
        eq(siteWorkAssignmentsTable.siteLocationId, params.data.siteId),
      ),
    )
    .returning();

  if (!updated) {
    sendApiError(res, 404, "assignment.not_found", "Assignment not found");
    return;
  }

  const [result] = await db
    .select({
      id: siteWorkAssignmentsTable.id,
      siteLocationId: siteWorkAssignmentsTable.siteLocationId,
      workTypeId: siteWorkAssignmentsTable.workTypeId,
      vendorId: siteWorkAssignmentsTable.vendorId,
      workTypeName: workTypesTable.name,
      workTypeCategory: workTypesTable.category,
      vendorName: vendorsTable.name,
      afe: siteWorkAssignmentsTable.afe,
    })
    .from(siteWorkAssignmentsTable)
    .leftJoin(workTypesTable, eq(siteWorkAssignmentsTable.workTypeId, workTypesTable.id))
    .leftJoin(vendorsTable, eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id))
    .where(eq(siteWorkAssignmentsTable.id, updated.id));

  res.json(result);
});

router.delete("/site-locations/:siteId/assignments/:assignmentId", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    sendApiError(res, 401, "auth.not_authenticated", "Authentication required");
    return;
  }

  const params = DeleteSiteAssignmentParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  if (!(await verifySitePartnerAccess(session, params.data.siteId, res))) return;

  // Look up the assignment first so we know the (vendor, work_type)
  // pair to count active tickets against. Active = anything that
  // hasn't reached one of the terminal states (approved, funds
  // dispersed, or cancelled). Without this guard a partner can quietly
  // remove an assignment that field crews and vendors are still
  // actively working under, and the orphaned ticket loses its catalog
  // anchor.
  const [assignment] = await db
    .select({
      id: siteWorkAssignmentsTable.id,
      vendorId: siteWorkAssignmentsTable.vendorId,
      workTypeId: siteWorkAssignmentsTable.workTypeId,
    })
    .from(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.id, params.data.assignmentId),
        eq(siteWorkAssignmentsTable.siteLocationId, params.data.siteId),
      ),
    );
  if (!assignment) {
    sendApiError(res, 404, "assignment.not_found", "Assignment not found");
    return;
  }

  const force = req.query.force === "true";
  if (!force) {
    const [{ openCount }] = await db
      .select({
        openCount: sql<number>`COUNT(*)::int`,
      })
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.siteLocationId, params.data.siteId),
          eq(ticketsTable.vendorId, assignment.vendorId),
          eq(ticketsTable.workTypeId, assignment.workTypeId),
          sql`${ticketsTable.status} NOT IN ('approved','funds_dispersed','cancelled')`,
        ),
      );
    if (openCount > 0) {
      res.status(409).json({
        error: "assignment_in_use",
        message: `${openCount} open ticket(s) still depend on this assignment. Resolve them first or pass ?force=true to remove anyway.`,
        code: "site_location.assignment_in_use",
        openTicketCount: openCount,
        details: { count: openCount },
      });
      return;
    }
  }

  const [deleted] = await db
    .delete(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.id, params.data.assignmentId),
        eq(siteWorkAssignmentsTable.siteLocationId, params.data.siteId),
      ),
    )
    .returning();
  if (!deleted) {
    sendApiError(res, 404, "assignment.not_found", "Assignment not found");
    return;
  }
  res.sendStatus(204);
});

export default router;
