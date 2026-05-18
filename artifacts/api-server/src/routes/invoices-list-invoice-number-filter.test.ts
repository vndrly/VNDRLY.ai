import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { sql } from "drizzle-orm";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// RBAC coverage for the `invoiceNumber` exact-match filter on
// GET /invoices?invoiceNumber=…
//
// The reconciliation-drift UI calls this endpoint to resolve a per-invoice
// drift warning's invoice number into a numeric id so it can deep-link to the
// detail page. Because the filter is exact-match, a vendor who guesses
// another vendor's invoice number would otherwise leak the existence (and
// id) of that invoice. The list-route's standard RBAC scoping must still
// apply on top of the new filter — that's what this test locks in.
//
// Like the sibling routes specs, this only runs when DATABASE_URL points at
// a real Postgres. Unit-only CI sees the placeholder URL from
// `src/test/setup.ts` and the suite skips.
// ---------------------------------------------------------------------------

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

const MARKER = `inv-num-rbac-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

interface SeedIds {
  adminUserId: number;
  vendorAId: number;
  vendorBId: number;
  partnerId: number;
  vendorAInvoiceNumber: string;
  vendorBInvoiceNumber: string;
}

let seeded: SeedIds | null = null;
let dbModule: typeof import("@workspace/db");
let app: express.Express;

function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin",
  });
}

function vendorCookie(userId: number, vendorId: number): string {
  return buildTestCookie({
    userId,
    role: "vendor",
    vendorId,
    displayName: "Vendor",
  });
}

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    invoicesTable,
    usersTable,
  } = dbModule;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-Partner`,
      contactName: "AP",
      contactEmail: `${MARKER}-ap@example.com`,
      billingAddress: "1 Main",
      physicalAddress: "1 Main",
      businessPhone: "5550000000",
    })
    .returning({ id: partnersTable.id });

  const [vendorA] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-VendorA`,
      contactName: "Owner A",
      contactEmail: `${MARKER}-a@example.com`,
      billingAddress: "1 A St",
    })
    .returning({ id: vendorsTable.id });

  const [vendorB] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-VendorB`,
      contactName: "Owner B",
      contactEmail: `${MARKER}-b@example.com`,
      billingAddress: "1 B St",
    })
    .returning({ id: vendorsTable.id });

  // Each vendor gets one draft invoice. The two invoice numbers are
  // intentionally distinct so the test can assert the cross-vendor lookup
  // returns nothing for VendorA looking up VendorB's number.
  const vendorAInvoiceNumber = `${MARKER}-A-INV-1`;
  const vendorBInvoiceNumber = `${MARKER}-B-INV-1`;

  await db.insert(invoicesTable).values([
    {
      invoiceNumber: vendorAInvoiceNumber,
      vendorId: vendorA.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 0, 31)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    },
    {
      invoiceNumber: vendorBInvoiceNumber,
      vendorId: vendorB.id,
      partnerId: partner.id,
      cadence: "per_ticket",
      status: "draft",
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 0, 31)),
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    },
  ]);

  // The list route decodes the session cookie directly and never looks
  // the user up by id, so a single user row is sufficient — the
  // role/vendorId carried in the cookie is what RBAC scoping reads.
  const [adminUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-admin@example.com`,
      passwordHash: "x",
      role: "admin",
      displayName: "Admin",
    })
    .returning({ id: usersTable.id });

  return {
    adminUserId: adminUser.id,
    vendorAId: vendorA.id,
    vendorBId: vendorB.id,
    partnerId: partner.id,
    vendorAInvoiceNumber,
    vendorBInvoiceNumber,
  };
}

async function cleanup(): Promise<void> {
  const { db } = dbModule;
  await db.execute(
    sql`delete from invoices where invoice_number like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from users where username like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from vendors where name like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from partners where name like ${MARKER + "-%"}`,
  );
}

describe.runIf(haveRealDb)(
  "GET /invoices?invoiceNumber= RBAC scoping",
  () => {
    beforeAll(async () => {
      dbModule = await import("@workspace/db");
      const invoicesRouter = (await import("./invoices")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use(invoicesRouter);
      attachTestErrorMiddleware(app);
      seeded = await seed();
    }, 30_000);

    afterAll(async () => {
      try {
        await cleanup();
      } catch {
        /* best-effort */
      }
    }, 30_000);

    it("admins can resolve any invoice number to its id", async () => {
      const res = await request(app)
        .get(`/invoices?invoiceNumber=${encodeURIComponent(seeded!.vendorBInvoiceNumber)}`)
        .set("Cookie", adminCookie(seeded!.adminUserId));
      expectStatus(res, 200);
      const items = (res.body as { items: { invoiceNumber: string }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0].invoiceNumber).toBe(seeded!.vendorBInvoiceNumber);
    });

    it("a vendor can look up its own invoice by number", async () => {
      const res = await request(app)
        .get(`/invoices?invoiceNumber=${encodeURIComponent(seeded!.vendorAInvoiceNumber)}`)
        .set(
          "Cookie",
          vendorCookie(seeded!.adminUserId, seeded!.vendorAId),
        );
      expectStatus(res, 200);
      const items = (res.body as { items: { invoiceNumber: string; vendorId: number }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0].invoiceNumber).toBe(seeded!.vendorAInvoiceNumber);
      expect(items[0].vendorId).toBe(seeded!.vendorAId);
    });

    it("a vendor cannot resolve another vendor's invoice number", async () => {
      // VendorA queries by VendorB's exact invoice number. The list
      // route's RBAC scoping (vendor role → vendorId equality) must
      // intersect with the new invoiceNumber filter, so the response
      // must come back empty — never 200 with the other vendor's row.
      const res = await request(app)
        .get(`/invoices?invoiceNumber=${encodeURIComponent(seeded!.vendorBInvoiceNumber)}`)
        .set(
          "Cookie",
          vendorCookie(seeded!.adminUserId, seeded!.vendorAId),
        );
      expectStatus(res, 200);
      const items = (res.body as { items: unknown[] }).items;
      expect(items).toHaveLength(0);
    });

    it("an unauthenticated request returns 401, not the row", async () => {
      // Sanity check: the auth gate runs before the filter, so the
      // existence of a known invoice number doesn't bypass it.
      const res = await request(app).get(
        `/invoices?invoiceNumber=${encodeURIComponent(seeded!.vendorAInvoiceNumber)}`,
      );
      expectStatus(res, 401);
    });
  },
);
