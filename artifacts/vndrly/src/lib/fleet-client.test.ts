import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FleetRequestError,
  fleetClient,
  fleetErrorMessage,
} from "./fleet-client";
afterEach(() => vi.unstubAllGlobals());
describe("Fleet request errors", () => {
  it("retains canonical blocker codes for clear readiness feedback", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
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
