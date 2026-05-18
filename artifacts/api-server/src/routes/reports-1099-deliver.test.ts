import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

import {
  fixtures,
  makeDrizzleMock,
  makeReportsDbMock,
  nextId,
  resetMockDb,
} from "../test/mock-reports-db";

// Tests for POST /api/reports/{admin,partner/:id}/1099-deliver. Verifies:
//   - vendors without eDeliveryConsent are skipped (counted, not emailed)
//   - vendors with consent get an email + a tax_1099_filings row marked
//     status='delivered', deliveryChannel='email', notes containing the email
//   - vendors with consent but no email on file are recorded as status='error'
//   - SendGrid failures are caught and recorded as status='error' with the
//     error message in `notes`
//
// We mock the db layer, drizzle helpers, the dashboard/aggregation modules,
// the PDF renderers, and SendGrid so the test stays unit-scoped.

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());

// Mock the dashboard + per-form aggregation modules so we can hand-craft
// rows without seeding invoices/payments/etc.
const mockDashboardRows: Array<{
  taxYear: number;
  formType: "NEC" | "MISC" | "K";
  payerPartnerId: number;
  payerPartnerName: string;
  recipientVendorId: number;
  recipientName: string;
  federalTaxId: string | null;
  totalReportable: string;
  eDeliveryConsent: boolean;
  filingId: number | null;
  status: string;
  filingMethod: string;
  externalReference: string | null;
  filedAt: string | null;
  deliveredAt: string | null;
  deliveryChannel: string | null;
  notes: string | null;
}> = [];

vi.mock("../lib/reports/dashboard1099", () => ({
  build1099Dashboard: vi.fn(async () => ({
    summary: {
      taxYear: 2024,
      totalRecipients: mockDashboardRows.length,
      byForm: { NEC: mockDashboardRows.length, MISC: 0, K: 0 },
      byStatus: {
        pending: 0,
        queued: 0,
        filed: 0,
        accepted: 0,
        rejected: 0,
        delivered: 0,
        error: 0,
      },
      totalReportable: "0.00",
    },
    rows: mockDashboardRows,
  })),
}));

vi.mock("../lib/reports/nec1099", () => ({
  NEC_THRESHOLD_USD: 600,
  nec1099Rows: vi.fn(async () =>
    mockDashboardRows
      .filter((r) => r.formType === "NEC")
      .map((r) => ({
        vendorId: r.recipientVendorId,
        vendorName: r.recipientName,
        federalTaxId: r.federalTaxId,
        vendorAddress: null,
        payerPartnerId: r.payerPartnerId,
        payerPartnerName: r.payerPartnerName,
        payerEin: null,
        payerAddress: null,
        totalPaid: r.totalReportable,
        sharedEinWarning: false,
      })),
  ),
}));

vi.mock("../lib/reports/misc1099", () => ({
  MISC_BOX_THRESHOLDS: {},
  misc1099Rows: vi.fn(async () => []),
}));

vi.mock("../lib/reports/k1099", () => ({
  thresholdForYear: () => 5000,
  k1099Rows: vi.fn(async () => []),
}));

vi.mock("../lib/reports/fire", () => ({
  renderFireFile: () => Buffer.from(""),
  necRowsToPayees: () => [],
  miscRowsToPayees: () => [],
  kRowsToPayees: () => [],
  parseAddress: () => ({ street: "", city: "", state: "", zip: "" }),
}));

vi.mock("../lib/reports/pdf", () => ({
  renderReportPdf: async () => Buffer.from("pdf"),
  renderNec1099Pdf: vi.fn(async () => Buffer.from("nec-pdf-bytes")),
  renderMisc1099Pdf: vi.fn(async () => Buffer.from("misc-pdf-bytes")),
  renderK1099Pdf: vi.fn(async () => Buffer.from("k-pdf-bytes")),
}));

const sendMock = vi.fn();
vi.mock("../lib/sendgrid", () => ({
  send1099RecipientEmail: (...args: unknown[]) => sendMock(...args),
  // Stubs for other helpers used by reports.ts indirectly (none currently).
}));

vi.mock("../lib/session", async () => {
  return {
    getSessionFromRequest: (req: { cookies?: Record<string, string> }) => {
      const raw = req.cookies?.["vndrly_session"];
      if (!raw) return null;
      const [body] = raw.split(".");
      try {
        return JSON.parse(Buffer.from(body, "base64").toString("utf-8"));
      } catch {
        return null;
      }
    },
    requireAdmin: (
      req: { cookies?: Record<string, string> },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void,
    ) => {
      const raw = req.cookies?.["vndrly_session"];
      if (!raw) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const [body] = raw.split(".");
      const s = JSON.parse(Buffer.from(body, "base64").toString("utf-8"));
      if (s.role !== "admin") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    },
  };
});

// Other modules pulled in by reports.ts that we don't exercise here. Make
// them no-ops so module-load doesn't fail.
vi.mock("../lib/reports/audit", () => ({
  recordExport: vi.fn(async () => undefined),
}));
vi.mock("../lib/reports/qb-mapping-audit", () => ({
  recordMappingAudit: vi.fn(async () => undefined),
}));
vi.mock("../lib/accounting/connections", () => ({
  getConnection: vi.fn(),
  updateAccessToken: vi.fn(),
  markRevoked: vi.fn(),
}));
vi.mock("../lib/accounting/qbo", () => ({
  pushBundleToQbo: vi.fn(),
  refreshAccessToken: vi.fn(),
  loadQboConfig: vi.fn(),
}));
vi.mock("../lib/accounting/oa", () => ({
  oaRefreshAccessToken: vi.fn(),
  pushBundleToOa: vi.fn(),
}));



function adminCookie(userId = 7): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin User",
  });
}

let app: express.Express;
let processDeliver1099Job: (jobId: number) => Promise<void>;

beforeEach(async () => {
  resetMockDb({ tax1099Filings: 1, dashboard1099DeliveryJobs: 1 });
  mockDashboardRows.length = 0;
  sendMock.mockReset();
  vi.resetModules();
  const mod = await import("./reports");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", mod.default);
  attachTestErrorMiddleware(app);
  processDeliver1099Job = mod.processDeliver1099Job;
});

// The route now returns 202 with `{ jobId }` and dispatches the loop via
// `setImmediate`. Tests want deterministic completion, so this helper
// enqueues, runs the worker inline (skipping the setImmediate dispatch),
// and pulls the final job status straight off the GET endpoint — same
// payload shape the polling client sees.
type DeliverPath =
  | "/api/reports/admin/1099-deliver"
  | `/api/reports/partner/${number}/1099-deliver`;
async function runDeliver(
  postPath: DeliverPath,
  cookie: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const enq = await request(app)
    .post(postPath)
    .set("Cookie", cookie)
    .send(body as object);
  if (enq.status !== 202) {
    return { status: enq.status, body: enq.body };
  }
  const jobId: number = enq.body.jobId;
  // Run the worker synchronously so fixture state is fully settled
  // before the test asserts.
  await processDeliver1099Job(jobId);
  const statusPath = postPath.replace(
    "/1099-deliver",
    `/1099-deliver/jobs/${jobId}`,
  );
  const got = await request(app).get(statusPath).set("Cookie", cookie);
  return { status: got.status, body: got.body };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/reports/admin/1099-deliver", () => {
  it("emails consenting vendors, skips non-consenting, and upserts a delivered filing row", async () => {
    fixtures.vendors.push(
      {
        id: 100,
        contactEmail: "vendor100@example.com",
        eDeliveryEmail: null,
      },
      {
        id: 101,
        contactEmail: "vendor101@example.com",
        eDeliveryEmail: "preferred@example.com",
      },
      {
        id: 102,
        contactEmail: "vendor102@example.com",
        eDeliveryEmail: null,
      },
    );
    mockDashboardRows.push(
      {
        taxYear: 2024,
        formType: "NEC",
        payerPartnerId: 1,
        payerPartnerName: "Acme",
        recipientVendorId: 100,
        recipientName: "Vendor One",
        federalTaxId: "12-3456789",
        totalReportable: "1000.00",
        eDeliveryConsent: true,
        filingId: null,
        status: "pending",
        filingMethod: "manual",
        externalReference: null,
        filedAt: null,
        deliveredAt: null,
        deliveryChannel: null,
        notes: null,
      },
      {
        taxYear: 2024,
        formType: "NEC",
        payerPartnerId: 1,
        payerPartnerName: "Acme",
        recipientVendorId: 101,
        recipientName: "Vendor Two",
        federalTaxId: "98-7654321",
        totalReportable: "2500.00",
        eDeliveryConsent: true,
        filingId: null,
        status: "pending",
        filingMethod: "manual",
        externalReference: null,
        filedAt: null,
        deliveredAt: null,
        deliveryChannel: null,
        notes: null,
      },
      {
        taxYear: 2024,
        formType: "NEC",
        payerPartnerId: 1,
        payerPartnerName: "Acme",
        recipientVendorId: 102,
        recipientName: "Vendor Three",
        federalTaxId: null,
        totalReportable: "1500.00",
        eDeliveryConsent: false,
        filingId: null,
        status: "pending",
        filingMethod: "manual",
        externalReference: null,
        filedAt: null,
        deliveredAt: null,
        deliveryChannel: null,
        notes: null,
      },
    );
    sendMock.mockResolvedValue({ messageId: "msg-1" });

    const res = await runDeliver(
      "/api/reports/admin/1099-deliver",
      adminCookie(),
      { year: 2024, formType: "NEC" },
    );

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      status: "completed",
      attempted: 3,
      delivered: 2,
      skippedNoConsent: 1,
      totalCount: 3,
    });
    expect(res.body.errors).toHaveLength(0);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const recipients = sendMock.mock.calls.map((c) => c[0].to);
    expect(recipients).toContain("vendor100@example.com");
    expect(recipients).toContain("preferred@example.com");

    expect(fixtures.tax1099Filings).toHaveLength(2);
    for (const f of fixtures.tax1099Filings) {
      expect(f.status).toBe("delivered");
      expect(f.deliveryChannel).toBe("email");
      expect(f.deliveredAt).toBeInstanceOf(Date);
      expect(typeof f.notes).toBe("string");
      expect(f.notes as string).toMatch(/Emailed to /);
      expect(f.updatedByUserId).toBe(7);
    }
  });

  it("records an error when SendGrid throws", async () => {
    fixtures.vendors.push({
      id: 200,
      contactEmail: "boom@example.com",
      eDeliveryEmail: null,
    });
    mockDashboardRows.push({
      taxYear: 2024,
      formType: "NEC",
      payerPartnerId: 1,
      payerPartnerName: "Acme",
      recipientVendorId: 200,
      recipientName: "Boom Vendor",
      federalTaxId: "11-1111111",
      totalReportable: "999.00",
      eDeliveryConsent: true,
      filingId: null,
      status: "pending",
      filingMethod: "manual",
      externalReference: null,
      filedAt: null,
      deliveredAt: null,
      deliveryChannel: null,
      notes: null,
    });
    sendMock.mockRejectedValue(new Error("SendGrid 500"));

    const res = await runDeliver(
      "/api/reports/admin/1099-deliver",
      adminCookie(),
      { year: 2024, formType: "NEC" },
    );

    expectStatus(res, 200);
    expect(res.body.status).toBe("completed");
    expect(res.body.delivered).toBe(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatchObject({
      recipientVendorId: 200,
      message: expect.stringContaining("SendGrid 500"),
    });
    expect(fixtures.tax1099Filings).toHaveLength(1);
    expect(fixtures.tax1099Filings[0].status).toBe("error");
    expect(fixtures.tax1099Filings[0].notes).toMatch(/SendGrid 500/);
  });

  it("records an error when a consenting vendor has no email on file", async () => {
    fixtures.vendors.push({
      id: 300,
      contactEmail: "",
      eDeliveryEmail: null,
    });
    mockDashboardRows.push({
      taxYear: 2024,
      formType: "NEC",
      payerPartnerId: 1,
      payerPartnerName: "Acme",
      recipientVendorId: 300,
      recipientName: "Email-less Vendor",
      federalTaxId: "22-2222222",
      totalReportable: "750.00",
      eDeliveryConsent: true,
      filingId: null,
      status: "pending",
      filingMethod: "manual",
      externalReference: null,
      filedAt: null,
      deliveredAt: null,
      deliveryChannel: null,
      notes: null,
    });

    const res = await runDeliver(
      "/api/reports/admin/1099-deliver",
      adminCookie(),
      { year: 2024, formType: "NEC" },
    );

    expectStatus(res, 200);
    expect(res.body.delivered).toBe(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].message).toMatch(/No email/i);
    expect(sendMock).not.toHaveBeenCalled();
    expect(fixtures.tax1099Filings).toHaveLength(1);
    expect(fixtures.tax1099Filings[0].status).toBe("error");
  });

  it("rejects vendors entirely (RBAC)", async () => {
    const cookie = buildTestCookie({
      userId: 9,
      role: "vendor",
      vendorId: 1,
    });
    const res = await request(app)
      .post("/api/reports/admin/1099-deliver")
      .set("Cookie", cookie)
      .send({ year: 2024, formType: "NEC" });
    // requireAdmin runs first and 403s vendors.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.admin_required");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("allows a partner to deliver their own 1099s and scopes the dashboard call to them", async () => {
    const dash = await import("../lib/reports/dashboard1099");
    const buildMock = vi.mocked(dash.build1099Dashboard);

    fixtures.vendors.push({
      id: 500,
      contactEmail: "partnerco@example.com",
      eDeliveryEmail: null,
    });
    mockDashboardRows.push({
      taxYear: 2024,
      formType: "NEC",
      payerPartnerId: 7,
      payerPartnerName: "Partner Seven",
      recipientVendorId: 500,
      recipientName: "Partner-Seven Vendor",
      federalTaxId: "44-4444444",
      totalReportable: "1234.00",
      eDeliveryConsent: true,
      filingId: null,
      status: "pending",
      filingMethod: "manual",
      externalReference: null,
      filedAt: null,
      deliveredAt: null,
      deliveryChannel: null,
      notes: null,
    });
    sendMock.mockResolvedValue({ messageId: "msg-3" });

    const cookie = buildTestCookie({
      userId: 12,
      role: "partner",
      partnerId: 7,
    });
    const res = await runDeliver(
      "/api/reports/partner/7/1099-deliver",
      cookie,
      { year: 2024, formType: "NEC" },
    );

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      status: "completed",
      attempted: 1,
      delivered: 1,
      skippedNoConsent: 0,
    });
    // The partner-scoped route must restrict the dashboard query to that
    // partner — otherwise a partner could deliver another partner's 1099s.
    const lastCall = buildMock.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ year: 2024, payerPartnerId: 7 });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fixtures.tax1099Filings).toHaveLength(1);
    expect(fixtures.tax1099Filings[0]).toMatchObject({
      status: "delivered",
      deliveryChannel: "email",
      payerPartnerId: 7,
      recipientVendorId: 500,
      updatedByUserId: 12,
    });
  });

  it("returns 202 with a jobId immediately, before the worker has run", async () => {
    fixtures.vendors.push({
      id: 800,
      contactEmail: "fast@example.com",
      eDeliveryEmail: null,
    });
    mockDashboardRows.push({
      taxYear: 2024,
      formType: "NEC",
      payerPartnerId: 1,
      payerPartnerName: "Acme",
      recipientVendorId: 800,
      recipientName: "Fast Vendor",
      federalTaxId: "55-5555555",
      totalReportable: "100.00",
      eDeliveryConsent: true,
      filingId: null,
      status: "pending",
      filingMethod: "manual",
      externalReference: null,
      filedAt: null,
      deliveredAt: null,
      deliveryChannel: null,
      notes: null,
    });

    // The response itself must be 202 with a jobId — the worker may
    // run via setImmediate before this assertion fires, but the
    // important contract is the synchronous response shape: it must
    // not contain the loop-result fields (delivered/errors). Those
    // only show up on the GET status endpoint.
    const res = await request(app)
      .post("/api/reports/admin/1099-deliver")
      .set("Cookie", adminCookie())
      .send({ year: 2024, formType: "NEC" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      jobId: expect.any(Number),
      status: "pending",
    });
    expect(res.body.delivered).toBeUndefined();
    expect(res.body.errors).toBeUndefined();
  });

  it("404s a partner trying to poll an admin job (cross-scope leak guard)", async () => {
    // Enqueue an admin-scoped job first.
    const enq = await request(app)
      .post("/api/reports/admin/1099-deliver")
      .set("Cookie", adminCookie())
      .send({ year: 2024, formType: "NEC" });
    expect(enq.status).toBe(202);
    const jobId: number = enq.body.jobId;

    // A partner authenticated for their own scope must not be able to
    // read the admin job even if they know its id.
    const partnerCookie = buildTestCookie({
      userId: 33,
      role: "partner",
      partnerId: 7,
    });
    const got = await request(app)
      .get(`/api/reports/partner/7/1099-deliver/jobs/${jobId}`)
      .set("Cookie", partnerCookie);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("report.job_not_found");
  });

  it("rejects a partner trying to deliver another partner's 1099s", async () => {
    const cookie = buildTestCookie({
      userId: 9,
      role: "partner",
      partnerId: 1,
    });
    const res = await request(app)
      .post("/api/reports/partner/2/1099-deliver")
      .set("Cookie", cookie)
      .send({ year: 2024, formType: "NEC" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.forbidden");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("updates the existing filing row when one already exists", async () => {
    fixtures.vendors.push({
      id: 400,
      contactEmail: "existing@example.com",
      eDeliveryEmail: null,
    });
    fixtures.tax1099Filings.push({
      id: 55,
      taxYear: 2024,
      formType: "NEC",
      payerPartnerId: 1,
      recipientVendorId: 400,
      totalAmount: "0",
      status: "filed",
      filingMethod: "fire",
      deliveredAt: null,
      deliveryChannel: null,
      notes: null,
      updatedByUserId: null,
      updatedAt: new Date(),
    });
    nextId.tax1099Filings = 56;
    mockDashboardRows.push({
      taxYear: 2024,
      formType: "NEC",
      payerPartnerId: 1,
      payerPartnerName: "Acme",
      recipientVendorId: 400,
      recipientName: "Existing Vendor",
      federalTaxId: "33-3333333",
      totalReportable: "3000.00",
      eDeliveryConsent: true,
      filingId: 55,
      status: "filed",
      filingMethod: "fire",
      externalReference: null,
      filedAt: null,
      deliveredAt: null,
      deliveryChannel: null,
      notes: null,
    });
    sendMock.mockResolvedValue({ messageId: "msg-2" });

    const res = await runDeliver(
      "/api/reports/admin/1099-deliver",
      adminCookie(),
      { year: 2024, formType: "NEC" },
    );

    expectStatus(res, 200);
    expect(res.body.delivered).toBe(1);
    // No new row inserted: existing row was updated in place.
    expect(fixtures.tax1099Filings).toHaveLength(1);
    expect(fixtures.tax1099Filings[0]).toMatchObject({
      id: 55,
      status: "delivered",
      deliveryChannel: "email",
      totalAmount: "3000.00",
    });
  });
});
