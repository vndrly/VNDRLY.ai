// Tests for POST /api/webhooks/sendgrid. Verifies that the SendGrid
// event-webhook handler maps inbound events back to the originating
// `tax_1099_filings` row (via the customArgs tuple we attach at send
// time, with `sg_message_id` as a fallback) and updates per-row
// delivery status: bounces flip status to 'error' with the bounce
// reason in notes; opens record `openedAt` once; deliver events
// refresh `deliveredAt`/status. Token-gated requests are rejected
// when the configured `SENDGRID_WEBHOOK_VERIFICATION_TOKEN` is wrong.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";

import {
  fixtures,
  makeDrizzleMock,
  makeReportsDbMock,
  resetMockDb,
} from "../test/mock-reports-db";

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());

let app: express.Express;

beforeEach(async () => {
  resetMockDb({ tax1099Filings: 1 });
  vi.resetModules();
  delete process.env.SENDGRID_WEBHOOK_VERIFICATION_TOKEN;
  // Tests below exercise event-handling logic, not auth — opt the
  // suite into the unauthenticated bypass. The dedicated auth test
  // at the bottom of this file flips this off and asserts the
  // fail-closed default.
  process.env.SENDGRID_WEBHOOK_ALLOW_UNAUTH = "1";
  const router = (await import("./webhooksSendgrid")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SENDGRID_WEBHOOK_VERIFICATION_TOKEN;
  delete process.env.SENDGRID_WEBHOOK_ALLOW_UNAUTH;
});

function seedFiling(extra: Record<string, unknown> = {}): number {
  const id = (fixtures.tax1099Filings.length + 1) * 10;
  fixtures.tax1099Filings.push({
    id,
    taxYear: 2024,
    formType: "NEC",
    payerPartnerId: 1,
    recipientVendorId: 100,
    totalAmount: "1000.00",
    status: "delivered",
    filingMethod: "manual",
    deliveredAt: new Date(),
    deliveryChannel: "email",
    notes: "Emailed to v@x.com",
    sendgridMessageId: "msg-abc",
    lastEventType: null,
    lastEventAt: null,
    bounceReason: null,
    openedAt: null,
    updatedByUserId: null,
    updatedAt: new Date(),
    ...extra,
  });
  return id;
}

describe("POST /api/webhooks/sendgrid", () => {
  it("flips a row to error with bounce reason on a bounce event", async () => {
    const id = seedFiling();
    const res = await request(app)
      .post("/api/webhooks/sendgrid")
      .send([
        {
          event: "bounce",
          email: "v@x.com",
          timestamp: 1700000000,
          reason: "550 5.1.1 mailbox does not exist",
          tax1099_year: "2024",
          tax1099_form_type: "NEC",
          tax1099_payer_partner_id: "1",
          tax1099_recipient_vendor_id: "100",
        },
      ]);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ matched: 1, unknown: 0 });
    const row = fixtures.tax1099Filings.find((f) => f.id === id);
    expect(row?.status).toBe("error");
    expect(row?.bounceReason).toMatch(/mailbox does not exist/);
    expect(row?.notes).toMatch(/SendGrid bounce/);
    expect(row?.lastEventType).toBe("bounce");
    expect(row?.lastEventAt).toBeInstanceOf(Date);
  });

  it("records openedAt on first open and only updates lastEventAt on re-opens", async () => {
    const id = seedFiling();
    const ev = (ts: number) => ({
      event: "open",
      timestamp: ts,
      tax1099_year: "2024",
      tax1099_form_type: "NEC",
      tax1099_payer_partner_id: "1",
      tax1099_recipient_vendor_id: "100",
    });
    await request(app).post("/api/webhooks/sendgrid").send([ev(1700000000)]);
    const firstOpen = fixtures.tax1099Filings.find((f) => f.id === id)
      ?.openedAt as Date | null;
    expect(firstOpen).toBeInstanceOf(Date);
    expect(firstOpen?.getTime()).toBe(1700000000 * 1000);

    await request(app).post("/api/webhooks/sendgrid").send([ev(1700000999)]);
    const row = fixtures.tax1099Filings.find((f) => f.id === id);
    expect((row?.openedAt as Date).getTime()).toBe(firstOpen?.getTime());
    expect((row?.lastEventAt as Date).getTime()).toBe(1700000999 * 1000);
    // Status untouched by an open event.
    expect(row?.status).toBe("delivered");
  });

  it("falls back to sendgrid_message_id when customArgs are missing", async () => {
    const id = seedFiling({ sendgridMessageId: "msg-fallback" });
    const res = await request(app)
      .post("/api/webhooks/sendgrid")
      .send([
        {
          event: "delivered",
          timestamp: 1700000000,
          sg_message_id: "msg-fallback.filterdrecv-1234",
        },
      ]);
    expectStatus(res, 200);
    expect(res.body.matched).toBe(1);
    const row = fixtures.tax1099Filings.find((f) => f.id === id);
    expect(row?.lastEventType).toBe("delivered");
  });

  it("counts events for unknown messages and still returns 200", async () => {
    seedFiling();
    const res = await request(app)
      .post("/api/webhooks/sendgrid")
      .send([
        {
          event: "open",
          tax1099_year: "2024",
          tax1099_form_type: "NEC",
          tax1099_payer_partner_id: "999",
          tax1099_recipient_vendor_id: "888",
        },
      ]);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ matched: 0, unknown: 1 });
  });

  it("fails closed (503) when no token is configured and unauth bypass is off", async () => {
    delete process.env.SENDGRID_WEBHOOK_VERIFICATION_TOKEN;
    delete process.env.SENDGRID_WEBHOOK_ALLOW_UNAUTH;
    vi.resetModules();
    const router = (await import("./webhooksSendgrid")).default;
    const app2 = express();
    app2.use(cookieParser());
    app2.use(express.json());
    app2.use("/api", router);
    attachTestErrorMiddleware(app2);

    seedFiling();
    const before = JSON.stringify(fixtures.tax1099Filings[0]);
    const res = await request(app2)
      .post("/api/webhooks/sendgrid")
      .send([
        {
          event: "bounce",
          reason: "spoofed",
          tax1099_year: "2024",
          tax1099_form_type: "NEC",
          tax1099_payer_partner_id: "1",
          tax1099_recipient_vendor_id: "100",
        },
      ]);
    expect(res.status).toBe(503);
    // Critically: no mutation must have happened on the rejected request.
    expect(JSON.stringify(fixtures.tax1099Filings[0])).toBe(before);
  });

  it("rejects requests with an invalid token when the env var is set", async () => {
    process.env.SENDGRID_WEBHOOK_VERIFICATION_TOKEN = "secret-xyz";
    vi.resetModules();
    const router = (await import("./webhooksSendgrid")).default;
    const app2 = express();
    app2.use(cookieParser());
    app2.use(express.json());
    app2.use("/api", router);
    attachTestErrorMiddleware(app2);

    const bad = await request(app2)
      .post("/api/webhooks/sendgrid")
      .set("X-Webhook-Token", "wrong")
      .send([{ event: "open" }]);
    expect(bad.status).toBe(401);

    const good = await request(app2)
      .post("/api/webhooks/sendgrid")
      .set("X-Webhook-Token", "secret-xyz")
      .send([]);
    expectStatus(good, 200);
  });
});
