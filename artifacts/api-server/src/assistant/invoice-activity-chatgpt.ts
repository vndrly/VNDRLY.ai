import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { readInvoiceActivity } from "./invoice-activity-read";
import { requireChatGptReadableTool } from "./chatgpt-tool-access";

const input = z.object({ basis: z.enum(["recorded_invoice_activity", "provider_acceptance"]).default("recorded_invoice_activity") }).strict();
const output = z.object({
  basis: z.enum(["recorded_invoice_activity", "provider_acceptance"]), observedAt: z.iso.datetime(),
  company: z.object({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive() }).strict(),
  events: z.array(z.object({ kind: z.enum(["manual_issue", "ticket_send_attempt", "provider_acceptance"]), observedRecords: z.number().int().nonnegative(), undatedRecords: z.number().int().nonnegative(), latestAt: z.iso.datetime().nullable(), sourceReference: z.string().max(220).nullable() }).strict()).length(3),
  state: z.enum(["observed", "unknown", "no_recorded_event"]), latestAt: z.iso.datetime().nullable(), elapsedDays: z.number().nonnegative().nullable(),
  thresholdDays: z.literal(15), exceeds15Days: z.boolean().nullable(), preparationRecommended: z.boolean(),
  draftPrepared: z.literal(false), deliveryVerified: z.literal(false), limitations: z.array(z.string().max(1000)).max(10),
}).strict();

export const INVOICE_ACTIVITY_TOOL = {
  name: "query_invoice_activity",
  description: "Read the current company's complete recorded invoice chronology and strict longer-than-15-day condition. Separates manual issue, every ticket send attempt (including failed or disabled-email retries), and provider acceptance evidence. No recorded event is not proof that external invoicing never occurred. Never creates a draft, establishes ticket draft eligibility, sends email or proves recipient delivery. Requires current company billing authority and finance:read consent.",
  inputSchema: { ...z.toJSONSchema(input), type: "object" as const },
  outputSchema: { ...z.toJSONSchema(output), type: "object" as const },
  securitySchemes: [{ type: "oauth2" as const, scopes: ["finance:read"] }],
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

export function invoiceActivityAvailable(session: SessionPayload, scopes: string[]) {
  try {
    requireChatGptReadableTool(session, scopes, "query_invoices");
    return Boolean(session.userId && session.activeMembershipId && session.sv
      && (session.role === "vendor" && session.vendorId || session.role === "partner" && session.partnerId));
  } catch { return false; }
}

/** Route supplies the authenticated connection context; arguments cannot select an account. */
export function createInvoiceActivityHandler(read: typeof readInvoiceActivity = readInvoiceActivity) {
  return async (raw: unknown, session: SessionPayload, scopes: string[]) => {
    if (!invoiceActivityAvailable(session, scopes)) throw Error("Current operational company and finance read consent required");
    return output.parse(await read(input.parse(raw), session, scopes));
  };
}
export const handleInvoiceActivityTool = createInvoiceActivityHandler();
