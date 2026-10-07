import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
const detail = vi.hoisted(() => vi.fn());
vi.mock("../services/fleet-ops", () => ({
  createFleetService: () => ({ detail }),
}));
vi.mock("../services/fleet-repository", () => ({
  databaseFleetRepository: {},
}));
import { resolveNotificationDestination } from "./notification-destination";
const actor = {
  userId: 7,
  role: "field_employee" as const,
  vendorId: 9,
  activeMembershipId: 12,
  membershipRole: "field_employee",
  vendorPeopleId: 8,
  sv: 3,
};
beforeEach(() => {
  detail.mockReset().mockResolvedValue({ status: "dispatched" });
});
describe("Fleet notification pointers", () => {
  it("rechecks the exact canonical run using current bound session before opening", async () => {
    const id = randomUUID();
    expect(
      await resolveNotificationDestination(actor, `/fleet/runs/${id}`),
    ).toBe(`/fleet/runs/${id}`);
    expect(detail).toHaveBeenCalledWith({ ...actor, companyId: 9 }, id);
    detail.mockRejectedValue(new Error("Current assignment revoked"));
    expect(
      await resolveNotificationDestination(actor, `/fleet/runs/${id}`),
    ).toBeNull();
  });
  it("refuses foreign portal and arbitrary or extra destinations without consulting records", async () => {
    const id = randomUUID();
    for (const url of [
      `/fleet/runs/${id}?companyId=9`,
      `https://evil.invalid/fleet/runs/${id}`,
      "/fleet/runs/not-a-uuid",
      `/fleet/runs/${id}/delete`,
    ])
      expect(
        await resolveNotificationDestination(
          { ...actor, role: "partner", vendorId: null, partnerId: 10 },
          url,
        ),
      ).toBeNull();
    expect(detail).not.toHaveBeenCalled();
  });
});
