import { expect, it } from "vitest";
import { PLAN_OPERATION_INPUTS, typedPlanProposalStepSchema } from "./plan-operation-inputs";
import { PLAN_EXECUTION_READ_TOOL_NAMES } from "./plan-execution-read-policy";
import { backgroundStepOperationTools, defineBackgroundStepOperation, plannedReadOperationTools, resolvePlannedReadOperation } from "./plan-operation-tools";
const taskId = "11111111-1111-4111-8111-111111111111";
it("retains every registered read and all adapters with inert strict definitions", () => {
 expect(PLAN_OPERATION_INPUTS.filter(x => x.adapter === "authorized_read").map(x => x.toolName).sort()).toEqual([...PLAN_EXECUTION_READ_TOOL_NAMES].sort());
 expect(new Set(PLAN_OPERATION_INPUTS.map(x => x.adapter)).size).toBe(6);
 const available = new Set(PLAN_OPERATION_INPUTS.map(x => x.toolName));
 expect(backgroundStepOperationTools(available)).toHaveLength(PLAN_OPERATION_INPUTS.length);
 const raw = { id: "brief", arguments: { title: "Return briefing" } };
 const result = defineBackgroundStepOperation("v_plan_step__company_review_draft", raw, available)!;
 expect(result).toMatchObject({ executionStarted: false, approvalGranted: false, step: { adapter: "personal_draft", toolName: "manage_work_hub_task" } });
 expect(typedPlanProposalStepSchema.parse(result.step)).toEqual(result.step);
 for (const extra of [{ adapter: "authorized_read" }, { operationId: taskId }, { approvalGranted: true }]) expect(() => defineBackgroundStepOperation("v_plan_step__company_review_draft", { ...raw, ...extra }, available)).toThrow();
 expect(() => defineBackgroundStepOperation("v_plan_step__company_review_draft", raw, new Set())).toThrow();
});
it("refuses away action substitution and caller authority", () => {
 const available = new Set(["manage_work_hub_away_responder"]);
 const args = { action: "pause", expectedVersion: 2, ruleId: taskId };
 expect(defineBackgroundStepOperation("v_plan_step__away_pause", { id: "pause", arguments: args }, available)?.step).toMatchObject({ arguments: args });
 for (const invalid of [{ ...args, action: "revoke" }, { ...args, ownerOrgId: 4 }, { ...args, operationId: taskId }]) expect(() => defineBackgroundStepOperation("v_plan_step__away_pause", { id: "pause", arguments: invalid }, available)).toThrow();
});
it("keeps canonical read schemas and denies removed operations or envelope substitution", () => {
 const reads = [{ name: "query_tickets", description: "Read scoped tickets", inputSchema: { type: "object" as const, properties: { status: { type: "string" } }, additionalProperties: false } }];
 const tool = plannedReadOperationTools(reads)[0];
 expect(tool.inputSchema.properties.arguments).toEqual(reads[0].inputSchema);
 const raw = { taskId, stepId: "review", arguments: { status: "submitted" } };
 expect(resolvePlannedReadOperation(tool.name, raw, reads)).toEqual({ ...raw, toolName: "query_tickets" });
 expect(() => resolvePlannedReadOperation(tool.name, { ...raw, toolName: "query_invoices" }, reads)).toThrow();
 expect(() => resolvePlannedReadOperation(tool.name, raw, [])).toThrow();
});
