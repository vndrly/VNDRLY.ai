import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

const sendTicketNudgeMock = vi.fn();
const listTicketNudgesMock = vi.fn();
const loadFieldTicketAccessRowMock = vi.fn();
const actorCanNudgeTicketMock = vi.fn();

vi.mock("../lib/ticket-nudge", () => ({
  sendTicketNudge: (...args: unknown[]) => sendTicketNudgeMock(...args),
  listTicketNudges: (...args: unknown[]) => listTicketNudgesMock(...args),
  actorCanNudgeTicket: (...args: unknown[]) => actorCanNudgeTicketMock(...args),
}));

vi.mock("../lib/field-ticket-access", () => ({
  loadFieldTicketAccessRow: (...args: unknown[]) =>
    loadFieldTicketAccessRowMock(...args),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  },
  vendorPeopleTable: { __table: "vendor_people" },
}));

import ticketNudgeRouter from "./ticketNudge";

function app() {
  const a = express();
  a.use(cookieParser());
  a.use(express.json());
  a.use(ticketNudgeRouter);
  attachTestErrorMiddleware(a);
  return a;
}

describe("POST /tickets/:id/nudge", () => {
  beforeEach(() => {
    sendTicketNudgeMock.mockReset();
    listTicketNudgesMock.mockReset();
    loadFieldTicketAccessRowMock.mockReset();
    actorCanNudgeTicketMock.mockReset();
  });

  it("requires auth", async () => {
    const res = await request(app()).post("/tickets/1/nudge").send({ direction: "up" });
    expectStatus(res, 401);
  });

  it("validates direction", async () => {
    const cookie = buildTestCookie({
      userId: 1,
      role: "vendor",
      vendorId: 10,
      partnerId: null,
    });
    const res = await request(app())
      .post("/tickets/1/nudge")
      .set("Cookie", cookie)
      .send({ direction: "sideways" });
    expectStatus(res, 400);
    expect(res.body.code).toBe("nudge.invalid_direction");
  });

  it("returns 201 on success", async () => {
    sendTicketNudgeMock.mockResolvedValue({
      ok: true,
      nudgeId: 99,
      targetTier: "vendor_office",
      notifiedCount: 3,
    });
    const cookie = buildTestCookie({
      userId: 5,
      role: "field_employee",
      vendorId: null,
      partnerId: null,
      displayName: "Pat Foreman",
    });
    const res = await request(app())
      .post("/tickets/42/nudge")
      .set("Cookie", cookie)
      .send({ direction: "up", message: "Need review" });
    expectStatus(res, 201);
    expect(res.body).toMatchObject({
      id: 99,
      ticketId: 42,
      direction: "up",
      targetTier: "vendor_office",
      notifiedCount: 3,
    });
    expect(sendTicketNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 42,
        actorUserId: 5,
        direction: "up",
        message: "Need review",
      }),
    );
  });

  it("returns 429 when rate limited", async () => {
    sendTicketNudgeMock.mockResolvedValue({
      ok: false,
      code: "nudge.rate_limited",
      message: "slow down",
      retryAfterSeconds: 120,
    });
    const cookie = buildTestCookie({
      userId: 1,
      role: "vendor",
      vendorId: 10,
      partnerId: null,
    });
    const res = await request(app())
      .post("/tickets/1/nudge")
      .set("Cookie", cookie)
      .send({ direction: "down" });
    expectStatus(res, 429);
    expect(res.headers["retry-after"]).toBe("120");
  });
});

describe("GET /tickets/:id/nudges", () => {
  beforeEach(() => {
    sendTicketNudgeMock.mockReset();
    listTicketNudgesMock.mockReset();
    loadFieldTicketAccessRowMock.mockReset();
    actorCanNudgeTicketMock.mockReset();
  });

  it("returns recent nudges for authorized callers", async () => {
    loadFieldTicketAccessRowMock.mockResolvedValue({
      vendorId: 10,
      partnerId: 2,
      fieldEmployeeId: 1,
      foremanUserId: 5,
    });
    actorCanNudgeTicketMock.mockResolvedValue(true);
    listTicketNudgesMock.mockResolvedValue([
      {
        id: 1,
        direction: "up",
        targetTier: "vendor_office",
        message: null,
        ticketStatus: "pending_review",
        createdAt: new Date(),
        actorUserId: 5,
      },
    ]);
    const cookie = buildTestCookie({
      userId: 5,
      role: "field_employee",
      vendorId: null,
      partnerId: null,
    });
    const res = await request(app())
      .get("/tickets/42/nudges")
      .set("Cookie", cookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
  });
});
