import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  partnersTable,
  vendorsTable,
  siteLocationsTable,
  userOrgMembershipsTable,
  vendorSiteLocationAfesTable,
  workTypesTable,
  vendorWorkTypesTable,
  workTypeSiteLocationsTable,
} from "@workspace/db";
import {
  getSessionFromRequest,
  type SessionPayload,
} from "../lib/session";
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

// Read authz: any member of the partner org can read its (vendor,
// site_location → AFE) mappings — useful so partner-side accountants
// and project managers can confirm an AFE without needing admin —
// but cross-tenant reads are denied. System admins always pass.
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

// List every site location belonging to the partner with the AFE that
// the given vendor has been assigned (blank if none). Site locations
// are scoped to the partner, so the URL is /partners/:p/vendors/:v.
router.get(
  "/partners/:partnerId/vendors/:vendorId/site-location-afes",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(req.params.partnerId, 10);
    const vendorId = parseInt(req.params.vendorId, 10);
    if (isNaN(partnerId) || isNaN(vendorId)) {
      sendApiError(res, 400, "validation.invalid_id", "Invalid partner or vendor id");
      return;
    }
    const auth = await requirePartnerMembership(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const [partner] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.id, partnerId))
      .limit(1);
    if (!partner) {
      sendApiError(res, 404, "partner.not_found", "Partner not found");
      return;
    }
    const [vendor] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (!vendor) {
      sendApiError(res, 404, "vendor.not_found", "Vendor not found");
      return;
    }

    const sites = await db
      .select({
        id: siteLocationsTable.id,
        name: siteLocationsTable.name,
        siteCode: siteLocationsTable.siteCode,
        address: siteLocationsTable.address,
      })
      .from(siteLocationsTable)
      .where(
        and(
          eq(siteLocationsTable.partnerId, partnerId),
          eq(siteLocationsTable.hidden, false),
        ),
      )
      .orderBy(asc(siteLocationsTable.name));

    const mappings = await db
      .select()
      .from(vendorSiteLocationAfesTable)
      .where(eq(vendorSiteLocationAfesTable.vendorId, vendorId));
    const afeBySite = new Map<number, string>();
    for (const m of mappings) afeBySite.set(m.siteLocationId, m.afe);

    const items = sites.map((s) => ({
      siteLocationId: s.id,
      name: s.name,
      siteCode: s.siteCode,
      address: s.address,
      afe: afeBySite.get(s.id) ?? "",
    }));

    res.json({ partnerId, vendorId, items });
  },
);

router.put(
  "/partners/:partnerId/vendors/:vendorId/site-location-afes",
  async (req, res): Promise<void> => {
    const partnerId = parseInt(req.params.partnerId, 10);
    const vendorId = parseInt(req.params.vendorId, 10);
    if (isNaN(partnerId) || isNaN(vendorId)) {
      sendApiError(res, 400, "validation.invalid_id", "Invalid partner or vendor id");
      return;
    }
    const auth = await requirePartnerAdmin(req, partnerId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }

    const body = req.body as {
      items?: Array<{ siteLocationId: number; afe: string }>;
    };
    if (!body || !Array.isArray(body.items)) {
      sendApiError(res, 400, "validation.items_required", "items array required");
      return;
    }

    // Validate site IDs belong to this partner — prevents writing AFEs
    // against another partner's sites by id-spoofing.
    const ownedSites = await db
      .select({ id: siteLocationsTable.id })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.partnerId, partnerId));
    const validIds = new Set(ownedSites.map((s) => s.id));

    let saved = 0;
    let cleared = 0;

    await db.transaction(async (tx) => {
      for (const raw of body.items!) {
        const siteLocationId = Number(raw.siteLocationId);
        if (!validIds.has(siteLocationId)) continue;
        const afe = (raw.afe ?? "").toString().trim();
        if (afe === "") {
          const del = await tx
            .delete(vendorSiteLocationAfesTable)
            .where(
              and(
                eq(vendorSiteLocationAfesTable.vendorId, vendorId),
                eq(vendorSiteLocationAfesTable.siteLocationId, siteLocationId),
              ),
            )
            .returning({ id: vendorSiteLocationAfesTable.id });
          if (del.length > 0) cleared += 1;
          continue;
        }
        await tx
          .insert(vendorSiteLocationAfesTable)
          .values({ vendorId, siteLocationId, afe })
          .onConflictDoUpdate({
            target: [
              vendorSiteLocationAfesTable.vendorId,
              vendorSiteLocationAfesTable.siteLocationId,
            ],
            set: { afe },
          });
        saved += 1;
      }
    });

    res.json({ partnerId, vendorId, saved, cleared });
  },
);

// ---------------------------------------------------------------
// Admin-scoped endpoints for the Product/Service Catalog modal.
// These let a system admin view & edit the (vendor × site_location)
// AFE matrix for a single work type. The same underlying table
// (vendor_site_location_afes) is shared with partner admins via the
// /partners/:p/vendors/:v/site-location-afes endpoints above.
// ---------------------------------------------------------------

function requireSystemAdmin(req: Request, res: Response): boolean {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    res
      .status(401)
      .json({ error: "Authentication required", code: "auth.required" });
    return false;
  }
  if (session.role !== "admin") {
    res
      .status(403)
      .json({ error: "System admin access required", code: "auth.admin_required" });
    return false;
  }
  return true;
}

// Returns one row per (vendor in vendor_work_types(work_type_id) ×
// site_location in work_type_site_locations(work_type_id)) that has a
// stored AFE. Vendors/sites without an AFE are omitted; the UI knows
// the full matrix from form state and treats missing rows as blank.
router.get(
  "/work-types/:workTypeId/vendor-site-afes",
  async (req, res): Promise<void> => {
    if (!requireSystemAdmin(req, res)) return;
    const workTypeId = parseInt(req.params.workTypeId, 10);
    if (isNaN(workTypeId)) {
      sendApiError(res, 400, "work_type.invalid_id", "Invalid work type id");
      return;
    }
    const [wt] = await db
      .select({ id: workTypesTable.id })
      .from(workTypesTable)
      .where(eq(workTypesTable.id, workTypeId))
      .limit(1);
    if (!wt) {
      sendApiError(res, 404, "work_type.not_found", "Work type not found");
      return;
    }

    const vendorRows = await db
      .select({ vendorId: vendorWorkTypesTable.vendorId })
      .from(vendorWorkTypesTable)
      .where(eq(vendorWorkTypesTable.workTypeId, workTypeId));
    const vendorIds = vendorRows.map((r) => r.vendorId);

    const siteRows = await db
      .select({ siteLocationId: workTypeSiteLocationsTable.siteLocationId })
      .from(workTypeSiteLocationsTable)
      .where(eq(workTypeSiteLocationsTable.workTypeId, workTypeId));
    const siteIds = siteRows.map((r) => r.siteLocationId);

    if (vendorIds.length === 0 || siteIds.length === 0) {
      res.json({ workTypeId, items: [] });
      return;
    }

    const rows = await db
      .select({
        vendorId: vendorSiteLocationAfesTable.vendorId,
        siteLocationId: vendorSiteLocationAfesTable.siteLocationId,
        afe: vendorSiteLocationAfesTable.afe,
      })
      .from(vendorSiteLocationAfesTable)
      .where(
        and(
          inArray(vendorSiteLocationAfesTable.vendorId, vendorIds),
          inArray(vendorSiteLocationAfesTable.siteLocationId, siteIds),
        ),
      );

    res.json({ workTypeId, items: rows });
  },
);

// Admin-only batch upsert. Each item is (vendorId, siteLocationId, afe).
// Blank afe deletes; non-blank afe upserts. Items are scope-checked
// against the (vendor_work_types × work_type_site_locations) matrix
// for THIS work type so the catalog modal can't (accidentally or
// otherwise) write AFE rows for vendors/sites that aren't actually
// linked to it.
router.put(
  "/work-types/:workTypeId/vendor-site-afes",
  async (req, res): Promise<void> => {
    if (!requireSystemAdmin(req, res)) return;
    const workTypeId = parseInt(req.params.workTypeId, 10);
    if (isNaN(workTypeId)) {
      sendApiError(res, 400, "work_type.invalid_id", "Invalid work type id");
      return;
    }
    const [wt] = await db
      .select({ id: workTypesTable.id })
      .from(workTypesTable)
      .where(eq(workTypesTable.id, workTypeId))
      .limit(1);
    if (!wt) {
      sendApiError(res, 404, "work_type.not_found", "Work type not found");
      return;
    }
    const items = Array.isArray(req.body?.items)
      ? (req.body.items as Array<{
          vendorId?: unknown;
          siteLocationId?: unknown;
          afe?: unknown;
        }>)
      : null;
    if (!items) {
      sendApiError(res, 400, "validation.items_required", "items array required");
      return;
    }

    const cleaned: { vendorId: number; siteLocationId: number; afe: string }[] = [];
    for (const raw of items) {
      const vendorId = Number(raw.vendorId);
      const siteLocationId = Number(raw.siteLocationId);
      if (!Number.isInteger(vendorId) || vendorId <= 0) continue;
      if (!Number.isInteger(siteLocationId) || siteLocationId <= 0) continue;
      const afe = (raw.afe ?? "").toString().trim();
      cleaned.push({ vendorId, siteLocationId, afe });
    }

    if (cleaned.length === 0) {
      res.json({ workTypeId, saved: 0, cleared: 0 });
      return;
    }

    // Allowed pairs = (vendors linked to this work type) ×
    // (site_locations linked to this work type). Anything outside this
    // set is rejected. The catalog modal must persist site_locations
    // and vendor_work_types BEFORE calling this endpoint, otherwise
    // newly checked rows will fail validation.
    const [allowedVendorRows, allowedSiteRows] = await Promise.all([
      db
        .select({ vendorId: vendorWorkTypesTable.vendorId })
        .from(vendorWorkTypesTable)
        .where(eq(vendorWorkTypesTable.workTypeId, workTypeId)),
      db
        .select({ siteLocationId: workTypeSiteLocationsTable.siteLocationId })
        .from(workTypeSiteLocationsTable)
        .where(eq(workTypeSiteLocationsTable.workTypeId, workTypeId)),
    ]);
    const allowedVendorIds = new Set(allowedVendorRows.map((r) => r.vendorId));
    const allowedSiteIds = new Set(allowedSiteRows.map((r) => r.siteLocationId));
    const invalid = cleaned.filter(
      (it) =>
        !allowedVendorIds.has(it.vendorId) ||
        !allowedSiteIds.has(it.siteLocationId),
    );
    if (invalid.length > 0) {
      sendApiError(
        res,
        400,
        "afe.out_of_scope",
        "One or more (vendor, site_location) pairs are not in this work type's matrix",
        {
          invalid: invalid.map((it) => ({
            vendorId: it.vendorId,
            siteLocationId: it.siteLocationId,
          })),
        },
      );
      return;
    }

    let saved = 0;
    let cleared = 0;
    await db.transaction(async (tx) => {
      for (const it of cleaned) {
        if (it.afe === "") {
          const del = await tx
            .delete(vendorSiteLocationAfesTable)
            .where(
              and(
                eq(vendorSiteLocationAfesTable.vendorId, it.vendorId),
                eq(
                  vendorSiteLocationAfesTable.siteLocationId,
                  it.siteLocationId,
                ),
              ),
            )
            .returning({ id: vendorSiteLocationAfesTable.id });
          if (del.length > 0) cleared += 1;
          continue;
        }
        await tx
          .insert(vendorSiteLocationAfesTable)
          .values({
            vendorId: it.vendorId,
            siteLocationId: it.siteLocationId,
            afe: it.afe,
          })
          .onConflictDoUpdate({
            target: [
              vendorSiteLocationAfesTable.vendorId,
              vendorSiteLocationAfesTable.siteLocationId,
            ],
            set: { afe: it.afe },
          });
        saved += 1;
      }
    });

    res.json({ workTypeId, saved, cleared });
  },
);

export default router;
