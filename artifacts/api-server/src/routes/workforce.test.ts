import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import router from "./workforce";
import { GateShiftAssignmentError } from "../services/gate-shift-assignment";
import { readWorkforceRoster } from "../services/workforce-roster";
import { createWorkforceOffer, listIncomingWorkforceOffers, readWorkforceOfferOperation, respondWorkforceOffer } from "../services/workforce-offers";

vi.mock("../services/workforce-roster", () => ({ readWorkforceRoster: vi.fn() }));
vi.mock("../services/workforce-offers", () => ({ createWorkforceOffer: vi.fn(), listWorkforceShiftOffers: vi.fn(), listIncomingWorkforceOffers: vi.fn(), readWorkforceOfferOperation: vi.fn(), respondWorkforceOffer: vi.fn() }));
vi.mock("../services/gate-shift-assignment", () => ({ GateShiftAssignmentError: class extends Error { constructor(public code: string, public status = 409) { super(code); } } }));
vi.mock("../services/gate-change-over", () => ({ ChangeOverError: class extends Error {} }));
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
const shiftId = "00000000-0000-4000-8000-000000000001", operationId = "00000000-0000-4000-8000-000000000002";
const app = express(); app.use(express.json(), cookieParser(), router);
beforeEach(() => vi.resetAllMocks());
it("requires authentication and prevents public demo mutations", async () => {
  expect((await request(app).get("/work-hub/workforce/roster")).status).toBe(401);
  expect((await request(app).post(`/work-hub/shifts/${shiftId}/offers`).set("Cookie", buildTestCookie({ ...session, publicDemo: true })).send({})).status).toBe(403);
  expect(createWorkforceOffer).not.toHaveBeenCalled();
});
it("returns scoped roster and recipient inbox with no-store caching", async () => {
  vi.mocked(readWorkforceRoster).mockResolvedValue({ employees: [] } as never);
  vi.mocked(listIncomingWorkforceOffers).mockResolvedValue({ offers: [] });
  const roster = await request(app).get("/work-hub/workforce/roster").set("Cookie", buildTestCookie(session));
  expect(roster.status).toBe(200); expect(roster.headers["cache-control"]).toBe("private, no-store");
  expect((await request(app).get("/work-hub/workforce/offers").set("Cookie", buildTestCookie(session))).body).toEqual({ offers: [] });
});
it("validates exact route identifiers before invoking a mutation", async () => {
  const response = await request(app).post("/work-hub/shifts/not-a-uuid/offers").set("Cookie", buildTestCookie(session)).send({});
  expect(response.status).toBe(400); expect(createWorkforceOffer).not.toHaveBeenCalled();
});
it("provides recipient operation preflight and passes the exact response request", async () => {
  vi.mocked(readWorkforceOfferOperation).mockResolvedValue({ receipt: null });
  const preflight = await request(app).get(`/work-hub/shifts/${shiftId}/offers/operations/${operationId}`).set("Cookie", buildTestCookie(session));
  expect(preflight.status).toBe(200); expect(preflight.body).toEqual({ receipt: null });
  const input = { operationId, expectedVersion: 1, decision: "accepted" };
  vi.mocked(respondWorkforceOffer).mockResolvedValue({ status: "accepted" } as never);
  const response = await request(app).post(`/work-hub/shifts/${shiftId}/offers/${operationId}/respond`).set("Cookie", buildTestCookie(session)).send(input);
  expect(response.status).toBe(200);
  expect(respondWorkforceOffer).toHaveBeenCalledWith(expect.objectContaining({ userId: 17 }), shiftId, operationId, input);
});
it("reports authority and capacity conflicts without changing their codes", async () => {
  vi.mocked(createWorkforceOffer).mockRejectedValue(new GateShiftAssignmentError("workforce.capacity_filled"));
  const response = await request(app).post(`/work-hub/shifts/${shiftId}/offers`).set("Cookie", buildTestCookie(session)).send({});
  expect(response.status).toBe(409); expect(response.body).toMatchObject({ code: "workforce.capacity_filled" });
});
