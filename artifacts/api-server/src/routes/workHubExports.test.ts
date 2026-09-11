import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { createWorkHubExportsRouter } from "./workHubExports";

const id = "11111111-1111-4111-8111-111111111111";
const cookie = buildTestCookie({ userId: 22, role: "vendor", vendorId: 41, membershipRole: "admin", displayName: "Casey" });
function appWith(overrides: Record<string, unknown> = {}) {
  const lifecycle = {
    request: vi.fn(async () => ({ replayed: false, job: { id, dataset: "tasks", format: "csv", status: "pending", createdAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-10T12:00:00.000Z", rowCount: null, byteCount: null, expiresAt: "2026-09-11T12:00:00.000Z", fileName: null, errorCode: null } })),
    status: vi.fn(async () => ({ id, dataset: "tasks", format: "csv", status: "completed", createdAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-10T12:01:00.000Z", rowCount: 1, byteCount: 4, expiresAt: "2026-09-11T12:00:00.000Z", fileName: "vndrly.csv", errorCode: null })),
    download: vi.fn(async () => ({ body: Buffer.from("safe"), contentType: "text/csv; charset=utf-8", fileName: "vndrly.csv" })),
    ...overrides,
  } as any;
  return { lifecycle, app: express().use(express.json()).use(cookieParser()).use(createWorkHubExportsRouter({ lifecycle, exportsEnabled: async () => true })) };
}

describe("Work Hub export HTTP boundary", () => {
  it("requires authentication and returns 202 for a new private export job", async () => {
    const h = appWith();
    expect((await request(h.app).post("/work-hub/exports").send({})).status).toBe(401);
    const response = await request(h.app).post("/work-hub/exports").set("Cookie", cookie).set("x-vndrly-client", "ios").send({ operationId: id, owner: { type: "vendor", id: 41 }, export: { dataset: "tasks", format: "csv", scope: { selectors: {} } }, expiresAt: "2026-09-11T12:00:00.000Z" });
    expect(response.status).toBe(202);
    expect(h.lifecycle.request).toHaveBeenCalledWith(expect.objectContaining({ requester: expect.objectContaining({ userId: 22, source: "ios" }) }));
  });

  it("returns safe status and private hardened download headers", async () => {
    const h = appWith();
    const status = await request(h.app).get(`/work-hub/exports/${id}`).set("Cookie", cookie);
    expect(status.status).toBe(200);
    expect(status.body).not.toHaveProperty("artifactStorageKey");
    const download = await request(h.app).get(`/work-hub/exports/${id}/download`).set("Cookie", cookie);
    expect(download.status).toBe(200);
    expect(download.headers["cache-control"]).toContain("private");
    expect(download.headers["cache-control"]).toContain("no-store");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.headers["content-security-policy"]).toContain("sandbox");
    expect(download.headers["content-disposition"]).toContain('filename="vndrly.csv"');
  });

  it("fails closed when exports are disabled", async () => {
    const h = appWith();
    h.app = express().use(express.json()).use(cookieParser()).use(createWorkHubExportsRouter({ lifecycle: h.lifecycle, exportsEnabled: async () => false }));
    expect((await request(h.app).post("/work-hub/exports").set("Cookie", cookie).send({})).status).toBe(404);
  });

  it("rejects malformed export IDs before calling the lifecycle", async () => {
    const h = appWith();
    const response = await request(h.app).get("/work-hub/exports/not-a-uuid").set("Cookie", cookie);
    expect(response.status).toBe(400);
    expect(h.lifecycle.status).not.toHaveBeenCalled();
  });
});
