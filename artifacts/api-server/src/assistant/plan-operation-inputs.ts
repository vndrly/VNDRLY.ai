import { z } from "zod/v4";
import { PLAN_EXECUTION_BUSINESS_READ_CANDIDATES, PLAN_EXECUTION_INVOICE_ACTIVITY_INPUT, PLAN_EXECUTION_OPPORTUNITY_INPUTS, PLAN_EXECUTION_READ_TOOL_NAMES } from "./plan-execution-read-policy";
import { CALENDAR_RESCHEDULE_ARGUMENTS } from "./calendar-reschedule-tools";
import { CALENDAR_CONFIRMATION_ARGUMENTS } from "./plan-execution-calendar-confirmation-policy";
import { TICKET_INVOICE_PREPARATION_ARGUMENTS } from "./ticket-invoice-preparation-tools";
import { AWAY_RESPONDER_ARGUMENTS } from "./away-responder-tools";

export const PLAN_TASK_READ_INPUT = z.object({ status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(), assigneeUserId: z.number().int().positive().optional() }).strict();
export const PLAN_CUSTODY_READ_INPUT = z.object({ assetId: z.uuid().optional(), checkedOutLongerThanDays: z.number().int().min(1).max(36500).optional() }).strict().refine(value => !(value.assetId && value.checkedOutLongerThanDays !== undefined), "Choose exact asset or custody age");
type Operation = { key: string; adapter: "authorized_read" | "personal_draft" | "ticket_invoice_preparation" | "calendar_reschedule" | "away_responder" | "calendar_confirmation"; toolName: string; input: z.ZodType; description: string };
const reads: Record<string, z.ZodType> = { ...PLAN_EXECUTION_BUSINESS_READ_CANDIDATES, ...PLAN_EXECUTION_OPPORTUNITY_INPUTS, query_invoice_activity: PLAN_EXECUTION_INVOICE_ACTIVITY_INPUT, list_work_hub_tasks: PLAN_TASK_READ_INPUT, query_asset_custody: PLAN_CUSTODY_READ_INPUT };
export const PLAN_OPERATION_INPUTS: readonly Operation[] = [
  ...PLAN_EXECUTION_READ_TOOL_NAMES.map(toolName => {
    if (!reads[toolName]) throw Error("Missing registered plan read schema");
    return { key: `read_${toolName}`, adapter: "authorized_read" as const, toolName, input: reads[toolName], description: `Define only the ${toolName} observation for an existing saved plan. No read is performed by this definition.` };
  }),
  { key: "company_review_draft", adapter: "personal_draft", toolName: "manage_work_hub_task", input: z.object({ title: z.string().trim().min(1).max(200) }).strict(), description: "Define a self-assigned company review draft sourced only from approved read dependencies. Normal company visibility applies." },
  { key: "ticket_invoice_preparation", adapter: "ticket_invoice_preparation", toolName: "prepare_ticket_invoices", input: TICKET_INVOICE_PREPARATION_ARGUMENTS, description: "Define exact selected ticket invoice draft preparation with its matching recorded-history prerequisite; no issue, send or payment." },
  { key: "calendar_reschedule", adapter: "calendar_reschedule", toolName: "reschedule_work_hub_meeting", input: CALENDAR_RESCHEDULE_ARGUMENTS, description: "Define one exact saved-occurrence reschedule; prior responses reset pending. No attendee acceptance is inferred." },
  { key: "calendar_confirmation", adapter: "calendar_confirmation", toolName: "query_work_hub_meeting_responses", input: CALENDAR_CONFIRMATION_ARGUMENTS, description: "Define bounded observation of actual participant responses for an exact host-owned schedule until the reviewed deadline. Never responds for others." },
  ...(["configure", "pause", "revoke"] as const).map(action => ({ key: `away_${action}`, adapter: "away_responder" as const, toolName: "manage_work_hub_away_responder", input: action === "configure" ? AWAY_RESPONDER_ARGUMENTS.options[0] : AWAY_RESPONDER_ARGUMENTS.options[1].extend({ action: z.literal(action) }), description: `Define your own exact away responder ${action} command. No reply, delivery or rule change occurs until whole-plan human approval.` })),
];
export function planOperationStepSchema(operation: Operation) {
  return z.object({ id: z.string().min(1).max(100), adapter: z.literal(operation.adapter), toolName: z.literal(operation.toolName), arguments: operation.input }).strict();
}
export const typedPlanProposalStepSchema = z.union(PLAN_OPERATION_INPUTS.map(planOperationStepSchema) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
