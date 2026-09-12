import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const sessionMock = vi.hoisted(() => vi.fn());
const enabledMock = vi.hoisted(() => vi.fn(async () => true));
const coordinatorMock = vi.hoisted(() => ({ registerDevice: vi.fn(), heartbeatDevice: vi.fn(), listDevices: vi.fn(), listOrganizationDevices: vi.fn(), listDeviceConnections: vi.fn(), revokeDevice: vi.fn(), revokeOrganizationDevice: vi.fn(), renameDevice: vi.fn() }));
const preferencesMock = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
const auditMock = vi.hoisted(() => vi.fn());
const membershipRows = vi.hoisted(() => ({ rows: [{ id: 1 }] as unknown[] }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: sessionMock }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: enabledMock }));
vi.mock("../work-hub/device-preferences", () => ({ getDevicePreferences: preferencesMock.get, saveDevicePreferences: preferencesMock.save }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: auditMock }));
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
    coordinatorMock.registerDevice.mockResolvedValue({ id: deviceId, deviceClass: "desktop" }); coordinatorMock.heartbeatDevice.mockResolvedValue({ deviceId }); coordinatorMock.listDevices.mockResolvedValue([]); coordinatorMock.listOrganizationDevices.mockResolvedValue([{ id: deviceId, userId: 8, revokedAt: null }]); coordinatorMock.listDeviceConnections.mockResolvedValue([]); coordinatorMock.revokeDevice.mockResolvedValue({ id: deviceId }); coordinatorMock.revokeOrganizationDevice.mockResolvedValue({ id: deviceId }); coordinatorMock.renameDevice.mockResolvedValue({ id: deviceId, friendlyName: "Desk" });
    preferencesMock.get.mockResolvedValue({ rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} }); preferencesMock.save.mockImplementation(async (_actor, value) => value); auditMock.mockResolvedValue(undefined);
  });
  it("registers a bounded device in the active company", async () => {
    const response = await request(app()).post("/work-hub/devices/register").set("x-work-hub-source", "ios").send({ friendlyName: "John's iPhone", deviceClass: "phone", capabilities: { microphone: true } }).expect(201);
    expect(response.body.id).toBe(deviceId); expect(coordinatorMock.registerDevice).toHaveBeenCalledWith({ userId: 7, owner: { type: "vendor", id: 12 } }, expect.objectContaining({ friendlyName: "John's iPhone" }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "device.registered", source: "ios", metadata: { deviceClass: "desktop" } }));
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
  it("lets a company admin list and revoke company devices", async () => {
    sessionMock.mockReturnValue({ userId: 7, role: "vendor", vendorId: 12, membershipRole: "admin" });
    await request(app()).get("/work-hub/devices?scope=organization").expect(200);
    await request(app()).delete(`/work-hub/devices/${deviceId}?scope=organization`).expect(204);
    expect(coordinatorMock.listOrganizationDevices).toHaveBeenCalledTimes(1);
    expect(coordinatorMock.revokeOrganizationDevice).toHaveBeenCalledTimes(1);
  });
  it("hides company-wide device controls from ordinary members", async () => {
    await request(app()).get("/work-hub/devices?scope=organization").expect(404);
    await request(app()).delete(`/work-hub/devices/${deviceId}?scope=organization`).expect(404);
    expect(coordinatorMock.revokeOrganizationDevice).not.toHaveBeenCalled();
  });
  it("renames a self-owned device and clears learned preferences explicitly", async () => {
    await request(app()).patch(`/work-hub/devices/${deviceId}`).send({ friendlyName: "Desk" }).expect(200);
    await request(app()).put("/work-hub/devices/preferences").send({ rankedDeviceIds: [], automaticBackupDeviceIds: [], clearLearning: true }).expect(200);
    expect(coordinatorMock.renameDevice).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }), deviceId, "Desk");
    expect(preferencesMock.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ learning: {} }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "device.learning_cleared", source: "web" }));
  });
});
