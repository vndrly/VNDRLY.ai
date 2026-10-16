import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FleetRequestError,
  fleetClient,
  fleetErrorMessage,
} from "./fleet-client";
afterEach(() => vi.unstubAllGlobals());
describe("Fleet request errors", () => {
  it("reads a saved Detail as the canonical record returned by the Details endpoint", async () => {
    const detail = {
      id: "11111111-1111-4111-8111-111111111111",
      companyId: 7,
      version: 1,
      name: "Bob support",
      vehicleAssetId: "22222222-2222-4222-8222-222222222222",
      rigPackageId: null,
      rigPackageVersion: null,
      driverUserId: 2,
      accessGroupIds: ["33333333-3333-4333-8333-333333333333"],
      effectiveFrom: "2026-10-16T12:00:00Z",
      effectiveUntil: null,
      archivedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(detail), { status: 200 }),
        ),
    );
    await expect(
      fleetClient.saveDetail({
        operationId: "44444444-4444-4444-8444-444444444444",
        expectedVersion: 0,
        detail,
      }),
    ).resolves.toEqual(detail);
  });
  it("uses the separate exact draft PATCH route with cookie authentication", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "run", events: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const input = {
      operationId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 4,
      title: "Reviewed draft",
      schedule: null,
    };
    await fleetClient.editDraft("22222222-2222-4222-8222-222222222222", input);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/fleet/runs/22222222-2222-4222-8222-222222222222/draft",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify(input),
      }),
    );
  });
  it("retains canonical blocker codes for clear readiness feedback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "fleet.equipment_on_hold" }), {
          status: 409,
        }),
      ),
    );
    await expect(fleetClient.overview()).rejects.toMatchObject({
      code: "fleet.equipment_on_hold",
      status: 409,
    });
    expect(
      fleetErrorMessage(
        new FleetRequestError("fleet.equipment_on_hold", 409),
        "Unavailable",
      ),
    ).toMatch(/active hold/);
  });
  it("does not expose arbitrary error contents", () => {
    expect(
      fleetErrorMessage(
        new FleetRequestError("private unexpected message", 500),
        "Unavailable",
      ),
    ).toBe("Unavailable");
  });
});
