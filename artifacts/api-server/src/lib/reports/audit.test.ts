import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// Tests for the per-invoice re-sync audit history helper. The query joins
// users for the display name and reaches into the jsonb `scope` column to
// match by invoiceId, so a unit-test mock would just re-implement the
// same SQL. Instead we seed real rows into the dev DB and assert that
// loadInvoiceResyncHistory returns them in the right order/shape, then
// clean up everything we inserted via a unique marker.

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkDatabase();

async function checkDatabase(): Promise<boolean> {
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

const MARKER = `audit-resync-test-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

let dbModule: typeof import("@workspace/db");
let auditModule: typeof import("./audit");
let seededUserId: number | null = null;
let seededAuditIds: number[] = [];
const TEST_INVOICE_ID = 9_999_999; // synthetic id; we never join invoices

beforeAll(async () => {
  if (!haveRealDb) return;
  dbModule = await import("@workspace/db");
  auditModule = await import("./audit");
  const { db, usersTable, reportExportAuditLogTable } = dbModule;

  const [user] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-u@example.com`,
      passwordHash: "x",
      role: "admin",
      displayName: `${MARKER} Operator`,
    })
    .returning({ id: usersTable.id });
  seededUserId = user.id;

  // Two re-syncs for our synthetic invoiceId, plus one re-sync for an
  // unrelated invoice (must NOT show up) and one non-resync row (also
  // must not show up).
  const inserted = await db
    .insert(reportExportAuditLogTable)
    .values([
      {
        reportKind: "vendor.quickbooksPush",
        format: "qbo_api_resync",
        scope: {
          vendorId: 1,
          invoiceId: TEST_INVOICE_ID,
          invoiceNumber: "INV-MARK",
          externalDocNumber: "QBO-DOC-1",
          externalInvoiceId: "QBO-1",
          outcome: "updated",
          warningCount: 0,
        },
        rowCount: 1,
        fileBytes: 0,
        downloadedByUserId: user.id,
        userRole: "admin",
        detailJson: null,
      },
      {
        reportKind: "vendor.openaccountantPush",
        format: "oa_api_resync",
        scope: {
          vendorId: 1,
          invoiceId: TEST_INVOICE_ID,
          invoiceNumber: "INV-MARK",
          externalInvoiceId: "OA-1",
          outcome: "missing",
        },
        rowCount: 0,
        fileBytes: 0,
        downloadedByUserId: user.id,
        userRole: "admin",
        detailJson: { message: "Remote invoice was deleted in OpenAccountant" },
      },
      {
        // Unrelated invoice — must not appear.
        reportKind: "vendor.quickbooksPush",
        format: "qbo_api_resync",
        scope: {
          vendorId: 1,
          invoiceId: TEST_INVOICE_ID + 1,
          invoiceNumber: "INV-OTHER",
          outcome: "updated",
        },
        rowCount: 1,
        fileBytes: 0,
        downloadedByUserId: user.id,
        userRole: "admin",
      },
      {
        // Bulk push (not a re-sync) — must not appear.
        reportKind: "vendor.quickbooksPush",
        format: "qbo_api_push",
        scope: {
          vendorId: 1,
          invoiceId: TEST_INVOICE_ID,
          invoiceNumber: "INV-MARK",
        },
        rowCount: 1,
        fileBytes: 0,
        downloadedByUserId: user.id,
        userRole: "admin",
      },
    ])
    .returning({ id: reportExportAuditLogTable.id });
  seededAuditIds = inserted.map((r) => r.id);
});

afterAll(async () => {
  if (!haveRealDb) return;
  const { db, usersTable, reportExportAuditLogTable } = dbModule;
  const { inArray, eq } = await import("drizzle-orm");
  if (seededAuditIds.length > 0) {
    await db
      .delete(reportExportAuditLogTable)
      .where(inArray(reportExportAuditLogTable.id, seededAuditIds));
  }
  if (seededUserId !== null) {
    await db.delete(usersTable).where(eq(usersTable.id, seededUserId));
  }
});

describe.skipIf(!haveRealDb)("loadInvoiceResyncHistory", () => {
  it("returns only the re-sync rows whose scope.invoiceId matches", async () => {
    const history = await auditModule.loadInvoiceResyncHistory(TEST_INVOICE_ID);
    // Must contain exactly the two re-sync rows we seeded for this id, and
    // ignore the unrelated invoice + the bulk push row.
    const seedIds = new Set(seededAuditIds.slice(0, 2));
    const matched = history.filter((h) => seedIds.has(h.id));
    expect(matched).toHaveLength(2);
  });

  it("maps the QBO success row with display name + outcome=updated", async () => {
    const history = await auditModule.loadInvoiceResyncHistory(TEST_INVOICE_ID);
    const qbo = history.find(
      (h) => h.id === seededAuditIds[0] && h.provider === "qbo",
    );
    expect(qbo).toBeDefined();
    expect(qbo?.outcome).toBe("updated");
    expect(qbo?.byUserDisplayName).toBe(`${MARKER} Operator`);
    expect(qbo?.byUserId).toBe(seededUserId);
    expect(qbo?.externalDocNumber).toBe("QBO-DOC-1");
    expect(qbo?.warningCount).toBe(0);
    expect(qbo?.errorMessage).toBeNull();
  });

  it("maps the OA missing row with the remote-deleted error message", async () => {
    const history = await auditModule.loadInvoiceResyncHistory(TEST_INVOICE_ID);
    const oa = history.find(
      (h) => h.id === seededAuditIds[1] && h.provider === "oa",
    );
    expect(oa).toBeDefined();
    expect(oa?.outcome).toBe("missing");
    expect(oa?.errorMessage).toBe(
      "Remote invoice was deleted in OpenAccountant",
    );
    expect(oa?.externalDocNumber).toBeNull();
  });

  it("orders newest first", async () => {
    const history = await auditModule.loadInvoiceResyncHistory(TEST_INVOICE_ID);
    const ours = history.filter((h) => seededAuditIds.includes(h.id));
    for (let i = 1; i < ours.length; i++) {
      expect(new Date(ours[i - 1].at).getTime()).toBeGreaterThanOrEqual(
        new Date(ours[i].at).getTime(),
      );
    }
  });

  it("respects the limit parameter", async () => {
    const history = await auditModule.loadInvoiceResyncHistory(
      TEST_INVOICE_ID,
      1,
    );
    expect(history.length).toBeLessThanOrEqual(1);
  });

  it("walks older pages via the beforeId cursor", async () => {
    // Page 1: newest row only.
    const page1 = await auditModule.loadInvoiceResyncHistory(TEST_INVOICE_ID, {
      limit: 1,
    });
    expect(page1).toHaveLength(1);
    // Page 2: rows strictly older than the page-1 row by id. Must
    // never include the page-1 row itself — that's the core
    // anti-duplication invariant of the cursor.
    const page2 = await auditModule.loadInvoiceResyncHistory(TEST_INVOICE_ID, {
      limit: 10,
      beforeId: page1[0].id,
    });
    expect(page2.find((r) => r.id === page1[0].id)).toBeUndefined();
    for (const r of page2) {
      expect(r.id).toBeLessThan(page1[0].id);
    }
  });
});
