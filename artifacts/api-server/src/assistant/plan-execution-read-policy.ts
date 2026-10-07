import { z } from "zod/v4";
const limit = z.number().int().min(1).max(25).default(25);
const positive = z.number().int().positive();
const empty = z.object({}).strict();
/** Fixed supported read schemas. Existing custody reads retain their legacy bounds. */
export const PLAN_EXECUTION_BUSINESS_READ_CANDIDATES = {
  query_work_hub_away_responder: empty,
  query_work_hub_away_channels: empty,
  query_work_hub_meeting_responses: z.object({ occurrenceId: z.uuid() }).strict(),
  query_calendar_reschedule_snapshot: z.object({ occurrenceId: z.uuid() }).strict(),
  query_ticket_invoice_candidates: z.object({ limit: z.number().int().min(1).max(20).default(20), afterTicketId: z.number().int().nonnegative().default(0) }).strict(),
  query_invoices: z.object({ sinceDays: z.number().int().min(1).max(365).default(90), status: z.enum(["draft", "open", "sent", "overdue", "paid", "cancelled"]).optional(), limit }).strict(),
  query_ar_aging: empty,
  query_tickets: z.object({ status: z.enum(["completed", "submitted", "approved", "awaiting_payment", "pending_review"]), sinceDays: z.number().int().min(1).max(365).default(90), limit }).strict(),
  query_gate_stations: z.object({ siteId: positive.optional(), mode: z.literal("operational").default("operational") }).strict(),
  query_gate_change_over: z.object({ stationId: z.uuid() }).strict(),
  query_workforce_coverage: empty,
  query_ticket_assignment_candidates: z.object({ name: z.string().trim().min(1).max(100).optional(), limit }).strict(),
  query_hotlist_jobs: z.object({ limit }).strict(),
  get_work_hub_calendar: z.object({ start: z.iso.datetime(), end: z.iso.datetime() }).strict().refine(value => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000, "Calendar window must be positive and at most 31 days"),
  query_asset_custody: z.object({ checkedOutLongerThanDays: z.number().int().min(90).max(36500).default(90) }).strict(),
};
export const PLAN_EXECUTION_INVOICE_ACTIVITY_INPUT = z.object({ basis: z.enum(["recorded_invoice_activity", "provider_acceptance"]).default("recorded_invoice_activity") }).strict();
export const PLAN_EXECUTION_OPPORTUNITY_INPUTS = {
  query_gate_staffing_candidates: z.object({ shiftId: z.uuid() }).strict(),
  query_qualified_hotlist_jobs: z.object({ limit: z.number().int().min(1).max(25).default(25), afterJobId: z.number().int().nonnegative().default(0) }).strict(),
};
export const PLAN_EXECUTION_READ_TOOL_NAMES = ["list_work_hub_tasks", "query_invoice_activity", ...Object.keys(PLAN_EXECUTION_OPPORTUNITY_INPUTS), ...Object.keys(PLAN_EXECUTION_BUSINESS_READ_CANDIDATES)];
