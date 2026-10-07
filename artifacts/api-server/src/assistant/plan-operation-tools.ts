import { z } from "zod/v4";
import { PLAN_OPERATION_INPUTS, planOperationStepSchema } from "./plan-operation-inputs";
import type { AskVToolDefinition } from "./tool-registry";
import { chatGptReadToolAnnotations } from "./chatgpt-tool-access";
import { exposedOperationTools, resolveOperationTool, canonicalOperationToolName } from "./chatgpt-operation-tools";
const readPrefix = "v_plan_read__", definitionPrefix = "v_plan_step__";
type ReadDefinition = Pick<AskVToolDefinition, "name" | "description" | "inputSchema">;
export function plannedReadOperationTools(reads: ReadDefinition[]) {
  return exposedOperationTools(reads as AskVToolDefinition[]).map(tool => ({ name: readPrefix + tool.name, description: `Read only ${tool.name} for one currently eligible saved-plan step. ${tool.description} This call returns signed observation evidence; it does not run other step operations, save a checkpoint or complete business work.`, inputSchema: { type: "object" as const, properties: { taskId: { type: "string", format: "uuid" }, stepId: { type: "string", minLength: 1, maxLength: 100 }, arguments: tool.inputSchema }, required: ["taskId", "stepId", "arguments"], additionalProperties: false }, annotations: chatGptReadToolAnnotations(canonicalOperationToolName(tool.name)) }));
}
export function resolvePlannedReadOperation(name: string, raw: unknown, reads: ReadDefinition[]) {
  if (!name.startsWith(readPrefix)) return null;
  const tool = exposedOperationTools(reads as AskVToolDefinition[]).find(tool => readPrefix + tool.name === name);
  if (!tool) throw Error("Planned read operation unavailable");
  const input = z.object({ taskId: z.uuid(), stepId: z.string().min(1).max(100), arguments: z.record(z.string(), z.unknown()) }).strict().parse(raw);
  const operation=resolveOperationTool(tool.name,input.arguments,reads as AskVToolDefinition[]);
  return { ...input, arguments:operation.input, toolName:operation.name };
}
export function backgroundStepOperationTools(available: ReadonlySet<string>) {
  return PLAN_OPERATION_INPUTS.filter(operation => available.has(operation.toolName)).map(operation => ({ name: definitionPrefix + operation.key, description: `${operation.description} Returns an inert typed step fragment only. Include every prerequisite in the complete saved-plan proposal, then obtain separate same-account browser approval within five minutes. This tool cannot grant authority or start execution.`, inputSchema: { ...z.toJSONSchema(z.object({ id: z.string().min(1).max(100), arguments: operation.input }).strict()), type: "object" as const }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }));
}
export function defineBackgroundStepOperation(name: string, raw: unknown, available: ReadonlySet<string>) {
  if (!name.startsWith(definitionPrefix)) return null;
  const operation = PLAN_OPERATION_INPUTS.find(operation => definitionPrefix + operation.key === name && available.has(operation.toolName));
  if (!operation) throw Error("Background step definition unavailable");
  const input = z.object({ id: z.string().min(1).max(100), arguments: operation.input }).strict().parse(raw);
  return { step: planOperationStepSchema(operation).parse({ ...input, adapter: operation.adapter, toolName: operation.toolName }), executionStarted: false, approvalGranted: false };
}
