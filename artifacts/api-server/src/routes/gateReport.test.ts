import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  open: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => ({ userId: 1, role: "vendor", vendorId: 2 }),
}));
vi.mock("../lib/visits-rate-limit", () => ({
  enforceVisitsRateLimit: vi.fn(async () => true),
}));
vi.mock("../services/gate-reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/gate-reports")>();
  return { ...actual, deliverGateReports: mocks.deliver, openGateReport: mocks.open };
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
    mocks.open.mockResolvedValue({ body: Buffer.from("report"), contentType: "application/pdf", filename: "report.pdf" });
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

  it("downloads the report only through the authenticated secure redemption route", async () => {
    const response = await request(app).get(`/api/gate-report/secure?token=${"a".repeat(32)}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("report.pdf");
    expect(mocks.open).toHaveBeenCalledWith({ token: "a".repeat(32), userId: 1 });
  });
});
