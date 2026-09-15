import { beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: env.apiFetch }));
import { completeActiveFieldTrip } from "./field-mode-api";

describe("completeActiveFieldTrip", () => {
  beforeEach(() => env.apiFetch.mockReset());

  it("completes the authoritative active trip with its current version", async () => {
    env.apiFetch.mockResolvedValueOnce({ id: "00000000-0000-4000-8000-000000000010", version: 4 }).mockResolvedValueOnce({ trackingState: "completed" });
    await expect(completeActiveFieldTrip({ operationId: "00000000-0000-4000-8000-000000000011", reason: "end_of_work", needsSupervisorConfirmation: false, completedAt: new Date("2026-09-15T18:00:00.000Z") })).resolves.toBe(true);
    expect(env.apiFetch).toHaveBeenNthCalledWith(2, "/api/implementation-a/trips/00000000-0000-4000-8000-000000000010/complete", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(env.apiFetch.mock.calls[1][1].body)).toEqual({ operationId: "00000000-0000-4000-8000-000000000011", expectedVersion: 4, reason: "end_of_work", needsSupervisorConfirmation: false, completedAt: "2026-09-15T18:00:00.000Z" });
  });

  it("returns false when there is no active trip", async () => {
    env.apiFetch.mockResolvedValueOnce(null);
    await expect(completeActiveFieldTrip({ operationId: "00000000-0000-4000-8000-000000000012", reason: "end_of_work", needsSupervisorConfirmation: false, completedAt: new Date() })).resolves.toBe(false);
    expect(env.apiFetch).toHaveBeenCalledTimes(1);
  });
});
