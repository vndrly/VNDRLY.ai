import React from "react";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  api: vi.fn(),
  user: {
    id: 1,
    role: "vendor",
    vendorId: 2,
    activeMembershipId: 3,
    username: "synthetic",
    displayName: "Synthetic",
  },
  current: true,
  invalidators: new Set<() => void>(),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => env.current,
  subscribeUser: (fn: () => void) => {
    env.invalidators.add(fn);
    return () => env.invalidators.delete(fn);
  },
  subscribeToken: () => () => {},
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    border: "gray",
    card: "black",
    mutedForeground: "gray",
  }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
import WorkHubPlanDetail from "./WorkHubPlanDetail";
import {
  isCoordinatedPlanDescription,
  readNativePlanProjection,
} from "@/lib/work-hub-plan";
const taskId = "10000000-0000-4000-8000-000000000001";
const projection = () => ({
  taskId,
  title: "Actual saved plan",
  taskVersion: 4,
  taskStatus: "open",
  permissionSource: "current_platform_session",
  backgroundExecutionAvailable: false,
  executionStarted: false,
  recordedCompletionRequiresReadback: true,
  plan: {
    schemaVersion: 1,
    id: "plan",
    version: 2,
    identity: { userId: 1, organizationKey: "vendor:2" },
    steps: [
      {
        id: "read",
        specialist: "V",
        toolNames: ["query_tickets"],
        dependsOn: [],
        state: "completed",
        resultReferences: ["receipt:actual"],
        completion: { kind: "planned_read_observed" },
      },
      {
        id: "next",
        specialist: "Felix",
        toolNames: ["manage_ticket_record_submit"],
        dependsOn: ["read"],
        state: "pending",
        resultReferences: [],
        deadlineAt: "2026-01-01T00:00:00Z",
      },
    ],
  },
  verifiedCompletionStepIds: [],
  eligibleStepIds: [],
  overdueStepIds: ["next"],
});
beforeEach(() => {
  env.current = true;
  env.invalidators.clear();
  env.api.mockReset().mockResolvedValue(projection());
});
afterEach(cleanup);
it("reads exact canonical projection without writes and distinguishes recorded from verified completion", async () => {
  render(<WorkHubPlanDetail taskId={taskId} />);
  expect(await screen.findByText("Actual saved plan")).toBeTruthy();
  expect(screen.getByText("workPlan.recordedUnverified")).toBeTruthy();
  expect(screen.queryByText("workPlan.verified")).toBeNull();
  expect(screen.getByText("workPlan.readOnlyCheckpoint")).toBeTruthy();
  expect(screen.queryByText(/receipt:actual/)).toBeNull();
  expect(screen.queryByRole("button", { name: /complete/i })).toBeNull();
  expect(env.api).toHaveBeenCalledTimes(1);
  expect(env.api.mock.calls[0][0]).toBe(`/api/work-hub/tasks/${taskId}/plan`);
  expect(env.api.mock.calls[0][1].method).toBeUndefined();
});
it("clears displayed private plan immediately on account change and ignores old response", async () => {
  let resolve!: (value: unknown) => void;
  env.api.mockImplementationOnce(
    () =>
      new Promise((value) => {
        resolve = value;
      }),
  );
  render(<WorkHubPlanDetail taskId={taskId} />);
  await waitFor(() => expect(env.api).toHaveBeenCalledOnce());
  await act(async () => {
    env.current = false;
    env.invalidators.forEach((fn) => fn());
    resolve(projection());
  });
  expect(screen.queryByText("Actual saved plan")).toBeNull();
  expect(screen.getByText("workPlan.unavailable")).toBeTruthy();
});
it("rejects mismatched account/company/task and never presents unavailable data", async () => {
  const value = projection();
  value.plan.identity.organizationKey = "vendor:99";
  env.api.mockResolvedValueOnce(value);
  render(<WorkHubPlanDetail taskId={taskId} />);
  expect(await screen.findByText("workPlan.unavailable")).toBeTruthy();
  expect(screen.queryByText("Actual saved plan")).toBeNull();
  expect(() =>
    readNativePlanProjection(projection(), taskId, { ...env.user, id: 9 }),
  ).toThrow();
  expect(() =>
    readNativePlanProjection(projection(), "other", env.user),
  ).toThrow();
});
it("rejects authority/execution overclaims and recognizes plans only to suppress generic completion", () => {
  expect(() =>
    readNativePlanProjection(
      { ...projection(), executionStarted: true },
      taskId,
      env.user,
    ),
  ).toThrow();
  expect(isCoordinatedPlanDescription(JSON.stringify(projection().plan))).toBe(
    true,
  );
  expect(isCoordinatedPlanDescription("Ordinary human task")).toBe(false);
  expect(
    isCoordinatedPlanDescription(
      JSON.stringify({ schemaVersion: 1, steps: [] }),
    ),
  ).toBe(false);
});
