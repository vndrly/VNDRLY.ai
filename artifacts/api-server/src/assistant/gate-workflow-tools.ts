import type { AskVToolDefinition } from "./tool-registry";

export const GATE_WORKFLOW_TOOLS: AskVToolDefinition[] = [{
  name: "manage_gate_shift",
  description: "Prepare ending your exact Gate duty or work session, preparing or cancelling your handoff, or opening, resolving and reopening a carry-forward item. Read current station state and exact item IDs first; a new item needs a fresh UUID. End duty before ending work. Incoming-worker authentication and acceptance remain on the trusted handoff device; this tool cannot impersonate that worker or transfer their account.",
  inputSchema: { type: "object", properties: {
    action: { type: "string", enum: ["end_duty", "end_work", "prepare_handoff", "cancel_handoff", "open_item", "resolve_item", "reopen_item"] },
    stationId: { type: "string", format: "uuid" }, dutySessionId: { type: "string", format: "uuid" }, workSessionId: { type: "string", format: "uuid" },
    reason: { type: "string", maxLength: 500 }, notes: { type: "string", maxLength: 8000 }, handoffCompleted: { type: "boolean", description: "The worker's actual handoff status; never assume it is complete." },
    itemId: { type: "string", format: "uuid" }, text: { type: "string", minLength: 1, maxLength: 2000, description: "The item, resolution, or reopening note supplied by the worker." },
  }, required: ["action", "stationId"], additionalProperties: false },
  roles: ["admin", "partner", "vendor", "field_employee"], mutating: true, confirmation: "required", risk: "high", execution: "server", pack: "role", auditTarget: "site",
}];
