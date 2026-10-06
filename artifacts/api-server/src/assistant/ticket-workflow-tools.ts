import type { AskVToolDefinition } from "./tool-registry";

export const TICKET_RECORD_ACTIONS = ["create", "update", "accept", "deny", "reinvite", "submit", "approve", "kickback", "awaiting_payment", "cancel", "reactivate", "add_line_item", "remove_line_item"] as const;
export function ticketRecordActionsForRole(role: string) {
  return TICKET_RECORD_ACTIONS.filter(action => {
    if (action === "reactivate") return role === "admin";
    if (["approve", "kickback", "awaiting_payment", "reinvite"].includes(action)) return ["admin", "partner"].includes(role);
    if (["accept", "deny"].includes(action)) return ["admin", "vendor"].includes(role);
    return ["admin", "partner", "vendor", "field_employee"].includes(role);
  });
}
/** Reuses canonical ticket endpoints; their role, ownership and lifecycle guards remain authoritative. */
export const TICKET_WORKFLOW_TOOLS: AskVToolDefinition[] = [{
  name: "manage_ticket_record",
  description: "Prepare an authorized ticket creation, edit, acceptance, submission, review, cancellation or line-item change. Read the ticket and required fields first. Approval/payment-review actions are only for the owning partner or VNDRLY administrator; worker access is limited to assigned tickets. This does not transfer money, start GPS tracking, upload photos or bypass ticket lifecycle rules.",
  inputSchema: { type: "object", properties: { action: { type: "string", enum: [...TICKET_RECORD_ACTIONS] }, ticketId: { type: "integer", minimum: 1 }, lineItemId: { type: "integer", minimum: 1 }, payload: { type: "object", description: "Exact canonical ticket or line-item fields supplied by the user; do not invent required values." } }, required: ["action", "payload"], additionalProperties: false },
  roles: ["admin", "partner", "vendor", "field_employee"],
  mutating: true, confirmation: "required", risk: "high", execution: "server", pack: "role", auditTarget: "ticket",
}];
