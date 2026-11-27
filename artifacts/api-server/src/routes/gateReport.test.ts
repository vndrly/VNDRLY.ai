import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  email: vi.fn(),
  open: vi.fn(),
  history: vi.fn(),
}));
vi.mock("../services/gate-history-query", () => ({ queryGateHistoryForSession: mocks.history }));

vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => ({ userId: 1, role: "vendor", vendorId: 2 }),
}));
vi.mock("../lib/visits-rate-limit", () => ({
  enforceVisitsRateLimit: vi.fn(async () => true),
}));
vi.mock("../services/gate-reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/gate-reports")>();
  return { ...actual, deliverGateReports: mocks.deliver, emailGateReportAttachments: mocks.email, openGateReport: mocks.open };
});

import router from "./gateReport";

const app = express().use(express.json()).use("/api", router);
const body = {
  recipientUserIds: [2, 3],
  reportKind: "history",
  format: "pdf",
  filters: { siteId: 10, range: "7d", recordType: "all" },
};

describe("Gate report delivery routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliver.mockResolvedValue([{ id: "delivery", recipientUserId: 2, expiresAt: new Date().toISOString() }]);
    mocks.email.mockResolvedValue({ sent: 2 });
    mocks.open.mockResolvedValue({ body: Buffer.from("report"), contentType: "application/pdf", filename: "report.pdf" });
  });

  it("emails the selected report attachment format to the selected recipients", async () => {
    const response = await request(app).post("/api/gate-report/email").send({ ...body, format: "word" });
    expect(response.status).toBe(201);
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({
      senderUserId: 1,
      recipientUserIds: [2, 3],
      reportKind: "history",
      format: "word",
    }));
  });

  it("accepts only selected user ids and rejects a free-text recipient address", async () => {
    expect((await request(app).post("/api/gate-report/deliver").send(body)).status).toBe(201);
    const rejected = await request(app).post("/api/gate-report/deliver").send({
      ...body,
      recipientEmail: "outside@example.com",
    });
    expect(rejected.status).toBe(400);
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
  });

  it("counts check-ins and check-outs inside a day-length window instead of leaving only the record total", async () => {
    const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    mocks.history.mockResolvedValue([
      { id: "visit:1", checkInTime: ago(24), checkOutTime: ago(12) },
      { id: "visit:2", checkInTime: ago(240), checkOutTime: null },
    ]);
    const query = (filters: Record<string, unknown>) => request(app).post("/api/gate-report/query").send({ reportKind: "history", page: 1, filters: { siteId: 10, recordType: "all", ...filters } });
    const week = await query({ range: "7d" });
    expect(week.body).toMatchObject({ total: 2, crossings: { checkIns: 1, checkOuts: 1, total: 2 } });
    expect(Date.parse(week.body.to) - Date.parse(week.body.from)).toBe(7 * 86_400_000);
    expect((await query({ range: "current_shift" })).body.crossings).toBeUndefined();
    expect((await query({ range: "7d", recordType: "on_site" })).body.crossings).toBeUndefined();
    const custom = await query({ range: "custom", from: ago(30), to: ago(18) });
    expect(custom.body).toMatchObject({ crossings: { checkIns: 1, checkOuts: 0 } });
  });

  it("downloads the report only through the authenticated secure redemption route", async () => {
    const response = await request(app).get(`/api/gate-report/secure?token=${"a".repeat(32)}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("report.pdf");
    expect(mocks.open).toHaveBeenCalledWith({ token: "a".repeat(32), userId: 1, session: { userId: 1, role: "vendor", vendorId: 2 } });
  });
});
