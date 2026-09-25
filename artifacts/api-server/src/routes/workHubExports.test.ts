import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { createWorkHubExportsRouter } from "./workHubExports";
import { db } from "@workspace/db";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@workspace/db", () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("../lib/reports/audit", () => ({ recordExport: vi.fn(async () => undefined) }));

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
  it.each(["", "/preview"])("binds managed supervisor staffing to signed sites even when siteIds are omitted on %s", async (suffix) => {
    const h = appWith();
    const managed = buildTestCookie({ userId: 33, role: "field_employee", vendorId: 41, vendorRole: "gate_supervisor", managedSubcontractor: { siteGrants: [{ siteId: 101, role: "gate_supervisor" }, { siteId: 202, role: "gatekeeper" }] } });
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [
      { ownerOrgId: 41, siteId: 101, assignmentId: "allowed", worker: "Allowed worker" },
      { ownerOrgId: 41, siteId: 202, assignmentId: "forbidden", worker: "Forbidden worker" },
    ] } as any);
    const body = { dataset: "staffing", scope: { ownerOrgType: "vendor", ownerOrgId: 41 } };
    const response = await request(h.app).post(`/work-hub/exports/implementation-a${suffix}`).set("Cookie", managed).send(body);
    expect(response.status).toBe(200);
    if (suffix) expect(response.body.scope.siteIds).toEqual([101]);
    else {
      expect(response.text).toContain("Allowed worker");
      expect(response.text).not.toContain("Forbidden worker");
      const query = new PgDialect().sqlToQuery(vi.mocked(db.execute).mock.calls.at(-1)![0] as any);
      expect(query.sql).toContain('s.site_location_id AS "siteId"');
    }
    for (const siteIds of [[202], [101, 202], []]) {
      const denied = await request(h.app).post(`/work-hub/exports/implementation-a${suffix}`).set("Cookie", managed).send({ ...body, scope: { ...body.scope, siteIds } });
      expect(denied.status).toBe(403);
    }
    vi.mocked(db.execute).mockReset().mockResolvedValue({ rows: [] } as any);
  });
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

  it("previews scoped Implementation A columns without exporting data", async () => {
    const h = appWith();
    expect((await request(h.app).post("/work-hub/exports/implementation-a/preview").send({ dataset: "assets", scope: { ownerOrgType: "vendor", ownerOrgId: 41 } })).status).toBe(401);
    const response = await request(h.app).post("/work-hub/exports/implementation-a/preview").set("Cookie", cookie).send({ dataset: "assets", scope: { ownerOrgType: "vendor", ownerOrgId: 41 } });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ dataset: "assets", headers: ["assetId", "name", "category", "status", "holder", "condition"], excludedSensitiveFields: ["incidentDetail"] });
  });

  it.each(["", "/preview"])("denies gatekeepers and cross-owner Implementation A requests on %s", async (suffix) => {
    const h = appWith();
    const gatekeeper = buildTestCookie({ userId: 31, role: "field_employee", vendorId: 41, vendorRole: "gatekeeper", membershipRole: "member" });
    const body = { dataset: "staffing", scope: { ownerOrgType: "vendor", ownerOrgId: 41 } };
    expect((await request(h.app).post(`/work-hub/exports/implementation-a${suffix}`).set("Cookie", gatekeeper).send(body)).status).toBe(403);
    expect((await request(h.app).post(`/work-hub/exports/implementation-a${suffix}`).set("Cookie", cookie).send({ ...body, scope: { ownerOrgType: "vendor", ownerOrgId: 42 } })).status).toBe(403);
  });

  it.each(["", "/preview"])("returns a scoped denial for a managed worker whose site grants were revoked on %s", async (suffix) => {
    const h = appWith();
    const revoked = buildTestCookie({ userId: 33, role: "field_employee", vendorId: 41, vendorRole: "gate_supervisor", membershipRole: "member", managedSubcontractor: { siteGrants: [] } });
    const response = await request(h.app).post(`/work-hub/exports/implementation-a${suffix}`).set("Cookie", revoked).send({ dataset: "staffing", scope: { ownerOrgType: "vendor", ownerOrgId: 41 } });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "work_hub.not_found" });
  });

  it.each(["", "/preview"])("allows supervisors to export staffing only on %s", async (suffix) => {
    const h = appWith();
    const supervisor = buildTestCookie({ userId: 32, role: "field_employee", vendorId: 41, vendorRole: "gate_supervisor", membershipRole: "member" });
    const url = `/work-hub/exports/implementation-a${suffix}`;
    const scope = { ownerOrgType: "vendor", ownerOrgId: 41 };
    expect((await request(h.app).post(url).set("Cookie", supervisor).send({ dataset: "staffing", scope })).status).toBe(200);
    expect((await request(h.app).post(url).set("Cookie", supervisor).send({ dataset: "payroll", scope })).status).toBe(403);
  });

  it.each(["", "/preview"])("allows org admins all five datasets on %s", async (suffix) => {
    const h = appWith();
    const url = `/work-hub/exports/implementation-a${suffix}`;
    for (const dataset of ["payroll", "quickbooks-time", "assets", "staffing", "safety"])
      expect((await request(h.app).post(url).set("Cookie", cookie).send({ dataset, scope: { ownerOrgType: "vendor", ownerOrgId: 41 } })).status).toBe(200);
  });
});
