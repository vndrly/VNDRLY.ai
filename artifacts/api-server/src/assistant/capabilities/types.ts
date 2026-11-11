import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";
import { capabilityInputContract } from "./input-contracts";

export interface ImplementationACapabilityTool {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
  mutating: boolean;
  confirmation: "none" | "required";
  roles: ("admin" | "partner" | "vendor" | "field_employee")[];
  authorityCapability: "directory.read" | "schedule.manage" | "export.read" | "location.read" | "events.subscribe" | "operations.display.view";
}

const objectSchema = (properties: Record<string, unknown> = {}): Anthropic.Tool["input_schema"] => ({ type: "object", properties, additionalProperties: true });

export function capabilityTools(domain: string, noun: string, authorityCapability: ImplementationACapabilityTool["authorityCapability"], roles: ImplementationACapabilityTool["roles"]): ImplementationACapabilityTool[] {
  const tools: ImplementationACapabilityTool[] = [
    { name: `query_${domain}`, description: `Read authorized ${noun}.`, input_schema: objectSchema(), mutating: false, confirmation: "none", roles, authorityCapability },
    { name: `prepare_${domain}_action`, description: `Prepare a ${noun} action and explain its effect.`, input_schema: objectSchema({ action: { type: "string" } }), mutating: false, confirmation: "none", roles, authorityCapability },
    { name: `confirm_${domain}_action`, description: `Execute a previously prepared ${noun} action after explicit confirmation.`, input_schema: objectSchema({ operationId: { type: "string" }, confirmed: { type: "boolean", const: true } }), mutating: true, confirmation: "required", roles, authorityCapability },
  ];
  return tools.map(tool => ({ ...tool, input_schema: capabilityInputContract(domain, tool.name.startsWith("query_") ? "query" : tool.name.startsWith("prepare_") ? "prepare" : "confirm") ?? tool.input_schema }));
}
