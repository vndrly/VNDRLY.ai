import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), capabilities: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("./fleet-mobile-permissions", () => ({ resolveFleetCapabilities: mocks.capabilities }));

import { readFleetDriverLocation } from "./fleet-driver-location";

const actor = { userId: 10, companyId: 7, sv: 1, activeMembershipId: 2, membershipRole: "member", role: "vendor" };
const observation = { runId: "00000000-0000-4000-8000-000000000001", vehicleAssetId: "00000000-0000-4000-8000-000000000002", driverUserId: 22, latitude: 35.4, longitude: -97.5, accuracyMeters: 8, recordedAt: "2026-10-21T11:59:00.000Z", receivedAt: "2026-10-21T11:59:01.000Z", source: "driver_phone", freshness: "recent", physicalProofVerified: false };

beforeEach(() => { mocks.query.mockReset(); mocks.capabilities.mockReset(); });

describe("Fleet Driver location privacy", () => {
  it("allows office access and labels an open shift location current", async () => {
    mocks.capabilities.mockResolvedValue(new Set(["office"]));
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: 1 }] }).mockResolvedValueOnce({ rows: [{ state: "on_shift" }] }).mockResolvedValueOnce({ rows: [{ observation }] });
    const result = await readFleetDriverLocation(actor, 22);
    expect(result).toMatchObject({ driverUserId: 22, onShift: true, shiftState: "on_shift", location: observation });
    expect(mocks.query.mock.calls[2][0]).toContain("c.revoked_at IS NULL");
  });

  it("allows a driver to see themselves and greys an ended shift", async () => {
    mocks.capabilities.mockResolvedValue(new Set(["driver"]));
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: 1 }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ observation: { ...observation, driverUserId: 22 } }] });
    const result = await readFleetDriverLocation({ ...actor, userId: 22, role: "field_employee", membershipRole: "field_employee", vendorPeopleId: 5 }, 22);
    expect(result).toMatchObject({ onShift: false, shiftState: "off_shift" });
  });

  it("denies a driver access to another driver before reading location data", async () => {
    mocks.capabilities.mockResolvedValue(new Set(["driver"]));
    await expect(readFleetDriverLocation({ ...actor, userId: 21, role: "field_employee", membershipRole: "field_employee", vendorPeopleId: 4 }, 22)).rejects.toMatchObject({ code: "fleet.permission_denied", status: 403 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
