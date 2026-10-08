import { beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  api: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  current: true,
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("./auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => env.current,
  getUser: async () => ({ id: 1073, vendorId: 1107, activeMembershipId: 800 }),
  subscribeUser: vi.fn(),
  subscribeToken: vi.fn(),
}));
vi.mock("./api", () => ({ apiFetch: env.api }));
vi.mock(
  "../modules/vndrly-system-surfaces/src/VndrlySystemSurfacesModule",
  () => ({ default: { setContext: env.set, updateWorkActivity: env.update } }),
);
import {
  showFleetWorkActivity,
  stopNativeWorkActivity,
} from "./native-live-work";
const account = {
  userId: 1073,
  companyId: 1107,
  membershipId: 800,
  sessionVersion: 2,
};
const run = {
  id: "70000000-0000-4000-8000-000000000001",
  companyId: 1107,
  driverUserId: 1073,
  status: "in_progress",
  phase: "traveling_to_pickup",
  version: 4,
  title: "Assigned Fleet run",
  stops: [],
  allowedActions: ["pause"],
};
beforeEach(() => {
  vi.clearAllMocks();
  env.current = true;
  env.set.mockResolvedValue(undefined);
  env.update.mockResolvedValue("activity-1");
});
describe("fresh canonical live-work controller", () => {
  it("reads account and run before creating a minimal display", async () => {
    env.api
      .mockResolvedValueOnce({
        accountScope: account,
        capabilities: { canDrive: true },
      })
      .mockResolvedValueOnce(run);
    expect(await showFleetWorkActivity(run.id)).toMatchObject({
      activityId: "activity-1",
      physicalTrackingVerified: false,
    });
    expect(env.api.mock.calls.map((call) => call[0])).toEqual([
      "/api/fleet/overview",
      `/api/fleet/runs/${run.id}`,
    ]);
    expect(env.update).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKind: "fleet",
        subjectId: run.id,
        phase: "in_progress",
      }),
    );
  });
  it("clears an earlier display if canonical duty has ended", async () => {
    env.api
      .mockResolvedValueOnce({
        accountScope: account,
        capabilities: { canDrive: true },
      })
      .mockResolvedValueOnce({ ...run, status: "completed" });
    await expect(showFleetWorkActivity(run.id)).rejects.toThrow(
      "current_duty_required",
    );
    expect(env.set).toHaveBeenCalledWith(null);
    expect(env.update).not.toHaveBeenCalled();
  });
  it("refuses a run whose driver grant changed after overview", async () => {
    env.api
      .mockResolvedValueOnce({
        accountScope: account,
        capabilities: { canDrive: true },
      })
      .mockResolvedValueOnce({ ...run, allowedActions: [] });
    await expect(showFleetWorkActivity(run.id)).rejects.toThrow(
      "current_duty_required",
    );
    expect(env.set).toHaveBeenCalledWith(null);
    expect(env.update).not.toHaveBeenCalled();
  });
  it("does not clear a selected active run when a different ended card unmounts", async () => {
    env.api
      .mockResolvedValueOnce({
        accountScope: account,
        capabilities: { canDrive: true },
      })
      .mockResolvedValueOnce(run);
    await showFleetWorkActivity(run.id);
    env.set.mockClear();
    await stopNativeWorkActivity("70000000-0000-4000-8000-000000000002");
    expect(env.set).not.toHaveBeenCalled();
    await stopNativeWorkActivity(run.id);
    expect(env.set).toHaveBeenCalledWith(null);
  });
  it("rejects a native result arriving after its exact run was stopped", async () => {
    env.api
      .mockResolvedValueOnce({
        accountScope: account,
        capabilities: { canDrive: true },
      })
      .mockResolvedValueOnce(run);
    let finish!: (id: string) => void;
    env.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = showFleetWorkActivity(run.id);
    const rejected = expect(pending).rejects.toThrow("context_changed");
    await vi.waitFor(() => expect(env.update).toHaveBeenCalled());
    await stopNativeWorkActivity(run.id);
    finish("late-activity");
    await rejected;
    expect(env.set).toHaveBeenLastCalledWith(null);
  });
  it("rejects foreign memberships before requesting run data", async () => {
    env.api.mockResolvedValueOnce({
      accountScope: { ...account, membershipId: 999 },
      capabilities: { canDrive: true },
    });
    await expect(showFleetWorkActivity(run.id)).rejects.toThrow(
      "driver_required",
    );
    expect(env.api).toHaveBeenCalledTimes(1);
    expect(env.update).not.toHaveBeenCalled();
  });
  it("does not publish a read that completed after an account switch", async () => {
    env.api.mockImplementationOnce(async () => {
      env.current = false;
      return { accountScope: account, capabilities: { canDrive: true } };
    });
    await expect(showFleetWorkActivity(run.id)).rejects.toThrow();
    expect(env.update).not.toHaveBeenCalled();
  });
});
