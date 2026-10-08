import { it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ task: vi.fn(), prepare: vi.fn() }));
vi.mock("./plan-execution-consent", () => ({
  createPlanExecutionConsentService: () => ({ prepare: m.prepare }),
}));
vi.mock("./coordinated-plan-exact-task", () => ({ readExactPlanTask: m.task }));
vi.mock("./chatgpt-tool-access", () => ({
  chatGptReadableTools: () => [
    { name: "list_work_hub_tasks" },
    { name: "query_asset_custody" },
  ],
  chatGptActionTools: () => [{ name: "manage_work_hub_task" }],
}));
vi.mock("./natural-voice-write-tools", () => ({
  callNaturalVoiceDomainApi: vi.fn(),
}));
import { handlePlanExecutionTool } from "./plan-execution-chatgpt";
import {
  encodePlanDescription,
  createCoordinatedPlan,
} from "./coordinated-plan";
it("binds actual fixed operation preparation then assembles references through existing whole-plan approval service", async () => {
  vi.stubEnv("ASSISTANT_PLAN_EXECUTION_ENABLED", "1");
  const id = "11111111-1111-4111-8111-111111111111",
    identity = { userId: 17, organizationKey: "vendor:4" };
  const plan = createCoordinatedPlan(identity, [
    {
      id: "read",
      specialist: "Inventory",
      toolNames: ["query_asset_custody"],
      dependsOn: [],
    },
  ]);
  m.task.mockResolvedValue({
    id,
    version: 1,
    status: "open",
    description: encodePlanDescription(plan),
  });
  m.prepare.mockImplementation(async (proposal) => ({
    token: "review-only",
    proposal,
  }));
  const actor = {
    userId: 17,
    role: "vendor",
    vendorId: 4,
    activeMembershipId: 8,
    sv: 2,
  };
  const raw = {
    taskId: id,
    expectedTaskVersion: 1,
    expectedPlanVersion: 1,
    id: "read",
    arguments: {},
  };
  const result = (await handlePlanExecutionTool(
    "v_plan_step__read_query_asset_custody",
    raw,
    actor,
    ["work_hub:read", "work_hub:write"],
    "grant",
  )) as { fragmentReference: string };
  expect(m.prepare).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    executionStarted: false,
    approvalGranted: false,
  });
  const assembly = {
    taskId: id,
    expectedTaskVersion: 1,
    expectedPlanVersion: 1,
    expiresInMinutes: 30,
    maxAttempts: 2,
    fragmentReferences: [result.fragmentReference],
  };
  await handlePlanExecutionTool(
    "v_prepare_background_work",
    assembly,
    actor,
    ["work_hub:read", "work_hub:write"],
    "grant",
  );
  expect(m.prepare).toHaveBeenCalledOnce();
  expect(m.prepare.mock.calls[0][0].steps[0]).toMatchObject({
    id: "read",
    adapter: "authorized_read",
    toolName: "query_asset_custody",
    arguments: {},
    dependsOn: [],
  });
  await expect(
    handlePlanExecutionTool(
      "v_prepare_background_work",
      { ...assembly, steps: [] },
      actor,
      [],
      "grant",
    ),
  ).rejects.toThrow();
  vi.unstubAllEnvs();
});
import { backgroundStepOperationTools } from "./plan-operation-tools";
import { PLAN_OPERATION_INPUTS } from "./plan-operation-inputs";
import { PLAN_EXECUTION_PREPARE_TOOL } from "./plan-execution-chatgpt";
it("advertises every fixed constructor upfront and coordinator accepts references only", () => {
  const tools = backgroundStepOperationTools(
    new Set(PLAN_OPERATION_INPUTS.map((op) => op.toolName)),
  );
  expect(tools).toHaveLength(PLAN_OPERATION_INPUTS.length);
  for (const tool of tools) {
    expect(tool.inputSchema.required).toEqual([
      "taskId",
      "expectedTaskVersion",
      "expectedPlanVersion",
      "id",
      "arguments",
    ]);
    expect(tool.inputSchema.properties).not.toHaveProperty("adapter");
    expect(tool.inputSchema.properties).not.toHaveProperty("toolName");
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  }
  expect(PLAN_EXECUTION_PREPARE_TOOL.inputSchema.properties).toHaveProperty(
    "fragmentReferences",
  );
  expect(PLAN_EXECUTION_PREPARE_TOOL.inputSchema.properties).not.toHaveProperty(
    "steps",
  );
});
