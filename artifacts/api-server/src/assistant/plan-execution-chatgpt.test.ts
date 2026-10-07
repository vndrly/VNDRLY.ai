import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ status: vi.fn(), cancel: vi.fn(), metadata: vi.fn() }));
vi.mock("./plan-execution-consent", () => ({ createPlanExecutionConsentService: () => ({ status: mocks.status, cancel: mocks.cancel, statusMetadata: mocks.metadata }) }));
vi.mock("./chatgpt-tool-access", () => ({ chatGptReadableTools: (_session: unknown, scopes: string[]) => scopes.includes("work_hub:read") ? [{ name: "list_work_hub_tasks" }] : [], chatGptActionTools: () => [] }));
import { planExecutionPublicRun, handlePlanExecutionTool, PLAN_EXECUTION_PREPARE_TOOL } from "./plan-execution-chatgpt";
import { createPlanExecution } from "./plan-execution";
afterEach(() => vi.unstubAllEnvs());
function run() {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return createPlanExecution({ id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 2 }, grantReference: "private-grant", taskId: uuid(2), taskVersion: 3, planId: uuid(3), planVersion: 1, planFingerprint: "a".repeat(64), approvedAt: 1000, expiresAt: 60000, maxAttempts: 2, steps: [{ id: "read", adapter: "authorized_read", toolName: "query_asset_custody", arguments: {}, dependsOn: [], operationId: uuid(4) }], notificationOperationId: uuid(5) });
}
it("does not expose originating grant and distinguishes pending approval from actual started execution", () => {
  const saved = run();
  expect(planExecutionPublicRun(saved)).toMatchObject({ state: "pending", workerAttemptStarted: false, originalPlanCheckpointsUpdated: false });
  expect(JSON.stringify(planExecutionPublicRun(saved))).not.toContain("private-grant");
  saved.steps[0].attempts = 1; saved.steps[0].state = "outcome_unknown"; saved.state = "outcome_unknown";
  expect(planExecutionPublicRun(saved)).toMatchObject({ state: "outcome_unknown", workerAttemptStarted: true, notificationSaved: false });
});
it("does not accept model identity, grant, approval or operation IDs in preparation", () => {
  const schema = PLAN_EXECUTION_PREPARE_TOOL.inputSchema;
  expect(schema.additionalProperties).toBe(false);
  for (const key of ["requester", "grantReference", "approvedAt", "confirmed", "operationId"]) expect(schema.properties).not.toHaveProperty(key);
});
it("refuses disabled execution tools before touching private records", async () => {
  vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "0");
  await expect(handlePlanExecutionTool("v_background_work_status", {}, { userId: 17 } as never, [], "private-grant")).rejects.toThrow("unavailable");
});
it("refuses direct unadvertised status calls without caller read permission or the originating connection", async () => {
  vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "1"); mocks.status.mockReset().mockResolvedValue(run());
  const actor = { userId: 17 } as never, input = { reference: run().authorization.id };
  await expect(handlePlanExecutionTool("v_background_work_status", input, actor, [], "private-grant")).rejects.toThrow("read unavailable");
  expect(mocks.status).not.toHaveBeenCalled();
  await expect(handlePlanExecutionTool("v_background_work_status", input, actor, ["work_hub:read"], "other-grant")).rejects.toThrow("connection changed");
  const output = await handlePlanExecutionTool("v_background_work_status", input, actor, ["work_hub:read"], "private-grant");
  expect(output).toMatchObject({ reference: input.reference, state: "pending" });
});
it("allows owner cancellation while returning no prior results, arguments or brief", async () => {
  vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "1"); const saved = run(); saved.brief = "private prior results"; saved.cancelRequested = true;
  mocks.cancel.mockResolvedValue(saved);
  const output = await handlePlanExecutionTool("v_cancel_background_work", { reference: saved.authorization.id }, { userId: 17 } as never, [], "different-grant");
  expect(output).toMatchObject({ cancelRequested: true, priorEffectsUndone: false });
  for (const key of ["steps", "authorization", "brief", "grantReference"]) expect(output).not.toHaveProperty(key);
});
it("returns only bound metadata when original execution authority has expired", async () => {
  vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "1"); mocks.status.mockRejectedValue(Error("Expired"));
  mocks.metadata.mockResolvedValue({ reference: run().authorization.id, state: "completed", workerAttemptStarted: true });
  const output = await handlePlanExecutionTool("v_background_work_status", { reference: run().authorization.id }, { userId: 17 } as never, ["work_hub:read"], "private-grant");
  expect(mocks.metadata).toHaveBeenCalledWith(run().authorization.id, { userId: 17 }, "private-grant");
  expect(output).toMatchObject({ state: "completed", savedResultsAvailable: false });
  expect(output).not.toHaveProperty("brief"); expect(output).not.toHaveProperty("steps");
});
