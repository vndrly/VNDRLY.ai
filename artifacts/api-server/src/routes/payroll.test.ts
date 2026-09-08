import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const state = vi.hoisted(() => ({ session: { userId: 1, role: "vendor", vendorId: 7, vendorRole: "office", membershipRole: "member" }, selects: 0, rows: [] as unknown[], predicate: undefined as unknown }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.session, requireSession: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return { ...actual, db: { select: vi.fn(() => {
    const result = state.selects++ % 2 === 0 ? [{ id: 7 }] : state.rows;
    const chain: Record<string, unknown> = {};
    for (const key of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[key] = () => chain;
    chain.where = (predicate: unknown) => { state.predicate = predicate; return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  }) } };
});
import router, { mayReviewPayroll } from "./payroll";
const app = express(); app.use(express.json()); app.use("/api", router);
const input = { from: "2026-09-07", to: "2026-09-08", timeZone: "UTC", weekStartsOn: 1, dailyOvertimeHours: null, weeklyOvertimeHours: 40, overtimeMultiplier: "1.5", rates: [{ employeeId: 1, hourlyWage: "20.00" }], confirmed: true };
beforeEach(() => { state.selects = 0; state.rows = [{ id: 1, ticketId: 1, employeeId: 1, employeeName: "Worker", checkInAt: new Date("2026-09-07T08:00:00Z"), checkOutAt: new Date("2026-09-07T09:00:00Z") }]; });
describe("payroll review authorization and export", () => {
  it("denies unrelated companies, partners, field and gatekeeper roles", () => {
    expect(mayReviewPayroll(state.session, 8)).toBe(false);
    for (const role of ["partner", "field_employee", "guest"]) expect(mayReviewPayroll({ ...state.session, role }, 7)).toBe(false);
    for (const vendorRole of ["field", "gatekeeper", "foreman", null]) expect(mayReviewPayroll({ ...state.session, vendorRole }, 7)).toBe(false);
    expect(mayReviewPayroll({ ...state.session, membershipRole: "admin" }, 7)).toBe(true);
  });
  it("rejects unauthorized routes before reading source records", async () => {
    expect((await request(app).post("/api/payroll/vendors/8/preview").send(input)).status).toBe(403);
    expect(state.selects).toBe(0);
  });
  it("recomputes source time before CSV and rejects a stale fingerprint", async () => {
    const preview = await request(app).post("/api/payroll/vendors/7/preview").send(input);
    expect(preview.status).toBe(200);
    const exported = await request(app).post("/api/payroll/vendors/7/export").send({ ...input, fingerprint: preview.body.fingerprint });
    expect(exported.status).toBe(200);
    expect(exported.text).toContain("20.00");
    state.rows = [{ ...(state.rows[0] as object), checkOutAt: new Date("2026-09-07T10:00:00Z") }];
    expect((await request(app).post("/api/payroll/vendors/7/export").send({ ...input, fingerprint: preview.body.fingerprint })).status).toBe(409);
  });
  it("includes started-in-context reversed sessions and blocks their export", async () => {
    state.rows = [{ ...(state.rows[0] as object), checkOutAt: new Date("2026-09-06T00:00:00Z") }];
    const preview = await request(app).post("/api/payroll/vendors/7/preview").send(input);
    expect(preview.body.issues).toContain("Session 1 has invalid times");
    expect(preview.body.exportable).toBe(false);
    const query = new PgDialect().sqlToQuery(state.predicate as SQL);
    expect(query.sql).toMatch(/"ticket_check_ins"\."check_in_at" >= \$\d+ or "ticket_check_ins"\."check_out_at" is null or "ticket_check_ins"\."check_out_at" > \$\d+/);
    expect((await request(app).post("/api/payroll/vendors/7/export").send({ ...input, fingerprint: preview.body.fingerprint })).status).toBe(409);
  });
});
