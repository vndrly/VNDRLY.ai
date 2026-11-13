import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
const state = vi.hoisted(() => ({ session: { role: "vendor", vendorId: 1054, partnerId: null, userId: 1 } as any,
  execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute: state.execute } }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.session, requireSession: (_req: any, res: any, next: any) => state.session ? next() : res.sendStatus(401) }));
import { dashboardTicketJourneysRouter } from "./dashboard-ticket-journeys";
const app = express().use(dashboardTicketJourneysRouter);
beforeEach(() => { state.execute.mockReset(); state.session = { role: "vendor", vendorId: 1054, userId: 1 }; });
it("requires authentication without reading records", async () => {
  state.session = null;
  expect((await request(app).get("/dashboard/ticket-journeys")).status).toBe(401);
  expect(state.execute).not.toHaveBeenCalled();
});
it("scopes vendor listing and reads authoritative invoice balances", async () => {
  state.execute.mockResolvedValue({ rows: [] });
  expect((await request(app).get("/dashboard/ticket-journeys")).status).toBe(200);
  const query = new PgDialect().sqlToQuery(state.execute.mock.calls[0][0]);
  expect(query.sql).toMatch(/WHERE t.vendor_id=\$\d/);
  expect(query.params).toContain(1054);
  expect(query.sql).toContain("i.vendor_id=t.vendor_id");
});
it("does not read history or payments for inaccessible tickets", async () => {
  state.execute.mockResolvedValue({ rows: [] });
  expect((await request(app).get("/dashboard/ticket-journeys/12")).status).toBe(404);
  expect(state.execute).toHaveBeenCalledTimes(1);
});
it("rejects invalid identifiers before database access", async () => {
  expect((await request(app).get("/dashboard/ticket-journeys/nope")).status).toBe(400);
  expect(state.execute).not.toHaveBeenCalled();
});
it("returns recorded steps and denies payment UI for partner viewers", async () => {
  state.session = { role: "partner", partnerId: 8, userId: 1 };
  state.execute.mockResolvedValueOnce({ rows: [{ id: 12, vendor_id: 1054, partner_id: 8 }] })
    .mockResolvedValue({ rows: [] });
  const result = await request(app).get("/dashboard/ticket-journeys/12");
  expect(result.body).toEqual({ history: [], invoices: [], approvals: [], canRecordPayment: false });
});
