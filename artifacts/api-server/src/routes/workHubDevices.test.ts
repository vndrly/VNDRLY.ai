import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const sessionMock = vi.hoisted(() => vi.fn());
const enabledMock = vi.hoisted(() => vi.fn(async () => true));
const coordinatorMock = vi.hoisted(() => ({ registerDevice: vi.fn(), heartbeatDevice: vi.fn(), listDevices: vi.fn(), revokeDevice: vi.fn() }));
const membershipRows = vi.hoisted(() => ({ rows: [{ id: 1 }] as unknown[] }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: sessionMock }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: enabledMock }));
vi.mock("../work-hub/device-coordinator", async importOriginal => {
  const actual = await importOriginal<typeof import("../work-hub/device-coordinator")>();
  return { ...actual, deviceCoordinator: coordinatorMock };
});
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => membershipRows.rows }) }) }) } };
});
import router from "./workHubDevices";

function app() { const value = express(); value.use(express.json()); value.use(router); return value; }
const deviceId = "10000000-0000-4000-8000-000000000001";

describe("Work Hub device routes", () => {
  beforeEach(() => {
    vi.clearAllMocks(); membershipRows.rows = [{ id: 1 }];
    sessionMock.mockReturnValue({ userId: 7, role: "vendor", vendorId: 12, membershipRole: "member" });
    coordinatorMock.registerDevice.mockResolvedValue({ id: deviceId }); coordinatorMock.heartbeatDevice.mockResolvedValue({ deviceId }); coordinatorMock.listDevices.mockResolvedValue([]); coordinatorMock.revokeDevice.mockResolvedValue({ id: deviceId });
  });
  it("registers a bounded device in the active company", async () => {
    const response = await request(app()).post("/work-hub/devices/register").send({ friendlyName: "John's iPhone", deviceClass: "phone", capabilities: { microphone: true } }).expect(201);
    expect(response.body.id).toBe(deviceId); expect(coordinatorMock.registerDevice).toHaveBeenCalledWith({ userId: 7, owner: { type: "vendor", id: 12 } }, expect.objectContaining({ friendlyName: "John's iPhone" }));
  });
  it("rejects stale organization sessions with not-found semantics", async () => {
    membershipRows.rows = [];
    await request(app()).get("/work-hub/devices").expect(404);
    expect(coordinatorMock.listDevices).not.toHaveBeenCalled();
  });
  it("rejects oversized or unexpected registration data", async () => {
    await request(app()).post("/work-hub/devices/register").send({ friendlyName: "x".repeat(81), deviceClass: "phone", capabilities: {}, secret: "no" }).expect(400);
  });
  it("heartbeats and revokes only validated device identifiers", async () => {
    await request(app()).post(`/work-hub/devices/${deviceId}/heartbeat`).send({ connectionId: deviceId, foreground: true, microphonePermission: "granted", surface: null }).expect(200);
    await request(app()).delete(`/work-hub/devices/${deviceId}`).expect(204);
    expect(coordinatorMock.heartbeatDevice).toHaveBeenCalledTimes(1); expect(coordinatorMock.revokeDevice).toHaveBeenCalledTimes(1);
  });
});
