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
  vendorsTable,
  workTypesTable,
  vendorWorkTypesTable,
  userOrgMembershipsTable,
  siteWorkAssignmentsTable,
  siteLocationsTable,
  partnersTable,
  VENDOR_WORK_TYPE_UNITS,
  type VendorWorkTypeUnit,
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

// Vendor org admins (and VNDRLY system admins) may write. Vendors and
// other signed-in users may read so that the catalog browse experience
// can surface "performs this work" badges later. The membership-lookup
// branch mirrors orgMembers.requireOrgAdmin so the gating story is
// consistent across vendor-scoped admin actions.
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
  const [active] = await db
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
  if (active && active.role === "admin") {
    return { ok: true, session, isSystemAdmin: false };
  }
  return {
    ok: false,
    status: 403,
    body: {
      error: "Vendor admin access required",
      code: "auth.vendor_admin_required",
    },
  };
}

// Returns every work type with a `selected` flag indicating whether
// this vendor has checked it off, plus the per-row pricing fields when
// selected. Powers the vendor self-service catalog page.
router.get(
  "/vendors/:vendorId/work-types",
  requireSession,
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      sendApiError(res, 400, "vendor.invalid_id", "Invalid vendor id");
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
    const workTypes = await db
      .select({
        id: workTypesTable.id,
        name: workTypesTable.name,
        category: workTypesTable.category,
      })
      .from(workTypesTable)
      .orderBy(asc(workTypesTable.category), asc(workTypesTable.name));
    const selected = await db
      .select({
        workTypeId: vendorWorkTypesTable.workTypeId,
        unitPrice: vendorWorkTypesTable.unitPrice,
        unit: vendorWorkTypesTable.unit,
        currency: vendorWorkTypesTable.currency,
        notes: vendorWorkTypesTable.notes,
      })
      .from(vendorWorkTypesTable)
      .where(eq(vendorWorkTypesTable.vendorId, vendorId));
    const selectedById = new Map(selected.map((s) => [s.workTypeId, s]));
    res.json({
      vendorId,
      items: workTypes.map((wt) => {
        const sel = selectedById.get(wt.id);
        return {
          ...wt,
          selected: !!sel,
          unitPrice: sel?.unitPrice ?? null,
          unit: sel?.unit ?? null,
          currency: sel?.currency ?? null,
          notes: sel?.notes ?? null,
        };
      }),
    });
  },
);

// Replace-all semantics. Body accepts either:
//   { workTypeIds: number[] }                (legacy, presence-only)
//   { items: VendorWorkTypeWriteItem[] }     (preferred, per-row pricing)
// Adds rows for ids that weren't selected before, updates pricing for
// ids that already existed, removes rows whose ids are no longer
// present. Vendor admins (and system admins) only.
type VendorWorkTypeWriteItem = {
  workTypeId: number;
  unitPrice?: string | number | null;
  unit?: VendorWorkTypeUnit | null;
  currency?: string | null;
  notes?: string | null;
  // Optional free-text reason for the change, captured by the
  // "Change Pricing" modal on Vendor Detail. Persisted to
  // `last_price_change_reason` on the row only when non-blank AND
  // the row's pricing actually changed (so passing siblings through
  // with an empty reason doesn't wipe a prior reason).
  priceChangeReason?: string | null;
};

function normalizeUnitPrice(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  // Postgres numeric(12,2) — round to 2 decimals.
  return (Math.round(n * 100) / 100).toFixed(2);
}

function normalizeUnit(raw: unknown): VendorWorkTypeUnit | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw);
  return (VENDOR_WORK_TYPE_UNITS as readonly string[]).includes(s)
    ? (s as VendorWorkTypeUnit)
    : null;
}

function normalizeCurrency(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "USD";
  const s = String(raw).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : "USD";
}

function normalizeNotes(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length === 0 ? null : s.slice(0, 500);
}

router.put(
  "/vendors/:vendorId/work-types",
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      sendApiError(res, 400, "vendor.invalid_id", "Invalid vendor id");
      return;
    }
    const auth = await requireVendorAdmin(req, vendorId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }
    const body = req.body as {
      workTypeIds?: number[];
      items?: VendorWorkTypeWriteItem[];
    };
    if (!body) {
      sendApiError(res, 400, "validation.body_required", "Request body required");
      return;
    }

    // Validate ids against the catalog so a typo'd id doesn't silently
    // create a row pointing at nothing once a future work type with
    // that id appears.
    const allIds = await db
      .select({ id: workTypesTable.id })
      .from(workTypesTable);
    const validIds = new Set(allIds.map((r) => r.id));

    // Build a normalized map of (workTypeId -> normalized payload).
    // The legacy shape (`workTypeIds: number[]`) maps each id to a
    // payload with all-null pricing fields.
    const wanted = new Map<
      number,
      {
        unitPrice: string | null;
        unit: VendorWorkTypeUnit | null;
        currency: string;
        notes: string | null;
        // Per-edit, never persisted onto siblings being passed
        // through. We only stamp `last_price_change_reason` on rows
        // that actually change AND where this is non-null.
        priceChangeReason: string | null;
      }
    >();
    if (Array.isArray(body.items)) {
      for (const raw of body.items) {
        const n = Number(raw?.workTypeId);
        if (!validIds.has(n)) continue;
        wanted.set(n, {
          unitPrice: normalizeUnitPrice(raw.unitPrice),
          unit: normalizeUnit(raw.unit),
          currency: normalizeCurrency(raw.currency),
          notes: normalizeNotes(raw.notes),
          priceChangeReason: normalizeNotes(raw.priceChangeReason),
        });
      }
    } else if (Array.isArray(body.workTypeIds)) {
      for (const raw of body.workTypeIds) {
        const n = Number(raw);
        if (validIds.has(n)) {
          wanted.set(n, {
            unitPrice: null,
            unit: null,
            currency: "USD",
            notes: null,
            priceChangeReason: null,
          });
        }
      }
    } else {
      res
        .status(400)
        .json({ error: "items array or workTypeIds array required" });
      return;
    }

    let added = 0;
    let removed = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({
          workTypeId: vendorWorkTypesTable.workTypeId,
          unitPrice: vendorWorkTypesTable.unitPrice,
          unit: vendorWorkTypesTable.unit,
          currency: vendorWorkTypesTable.currency,
          notes: vendorWorkTypesTable.notes,
        })
        .from(vendorWorkTypesTable)
        .where(eq(vendorWorkTypesTable.vendorId, vendorId));
      const existingById = new Map(existing.map((r) => [r.workTypeId, r]));

      const toAdd: number[] = [];
      const toRemove: number[] = [];
      const toUpdate: number[] = [];
      for (const id of wanted.keys()) {
        if (!existingById.has(id)) toAdd.push(id);
        else {
          const cur = existingById.get(id)!;
          const want = wanted.get(id)!;
          // Only PATCH the row when at least one field actually
          // changed. Comparing nullable strings; numeric comes back
          // from drizzle as a string already.
          const changed =
            (cur.unitPrice ?? null) !== want.unitPrice ||
            (cur.unit ?? null) !== want.unit ||
            (cur.currency ?? "USD") !== want.currency ||
            (cur.notes ?? null) !== want.notes;
          if (changed) toUpdate.push(id);
        }
      }
      for (const id of existingById.keys()) {
        if (!wanted.has(id)) toRemove.push(id);
      }

      if (toAdd.length) {
        // onConflictDoNothing guards the (vendor_id, work_type_id)
        // unique index against concurrent writers (e.g. partner-side
        // catalog-conflict append racing the vendor's own save).
        await tx
          .insert(vendorWorkTypesTable)
          .values(
            toAdd.map((workTypeId) => {
              const w = wanted.get(workTypeId)!;
              return {
                vendorId,
                workTypeId,
                unitPrice: w.unitPrice,
                unit: w.unit,
                currency: w.currency,
                notes: w.notes,
              };
            }),
          )
          .onConflictDoNothing({
            target: [
              vendorWorkTypesTable.vendorId,
              vendorWorkTypesTable.workTypeId,
            ],
          });
        added = toAdd.length;
      }
      if (toRemove.length) {
        await tx
          .delete(vendorWorkTypesTable)
          .where(
            and(
              eq(vendorWorkTypesTable.vendorId, vendorId),
              inArray(vendorWorkTypesTable.workTypeId, toRemove),
            ),
          );
        removed = toRemove.length;
      }
      for (const id of toUpdate) {
        const w = wanted.get(id)!;
        await tx
          .update(vendorWorkTypesTable)
          .set({
            unitPrice: w.unitPrice,
            unit: w.unit,
            currency: w.currency,
            notes: w.notes,
            // Only stamp `last_price_change_reason` when the modal
            // actually supplied one. Passing siblings through with an
            // empty reason must not clobber a prior value.
            ...(w.priceChangeReason !== null
              ? { lastPriceChangeReason: w.priceChangeReason }
              : {}),
          })
          .where(
            and(
              eq(vendorWorkTypesTable.vendorId, vendorId),
              eq(vendorWorkTypesTable.workTypeId, id),
            ),
          );
        updated += 1;
      }
    });

    // Task #1156 — work-type pricing edits invalidate any partner
    // relationship pointing at the previous catalog cut. Fire-and-
    // forget recompute so the PUT stays snappy. The engine itself
    // doesn't auto-publish a new catalog version (the vendor admin
    // must explicitly hit POST /catalog/publish for that) but it
    // still re-derives status from the current vendor state so
    // anything that should already be `auto_unapproved` (compliance
    // lapse, missing employee) flips immediately.
    if (added > 0 || removed > 0 || updated > 0) {
      void (async () => {
        try {
          const { recomputeAllForVendor } = await import(
            "../lib/approval-derivation"
          );
          await recomputeAllForVendor(vendorId, {
            triggerReason: "vendor_pricing_changed",
            actorUserId: auth.session.userId ?? null,
            actorRole: auth.isSystemAdmin ? "system_admin" : "vendor_admin",
          });
        } catch {
          /* best-effort */
        }
      })();
    }
    res.json({ vendorId, added, removed, updated });
  },
);

// Add-only endpoint used by the partner/admin "catalog conflict"
// recovery dialog in site-location-detail. Unlike the full PUT above,
// this one is purely additive (no removes, no pricing edits) so it can
// safely be exposed to any partner-org admin or VNDRLY system admin —
// they need to be able to extend a vendor's catalog when creating an
// SWA, but they should never edit pricing or remove other rows.
router.post(
  "/vendors/:vendorId/work-types/append",
  async (req, res): Promise<void> => {
    const session = getSessionFromRequest(req);
    if (!session?.userId) {
      res
        .status(401)
        .json({ error: "Authentication required", code: "auth.required" });
      return;
    }
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      sendApiError(res, 400, "vendor.invalid_id", "Invalid vendor id");
      return;
    }
    const body = req.body as { workTypeId?: number | string };
    const workTypeId = Number(body?.workTypeId);
    if (!Number.isFinite(workTypeId) || workTypeId <= 0) {
      sendApiError(res, 400, "work_type.invalid_id", "workTypeId required");
      return;
    }

    let allowed = session.role === "admin";
    if (!allowed) {
      // Allow vendor-org admins on this vendor.
      const [vendorAdmin] = await db
        .select({ role: userOrgMembershipsTable.role })
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.userId, session.userId),
            eq(userOrgMembershipsTable.orgType, "vendor"),
            eq(userOrgMembershipsTable.vendorId, vendorId),
            eq(userOrgMembershipsTable.role, "admin"),
          ),
        )
        .limit(1);
      if (vendorAdmin) allowed = true;
    }
    if (!allowed) {
      // Allow any partner-org admin — partners need to extend a
      // vendor's catalog when creating site work assignments.
      const [partnerAdmin] = await db
        .select({ role: userOrgMembershipsTable.role })
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.userId, session.userId),
            eq(userOrgMembershipsTable.orgType, "partner"),
            eq(userOrgMembershipsTable.role, "admin"),
          ),
        )
        .limit(1);
      if (partnerAdmin) allowed = true;
    }
    if (!allowed) {
      sendApiError(
        res,
        403,
        "auth.catalog_append_required",
        "Catalog write requires admin role",
      );
      return;
    }

    // Validate the vendor and the work type both exist.
    const [vendor] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (!vendor) {
      sendApiError(res, 404, "vendor.not_found", "Vendor not found");
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

    const inserted = await db
      .insert(vendorWorkTypesTable)
      .values({
        vendorId,
        workTypeId,
        unitPrice: null,
        unit: null,
        currency: "USD",
        notes: null,
      })
      .onConflictDoNothing({
        target: [
          vendorWorkTypesTable.vendorId,
          vendorWorkTypesTable.workTypeId,
        ],
      })
      .returning({ workTypeId: vendorWorkTypesTable.workTypeId });

    res.json({
      vendorId,
      workTypeId,
      added: inserted.length > 0,
    });
  },
);

// Authz for the per-vendor site-AFE listing below: must be either a
// VNDRLY system admin or the vendor user whose vendorId matches the
// path param. We intentionally do NOT use requireVendorAdmin here —
// non-admin vendor portal users still need to see their own AFE
// references — but we still refuse cross-vendor reads.
async function requireVendorOrAdmin(
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
  if (session.role === "vendor" && session.vendorId === vendorId) {
    return { ok: true, session, isSystemAdmin: false };
  }
  return {
    ok: false,
    status: 403,
    body: {
      error: "Vendor access required",
      code: "auth.vendor_required",
    },
  };
}

// List every site this vendor is assigned to for a given work type,
// each with its AFE value (nullable). Mirrors the join shape used by
// the ticket-detail page so the AFE pills match exactly.
router.get(
  "/vendors/:vendorId/work-types/:workTypeId/site-afes",
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    const workTypeId = parseInt(String(req.params.workTypeId), 10);
    if (isNaN(vendorId) || isNaN(workTypeId)) {
      sendApiError(res, 400, "validation.invalid_id", "Invalid vendor or work type id");
      return;
    }
    const auth = await requireVendorOrAdmin(req, vendorId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
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
    const [workType] = await db
      .select({ id: workTypesTable.id })
      .from(workTypesTable)
      .where(eq(workTypesTable.id, workTypeId))
      .limit(1);
    if (!workType) {
      sendApiError(res, 404, "work_type.not_found", "Work type not found");
      return;
    }

    const rows = await db
      .select({
        assignmentId: siteWorkAssignmentsTable.id,
        siteLocationId: siteLocationsTable.id,
        siteCode: siteLocationsTable.siteCode,
        siteName: siteLocationsTable.name,
        partnerName: partnersTable.name,
        afe: siteWorkAssignmentsTable.afe,
      })
      .from(siteWorkAssignmentsTable)
      .innerJoin(
        siteLocationsTable,
        eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id),
      )
      .leftJoin(
        partnersTable,
        eq(siteLocationsTable.partnerId, partnersTable.id),
      )
      .where(
        and(
          eq(siteWorkAssignmentsTable.vendorId, vendorId),
          eq(siteWorkAssignmentsTable.workTypeId, workTypeId),
        ),
      )
      .orderBy(asc(siteLocationsTable.name));

    res.json({
      vendorId,
      workTypeId,
      items: rows.map((r) => ({
        assignmentId: r.assignmentId,
        siteLocationId: r.siteLocationId,
        siteCode: r.siteCode,
        siteName: r.siteName,
        partnerName: r.partnerName ?? null,
        afe: r.afe ?? null,
      })),
    });
  },
);

// Bulk variant of the per-work-type site-AFE listing above. Returns
// every (work_type_id, site_assignment) pair for this vendor in one
// payload so catalog browse pages can render inline AFE pills on
// each row without firing N+1 requests. Partner sessions are
// allowed read access but the row set is scoped to that partner's
// own sites so cross-tenant AFE values are never disclosed.
router.get(
  "/vendors/:vendorId/site-afes",
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      sendApiError(res, 400, "vendor.invalid_id", "Invalid vendor id");
      return;
    }
    const session = getSessionFromRequest(req);
    if (!session?.userId) {
      sendApiError(res, 401, "auth.required", "Authentication required");
      return;
    }
    let partnerScopeId: number | null = null;
    if (session.role === "admin") {
      // unrestricted
    } else if (session.role === "vendor" && session.vendorId === vendorId) {
      // unrestricted within this vendor
    } else if (session.role === "partner" && session.partnerId != null) {
      partnerScopeId = session.partnerId;
    } else {
      sendApiError(res, 403, "auth.vendor_required", "Vendor access required");
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

    const whereClause =
      partnerScopeId != null
        ? and(
            eq(siteWorkAssignmentsTable.vendorId, vendorId),
            eq(siteLocationsTable.partnerId, partnerScopeId),
          )
        : eq(siteWorkAssignmentsTable.vendorId, vendorId);

    const rows = await db
      .select({
        workTypeId: siteWorkAssignmentsTable.workTypeId,
        assignmentId: siteWorkAssignmentsTable.id,
        siteLocationId: siteLocationsTable.id,
        siteCode: siteLocationsTable.siteCode,
        siteName: siteLocationsTable.name,
        partnerName: partnersTable.name,
        afe: siteWorkAssignmentsTable.afe,
      })
      .from(siteWorkAssignmentsTable)
      .innerJoin(
        siteLocationsTable,
        eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id),
      )
      .leftJoin(
        partnersTable,
        eq(siteLocationsTable.partnerId, partnersTable.id),
      )
      .where(whereClause)
      .orderBy(asc(siteLocationsTable.name));

    res.json({
      vendorId,
      items: rows.map((r) => ({
        workTypeId: r.workTypeId,
        assignmentId: r.assignmentId,
        siteLocationId: r.siteLocationId,
        siteCode: r.siteCode,
        siteName: r.siteName,
        partnerName: r.partnerName ?? null,
        afe: r.afe ?? null,
      })),
    });
  },
);

// Returns the set of partners this vendor is currently assigned to
// (via siteWorkAssignments → siteLocations → partners), plus a flat
// (workTypeId, partnerId) mapping. The vendor catalog page uses both:
// the partner list to populate a filter dropdown, and the mapping to
// hide work types that aren't relevant to the chosen partner. Only a
// VNDRLY admin or the vendor themselves may read it.
router.get(
  "/vendors/:vendorId/work-type-partners",
  async (req, res): Promise<void> => {
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(vendorId)) {
      sendApiError(res, 400, "vendor.invalid_id", "Invalid vendor id");
      return;
    }
    const auth = await requireVendorOrAdmin(req, vendorId);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
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

    const rows = await db
      .select({
        workTypeId: siteWorkAssignmentsTable.workTypeId,
        partnerId: partnersTable.id,
        partnerName: partnersTable.name,
      })
      .from(siteWorkAssignmentsTable)
      .innerJoin(
        siteLocationsTable,
        eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id),
      )
      .innerJoin(
        partnersTable,
        eq(siteLocationsTable.partnerId, partnersTable.id),
      )
      .where(eq(siteWorkAssignmentsTable.vendorId, vendorId));

    // De-dupe partners by id (a partner with N sites/work types appears
    // many times in the join) and the (workTypeId, partnerId) pairs
    // (same vendor may have multiple SWAs for the same combo).
    const partnersById = new Map<number, { id: number; name: string }>();
    const pairKeys = new Set<string>();
    const workTypePartners: { workTypeId: number; partnerId: number }[] = [];
    for (const r of rows) {
      if (!partnersById.has(r.partnerId)) {
        partnersById.set(r.partnerId, { id: r.partnerId, name: r.partnerName });
      }
      const key = `${r.workTypeId}:${r.partnerId}`;
      if (!pairKeys.has(key)) {
        pairKeys.add(key);
        workTypePartners.push({
          workTypeId: r.workTypeId,
          partnerId: r.partnerId,
        });
      }
    }
    const partners = Array.from(partnersById.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    // Task #788 — for every partner this vendor already shows up
    // under, also enumerate the *full* set of work types that partner
    // is paying any vendor for. The catalog page subtracts the
    // vendor's own selections from this to surface "Recommended for
    // this partner" gaps so the vendor can opt in. Restricted to the
    // partners we already returned above so we don't leak the full
    // partner roster, and so the payload stays bounded.
    const partnerIds = Array.from(partnersById.keys());
    const partnerWorkTypes: { partnerId: number; workTypeId: number }[] = [];
    if (partnerIds.length > 0) {
      const allRows = await db
        .select({
          partnerId: siteLocationsTable.partnerId,
          workTypeId: siteWorkAssignmentsTable.workTypeId,
        })
        .from(siteWorkAssignmentsTable)
        .innerJoin(
          siteLocationsTable,
          eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id),
        )
        .where(inArray(siteLocationsTable.partnerId, partnerIds));
      const allPairs = new Set<string>();
      for (const r of allRows) {
        if (r.partnerId === null) continue;
        const key = `${r.partnerId}:${r.workTypeId}`;
        if (allPairs.has(key)) continue;
        allPairs.add(key);
        partnerWorkTypes.push({
          partnerId: r.partnerId,
          workTypeId: r.workTypeId,
        });
      }
    }

    res.json({ vendorId, partners, workTypePartners, partnerWorkTypes });
  },
);

export default router;
