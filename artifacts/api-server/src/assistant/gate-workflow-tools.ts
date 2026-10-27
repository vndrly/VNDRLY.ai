import type { AskVToolDefinition } from "./tool-registry";

export const GATE_WORKFLOW_TOOLS: AskVToolDefinition[] = [{
  name: "manage_gate_shift",
  description: "Add a spoken or typed shift note to the current watch, prepare ending exact Gate duty/work sessions, prepare or cancel a handoff, or manage carry-forward tasks. For 'add shift note', use add_shift_note, never open_item or prepare_handoff: preserve the worker's words, including reported incident time, and read their current watch ID first. A new note needs a fresh operationId UUID. Only the gatekeeper can sign the notes in the trusted handoff screen; this tool never signs or assumes a watch for them.",
  inputSchema: { type: "object", properties: {
    action: { type: "string", enum: ["add_shift_note", "end_duty", "end_work", "prepare_handoff", "cancel_handoff", "open_item", "resolve_item", "reopen_item"] },
    expectedWatchId: {type:"string",format:"uuid"}, operationId:{type:"string",format:"uuid"},
    stationId: { type: "string", format: "uuid" }, dutySessionId: { type: "string", format: "uuid" }, workSessionId: { type: "string", format: "uuid" },
    reason: { type: "string", maxLength: 500 }, notes: { type: "string", maxLength: 8000 }, handoffCompleted: { type: "boolean", description: "The worker's actual handoff status; never assume it is complete." },
    itemId: { type: "string", format: "uuid" }, text: { type: "string", minLength: 1, maxLength: 2000, description: "The item, resolution, or reopening note supplied by the worker." },
  }, required: ["action", "stationId"], additionalProperties: false },
  roles: ["admin", "partner", "vendor", "field_employee"], mutating: true, confirmation: "required", risk: "high", execution: "server", pack: "role", auditTarget: "site",
}];
