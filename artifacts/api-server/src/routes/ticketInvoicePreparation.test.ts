import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), candidates: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: mocks.session }));
vi.mock("../services/ticket-invoice-preparation-repository", () => ({
  ticketInvoiceCandidatesForSession: mocks.candidates,
  ticketInvoicePreparationForSession: vi.fn(),
}));
import router from "./ticketInvoicePreparation";
const app = express().use(express.json()).use(router);
const session = {
  userId: 17,
  role: "vendor",
  vendorId: 4,
  activeMembershipId: 12,
  membershipRole: "member",
  sv: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockReturnValue(session);
});
it("requires a current authenticated session before a canonical candidate read", async () => {
  mocks.session.mockReturnValue(null);
  expect(
    (await request(app).get("/invoices/ticket-preparation/candidates")).status,
  ).toBe(401);
  expect(mocks.candidates).not.toHaveBeenCalled();
});
it("passes exact numeric bounded page input and trusted current session to canonical authority", async () => {
  mocks.candidates.mockResolvedValue({ tickets: [] });
  const response = await request(app).get(
    "/invoices/ticket-preparation/candidates?limit=10&afterTicketId=100",
  );
  expect(response.status).toBe(200);
  expect(mocks.candidates).toHaveBeenCalledExactlyOnceWith(
    { limit: 10, afterTicketId: 100 },
    session,
  );
});
it("rejects account injection, nonnumeric or over-limit pages before database access", async () => {
  for (const query of [
    "vendorId=99",
    "limit=21",
    "limit=-1",
    "limit=1.5",
    "limit=1&limit=2",
  ]) {
    expect(
      (
        await request(app).get(
          `/invoices/ticket-preparation/candidates?${query}`,
        )
      ).status,
    ).toBe(400);
  }
  expect(mocks.candidates).not.toHaveBeenCalled();
});
it("withholds candidate records on removed Billing grant/current membership denial", async () => {
  for (const error of [
    "invoice_preparation.billing_permission_required",
    "invoice_preparation.current_authority_required",
  ]) {
    mocks.candidates.mockRejectedValueOnce(Error(error));
    const response = await request(app).get(
      "/invoices/ticket-preparation/candidates",
    );
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Invoice candidates unavailable" });
  }
});
