import { z } from "zod/v4";
import { TicketLaborFinalizationInputSchema } from "@workspace/api-zod";
import type { AskVToolDefinition } from "./tool-registry";

// Model JSON contracts mirror generated canonical fields. Dates travel as ISO strings; canonical endpoints validate every action.
const CreateTicketBody = z.object({
  siteLocationId: z.number(),
  vendorId: z.number(),
  fieldEmployeeId: z.number().nullish(),
  workTypeId: z.number(),
  description: z.string().nullish(),
  checkInLatitude: z.number().nullish(),
  checkInLongitude: z.number().nullish(),
  initialState: z
    .union([
      z.literal("pending_arrival"),
      z.literal("on_site"),
      z.literal(null),
    ])
    .nullish()
    .describe(
      "Hint from client: 'on_site' = check in immediately; 'pending_arrival' = create without check-in. Server still verifies geofence.",
    ),
  intakeChannel: z
    .union([
      z.literal("partner_self_service"),
      z.literal("partner_hotlist"),
      z.literal("office_on_behalf_of_partner"),
      z.literal("office_on_behalf_of_field_employee"),
      z.literal("vendor_field_self_service"),
      z.literal(null),
    ])
    .nullish()
    .describe(
      "Optional explicit intake channel. Server validates the caller is allowed to claim it; unauthorized values fall back to the role-default channel.",
    ),
  acceptanceImplicit: z
    .boolean()
    .nullish()
    .describe(
      "Office phone-intake only. When true on office_on_behalf_of_partner, skip the vendor-accept gate and start at initiated\/in_progress (the partner has already coordinated).",
    ),
  phoneIntakeCallerName: z
    .string()
    .nullish()
    .describe(
      "Office phone-intake only. Free-text caller name persisted to ticket_status_history.reason as `phone_intake_caller:<name>`.",
    ),
  foremanUserId: z
    .number()
    .nullish()
    .describe(
      "Optional foreman assignment. Office_on_behalf_of_field_employee uses this to mark the named FE as foreman.",
    ),
  scheduledStartAt: z.iso.datetime().nullish(),
  scheduledDurationMinutes: z.number().nullish(),
});
const UpdateTicketBody = z.object({
  description: z.string().nullish(),
  notes: z.string().nullish(),
  fieldEmployeeId: z.number().nullish(),
});
const CreateTicketLineItemBody = z.object({
  type: z.enum(["part", "labor", "equipment", "other"]),
  description: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  taxableOverride: z.boolean().nullish(),
});

export const TICKET_RECORD_ACTIONS = ["create", "update", "accept", "deny", "reinvite", "submit", "approve", "kickback", "awaiting_payment", "cancel", "reactivate", "unlock", "add_line_item", "remove_line_item", "finalize_labor"] as const;
export function ticketRecordActionsForRole(role: string) {
  return TICKET_RECORD_ACTIONS.filter(action => {
    if (action === "finalize_labor") return ["admin", "vendor", "field_employee"].includes(role);
    if (["reactivate", "unlock"].includes(action)) return role === "admin";
    if (["approve", "kickback", "reinvite"].includes(action)) return ["admin", "partner"].includes(role);
    if (["accept", "deny"].includes(action)) return ["admin", "vendor"].includes(role);
    return ["admin", "partner", "vendor", "field_employee"].includes(role);
  });
}
/** Reuses canonical ticket endpoints; their role, ownership and lifecycle guards remain authoritative. */
export const TICKET_WORKFLOW_TOOLS: AskVToolDefinition[] = [{
  name: "acknowledge_ticket_assignment",
  description: "Confirm or decline your own active ticket crew assignment in your current vendor organization. This only records your acknowledgement; it cannot respond for another worker, accept the vendor's ticket contract, remove crew or change the ticket lifecycle.",
  inputSchema: { type: "object", properties: { ticketId: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["confirmed", "declined"] }, note: { type: "string", maxLength: 500 } }, required: ["ticketId", "status"], additionalProperties: false },
  roles: ["vendor", "field_employee"], mutating: true, confirmation: "required", risk: "low", execution: "server", pack: "role", auditTarget: "ticket",
}, {
  name: "manage_ticket_record",
  description: "Prepare a ticket creation, edit, acceptance, submission, review, cancellation or line-item change for authenticated authorization. Read the ticket and required fields first. A prepared action is not proof that the canonical endpoint will permit or complete the change: execution rechecks current permissions and lifecycle, and success requires its saved result. The finalize_labor action freezes recorded auto-labor totals using payload.expectedUpdatedAt from the current ticket read and fresh server viewerCanFinalizeLabor authority; it neither submits nor checks out the ticket nor verifies physical work. Unlocking submitted or approved tickets for correction is platform-admin-only and requires a reason of 1 to 500 characters; it is distinct from cancelled-ticket reactivation. Approval/payment-review actions are only for the owning partner or VNDRLY administrator; worker access is limited to assigned tickets. This does not transfer money, start GPS tracking, upload photos or bypass ticket lifecycle rules.",
  inputSchema: { type: "object", properties: { action: { type: "string", enum: [...TICKET_RECORD_ACTIONS] }, ticketId: { type: "integer", minimum: 1 }, lineItemId: { type: "integer", minimum: 1 }, payload: { anyOf: [CreateTicketBody, UpdateTicketBody, CreateTicketLineItemBody, TicketLaborFinalizationInputSchema.omit({ operationId: true }), z.object({ reason: z.string().trim().min(1).max(500) }), z.object({}).strict()].map(value => z.toJSONSchema(value, { io: "input", unrepresentable: "any" })), description: "Use the canonical fields for the selected action. Create and line-item actions require their full fields; updates use only reviewed edits; transitions use their explicit reason when required. Never invent required values." } }, required: ["action", "payload"], additionalProperties: false },
  roles: ["admin", "partner", "vendor", "field_employee"],
  mutating: true, confirmation: "required", risk: "high", execution: "server", pack: "role", auditTarget: "ticket",
}, {
  name: "record_ticket_payment",
  description: "Record an already-made ticket payment using VNDRLY's canonical disperse-funds endpoint. This records payment metadata and moves an approved or awaiting-payment ticket to funds_dispersed; it does not transfer money. Requires the owning partner's Accounts Payable authority or platform administrator, separate finance write consent and trusted approval. Never invent a payment or reference.",
  inputSchema: { type: "object", properties: { ticketId: { type: "integer", minimum: 1 }, paymentMethod: { type: "string", enum: ["check", "etf", "ach", "other"] }, paymentReference: { type: "string" }, paymentReceiptUrl: { type: "string", description: "Existing authorized proof-of-payment upload path. Never invent a receipt or claim this tool uploads evidence." }, note: { type: "string" } }, required: ["ticketId", "paymentMethod"], additionalProperties: false },
  roles: ["admin", "partner"], mutating: true, confirmation: "required", risk: "high", execution: "server", pack: "role", auditTarget: "ticket",
}, {
  name: "reverse_ticket_payment_record",
  description: "Reverse the recorded dispersal of a funds_dispersed ticket, restoring approved and preserving payment audit history. This corrects VNDRLY's accounting record only: it does not refund, cancel a bank payment, recover money or transfer funds. Requires the owning partner's Accounts Payable authority or platform administrator, separate finance write consent, an exact reason and trusted approval. Read the current ticket and its viewerCanReverseDispersal permission first.",
  inputSchema: { type: "object", properties: { ticketId: { type: "integer", minimum: 1 }, reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["ticketId", "reason"], additionalProperties: false },
  roles: ["admin", "partner"], mutating: true, confirmation: "required", risk: "high", execution: "server", pack: "role", auditTarget: "ticket",
}];
