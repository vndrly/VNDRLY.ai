// Tool catalog visible to Claude on every assistant turn.
//
// Extracted from `routes/assistant.ts` so the eval suite in
// `__evals__/tool-use.eval.ts` can import the *exact* tool set the
// production route advertises. Importing the route file directly
// would drag in the full Express router, the DB pool, and every
// handler, which a focused eval has no reason to load.
//
// Tool _execution_ still lives in `routes/assistant.ts#runTool` —
// this module is schema-only.

import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";

// Screens the model is allowed to deep-link to. Mirrored in the
// route's `buildDeepLink` switch and in the per-role allow lists in
// `assistant/permissions.ts`. When you add a screen, update all
// three call sites.
export const DEEP_LINK_SCREENS = [
  "dashboard",
  "onboarding-partner",
  "onboarding-vendor",
  "onboarding-field",
  "tickets",
  "ticket-detail",
  "site-locations",
  "site-location-detail",
  "field-employees",
  "field-employee-detail",
  "vendors",
  "vendor-detail",
  "partners",
  "partner-detail",
  "invoices",
  "invoice-detail",
  "bills-to-pay",
  "statement",
  "reports",
  "vendor-analytics",
  "partner-analytics",
  "vendor-catalog",
  "catalog",
  "crew-map",
  "crew-replay",
  "site-map",
  "visitors",
  "notification-preferences",
  "notifications-inbox",
  "field-home",
] as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "lookup_user_progress",
    description:
      "Returns the current onboarding progress for this user's org (current step, completed steps, skipped steps, and the partial payload). Always call this before suggesting onboarding actions if you don't already have fresh state.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "start_onboarding",
    description:
      "Ensures an onboarding progress row exists for this user's org and returns it. Safe to call repeatedly. Does not change data the user has already entered.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_onboarding_field",
    description:
      "Writes a single field into the onboarding payload. Use dot.notation for nested keys (e.g. 'firstSite.address'). Only call after explicitly confirming the value with the user. Re-checks role permissions server-side.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Dot-path of the field to set (e.g. 'brandPrimaryColor', 'firstSite.address', 'rates.hourlyRate')." },
        value: { description: "The value to write. Strings, numbers, booleans, and arrays of those are accepted." },
      },
      required: ["path", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_onboarding_step",
    description:
      "Marks a step as completed (or skipped) and advances `currentStep` to the next provided value. Use when the user has finished gathering data for a step.",
    input_schema: {
      type: "object",
      properties: {
        step: { type: "string", description: "The step key being completed (e.g. 'company-basics')." },
        nextStep: { type: "string", description: "The step key to advance to. Use 'done' when the wizard is finished." },
        skipped: { type: "boolean", description: "True if this step was skipped instead of completed. Defaults to false." },
      },
      required: ["step", "nextStep"],
      additionalProperties: false,
    },
  },
  {
    name: "finalize_onboarding",
    description:
      "Submits the wizard for final completion. Calls the same /onboarding/:orgType/:orgId/complete endpoint the UI uses, which validates that every required field for the persona is present and writes the canonical partner/vendor records. Only call when the user confirms they're ready to finish — not for intermediate step advances.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "lookup_open_invoices",
    description: "Returns up to 10 open (unpaid or partially paid) invoices for this user's org, with totals and due dates.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "lookup_open_tickets",
    description: "Returns up to 10 in-flight tickets (status not closed) visible to this user, with site, vendor, and status.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  // ─────────────────────────────────────────────────────────────
  // Read-only DATA tools. All scoped to the caller's role + org by
  // ../assistant/data-tools.ts (defense-in-depth) — admin sees
  // everything, partner/vendor are clamped to their org, field
  // employees are blocked from aggregate metrics.
  // ─────────────────────────────────────────────────────────────
  {
    name: "query_tickets",
    description:
      "Lists or counts tickets in the caller's scope. Optional filters: status (e.g. 'in_progress', 'kicked_back', 'completed'), vendorId, siteId, sinceDays (default 30, max 365), limit (default 10, max 50), countOnly (true to return just a count). Use this when the user asks 'how many', 'show me my', 'list open' tickets, or wants a fresh look at recent activity.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Lifecycle status filter, e.g. 'initiated','in_progress','pending_review','submitted','approved','kicked_back','completed','closed','cancelled'." },
        vendorId: { type: "number" },
        siteId: { type: "number" },
        sinceDays: { type: "number", description: "Window in days (1-365). Defaults to 30." },
        limit: { type: "number", description: "1-50, defaults to 10. Ignored when countOnly is true." },
        countOnly: { type: "boolean", description: "Return just the count for the filtered window." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_gps_trail",
    description:
      "Returns a summary of the mobile GPS trail captured during a single ticket: number of points, first/last timestamps, max speed (m/s), lowest battery level seen, and the most recent (lat, lng). Caller must be able to see the ticket in their scope. Use for 'where is the crew on ticket #123', 'how long was the drive', or to verify a vendor was actually on site.",
    input_schema: {
      type: "object",
      properties: {
        ticketId: { type: "number" },
      },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_vendor_performance",
    description:
      "Returns vendor performance numbers in the window: count + avg/min/max of partner-submitted ratings (1-5), and the kickback rate (share of tickets sent back for rework). Vendors see only their own; partners see only the vendors who worked their sites; field employees are blocked.",
    input_schema: {
      type: "object",
      properties: {
        vendorId: { type: "number", description: "Optional — defaults to the caller's vendor for vendor accounts." },
        sinceDays: { type: "number", description: "Window in days (1-365). Defaults to 30." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_visits",
    description:
      "Returns visitor (guest) check-in counts in the caller's scope. Filters: siteId, sinceDays (default 7), activeOnly (still on site, no check-out yet). Returns total visits + how many included a safety acknowledgment. Field employees are blocked.",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "number" },
        sinceDays: { type: "number", description: "Window in days (1-365). Defaults to 7." },
        activeOnly: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_field_metrics",
    description:
      "Aggregate operational KPIs in the caller's scope: ticket counts by status bucket (open/completed/kicked_back/cancelled), completion rate, kickback rate, average on-site minutes (check-in to check-out), total miles logged via odometer, and how many tickets had a mobile GPS trail or odometer reading. Use for 'how are we doing', 'what's our completion rate', 'how much driving did the crew do this week'. Field employees are blocked.",
    input_schema: {
      type: "object",
      properties: {
        sinceDays: { type: "number", description: "Window in days (1-365). Defaults to 30." },
        vendorId: { type: "number", description: "Narrow to one vendor (admins/partners only)." },
        siteId: { type: "number", description: "Narrow to one site." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_invoice_summary",
    description:
      "Aggregate invoice totals in the caller's scope: count, total billed, total paid, count of open and past-due. Vendor sees their own; partner sees what they owe; admin sees all. Field employees are blocked.",
    input_schema: {
      type: "object",
      properties: {
        sinceDays: { type: "number", description: "Window in days (1-365). Defaults to 30." },
        status: { type: "string", description: "Optional status filter, e.g. 'open','paid','past_due'." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "deep_link_to",
    description:
      "Returns a URL the user can navigate to in this web app for a given screen. Use this instead of describing 'click X then Y' when a single link will do. Detail screens (ticket-detail, vendor-detail, partner-detail, invoice-detail, vendor-analytics, partner-analytics, crew-replay) require `id`. Field-employee onboarding requires the invite `token`.",
    input_schema: {
      type: "object",
      properties: {
        screen: {
          type: "string",
          enum: [...DEEP_LINK_SCREENS],
        },
        id: { type: "number", description: "Required for detail screens (e.g. ticket-detail, vendor-analytics, partner-analytics, crew-replay)." },
        token: { type: "string", description: "Required for onboarding-field — the invite token from the email link." },
        step: { type: "string", description: "Optional ?step= query for onboarding deep-links." },
      },
      required: ["screen"],
      additionalProperties: false,
    },
  },
];
