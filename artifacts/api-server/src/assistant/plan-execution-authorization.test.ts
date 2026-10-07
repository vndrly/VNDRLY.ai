import { beforeEach, expect, it, vi } from "vitest";
import { createCoordinatedPlan } from "./coordinated-plan";
import { prepareBoundExecutionProposal } from "./plan-execution-approval";
const mocks = vi.hoisted(() => ({ grants: vi.fn(), session: vi.fn(), reads: vi.fn(), actions: vi.fn(), task: vi.fn(), decode: vi.fn() }));
vi.mock("./chatgpt-grant-store", () => ({ withAssistantGrants: mocks.grants, validateAssistantSession: mocks.session }));
vi.mock("./chatgpt-tool-access", () => ({ chatGptReadableTools: mocks.reads, chatGptActionTools: mocks.actions }));
vi.mock("./coordinated-plan-exact-task", () => ({ readExactPlanTask: mocks.task }));
vi.mock("./coordinated-plan", async importOriginal => ({ ...await importOriginal<object>(), decodePlanDescription: mocks.decode }));
import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
let authorization: ReturnType<typeof prepareBoundExecutionProposal>;
let plan: ReturnType<typeof createCoordinatedPlan>;
let grants: Array<Record<string, unknown>>;
beforeEach(() => {
  vi.clearAllMocks();
  plan = createCoordinatedPlan({ userId: 17, organizationKey: "vendor:4" }, [{ id: "read", specialist: "Ivy", toolNames: ["query_asset_custody"], dependsOn: [] }]);
  authorization = prepareBoundExecutionProposal(plan, { requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 2 }, grantReference: "exact-grant", taskId: "00000000-0000-4000-8000-000000000010", taskVersion: 3, availableTools: new Set(["query_asset_custody"]) }, { taskId: "00000000-0000-4000-8000-000000000010", expectedTaskVersion: 3, expectedPlanVersion: 1, expiresInMinutes: 30, maxAttempts: 2, steps: [{ id: "read", adapter: "authorized_read", toolName: "query_asset_custody", arguments: {} }] });
  grants = [{ consentHash: "exact-grant", revoked: false, refreshExpiresAt: Date.now() + 60000, session: {}, scopes: ["operations:read", "work_hub:read"] }];
  mocks.grants.mockImplementation(async (_id, callback) => callback(grants, {}));
  mocks.session.mockResolvedValue({ userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 12, sv: 2 });
  mocks.reads.mockReturnValue([{ name: "list_work_hub_tasks" }, { name: "query_asset_custody" }]);
  mocks.actions.mockReturnValue([]);
  mocks.task.mockResolvedValue({ id: authorization.taskId, version: 3, status: "open", description: "saved" });
  mocks.decode.mockReturnValue(plan);
});
it("revalidates the exact originating grant and current membership before reading the pinned plan", async () => {
  expect((await currentPlanExecutionAuthority(authorization)).current).toMatchObject({ grantReference: "exact-grant", taskVersion: 3, membershipId: 12 });
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.task).toHaveBeenCalledTimes(1);
});
it("refuses expired, revoked or substituted grants before domain reads", async () => {
  for (const change of [{ revoked: true }, { refreshExpiresAt: 1 }, { consentHash: "other" }]) {
    grants = [{ ...grants[0], ...change }];
    await expect(currentPlanExecutionAuthority(authorization)).rejects.toThrow("unavailable");
  }
  await expect(currentPlanExecutionAuthority({ ...authorization, expiresAt: 1 })).rejects.toThrow("expired");
  expect(mocks.task).not.toHaveBeenCalled();
});
it("refuses changed user, membership, company or session version before domain reads", async () => {
  for (const change of [{ userId: 18 }, { activeMembershipId: 13 }, { vendorId: 5 }, { sv: 3 }]) {
    mocks.session.mockResolvedValue({ userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 12, sv: 2, ...change });
    await expect(currentPlanExecutionAuthority(authorization)).rejects.toThrow("membership");
  }
  expect(mocks.task).not.toHaveBeenCalled();
});
it("refuses terminal or changed saved plan and removed tool authority", async () => {
  mocks.task.mockResolvedValueOnce({ version: 3, status: "completed" });
  await expect(currentPlanExecutionAuthority(authorization)).rejects.toThrow("terminal");
  mocks.task.mockResolvedValueOnce({ version: 4, status: "open", description: "saved" });
  await expect(currentPlanExecutionAuthority(authorization)).rejects.toThrow("changed");
  mocks.decode.mockReturnValueOnce({ ...plan, version: 2 });
  await expect(currentPlanExecutionAuthority(authorization)).rejects.toThrow("changed");
  mocks.reads.mockReturnValue([{ name: "list_work_hub_tasks" }]);
  await expect(currentPlanExecutionAuthority(authorization)).rejects.toThrow("changed");
});
