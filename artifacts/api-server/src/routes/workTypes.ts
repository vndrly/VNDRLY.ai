import { Router, type IRouter } from "express";
import {
  db,
  workTypesTable,
  vendorWorkTypesTable,
  vendorsTable,
  insertWorkTypeSchema,
  workTypeSiteLocationsTable,
  siteLocationsTable,
  partnersTable,
} from "@workspace/db";
import { eq, asc, inArray, isNull, sql } from "drizzle-orm";
import { ListWorkTypesResponse } from "@workspace/api-zod";
import { requireAdmin, requireSession } from "../lib/session";
import { sendApiError } from "../lib/apiError";

import { sendValidationFailed } from "../lib/validation-error";
const router: IRouter = Router();

// Translate a Postgres unique-violation on the
// `work_types_canonical_name_unique` index (lower(btrim(name))) into a
// 409 with a friendly message and a structured `code` + `details`
// payload so the admin catalog form can render an inline error next
// to the name field via `translateApiError(err, t)`. Returns true if
// the response was handled (and the caller should bail out), false if
// the error was unrelated and should bubble up.
async function handleWorkTypeNameConflict(
  err: unknown,
  submittedName: string,
  res: import("express").Response,
): Promise<boolean> {
  const cause = (err as { cause?: { code?: string; constraint?: string } })
    .cause;
  const constraints = new Set([
    "work_types_global_canonical_name_unique",
    "work_types_canonical_name_unique",
    "work_types_partner_canonical_name_unique",
  ]);
  if (cause?.code !== "23505" || !constraints.has(cause.constraint ?? "")) {
    return false;
  }
  // Best-effort: look up the persisted row so the response shows the
  // existing stored name (preserved casing/punctuation) rather than
  // the raw text the caller submitted. Falls back to the submitted
  // name if the lookup fails for any reason.
  let conflictName = submittedName;
  try {
    const [existing] = await db
      .select({ name: workTypesTable.name })
      .from(workTypesTable)
      .where(
        sql`lower(btrim(${workTypesTable.name})) = lower(btrim(${submittedName}))`,
      )
      .limit(1);
    if (existing?.name) conflictName = existing.name;
  } catch {
    /* fall back to submittedName */
  }
  sendApiError(
    res,
    409,
    "work_type.duplicate_name",
    `A work type named "${conflictName}" already exists.`,
    { details: { name: conflictName } },
  );
  return true;
}

router.get("/work-types", requireSession, async (req, res): Promise<void> => {
  const scope = String(req.query.scope ?? "");
  const workTypes =
    scope === "platform"
      ? await db
          .select()
          .from(workTypesTable)
          .where(isNull(workTypesTable.partnerId))
          .orderBy(workTypesTable.category, workTypesTable.name)
      : await db
          .select()
          .from(workTypesTable)
          .orderBy(workTypesTable.category, workTypesTable.name);

  const vendorLinks = await db
    .select({
      workTypeId: vendorWorkTypesTable.workTypeId,
      vendorId: vendorsTable.id,
      vendorName: vendorsTable.name,
    })
    .from(vendorWorkTypesTable)
    .innerJoin(vendorsTable, eq(vendorWorkTypesTable.vendorId, vendorsTable.id));

  const vendorMap = new Map<number, { id: number; name: string }[]>();
  for (const vl of vendorLinks) {
    if (!vendorMap.has(vl.workTypeId)) vendorMap.set(vl.workTypeId, []);
    vendorMap.get(vl.workTypeId)!.push({ id: vl.vendorId, name: vl.vendorName });
  }

  const result = workTypes.map((wt) => ({
    ...wt,
    vendors: vendorMap.get(wt.id) || [],
  }));

  res.json(result);
});

router.post("/work-types", requireAdmin, async (req, res): Promise<void> => {
  const { vendorIds, partnerId: _ignoredPartnerId, ...rest } = req.body;
  const body = insertWorkTypeSchema.safeParse(rest);
  if (!body.success) {
    sendValidationFailed(res, body.error);
    return;
  }
  let created;
  try {
    [created] = await db
      .insert(workTypesTable)
      .values({ ...body.data, partnerId: null })
      .returning();
  } catch (err) {
    // The DB unique index `work_types_canonical_name_unique` (on
    // lower(btrim(name)), added in task #450) catches case- and
    // whitespace-insensitive duplicates. Translate the raw Postgres
    // unique-violation into a clean 409 with the same `code` + `details`
    // shape the partner/vendor duplicate-name responses use, so the
    // catalog form can render an inline message instead of a generic
    // toast / 500 blob.
    const handled = await handleWorkTypeNameConflict(err, body.data.name, res);
    if (handled) return;
    throw err;
  }

  if (vendorIds && Array.isArray(vendorIds) && vendorIds.length > 0) {
    await db.insert(vendorWorkTypesTable).values(
      vendorIds.map((vid: number) => ({ vendorId: vid, workTypeId: created.id }))
    );
  }

  res.status(201).json(created);
});

router.put("/work-types/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid ID");
    return;
  }
  const { vendorIds, ...rest } = req.body;
  const body = insertWorkTypeSchema.partial().safeParse(rest);
  if (!body.success) {
    sendValidationFailed(res, body.error);
    return;
  }
  let updated;
  try {
    [updated] = await db.update(workTypesTable).set(body.data).where(eq(workTypesTable.id, id)).returning();
  } catch (err) {
    // Mirror the POST handler: a rename that collides with another
    // work type's canonical name (case/whitespace-insensitive) trips
    // `work_types_canonical_name_unique`. Surface a clean 409 so the
    // catalog form can show an inline message instead of a 500 blob.
    const handled = await handleWorkTypeNameConflict(err, body.data.name ?? "", res);
    if (handled) return;
    throw err;
  }
  if (!updated) {
    sendApiError(res, 404, "work_type.not_found", "Work type not found");
    return;
  }

  if (vendorIds !== undefined && Array.isArray(vendorIds)) {
    await db.delete(vendorWorkTypesTable).where(eq(vendorWorkTypesTable.workTypeId, id));
    if (vendorIds.length > 0) {
      await db.insert(vendorWorkTypesTable).values(
        vendorIds.map((vid: number) => ({ vendorId: vid, workTypeId: id }))
      );
    }
  }

  res.json(updated);
});

type ImportRow = {
  name?: unknown;
  category?: unknown;
  description?: unknown;
  estimatedDuration?: unknown;
  estimatedPrice?: unknown;
  vendors?: unknown;
};

router.post("/work-types/import", requireAdmin, async (req, res): Promise<void> => {
  const rows: ImportRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    sendApiError(res, 400, "validation.rows_required", "No rows provided");
    return;
  }
  if (rows.length > 5000) {
    sendApiError(res, 400, "validation.too_many_rows", "Too many rows (max 5000)");
    return;
  }

  const allVendors = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable);
  const vendorByLower = new Map<string, number>();
  for (const v of allVendors) vendorByLower.set(v.name.toLowerCase().trim(), v.id);

  // Index by canonical (lower(btrim(name))) so the lookup matches the DB-side
  // work_types_canonical_name_unique index. Otherwise re-importing a row whose
  // existing canonical match differs only in case/whitespace would fall through
  // to an INSERT that now hits the unique-violation.
  const canonical = (s: string): string => s.trim().toLowerCase();
  const allWorkTypes = await db.select({ id: workTypesTable.id, name: workTypesTable.name }).from(workTypesTable);
  const workTypeByCanonical = new Map<string, number>();
  for (const wt of allWorkTypes) workTypeByCanonical.set(canonical(wt.name), wt.id);

  let created = 0;
  let updated = 0;
  const errors: { row: number; message: string }[] = [];
  const unknownVendors = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const category = typeof r.category === "string" ? r.category.trim() : "";
    if (!name) {
      errors.push({ row: i + 1, message: "Missing name" });
      continue;
    }
    if (!category) {
      errors.push({ row: i + 1, message: "Missing category" });
      continue;
    }
    const description = typeof r.description === "string" && r.description.trim() !== "" ? r.description.trim() : null;
    const estimatedDuration = typeof r.estimatedDuration === "string" && r.estimatedDuration.trim() !== "" ? r.estimatedDuration.trim() : null;
    let estimatedPrice: string | null = null;
    if (r.estimatedPrice !== null && r.estimatedPrice !== undefined && String(r.estimatedPrice).trim() !== "") {
      const cleaned = String(r.estimatedPrice).replace(/[$,\s]/g, "");
      const n = Number(cleaned);
      if (Number.isFinite(n) && n >= 0) estimatedPrice = n.toFixed(2);
      else {
        errors.push({ row: i + 1, message: `Invalid price: ${r.estimatedPrice}` });
        continue;
      }
    }

    const rawVendors: string[] = Array.isArray(r.vendors)
      ? (r.vendors as unknown[]).map(String)
      : typeof r.vendors === "string"
        ? r.vendors.split(/[;|]/).map((s) => s.trim()).filter(Boolean)
        : [];
    const vendorIds: number[] = [];
    for (const vname of rawVendors) {
      const key = vname.toLowerCase().trim();
      if (!key) continue;
      const vid = vendorByLower.get(key);
      if (vid) vendorIds.push(vid);
      else unknownVendors.add(vname);
    }

    try {
      const existingId = workTypeByCanonical.get(canonical(name));
      const uniqueVendorIds = Array.from(new Set(vendorIds));
      const result = await db.transaction(async (tx) => {
        let id: number;
        let didCreate = false;
        if (existingId) {
          await tx.update(workTypesTable)
            .set({ name, category, description, estimatedDuration, estimatedPrice })
            .where(eq(workTypesTable.id, existingId));
          id = existingId;
        } else {
          const [row] = await tx.insert(workTypesTable)
            .values({ name, category, description, estimatedDuration, estimatedPrice })
            .returning({ id: workTypesTable.id });
          id = row.id;
          didCreate = true;
        }

        await tx.delete(vendorWorkTypesTable).where(eq(vendorWorkTypesTable.workTypeId, id));
        if (uniqueVendorIds.length > 0) {
          await tx.insert(vendorWorkTypesTable).values(
            uniqueVendorIds.map((vendorId) => ({ vendorId, workTypeId: id })),
          );
        }
        return { id, didCreate };
      });

      if (result.didCreate) {
        workTypeByCanonical.set(canonical(name), result.id);
        created++;
      } else {
        updated++;
      }
    } catch (e) {
      errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  }

  res.json({
    created,
    updated,
    errors,
    unknownVendors: Array.from(unknownVendors),
    total: rows.length,
  });
});

// List the site locations linked to a work type, joined with their owning
// partner so the UI can display the partner logo above the modal header.
router.get(
  "/work-types/:id/site-locations",
  requireSession,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      sendApiError(res, 400, "work_type.invalid_id", "Invalid work type id");
      return;
    }
    const rows = await db
      .select({
        siteLocationId: siteLocationsTable.id,
        siteLocationName: siteLocationsTable.name,
        partnerId: partnersTable.id,
        partnerName: partnersTable.name,
        partnerLogoUrl: partnersTable.logoUrl,
      })
      .from(workTypeSiteLocationsTable)
      .innerJoin(
        siteLocationsTable,
        eq(workTypeSiteLocationsTable.siteLocationId, siteLocationsTable.id),
      )
      .innerJoin(
        partnersTable,
        eq(siteLocationsTable.partnerId, partnersTable.id),
      )
      .where(eq(workTypeSiteLocationsTable.workTypeId, id))
      .orderBy(asc(siteLocationsTable.id));
    res.json({ items: rows });
  },
);

router.put(
  "/work-types/:id/site-locations",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      sendApiError(res, 400, "work_type.invalid_id", "Invalid work type id");
      return;
    }
    const ids = Array.isArray(req.body?.siteLocationIds)
      ? (req.body.siteLocationIds as unknown[])
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n > 0)
      : null;
    if (ids === null) {
      sendApiError(res, 400, "site_location.ids_array_required", "siteLocationIds must be an array");
      return;
    }
    // Confirm the work type exists before mutating the join table.
    const [wt] = await db
      .select({ id: workTypesTable.id })
      .from(workTypesTable)
      .where(eq(workTypesTable.id, id))
      .limit(1);
    if (!wt) {
      sendApiError(res, 404, "work_type.not_found", "Work type not found");
      return;
    }
    const unique = Array.from(new Set(ids));
    // Validate that every requested site location actually exists, so a
    // typo doesn't silently insert a dangling link (the FK would catch it
    // but we'd rather return a clean 400 than a 500).
    if (unique.length > 0) {
      const existing = await db
        .select({ id: siteLocationsTable.id })
        .from(siteLocationsTable)
        .where(inArray(siteLocationsTable.id, unique));
      if (existing.length !== unique.length) {
        sendApiError(res, 400, "site_location.not_found", "One or more site locations not found");
        return;
      }
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(workTypeSiteLocationsTable)
        .where(eq(workTypeSiteLocationsTable.workTypeId, id));
      if (unique.length > 0) {
        await tx
          .insert(workTypeSiteLocationsTable)
          .values(unique.map((sid) => ({ workTypeId: id, siteLocationId: sid })));
      }
    });
    res.json({ siteLocationIds: unique });
  },
);

router.delete("/work-types/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid ID");
    return;
  }
  await db.delete(vendorWorkTypesTable).where(eq(vendorWorkTypesTable.workTypeId, id));
  const [deleted] = await db.delete(workTypesTable).where(eq(workTypesTable.id, id)).returning();
  if (!deleted) {
    sendApiError(res, 404, "work_type.not_found", "Work type not found");
    return;
  }
  res.json({ success: true });
});

export default router;
