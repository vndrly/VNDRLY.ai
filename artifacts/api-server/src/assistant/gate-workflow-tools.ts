import type { AskVToolDefinition } from "./tool-registry";
import { GATE_GUIDED_WORKFLOW_KEYS, parseGateWorkflowOffer } from "@workspace/gate-booth";

export function offerGateWorkflow(input: unknown, companyId?: number | null) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const context = raw.context && typeof raw.context === "object" && !Array.isArray(raw.context) ? Object.fromEntries(Object.entries(raw.context).filter(([, value]) => value != null)) : {};
  const offer = parseGateWorkflowOffer({ kind: "gate_workflow_offer", companyId, workflowKey: raw.workflowKey, context }, companyId);
  const fields = ["siteId", "stationId", "shiftId", "vehicleId", "alertId", "movementId", "day", "employeeUserId"];
  if (!offer || raw.context != null && (typeof raw.context !== "object" || Array.isArray(raw.context)) || Object.keys(raw).some(key => !["workflowKey", "context"].includes(key)) || Object.entries(context).some(([key, value]) => !fields.includes(key) || offer.context[key as keyof typeof offer.context] !== value)) return { ok: false, error: "Choose an existing Gate workflow and exact IDs from authorized reads; no actor, company, route or saved-outcome override is accepted." };
  return offer;
}

export const GATE_WORKFLOW_TOOLS: AskVToolDefinition[] = [{
  name: "offer_gate_workflow",
  description: "Offer one of askV's registered Gate workflows in Next Steps after understanding the user's question. Use existing authorized reads and the active guidance context to keep the same site, station, shift or vehicle and resume at the relevant step. The user explicitly chooses Start or Resume. This tool only proposes guidance: it does not navigate, click, save, acknowledge or assume watch. For first-watch setup, read query_gate_setup_progress first; resume checks saved state again. Never invent routes, completion or IDs.",
  inputSchema: { type: "object", properties: { workflowKey: { type: "string", enum: [...GATE_GUIDED_WORKFLOW_KEYS] }, context: { type: "object", properties: {
    siteId: { type: "integer", minimum: 1 }, stationId: { type: "string", format: "uuid" }, shiftId: { type: "string", format: "uuid" }, vehicleId: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", maxLength: 80 }] }, alertId: { type: "string", format: "uuid" }, movementId: { type: "string", format: "uuid" }, day: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, employeeUserId: { type: "integer", minimum: 1 },
  }, additionalProperties: false } }, required: ["workflowKey"], additionalProperties: false },
  roles: ["vendor", "field_employee"], mutating: false, confirmation: "none", risk: "read", execution: "server", pack: "screen", auditTarget: "work_hub",
}, {
  name: "query_gate_setup_progress",
  description: "Read the current user's saved Gate setup and exact next blocking step for the first watch in their active company. askV owns these workflows; Next Steps renders the same guidance. Use for how-to, resume and what-is-next questions, including from another page. Completion requires the saved watch AND its automatic ticket. A saved watch awaiting ticket confirmation is a wait, never another Assume Watch. This is a read only; it neither starts guidance nor saves business changes. For daily vehicle/handoff questions, read the exact current records with the existing Gate tools and use the active Gate guidance context.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  roles: ["vendor", "field_employee"], mutating: false, confirmation: "none", risk: "read", execution: "server", pack: "screen", auditTarget: "work_hub",
}, {
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
