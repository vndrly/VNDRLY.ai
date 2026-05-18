// Integration tests for the admin-only vendor-merge endpoints
// (`POST /api/vendors/:id/merge-preview` and
// `POST /api/vendors/:id/merge-into`).
//
// These endpoints share a real `pg.Pool` transaction with the shared
// `vendor-merge` lib, do partial-unique-index preflights, and write an
// audit-log row inside the apply transaction. None of that is meaningful
// to mock — the contract IS the SQL — so we mount the real router
// against the isolated test DB and exercise every branch end-to-end.
//
// Skips with a no-op `describe` when no real DATABASE_URL is reachable
// so the unit suite keeps running in offline CI (matching the pattern
// used in `vendors-create-duplicate.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { eq, inArray, sql } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkRealDb();

async function checkRealDb(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  if (DATABASE_URL.includes("test:test@localhost")) return false;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

const MARKER = `merge-route-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

function adminCookie(userId = 1): string {
  return buildTestCookie({
    userId,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

function partnerCookie(): string {
  return buildTestCookie({
    userId: 1,
    role: "partner",
    vendorId: null,
    partnerId: 1,
  });
}

describe.runIf(haveRealDb)(
  "POST /api/vendors/:id/merge-preview & /merge-into",
  () => {
    let app: express.Express;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");

    // Track every row this suite seeds so the afterAll cleanup can target
    // only the marker rows (the test DB is shared across files within a
    // single run; deleting unrelated rows would break other suites).
    const createdVendorIds: number[] = [];
    const createdPartnerIds: number[] = [];
    const createdUserIds: number[] = [];
    const createdInvoiceIds: number[] = [];
    const createdRatingIds: number[] = [];
    const createdNoteIds: number[] = [];
    const createdAuditLogIds: number[] = [];

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      const router = (await import("./vendors")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);
      attachTestErrorMiddleware(app);
    });

    afterAll(async () => {
      // Order matters: rows that reference vendors/partners must be
      // removed before those parent rows so FK cascades don't fight
      // with explicit deletes.
      if (createdAuditLogIds.length) {
        await db
          .delete(s.vendorMergeAuditLogTable)
          .where(inArray(s.vendorMergeAuditLogTable.id, createdAuditLogIds));
      }
      if (createdNoteIds.length) {
        await db
          .delete(s.vendorNotesTable)
          .where(inArray(s.vendorNotesTable.id, createdNoteIds));
      }
      if (createdRatingIds.length) {
        await db
          .delete(s.vendorRatingsTable)
          .where(inArray(s.vendorRatingsTable.id, createdRatingIds));
      }
      if (createdInvoiceIds.length) {
        await db
          .delete(s.invoicesTable)
          .where(inArray(s.invoicesTable.id, createdInvoiceIds));
      }
      if (createdVendorIds.length) {
        await db
          .delete(s.vendorsTable)
          .where(inArray(s.vendorsTable.id, createdVendorIds));
      }
      if (createdPartnerIds.length) {
        await db
          .delete(s.partnersTable)
          .where(inArray(s.partnersTable.id, createdPartnerIds));
      }
      if (createdUserIds.length) {
        await db
          .delete(s.usersTable)
          .where(inArray(s.usersTable.id, createdUserIds));
      }
    });

    let nameCounter = 0;
    async function seedVendor(label: string): Promise<{ id: number; name: string }> {
      nameCounter += 1;
      const name = `${MARKER}-${label}-${nameCounter}`;
      const [v] = await db
        .insert(s.vendorsTable)
        .values({
          name,
          contactName: "Seed",
          contactEmail: `${MARKER}-${label}-${nameCounter}@example.com`,
        })
        .returning({ id: s.vendorsTable.id, name: s.vendorsTable.name });
      createdVendorIds.push(v.id);
      return v;
    }

    let partnerCounter = 0;
    async function seedPartner(label = "P"): Promise<number> {
      partnerCounter += 1;
      const [p] = await db
        .insert(s.partnersTable)
        .values({
          name: `${MARKER}-${label}-${partnerCounter}`,
          contactName: "Seed",
          contactEmail: `${MARKER}-${label}-${partnerCounter}@example.com`,
        })
        .returning({ id: s.partnersTable.id });
      createdPartnerIds.push(p.id);
      return p.id;
    }

    let userCounter = 0;
    async function seedUser(role = "admin"): Promise<number> {
      userCounter += 1;
      const username = `${MARKER}-user-${userCounter}@example.com`;
      const [u] = await db
        .insert(s.usersTable)
        .values({
          username,
          passwordHash: "$2y$10$placeholder.hash.never.matches.anything",
          role,
          displayName: username,
        })
        .returning({ id: s.usersTable.id });
      createdUserIds.push(u.id);
      return u.id;
    }

    async function seedNote(vendorId: number, content: string): Promise<number> {
      const [n] = await db
        .insert(s.vendorNotesTable)
        .values({ vendorId, content })
        .returning({ id: s.vendorNotesTable.id });
      createdNoteIds.push(n.id);
      return n.id;
    }

    async function seedRating(
      vendorId: number,
      partnerId: number,
      userId: number,
      rating = 5,
    ): Promise<number> {
      const [r] = await db
        .insert(s.vendorRatingsTable)
        .values({ vendorId, partnerId, userId, rating })
        .returning({ id: s.vendorRatingsTable.id });
      createdRatingIds.push(r.id);
      return r.id;
    }

    async function seedDraftInvoice(
      vendorId: number,
      partnerId: number,
      periodStartIso: string,
      periodEndIso: string,
    ): Promise<number> {
      // The unique partial index that the merge preflight watches is
      // `(vendor_id, partner_id, cadence, period_start)` WHERE
      // status='draft' AND supplemental_of_invoice_id IS NULL AND
      // cadence <> 'per_ticket'. Use 'monthly' so the index applies.
      nameCounter += 1;
      const [i] = await db
        .insert(s.invoicesTable)
        .values({
          invoiceNumber: `${MARKER}-INV-${nameCounter}`,
          vendorId,
          partnerId,
          cadence: "monthly",
          status: "draft",
          periodStart: new Date(periodStartIso),
          periodEnd: new Date(periodEndIso),
        })
        .returning({ id: s.invoicesTable.id });
      createdInvoiceIds.push(i.id);
      return i.id;
    }

    // Pick a vendor id we know is not in the DB. We don't try -1 because
    // SERIAL PRIMARY KEY can technically hold negatives but the route's
    // Number(req.params.id) parses any int. Use a very high number that
    // is overwhelmingly unlikely to exist alongside the test seed.
    function unusedVendorId(): number {
      return 2_000_000_000 + Math.floor(Math.random() * 1_000_000);
    }

    // ──────────────────────────────────────────────────────────────
    // Auth gate
    // ──────────────────────────────────────────────────────────────

    it("merge-preview returns 401 without a session cookie", async () => {
      const loser = await seedVendor("auth-loser");
      const survivor = await seedVendor("auth-survivor");

      const res = await request(app)
        .post(`/api/vendors/${loser.id}/merge-preview`)
        .send({ survivorVendorId: survivor.id });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("auth.not_authenticated");
    });

    it("merge-into returns 401 without a session cookie", async () => {
      const loser = await seedVendor("auth-loser");
      const survivor = await seedVendor("auth-survivor");

      const res = await request(app)
        .post(`/api/vendors/${loser.id}/merge-into`)
        .send({ survivorVendorId: survivor.id });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("auth.not_authenticated");
    });

    it("merge-preview returns 403 for non-admin (partner) sessions", async () => {
      const loser = await seedVendor("auth-loser");
      const survivor = await seedVendor("auth-survivor");

      const res = await request(app)
        .post(`/api/vendors/${loser.id}/merge-preview`)
        .set("Cookie", partnerCookie())
        .send({ survivorVendorId: survivor.id });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("auth.admin_required");
    });

    it("merge-into returns 403 for non-admin (partner) sessions", async () => {
      const loser = await seedVendor("auth-loser");
      const survivor = await seedVendor("auth-survivor");

      const res = await request(app)
        .post(`/api/vendors/${loser.id}/merge-into`)
        .set("Cookie", partnerCookie())
        .send({ survivorVendorId: survivor.id });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("auth.admin_required");
    });

    // ──────────────────────────────────────────────────────────────
    // Validation
    // ──────────────────────────────────────────────────────────────

    it("rejects self-merge with 400 on merge-preview", async () => {
      const v = await seedVendor("self");

      const res = await request(app)
        .post(`/api/vendors/${v.id}/merge-preview`)
        .set("Cookie", adminCookie())
        .send({ survivorVendorId: v.id });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("vendor.cannot_merge_self");
    });

    it("rejects self-merge with 400 on merge-into", async () => {
      const v = await seedVendor("self");

      const res = await request(app)
        .post(`/api/vendors/${v.id}/merge-into`)
        .set("Cookie", adminCookie())
        .send({ survivorVendorId: v.id });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("vendor.cannot_merge_self");
    });

    it("returns 404 when the loser vendor does not exist (preview)", async () => {
      const survivor = await seedVendor("404-survivor");

      const res = await request(app)
        .post(`/api/vendors/${unusedVendorId()}/merge-preview`)
        .set("Cookie", adminCookie())
        .send({ survivorVendorId: survivor.id });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("vendor.loser_not_found");
    });

    it("returns 404 when the survivor vendor does not exist (preview)", async () => {
      const loser = await seedVendor("404-loser");

      const res = await request(app)
        .post(`/api/vendors/${loser.id}/merge-preview`)
        .set("Cookie", adminCookie())
        .send({ survivorVendorId: unusedVendorId() });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("vendor.survivor_not_found");
    });

    it("returns 404 when the loser vendor does not exist (merge-into)", async () => {
      const survivor = await seedVendor("404-survivor");

      const res = await request(app)
        .post(`/api/vendors/${unusedVendorId()}/merge-into`)
        .set("Cookie", adminCookie())
        .send({ survivorVendorId: survivor.id });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("vendor.loser_not_found");
    });

    it("returns 404 when the survivor vendor does not exist (merge-into)", async () => {
      // The route shares loadMergePair with merge-preview, but pinning
      // both endpoints makes the symmetry explicit so a future change
      // that diverges the apply-path's preflight can't sneak past CI.
      const loser = await seedVendor("404-loser");

      const res = await request(app)
        .post(`/api/vendors/${loser.id}/merge-into`)
        .set("Cookie", adminCookie())
        .send({ survivorVendorId: unusedVendorId() });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("vendor.survivor_not_found");
    });

    // ──────────────────────────────────────────────────────────────
    // Happy path: preview is read-only
    // ──────────────────────────────────────────────────────────────

    it(
      "merge-preview returns per-table counts and does not mutate any rows",
      async () => {
        const loser = await seedVendor("preview-loser");
        const survivor = await seedVendor("preview-survivor");
        const noteId = await seedNote(loser.id, "preview note");

        const res = await request(app)
          .post(`/api/vendors/${loser.id}/merge-preview`)
          .set("Cookie", adminCookie())
          .send({ survivorVendorId: survivor.id });

        expectStatus(res, 200);
        expect(res.body.survivorVendorId).toBe(survivor.id);
        expect(res.body.survivorVendorName).toBe(survivor.name);
        expect(res.body.loserVendorId).toBe(loser.id);
        expect(res.body.loserVendorName).toBe(loser.name);
        expect(res.body.counts).toBeTypeOf("object");
        // The lib reports every FK_TABLES entry, so vendor_notes must
        // be present and reflect the seeded row queued to move.
        expect(res.body.counts.vendor_notes).toEqual({
          move: 1,
          conflictDelete: 0,
        });
        expect(res.body.totalMoved).toBeGreaterThanOrEqual(1);
        expect(res.body.totalConflictDeleted).toBe(0);

        // Crucial: the preview must roll back. The loser vendor and
        // its note must still be in place exactly as seeded.
        const [stillLoser] = await db
          .select()
          .from(s.vendorsTable)
          .where(eq(s.vendorsTable.id, loser.id));
        expect(stillLoser?.id).toBe(loser.id);

        const [stillNote] = await db
          .select()
          .from(s.vendorNotesTable)
          .where(eq(s.vendorNotesTable.id, noteId));
        expect(stillNote?.vendorId).toBe(loser.id);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Happy path: apply moves rows, deletes loser, writes audit log
    // ──────────────────────────────────────────────────────────────

    it(
      "merge-into moves FK rows, deletes the loser, and writes an audit log row",
      async () => {
        const actorId = await seedUser("admin");
        const loser = await seedVendor("apply-loser");
        const survivor = await seedVendor("apply-survivor");
        const noteId = await seedNote(loser.id, "apply note");

        const res = await request(app)
          .post(`/api/vendors/${loser.id}/merge-into`)
          .set("Cookie", adminCookie(actorId))
          .send({ survivorVendorId: survivor.id });

        expectStatus(res, 200);
        expect(res.body.survivorVendorId).toBe(survivor.id);
        expect(res.body.loserVendorId).toBe(loser.id);
        expect(res.body.counts.vendor_notes).toEqual({
          move: 1,
          conflictDelete: 0,
        });
        expect(res.body.totalMoved).toBeGreaterThanOrEqual(1);
        expect(typeof res.body.auditLogId).toBe("number");
        createdAuditLogIds.push(res.body.auditLogId);

        // The note row should now point at the survivor.
        const [movedNote] = await db
          .select()
          .from(s.vendorNotesTable)
          .where(eq(s.vendorNotesTable.id, noteId));
        expect(movedNote?.vendorId).toBe(survivor.id);

        // The loser vendor row must be gone.
        const stillLoser = await db
          .select()
          .from(s.vendorsTable)
          .where(eq(s.vendorsTable.id, loser.id));
        expect(stillLoser).toHaveLength(0);

        // The audit log row must capture survivor/loser identities,
        // counts, totals, and the actor that performed the merge.
        const [audit] = await db
          .select()
          .from(s.vendorMergeAuditLogTable)
          .where(eq(s.vendorMergeAuditLogTable.id, res.body.auditLogId));
        expect(audit).toBeDefined();
        expect(audit.survivorVendorId).toBe(survivor.id);
        expect(audit.survivorVendorName).toBe(survivor.name);
        expect(audit.loserVendorId).toBe(loser.id);
        expect(audit.loserVendorName).toBe(loser.name);
        expect(audit.actorUserId).toBe(actorId);
        expect(audit.actorRole).toBe("admin");
        expect(audit.totalMoved).toBe(res.body.totalMoved);
        expect(audit.totalConflictDeleted).toBe(res.body.totalConflictDeleted);
        expect((audit.counts as Record<string, unknown>).vendor_notes).toEqual({
          move: 1,
          conflictDelete: 0,
        });
        // Snapshot must include the loser's pre-merge fields so a future
        // support engineer can see what the deleted row looked like.
        expect((audit.loserSnapshot as { name?: string }).name).toBe(loser.name);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Generic conflict-drop path (uniqueScope tables)
    // ──────────────────────────────────────────────────────────────

    it(
      "drops loser rows that would collide on a vendor-scoped unique index (vendor_ratings)",
      async () => {
        const partnerId = await seedPartner("ratings");
        const userId = await seedUser("partner");
        const loser = await seedVendor("ratings-loser");
        const survivor = await seedVendor("ratings-survivor");

        // Both vendors get a rating from the same partner+user. Without
        // the conflict-drop pre-step the survivor's UPDATE would
        // violate `vendor_ratings_vendor_partner_unique`.
        const survivorRatingId = await seedRating(survivor.id, partnerId, userId, 5);
        const loserRatingId = await seedRating(loser.id, partnerId, userId, 3);

        const res = await request(app)
          .post(`/api/vendors/${loser.id}/merge-into`)
          .set("Cookie", adminCookie(userId))
          .send({ survivorVendorId: survivor.id });

        expectStatus(res, 200);
        expect(res.body.counts.vendor_ratings).toEqual({
          move: 0,
          conflictDelete: 1,
        });
        expect(res.body.totalConflictDeleted).toBeGreaterThanOrEqual(1);
        if (typeof res.body.auditLogId === "number") {
          createdAuditLogIds.push(res.body.auditLogId);
        }

        // The survivor's rating must still be present and the loser's
        // rating must have been deleted (not merged onto survivor).
        const remaining = await db
          .select()
          .from(s.vendorRatingsTable)
          .where(
            inArray(s.vendorRatingsTable.id, [survivorRatingId, loserRatingId]),
          );
        const ids = remaining.map((r) => r.id);
        expect(ids).toContain(survivorRatingId);
        expect(ids).not.toContain(loserRatingId);

        // Loser vendor itself is gone.
        const stillLoser = await db
          .select()
          .from(s.vendorsTable)
          .where(eq(s.vendorsTable.id, loser.id));
        expect(stillLoser).toHaveLength(0);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Partial-index conflict path (invoices)
    // ──────────────────────────────────────────────────────────────

    it(
      "returns 409 with colliding rows when a partial-index preflight (invoices) hits",
      async () => {
        const partnerId = await seedPartner("partial");
        const loser = await seedVendor("partial-loser");
        const survivor = await seedVendor("partial-survivor");

        // Two draft invoices for the same (partner, cadence='monthly',
        // periodStart, supplemental_of_invoice_id IS NULL) — once
        // re-pointed, both would collide on
        // invoices_unique_draft_per_period.
        const periodStart = "2025-01-01T00:00:00Z";
        const periodEnd = "2025-01-31T23:59:59Z";
        const survivorInvoiceId = await seedDraftInvoice(
          survivor.id,
          partnerId,
          periodStart,
          periodEnd,
        );
        const loserInvoiceId = await seedDraftInvoice(
          loser.id,
          partnerId,
          periodStart,
          periodEnd,
        );

        // Preview should surface the conflict as 409 + colliding rows.
        const previewRes = await request(app)
          .post(`/api/vendors/${loser.id}/merge-preview`)
          .set("Cookie", adminCookie())
          .send({ survivorVendorId: survivor.id });

        expect(previewRes.status).toBe(409);
        expect(previewRes.body.code).toBe("PARTIAL_CONFLICT");
        expect(previewRes.body.table).toBe("invoices");
        expect(Array.isArray(previewRes.body.rows)).toBe(true);
        expect(previewRes.body.rows.length).toBeGreaterThanOrEqual(1);
        const previewRow = previewRes.body.rows[0];
        expect(previewRow.survivor_invoice_id).toBe(survivorInvoiceId);
        expect(previewRow.loser_invoice_id).toBe(loserInvoiceId);

        // Apply must also refuse — and must not mutate.
        const applyRes = await request(app)
          .post(`/api/vendors/${loser.id}/merge-into`)
          .set("Cookie", adminCookie())
          .send({ survivorVendorId: survivor.id });

        expect(applyRes.status).toBe(409);
        expect(applyRes.body.code).toBe("PARTIAL_CONFLICT");
        expect(applyRes.body.table).toBe("invoices");

        // Sanity-check that the apply rolled back: the loser vendor and
        // both invoices are still in place exactly as seeded.
        const [stillLoser] = await db
          .select()
          .from(s.vendorsTable)
          .where(eq(s.vendorsTable.id, loser.id));
        expect(stillLoser?.id).toBe(loser.id);

        const invoices = await db
          .select({
            id: s.invoicesTable.id,
            vendorId: s.invoicesTable.vendorId,
          })
          .from(s.invoicesTable)
          .where(
            inArray(s.invoicesTable.id, [survivorInvoiceId, loserInvoiceId]),
          );
        const byId = new Map(invoices.map((i) => [i.id, i.vendorId]));
        expect(byId.get(survivorInvoiceId)).toBe(survivor.id);
        expect(byId.get(loserInvoiceId)).toBe(loser.id);

        // No audit-log row should have been written for either attempt.
        const audit = await db
          .select({ id: s.vendorMergeAuditLogTable.id })
          .from(s.vendorMergeAuditLogTable)
          .where(
            sql`${s.vendorMergeAuditLogTable.loserVendorId} = ${loser.id}`,
          );
        expect(audit).toHaveLength(0);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Per-row tracking: merge captures moved/conflict-deleted ids
    // ──────────────────────────────────────────────────────────────

    it(
      "tracks the actual primary keys of moved and conflict-deleted rows in moved_row_ids",
      async () => {
        const partnerId = await seedPartner("track");
        const userId = await seedUser("partner");
        const loser = await seedVendor("track-loser");
        const survivor = await seedVendor("track-survivor");

        // A vendor_notes row will MOVE (no unique scope) and a
        // vendor_ratings row on the loser will be CONFLICT-DELETED
        // (survivor already has one for the same partner+user).
        const noteId = await seedNote(loser.id, "track note");
        const survivorRatingId = await seedRating(
          survivor.id,
          partnerId,
          userId,
          5,
        );
        const loserRatingId = await seedRating(loser.id, partnerId, userId, 3);

        const res = await request(app)
          .post(`/api/vendors/${loser.id}/merge-into`)
          .set("Cookie", adminCookie(userId))
          .send({ survivorVendorId: survivor.id });

        expectStatus(res, 200);
        if (typeof res.body.auditLogId === "number") {
          createdAuditLogIds.push(res.body.auditLogId);
        }

        // Response carries the per-row id maps so callers don't have
        // to round-trip the audit-log row to know what moved.
        expect(res.body.rowIds.vendor_notes.moved).toEqual([noteId]);
        expect(res.body.rowIds.vendor_notes.conflictDeleted).toEqual([]);
        expect(res.body.rowIds.vendor_ratings.moved).toEqual([]);
        expect(res.body.rowIds.vendor_ratings.conflictDeleted).toEqual([
          loserRatingId,
        ]);

        // Audit-log row stores the same map for the revert handler.
        const [audit] = await db
          .select()
          .from(s.vendorMergeAuditLogTable)
          .where(eq(s.vendorMergeAuditLogTable.id, res.body.auditLogId));
        expect(audit?.movedRowIds).toBeDefined();
        const tracked = audit!.movedRowIds as Record<
          string,
          { moved: number[]; conflictDeleted: number[] }
        >;
        expect(tracked.vendor_notes.moved).toEqual([noteId]);
        expect(tracked.vendor_ratings.conflictDeleted).toEqual([loserRatingId]);
        // Untouched (the survivor's rating is unchanged).
        expect(survivorRatingId).toBeGreaterThan(0);
      },
    );
  },
);
