import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, and, or, isNull, sql, desc } from "drizzle-orm";
import {
  db,
  partnersTable,
  workTypesTable,
  partnerWorkTypeAfesTable,
  vendorWorkTypesTable,
  partnerVendorWorkTypeApprovalsTable,
  userOrgMembershipsTable,
  insertWorkTypeSchema,
  partnerVendorRelationshipsTable,
} from "@workspace/db";
import {
  getSessionFromRequest,
  requireAdmin,
  type SessionPayload,
} from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { sendValidationFailed } from "../lib/validation-error";
import { classifySavedWorkType } from "../services/service-matching/catalog-classification";

import { createPostgresPartnerMarketplaceStore } from "../services/marketplace/partner-store";
import { catalogImportInput, importPartnerCatalog } from "../services/marketplace/partner-catalog-import";
import { MarketplaceError } from "../services/marketplace/vendor-store";
const router: IRouter = Router();

function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendApiError(res, 401, "auth.required", "Authentication required");
    return;
  }
  next();
}

function canSeePartner(session: SessionPayload, partnerId: number): boolean {
  if (session.role === "admin") return true;
  return session.role === "partner" && session.partnerId === partnerId;
}

async function requirePartnerAdmin(
  req: Request,
  partnerId: number,
): Promise<
  | { ok: true; session: SessionPayload; isSystemAdmin: boolean }
  | { ok: false; status: number; code: string; error: string }
> {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    return {
      ok: false,
      status: 401,
      code: "auth.required",
      error: "Authentication required",
    };
  }
  if (session.role === "admin") {
    return { ok: true, session, isSystemAdmin: true };
  }
  if (session.role !== "partner" || session.partnerId !== partnerId) {
    return { ok: false, status: 403, code: "auth.forbidden", error: "Active partner access required" };
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
  if (active?.role === "admin") {
    return { ok: true, session, isSystemAdmin: false };
  }
  return {
    ok: false,
    status: 403,
    code: "auth.partner_admin_required",
    error: "Partner admin access required",
  };
}

async function handlePartnerWorkTypeNameConflict(
  err: unknown,
  submittedName: string,
  partnerId: number,
  res: Response,
): Promise<boolean> {
  const cause = (err as { cause?: { code?: string; constraint?: string } })
    .cause;
  const constraints = new Set([
    "work_types_partner_canonical_name_unique",
    "work_types_global_canonical_name_unique",
    "work_types_canonical_name_unique",
  ]);
  if (cause?.code !== "23505" || !constraints.has(cause.constraint ?? "")) {
    return false;
  }
  let conflictName = submittedName;
  try {
    const [existing] = await db
      .select({ name: workTypesTable.name })
      .from(workTypesTable)
      .where(
        and(
          eq(workTypesTable.partnerId, partnerId),
          sql`lower(btrim(${workTypesTable.name})) = lower(btrim(${submittedName}))`,
        ),
      )
      .limit(1);
    if (existing?.name) conflictName = existing.name;
  } catch {
    /* ignore */
  }
  sendApiError(
    res,
    409,
    "work_type.duplicate_name",
    `A work type named "${conflictName}" already exists for this partner.`,
    { details: { name: conflictName } },
  );
  return true;
}

router.get(
  "/partners/:partnerId/work-type-afes",
  requireSession,
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    if (isNaN(partnerId)) {
      sendApiError(res, 400, "partner.invalid_id", "Invalid partner id");
      return;
    }
    const session = getSessionFromRequest(req);
    if (!session || !canSeePartner(session, partnerId)) {
      sendApiError(res, 403, "auth.forbidden", "Forbidden");
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

    const workTypes = await db
      .select()
      .from(workTypesTable)
      .where(
        eq(workTypesTable.partnerId, partnerId),
      )
      .orderBy(workTypesTable.category, workTypesTable.name);

    const mappings = await db
      .select()
      .from(partnerWorkTypeAfesTable)
      .where(eq(partnerWorkTypeAfesTable.partnerId, partnerId));

    const afeByWorkType = new Map<number, string>();
    for (const m of mappings) afeByWorkType.set(m.workTypeId, m.afe);

    // Per-row vendor count: how many vendors currently offer each work
    // type via vendor_work_types. One grouped query (no N+1) keyed by
    // workTypeId; rows with no offers won't appear in the result and
    // fall back to 0 in the map lookup.
    const vendorCounts = await db
      .select({
        workTypeId: vendorWorkTypesTable.workTypeId,
        n: sql<number>`count(*)::int`,
      })
      .from(vendorWorkTypesTable)
      .innerJoin(partnerVendorRelationshipsTable, and(
        eq(partnerVendorRelationshipsTable.vendorId, vendorWorkTypesTable.vendorId),
        eq(partnerVendorRelationshipsTable.partnerId, partnerId),
        eq(partnerVendorRelationshipsTable.status, "approved")))
      .groupBy(vendorWorkTypesTable.workTypeId);
    const vendorCountByWorkType = new Map<number, number>();
    for (const r of vendorCounts) vendorCountByWorkType.set(r.workTypeId, r.n);

    const items = workTypes.map((wt) => ({
      workTypeId: wt.id,
      name: wt.name,
      category: wt.category,
      description: wt.description ?? "",
      estimatedDuration: wt.estimatedDuration,
      estimatedPrice: wt.estimatedPrice,
      afe: afeByWorkType.get(wt.id) ?? "",
      vendorCount: vendorCountByWorkType.get(wt.id) ?? 0,
      partnerScoped: wt.partnerId != null,
    }));

    res.json({ partnerId, items });
  },
);

router.get(
  "/partners/:partnerId/work-type-approval-summary",
  requireSession,
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    if (isNaN(partnerId)) {
      sendApiError(res, 400, "partner.invalid_id", "Invalid partner id");
      return;
    }
    const session = getSessionFromRequest(req);
    if (!session || !canSeePartner(session, partnerId)) {
      sendApiError(res, 403, "auth.forbidden", "Forbidden");
      return;
    }

    const workTypes = await db
      .select({ id: workTypesTable.id })
      .from(workTypesTable)
      .where(
        eq(workTypesTable.partnerId, partnerId),
      );
    const total = workTypes.length;

    const approvedWorkTypeIds = await db
      .selectDistinct({ workTypeId: partnerVendorWorkTypeApprovalsTable.workTypeId })
      .from(partnerVendorWorkTypeApprovalsTable)
      .innerJoin(workTypesTable, eq(workTypesTable.id, partnerVendorWorkTypeApprovalsTable.workTypeId))
      .where(and(eq(partnerVendorWorkTypeApprovalsTable.partnerId, partnerId), eq(workTypesTable.partnerId, partnerId)));

    res.json({
      partnerId,
      total,
      approved: approvedWorkTypeIds.length,
    });
  },
);

router.post("/partners/:partnerId/catalog-import", requireSession, async (req, res): Promise<void> => {
  const partnerId = Number(req.params.partnerId);
  if (!Number.isSafeInteger(partnerId) || partnerId < 1) { sendApiError(res, 400, "partner.invalid_id", "Invalid partner id"); return; }
  const session = getSessionFromRequest(req);
  if (session?.publicDemo) { sendApiError(res, 403, "auth.forbidden", "Demo catalog imports are disabled"); return; }
  const auth = await requirePartnerAdmin(req, partnerId);
  if (!auth.ok) { sendApiError(res, auth.status, auth.code, auth.error); return; }
  if (!(await createPostgresPartnerMarketplaceStore().authorize(auth.session, partnerId))) { sendApiError(res, 403, "auth.forbidden", "Current partner authority required"); return; }
  const body = catalogImportInput.safeParse(req.body);
  if (!body.success) { sendValidationFailed(res, body.error); return; }
  const [partner] = await db.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.id, partnerId)).limit(1);
  if (!partner) { sendApiError(res, 404, "partner.not_found", "Partner not found"); return; }
  try { res.json(await importPartnerCatalog(partnerId, auth.session.userId!, auth.isSystemAdmin ? "admin" : "partner", body.data)); }
  catch (error) {
    if (error instanceof MarketplaceError) { sendApiError(res, error.status, error.code, error.message); return; }
    throw error;
  }
});

router.get("/partners/:partnerId/catalog-imports", requireSession, async (req, res): Promise<void> => {
  const partnerId = Number(req.params.partnerId);
  if (!Number.isSafeInteger(partnerId) || partnerId < 1) { sendApiError(res, 400, "partner.invalid_id", "Invalid partner id"); return; }
  const auth = await requirePartnerAdmin(req, partnerId);
  if (!auth.ok) { sendApiError(res, auth.status, auth.code, auth.error); return; }
  if (!(await createPostgresPartnerMarketplaceStore().authorize(auth.session, partnerId))) { sendApiError(res, 403, "auth.forbidden", "Current partner authority required"); return; }
  const { assistantActionAuditTable: audit } = await import("@workspace/db");
  const imports = await db.select({ id: audit.id, report: audit.toolOutput, createdAt: audit.createdAt }).from(audit)
    .where(and(eq(audit.partnerId, partnerId), eq(audit.targetType, "partner-catalog-import"), eq(audit.resultStatus, "completed"))).orderBy(desc(audit.id)).limit(20);
  res.json({ items: imports.map(item => ({ ...(item.report as Record<string, unknown>), importId: item.id, importedAt: item.createdAt })) });
});

router.get("/partners/:partnerId/catalog-imports/:importId/source", requireSession, async (req, res): Promise<void> => {
  const partnerId = Number(req.params.partnerId), importId = Number(req.params.importId);
  if (![partnerId, importId].every(value => Number.isSafeInteger(value) && value > 0)) { sendApiError(res, 400, "catalog.invalid_id", "Invalid import id"); return; }
  const auth = await requirePartnerAdmin(req, partnerId);
  if (!auth.ok) { sendApiError(res, auth.status, auth.code, auth.error); return; }
  if (!(await createPostgresPartnerMarketplaceStore().authorize(auth.session, partnerId))) { sendApiError(res, 403, "auth.forbidden", "Current partner authority required"); return; }
  const { assistantActionAuditTable: audit } = await import("@workspace/db");
  const [saved] = await db.select({ source: audit.toolInput }).from(audit).where(and(eq(audit.id, importId), eq(audit.partnerId, partnerId), eq(audit.targetType, "partner-catalog-import"))).limit(1);
  const source = saved?.source as { fileName?: string; sourceBase64?: string } | undefined;
  if (!source?.sourceBase64) { sendApiError(res, 404, "catalog.source_not_found", "Import source not found"); return; }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(source.fileName ?? "catalog.csv")}`);
  res.send(Buffer.from(source.sourceBase64, "base64"));
});

router.post(
  "/partners/:partnerId/work-types",
  requireSession,
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    if (isNaN(partnerId)) {
      sendApiError(res, 400, "partner.invalid_id", "Invalid partner id");
      return;
    }
    const auth = await requirePartnerAdmin(req, partnerId);
    if (!auth.ok) {
      sendApiError(res, auth.status, auth.code, auth.error);
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

    const body = insertWorkTypeSchema.safeParse(req.body);
    if (!body.success) {
      sendValidationFailed(res, body.error);
      return;
    }

    let created;
    try {
      [created] = await db
        .insert(workTypesTable)
        .values({ ...body.data, partnerId })
        .returning();
    } catch (err) {
      const handled = await handlePartnerWorkTypeNameConflict(
        err,
        body.data.name,
        partnerId,
        res,
      );
      if (handled) return;
      throw err;
    }

    await classifySavedWorkType(created.id);
    res.status(201).json(created);
  },
);

router.put("/partners/:partnerId/work-types/:workTypeId", requireSession, async (req, res): Promise<void> => {
  const partnerId = Number(req.params.partnerId);
  const workTypeId = Number(req.params.workTypeId);
  if (!Number.isInteger(partnerId) || !Number.isInteger(workTypeId)) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid ID");
    return;
  }
  const auth = await requirePartnerAdmin(req, partnerId);
  if (!auth.ok) { sendApiError(res, auth.status, auth.code, auth.error); return; }
  const body = insertWorkTypeSchema.omit({ partnerId: true }).partial().safeParse(req.body);
  if (!body.success) { sendValidationFailed(res, body.error); return; }
  try {
    const [updated] = await db.update(workTypesTable).set(body.data)
      .where(and(eq(workTypesTable.id, workTypeId), eq(workTypesTable.partnerId, partnerId))).returning();
    if (!updated) { sendApiError(res, 404, "work_type.not_found", "Work type not found"); return; }
    await classifySavedWorkType(updated.id);
    res.json(updated);
  } catch (error) {
    if (await handlePartnerWorkTypeNameConflict(error, body.data.name ?? "", partnerId, res)) return;
    throw error;
  }
});

router.post(
  "/partners/:partnerId/work-type-afes/import",
  requireAdmin,
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    if (isNaN(partnerId)) {
      sendApiError(res, 400, "partner.invalid_id", "Invalid partner id");
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

    const body = req.body as { rows?: Array<{ name?: string; afe?: string }> };
    if (!body || !Array.isArray(body.rows)) {
      sendApiError(res, 400, "validation.rows_required", "rows array required");
      return;
    }

    // Build a lookup of catalog work types by lower-cased trimmed name.
    const catalog = await db
      .select({ id: workTypesTable.id, name: workTypesTable.name })
      .from(workTypesTable).where(eq(workTypesTable.partnerId, partnerId));
    const byName = new Map<string, number>();
    for (const wt of catalog) {
      byName.set(wt.name.trim().toLowerCase(), wt.id);
    }

    // Pre-load existing mappings for this partner so we can classify
    // each row as created / updated / unchanged without a per-row read.
    const existingRows = await db
      .select()
      .from(partnerWorkTypeAfesTable)
      .where(eq(partnerWorkTypeAfesTable.partnerId, partnerId));
    const existingByWorkType = new Map<number, string>();
    for (const r of existingRows) existingByWorkType.set(r.workTypeId, r.afe);

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const unknown: string[] = [];
    const errors: { row: number; message: string }[] = [];

    // First pass: collapse the upload to one final value per work type
    // (last-write-wins), so duplicate rows are counted once and counters
    // reflect the winning value rather than the first occurrence.
    const finalByWorkType = new Map<number, string>();
    for (let i = 0; i < body.rows!.length; i++) {
      const raw = body.rows![i];
      const rowNum = i + 2; // header is row 1
      const name = (raw.name ?? "").toString().trim();
      const afe = (raw.afe ?? "").toString().trim();

      if (name === "") {
        errors.push({ row: rowNum, message: "Missing name" });
        continue;
      }
      if (afe === "") {
        // Blank AFE is skipped — the importer never deletes existing
        // mappings (that requires the explicit Save flow on the table).
        continue;
      }
      const workTypeId = byName.get(name.toLowerCase());
      if (!workTypeId) {
        if (!unknown.includes(name)) unknown.push(name);
        continue;
      }
      finalByWorkType.set(workTypeId, afe);
    }

    // Second pass: write each work type's final value once and classify
    // against the prior DB state.
    await db.transaction(async (tx) => {
      for (const [workTypeId, afe] of finalByWorkType) {
        const prior = existingByWorkType.get(workTypeId);
        await tx
          .insert(partnerWorkTypeAfesTable)
          .values({ partnerId, workTypeId, afe })
          .onConflictDoUpdate({
            target: [
              partnerWorkTypeAfesTable.partnerId,
              partnerWorkTypeAfesTable.workTypeId,
            ],
            set: { afe },
          });

        if (prior === undefined) {
          created += 1;
        } else if (prior === afe) {
          unchanged += 1;
        } else {
          updated += 1;
        }
      }
    });

    // This importer updates AFEs, not catalog wording. It also repairs missing
    // classification for the existing saved demand without changing its scope.
    for (const workTypeId of finalByWorkType.keys()) await classifySavedWorkType(workTypeId);
    res.json({
      partnerId,
      created,
      updated,
      unchanged,
      unknown,
      errors,
      total: body.rows.length,
    });
  },
);

router.put(
  "/partners/:partnerId/work-type-afes",
  requireAdmin,
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    if (isNaN(partnerId)) {
      sendApiError(res, 400, "partner.invalid_id", "Invalid partner id");
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

    const body = req.body as { items?: Array<{ workTypeId: number; afe: string }> };
    if (!body || !Array.isArray(body.items)) {
      sendApiError(res, 400, "validation.items_required", "items array required");
      return;
    }

    const workTypes = await db.select({ id: workTypesTable.id }).from(workTypesTable)
      .where(eq(workTypesTable.partnerId, partnerId));
    const validIds = new Set(workTypes.map((w) => w.id));

    let saved = 0;
    let cleared = 0;

    await db.transaction(async (tx) => {
      for (const raw of body.items!) {
        const workTypeId = Number(raw.workTypeId);
        if (!validIds.has(workTypeId)) continue;
        const afe = (raw.afe ?? "").toString().trim();

        if (afe === "") {
          const del = await tx
            .delete(partnerWorkTypeAfesTable)
            .where(
              and(
                eq(partnerWorkTypeAfesTable.partnerId, partnerId),
                eq(partnerWorkTypeAfesTable.workTypeId, workTypeId),
              ),
            )
            .returning({ id: partnerWorkTypeAfesTable.id });
          if (del.length > 0) cleared += 1;
          continue;
        }

        // Atomic upsert; relies on the unique index on (partnerId, workTypeId).
        // Avoids a race where two concurrent admin saves could both miss an
        // existing row in a select-then-insert pattern and collide on the
        // unique constraint.
        await tx
          .insert(partnerWorkTypeAfesTable)
          .values({ partnerId, workTypeId, afe })
          .onConflictDoUpdate({
            target: [
              partnerWorkTypeAfesTable.partnerId,
              partnerWorkTypeAfesTable.workTypeId,
            ],
            set: { afe },
          });
        saved += 1;
      }
    });

    res.json({ partnerId, saved, cleared });
  },
);

export default router;
