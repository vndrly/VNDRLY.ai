import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";

const duty = vi.hoisted(() => ({
  startWorkSession: vi.fn(),
  assumeGateDuty: vi.fn(),
  endGateDuty: vi.fn(),
  endWorkSession: vi.fn(),
  getGateRoster: vi.fn(),
}));

vi.mock("../services/gate-duty", () => duty);

import gateChangeOverRouter from "./gateChangeOver";

const app = express();
app.use(express.json(), cookieParser(), gateChangeOverRouter);
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => res.status(500).json({ message: error.message }),
);

const stationId = "11111111-1111-4111-8111-111111111111";
const shiftId = "22222222-2222-4222-8222-222222222222";
const session = buildTestCookie({
  userId: 41,
  role: "vendor",
  vendorId: 7,
  sv: 1,
});

describe("Gate duty routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts work using the signed-in actor and validated Gate fields", async () => {
    duty.startWorkSession.mockResolvedValue({ workSession: { id: "work" } });
    const response = await request(app)
      .post(`/gate-change-over/${stationId}/work-sessions/start`)
      .set("Cookie", session)
      .send({
        workHubShiftId: shiftId,
        source: "ios",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        locationSharingActive: true,
      });
    expect(response.status).toBe(200);
    expect(duty.startWorkSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 41 }),
      expect.objectContaining({ stationId, workHubShiftId: shiftId }),
    );
  });

  it("assumes duty and returns the current roster", async () => {
    duty.assumeGateDuty.mockResolvedValue({ id: "duty" });
    duty.getGateRoster.mockResolvedValue([{ id: "duty", userId: 41 }]);
    const assumed = await request(app)
      .post(`/gate-change-over/${stationId}/duty/assume`)
      .set("Cookie", session)
      .send({
        workHubShiftId: shiftId,
        source: "web",
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      });
    expect(assumed.status).toBe(200);
    const roster = await request(app)
      .get(`/gate-change-over/${stationId}/roster`)
      .set("Cookie", session);
    expect(roster.status).toBe(200);
    expect(roster.body).toEqual({ roster: [{ id: "duty", userId: 41 }] });
  });

  it("ends only the requested duty session with handoff state", async () => {
    duty.endGateDuty.mockResolvedValue({ id: "duty", endedAt: "now" });
    const response = await request(app)
      .post(`/gate-change-over/${stationId}/duty/55555555-5555-4555-8555-555555555555/end`)
      .set("Cookie", session)
      .send({ reason: "Shift complete", handoffCompleted: true });
    expect(response.status).toBe(200);
    expect(duty.endGateDuty).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 41 }),
      expect.objectContaining({
        dutySessionId: "55555555-5555-4555-8555-555555555555",
        handoffCompleted: true,
      }),
    );
  });
});
