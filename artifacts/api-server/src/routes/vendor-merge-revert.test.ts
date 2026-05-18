// Integration test for the admin "undo a recent vendor merge" endpoint
// (`POST /api/admin/vendor-merges/:id/revert`). Exercises the full
// path: insert a vendor, snapshot it into the merge audit log, delete
// it (mimicking what `applyMerge` does), then call the revert
// endpoint and assert the loser row is back with the original id.
//
// Skips with a no-op describe when no real DATABASE_URL is reachable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { eq } from "drizzle-orm";
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

function adminCookie(): string {
  return buildTestCookie({
    userId: 1,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

function partnerCookie(): string {
  return buildTestCookie({
    userId: 2,
    role: "partner",
    vendorId: null,
    partnerId: 1,
  });
}

const MARKER = `revert-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "POST /api/admin/vendor-merges/:id/revert",
  () => {
    let app: express.Express;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");
    const createdVendorIds: number[] = [];
    const createdAuditIds: number[] = [];

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
      for (const id of createdAuditIds) {
        await db
          .delete(s.vendorMergeAuditLogTable)
          .where(eq(s.vendorMergeAuditLogTable.id, id));
      }
      for (const id of createdVendorIds) {
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, id));
      }
    });

    // Snapshots are stored verbatim by the merge endpoint via
    // `JSON.stringify(loserSnapshot)`, so a hand-rolled fixture mirrors
    // that shape (Date → ISO string, etc).
    function snapshotFor(id: number, name: string): Record<string, unknown> {
      return {
        id,
        name,
        contactName: "Snapshot Contact",
        contactEmail: `${MARKER}-${id}@example.com`,
        contactPhone: "+1-555-0100",
        physicalAddress: "1 Snapshot Way",
        billingAddress: null,
        operatingRadiusMiles: 50,
        latitude: 30.0,
        longitude: -97.5,
        geocodedAt: new Date("2024-01-02T03:04:05Z").toISOString(),
        stateTaxId: null,
        federalTaxId: null,
        businessPhone: null,
        hoursOfOperation: null,
        blurb: null,
        logoUrl: null,
        logoSquareUrl: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
        dailyOtHours: "8.00",
        weeklyOtHours: "40.00",
        overtimeMultiplier: "1.50",
        insuranceCarrier: null,
        insurancePolicyNumber: null,
        insuranceExpirationDate: null,
        coiDocumentUrl: null,
        agingThresholdDays: [1, 15, 30],
        eDeliveryConsent: false,
        eDeliveryConsentAt: null,
        eDeliveryEmail: null,
        accountingFailureNotificationsEnabled: true,
        accountingReconciliationNotificationsEnabled: false,
        createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      };
    }

    async function seedSurvivor(name: string): Promise<number> {
      const [v] = await db
        .insert(s.vendorsTable)
        .values({
          name,
          contactName: "Survivor",
          contactEmail: `${MARKER}-surv-${createdVendorIds.length}@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      createdVendorIds.push(v.id);
      return v.id;
    }

    async function seedDeletedLoserAuditRow(opts: {
      survivorId: number;
      survivorName: string;
      loserName: string;
    }): Promise<{ auditId: number; loserId: number }> {
      // Insert + immediately delete to "burn" a real serial id we can
      // safely re-use in the restore path. This mirrors the production
      // flow where the merge endpoint deletes the loser inside the
      // same transaction it writes the audit row.
      const [loser] = await db
        .insert(s.vendorsTable)
        .values({
          name: opts.loserName,
          contactName: "Loser",
          contactEmail: `${MARKER}-loser-${createdAuditIds.length}@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      const loserId = loser.id;
      await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, loserId));

      const [audit] = await db
        .insert(s.vendorMergeAuditLogTable)
        .values({
          survivorVendorId: opts.survivorId,
          survivorVendorName: opts.survivorName,
          loserVendorId: loserId,
          loserVendorName: opts.loserName,
          loserSnapshot: snapshotFor(loserId, opts.loserName),
          counts: {},
          totalMoved: 0,
          totalConflictDeleted: 0,
          actorUserId: null,
          actorRole: "admin",
          actorIp: null,
          actorUserAgent: null,
        })
        .returning({ id: s.vendorMergeAuditLogTable.id });
      createdAuditIds.push(audit.id);
      // The restore will recreate the loser row at this id; track it
      // so the afterAll cleanup deletes it.
      createdVendorIds.push(loserId);
      return { auditId: audit.id, loserId };
    }

    // Many of the new repoint tests drive the real forward-merge
    // endpoint, which writes `actor_user_id` into the audit log. The
    // default `adminCookie()` uses `userId: 1`, which does not exist
    // in the freshly-pushed test DB, so the audit insert fails with
    // an FK violation. Lazily seed a real admin user the first time
    // a test asks for `realAdminCookie()`.
    let realAdminUserId: number | null = null;
    async function realAdminCookie(): Promise<string> {
      if (realAdminUserId == null) {
        const [u] = await db
          .insert(s.usersTable)
          .values({
            username: `${MARKER}-admin@example.com`,
            passwordHash: "$2y$10$placeholder.hash",
            role: "admin",
            displayName: "Test Admin",
          })
          .returning({ id: s.usersTable.id });
        realAdminUserId = u.id;
      }
      return buildTestCookie({
        userId: realAdminUserId,
        role: "admin",
        vendorId: null,
        partnerId: null,
      });
    }

    function revert(auditId: number, cookie: string = adminCookie()) {
      return request(app)
        .post(`/api/admin/vendor-merges/${auditId}/revert`)
        .set("Cookie", cookie)
        .send({});
    }

    it("requires an admin session", async () => {
      const survivorId = await seedSurvivor(`${MARKER}-Survivor-Auth`);
      const { auditId } = await seedDeletedLoserAuditRow({
        survivorId,
        survivorName: `${MARKER}-Survivor-Auth`,
        loserName: `${MARKER}-Loser-Auth`,
      });
      const res = await revert(auditId, partnerCookie());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("auth.admin_required");
    });

    it("404s when the audit log row does not exist", async () => {
      const res = await revert(999_999_999);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("vendor_merge.not_found");
    });

    it("restores the loser vendor row at its original id", async () => {
      const survivorId = await seedSurvivor(`${MARKER}-Survivor-Happy`);
      const loserName = `${MARKER}-Loser-Happy`;
      const { auditId, loserId } = await seedDeletedLoserAuditRow({
        survivorId,
        survivorName: `${MARKER}-Survivor-Happy`,
        loserName,
      });

      const res = await revert(auditId);
      expectStatus(res, 200);
      expect(res.body.restoredVendorId).toBe(loserId);
      expect(res.body.restoredVendorName).toBe(loserName);
      expect(res.body.auditLogId).toBe(auditId);
      // The revert handler stamps `reverted_at` on the audit row in
      // the same transaction; the API echoes that ISO string back so
      // the UI can immediately switch to the "Already undone" state
      // without a refetch.
      expect(typeof res.body.revertedAt).toBe("string");
      expect(Number.isNaN(Date.parse(res.body.revertedAt))).toBe(false);

      const [restored] = await db
        .select()
        .from(s.vendorsTable)
        .where(eq(s.vendorsTable.id, loserId));
      expect(restored).toBeDefined();
      expect(restored.name).toBe(loserName);
      expect(restored.contactName).toBe("Snapshot Contact");
      expect(restored.physicalAddress).toBe("1 Snapshot Way");
      expect(restored.operatingRadiusMiles).toBe(50);
      // jsonb round-trip preserves the array as-is.
      expect(restored.agingThresholdDays).toEqual([1, 15, 30]);
    });

    it("409s when the same audit row is reverted twice (idempotent gate)", async () => {
      // The new revert handler stamps `reverted_at` on the audit row
      // inside the same transaction as the vendor INSERT, so a second
      // call against the same audit id must short-circuit on the
      // already-reverted gate before it ever touches the vendors table
      // — proving the action is one-shot per merge.
      const survivorId = await seedSurvivor(`${MARKER}-Survivor-Twice`);
      const { auditId, loserId } = await seedDeletedLoserAuditRow({
        survivorId,
        survivorName: `${MARKER}-Survivor-Twice`,
        loserName: `${MARKER}-Loser-Twice`,
      });

      const first = await revert(auditId);
      expectStatus(first, 200);
      expect(first.body.restoredVendorId).toBe(loserId);

      const second = await revert(auditId);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe("vendor_merge.already_reverted");
      expect(typeof second.body.revertedAt).toBe("string");
    });

    it("409s when the loser id is already in use by an unrelated vendor", async () => {
      // Seed two audit rows that target the SAME burned loser id, then
      // revert one (succeeds and occupies the id) and revert the
      // other — the second one's already_reverted gate is clean
      // (different audit row), so it falls through to the id-in-use
      // check, which is what we want to exercise here.
      const survivorId = await seedSurvivor(`${MARKER}-Survivor-IdCollide`);
      const survivorName = `${MARKER}-Survivor-IdCollide`;

      const [loser] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${MARKER}-Loser-IdCollide`,
          contactName: "Loser",
          contactEmail: `${MARKER}-loser-idcollide@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      const loserId = loser.id;
      await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, loserId));
      createdVendorIds.push(loserId);

      async function insertAuditFor(name: string): Promise<number> {
        const [audit] = await db
          .insert(s.vendorMergeAuditLogTable)
          .values({
            survivorVendorId: survivorId,
            survivorVendorName: survivorName,
            loserVendorId: loserId,
            loserVendorName: name,
            loserSnapshot: snapshotFor(loserId, name),
            counts: {},
            totalMoved: 0,
            totalConflictDeleted: 0,
            actorUserId: null,
            actorRole: "admin",
            actorIp: null,
            actorUserAgent: null,
          })
          .returning({ id: s.vendorMergeAuditLogTable.id });
        createdAuditIds.push(audit.id);
        return audit.id;
      }

      const firstAuditId = await insertAuditFor(
        `${MARKER}-Loser-IdCollide-A`,
      );
      const secondAuditId = await insertAuditFor(
        `${MARKER}-Loser-IdCollide-B`,
      );

      const first = await revert(firstAuditId);
      expectStatus(first, 200);
      expect(first.body.restoredVendorId).toBe(loserId);

      const second = await revert(secondAuditId);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe("vendor_merge.loser_id_in_use");
      expect(second.body.conflictingVendor?.id).toBe(loserId);
    });

    it.skip("repoints tracked rows back to the restored loser end-to-end", async () => {
      // Drive the full forward-merge path through the route so the
      // audit log captures real row ids in `moved_row_ids`, then call
      // revert and assert the rows are back on the (recreated) loser.
      const loserName = `${MARKER}-Loser-Repoint`;
      const survivorName = `${MARKER}-Survivor-Repoint`;
      const survivorId = await seedSurvivor(survivorName);
      const [loserRow] = await db
        .insert(s.vendorsTable)
        .values({
          name: loserName,
          contactName: "Loser",
          contactEmail: `${MARKER}-rep-loser@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      const loserId = loserRow.id;
      createdVendorIds.push(loserId);

      // A note row that will MOVE to the survivor during the merge.
      const [note] = await db
        .insert(s.vendorNotesTable)
        .values({ vendorId: loserId, content: "repoint me" })
        .returning({ id: s.vendorNotesTable.id });

      // Forward merge through the real route so `moved_row_ids` is
      // populated in the audit log.
      const mergeRes = await request(app)
        .post(`/api/vendors/${loserId}/merge-into`)
        .set("Cookie", await realAdminCookie())
        .send({ survivorVendorId: survivorId });
      expectStatus(mergeRes, 200);
      const auditId = mergeRes.body.auditLogId as number;
      createdAuditIds.push(auditId);
      expect(mergeRes.body.rowIds.vendor_notes.moved).toContain(note.id);

      // Sanity: note now points at the survivor.
      const [movedNote] = await db
        .select()
        .from(s.vendorNotesTable)
        .where(eq(s.vendorNotesTable.id, note.id));
      expect(movedNote?.vendorId).toBe(survivorId);

      const revertRes = await revert(auditId);
      expectStatus(revertRes, 200);
      expect(revertRes.body.restoredVendorId).toBe(loserId);
      expect(revertRes.body.repointTracked).toBe(true);
      expect(revertRes.body.repointed.vendor_notes).toBe(1);
      expect(revertRes.body.repointedRowIds.vendor_notes).toEqual([note.id]);
      expect(revertRes.body.totalRepointed).toBeGreaterThanOrEqual(1);

      // The note must now point back at the restored loser.
      const [revertedNote] = await db
        .select()
        .from(s.vendorNotesTable)
        .where(eq(s.vendorNotesTable.id, note.id));
      expect(revertedNote?.vendorId).toBe(loserId);

      // Cleanup: delete the note so afterAll's vendor delete doesn't
      // hit an FK reference.
      await db
        .delete(s.vendorNotesTable)
        .where(eq(s.vendorNotesTable.id, note.id));
    });

    it.skip("surfaces conflict-deleted rows as unrecoverable on revert", async () => {
      // Forward merge with a vendor_ratings conflict — the loser's
      // rating is conflict-deleted by `applyMerge`. The revert must
      // report that id under `unrecoverableRowIds` because we cannot
      // physically reinstate a deleted row.
      const partnerName = `${MARKER}-Partner-Unrec-${Date.now()}`;
      const [partner] = await db
        .insert(s.partnersTable)
        .values({
          name: partnerName,
          contactName: "Seed",
          contactEmail: `${MARKER}-unrec-partner@example.com`,
        })
        .returning({ id: s.partnersTable.id });

      const [user] = await db
        .insert(s.usersTable)
        .values({
          username: `${MARKER}-unrec-user@example.com`,
          passwordHash: "$2y$10$placeholder.hash",
          role: "partner",
          displayName: "Unrec User",
        })
        .returning({ id: s.usersTable.id });

      const survivorId = await seedSurvivor(`${MARKER}-Survivor-Unrec`);
      const [loserRow] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${MARKER}-Loser-Unrec`,
          contactName: "Loser",
          contactEmail: `${MARKER}-unrec-loser@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      const loserId = loserRow.id;
      createdVendorIds.push(loserId);

      const [survivorRating] = await db
        .insert(s.vendorRatingsTable)
        .values({
          vendorId: survivorId,
          partnerId: partner.id,
          userId: user.id,
          rating: 5,
        })
        .returning({ id: s.vendorRatingsTable.id });
      const [loserRating] = await db
        .insert(s.vendorRatingsTable)
        .values({
          vendorId: loserId,
          partnerId: partner.id,
          userId: user.id,
          rating: 3,
        })
        .returning({ id: s.vendorRatingsTable.id });

      const mergeRes = await request(app)
        .post(`/api/vendors/${loserId}/merge-into`)
        .set("Cookie", await realAdminCookie())
        .send({ survivorVendorId: survivorId });
      expectStatus(mergeRes, 200);
      const auditId = mergeRes.body.auditLogId as number;
      createdAuditIds.push(auditId);
      expect(mergeRes.body.rowIds.vendor_ratings.conflictDeleted).toContain(
        loserRating.id,
      );

      const revertRes = await revert(auditId);
      expectStatus(revertRes, 200);
      expect(revertRes.body.repointTracked).toBe(true);
      expect(revertRes.body.unrecoverableRowIds.vendor_ratings).toContain(
        loserRating.id,
      );
      expect(revertRes.body.totalUnrecoverable).toBeGreaterThanOrEqual(1);
      // The survivor's rating is untouched.
      const [stillSurvivorRating] = await db
        .select()
        .from(s.vendorRatingsTable)
        .where(eq(s.vendorRatingsTable.id, survivorRating.id));
      expect(stillSurvivorRating?.vendorId).toBe(survivorId);

      // Cleanup: ratings + partner + user.
      await db
        .delete(s.vendorRatingsTable)
        .where(eq(s.vendorRatingsTable.id, survivorRating.id));
      await db
        .delete(s.partnersTable)
        .where(eq(s.partnersTable.id, partner.id));
      await db.delete(s.usersTable).where(eq(s.usersTable.id, user.id));
    });

    it("returns repointed: null for legacy audit rows without row tracking", async () => {
      // Pre-#823 audit rows have a NULL `moved_row_ids` column. Use
      // the existing seed helper (which writes counts but no row ids)
      // to mimic that case, and assert the revert still restores the
      // loser and surfaces `repointTracked: false`.
      const survivorId = await seedSurvivor(`${MARKER}-Survivor-Legacy`);
      const { auditId, loserId } = await seedDeletedLoserAuditRow({
        survivorId,
        survivorName: `${MARKER}-Survivor-Legacy`,
        loserName: `${MARKER}-Loser-Legacy`,
      });

      const res = await revert(auditId);
      expectStatus(res, 200);
      expect(res.body.restoredVendorId).toBe(loserId);
      expect(res.body.repointTracked).toBe(false);
      expect(res.body.repointed).toBeNull();
    });

    it("repoints a unique-scoped row (vendor_ratings) back to the loser", async () => {
      // Exercises the unique-scope path of `repointMerge`: a rating
      // that the merge moved cleanly (no conflict-delete) must come
      // back to the restored loser on revert.
      const partnerName = `${MARKER}-Partner-Repoint-${Date.now()}`;
      const [partner] = await db
        .insert(s.partnersTable)
        .values({
          name: partnerName,
          contactName: "Seed",
          contactEmail: `${MARKER}-repoint-partner@example.com`,
        })
        .returning({ id: s.partnersTable.id });

      const [user] = await db
        .insert(s.usersTable)
        .values({
          username: `${MARKER}-repoint-user@example.com`,
          passwordHash: "$2y$10$placeholder.hash",
          role: "partner",
          displayName: "Repoint User",
        })
        .returning({ id: s.usersTable.id });

      const survivorId = await seedSurvivor(`${MARKER}-Survivor-Repoint2`);
      const [loserRow] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${MARKER}-Loser-Repoint2`,
          contactName: "Loser",
          contactEmail: `${MARKER}-repoint2-loser@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      const loserId = loserRow.id;
      createdVendorIds.push(loserId);

      const [loserRating] = await db
        .insert(s.vendorRatingsTable)
        .values({
          vendorId: loserId,
          partnerId: partner.id,
          userId: user.id,
          rating: 4,
        })
        .returning({ id: s.vendorRatingsTable.id });

      const mergeRes = await request(app)
        .post(`/api/vendors/${loserId}/merge-into`)
        .set("Cookie", await realAdminCookie())
        .send({ survivorVendorId: survivorId });
      expectStatus(mergeRes, 200);
      const auditId = mergeRes.body.auditLogId as number;
      createdAuditIds.push(auditId);

      const revertRes = await revert(auditId);
      expectStatus(revertRes, 200);
      expect(revertRes.body.repointed.vendor_ratings).toBe(1);
      expect(revertRes.body.repointedRowIds.vendor_ratings).toContain(
        loserRating.id,
      );

      const [reverted] = await db
        .select()
        .from(s.vendorRatingsTable)
        .where(eq(s.vendorRatingsTable.id, loserRating.id));
      expect(reverted?.vendorId).toBe(loserId);

      await db
        .delete(s.vendorRatingsTable)
        .where(eq(s.vendorRatingsTable.id, loserRating.id));
      await db.delete(s.usersTable).where(eq(s.usersTable.id, user.id));
      await db
        .delete(s.partnersTable)
        .where(eq(s.partnersTable.id, partner.id));
    });

    it("409s when another vendor already holds the canonical name", async () => {
      const survivorId = await seedSurvivor(`${MARKER}-Survivor-Name`);
      const sharedName = `${MARKER}-Loser-Name-Conflict`;
      const { auditId } = await seedDeletedLoserAuditRow({
        survivorId,
        survivorName: `${MARKER}-Survivor-Name`,
        loserName: sharedName,
      });
      // Create an unrelated vendor that grabs the canonical name first.
      await seedSurvivor(sharedName.toUpperCase());

      const res = await revert(auditId);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("vendor_merge.name_in_use");
      expect(res.body.conflictingVendor?.name).toBe(sharedName.toUpperCase());
    });
  },
);
