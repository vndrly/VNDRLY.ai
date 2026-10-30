import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({ read: vi.fn(async (..._args: unknown[]) => ({ definitions: [] })), save: vi.fn(async (..._args: unknown[]) => ({ resource: { definitions: [] } })), retire: vi.fn(async (..._args: unknown[]) => ({ resource: { retired: true } })) }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("../work-hub/gate-shift-definitions", () => ({ gateDefinitionList: state.read, saveGateDefinition: state.save, deleteGateDefinition: state.retire }));
import router from "./workHubGateShiftDefinitions";
const app = express().use(express.json()).use(cookieParser()).use(router);
const cookie = buildTestCookie({ userId: 1, role: "vendor", vendorId: 7, membershipRole: "admin" });
const body = () => ({ operationId: randomUUID(), payloadVersion: 1, expectedVersion: null, owner: { type: "vendor", id: 7 }, context: { kind: "organization", id: 7 }, payload: { stationIds: [randomUUID()], startsAtLocal: "06:00", endsAtLocal: "18:00", weekdays: [0,1,2,3,4,5,6], timezone: "America/Chicago" } });
describe("Gate shift definition endpoints", () => {
  beforeEach(() => { state.read.mockClear(); state.save.mockClear(); state.retire.mockClear(); });
  it("requires sign-in before listing or saving", async () => {
    expect((await request(app).get("/work-hub/gate-shift-definitions?vendorId=7")).status).toBe(401);
    expect((await request(app).post("/work-hub/gate-shift-definitions").send(body())).status).toBe(401);
    expect(state.read).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
  });
  it("validates a new unassigned definition before passing it to the scoped save", async () => {
    const result = await request(app).post("/work-hub/gate-shift-definitions").set("Cookie", cookie).send(body());
    expect(result.status, result.text).toBe(200);
    expect(state.save.mock.calls[0][2]).toMatchObject({ userIds: [], crewIds: [], requiredCount: 1 });
    const invalid = body(); invalid.payload.stationIds = [];
    expect((await request(app).post("/work-hub/gate-shift-definitions").set("Cookie", cookie).send(invalid)).status).toBe(400);
    expect(state.save).toHaveBeenCalledTimes(1);
  });
  it("requires sign-in and a versioned definition for retirement", async () => {
    const requestBody = { ...body(), payload: { id: randomUUID(), version: 3 } };
    expect((await request(app).post("/work-hub/gate-shift-definitions/retire").send(requestBody)).status).toBe(401);
    expect((await request(app).post("/work-hub/gate-shift-definitions/retire").set("Cookie", cookie).send(requestBody)).status).toBe(200);
    expect(state.retire.mock.calls[0][2]).toEqual(requestBody.payload);
    expect((await request(app).post("/work-hub/gate-shift-definitions/retire").set("Cookie", cookie).send({ ...requestBody, payload: { id: requestBody.payload.id } })).status).toBe(400);
    expect(state.retire).toHaveBeenCalledTimes(1);
  });
});
