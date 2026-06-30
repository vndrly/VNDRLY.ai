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
  "partner-catalog",
  "catalog",
  "catalog-health",
  "crew-map",
  "crew-replay",
  "site-map",
  "visitors",
  "notification-preferences",
  "notifications-inbox",
  "field-home",
  "safety-inbox",
  "safety-event-detail",
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
    name: "query_sales_tax_by_state",
    description:
      "Returns sales tax collected by US state for a calendar period — taxable sales, exempt sales, tax collected, and effective rate per state. Uses the same engine as Reports → Sales tax. Scoped to the caller's vendor or partner org. Use for questions like 'how much sales tax did we pay in Texas YTD?' or 'sales tax by state this year'. Optional state filter (e.g. 'TX'). Field employees are blocked.",
    input_schema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "ytd"],
          description: "Period shortcut. Defaults to 'ytd'.",
        },
        state: { type: "string", description: "Optional two-letter state code filter (e.g. 'TX', 'NM')." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_nec1099_summary",
    description:
      "Returns 1099-NEC payment totals for a calendar year — same aggregation as Reports → 1099. Vendors see totals paid to them per partner; partners see totals paid to each vendor; admins see platform-wide (capped). Includes the $600 IRS threshold context. Use for 'how much did we pay vendor X on 1099-NEC this year?' or 'YTD 1099 totals'. Field employees are blocked.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Calendar tax year (e.g. 2026). Defaults to the current UTC year." },
      },
      additionalProperties: false,
    },
  },
  // ── Field / foreman ticket drill-down (mobile-friendly) ─────────
  {
    name: "query_ticket_detail",
    description:
      "Returns a rich summary for one ticket: work type, site, status, check-in/out, odometer miles, crew count, note/attachment counts, payment receipt flag. Field employees and foremen may call this for any ticket they are assigned to, on the crew roster for, or foreman on. Vendors/partners/admins see tickets in their org scope.",
    input_schema: {
      type: "object",
      properties: { ticketId: { type: "number" } },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_ticket_crew",
    description:
      "Lists active crew members on a ticket: names, roles, acknowledgment status, when added. Use for 'how many field employees on this job', 'who is on the crew', 'did everyone ack'. Scoped to the same ticket visibility as query_ticket_detail.",
    input_schema: {
      type: "object",
      properties: { ticketId: { type: "number" } },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_ticket_labor",
    description:
      "Per-person hours and estimated labor cost for one ticket from check-in records, plus ticket odometer miles. Use for 'total hours on ticket #', 'labor cost for this crew', 'how many miles we drove'. Scoped like query_ticket_detail — field employees see tickets they work or foreman.",
    input_schema: {
      type: "object",
      properties: { ticketId: { type: "number" } },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_ticket_notes",
    description:
      "Returns recent ticket notes and photo/document attachment URLs. Use for 'were there pictures on this job', 'what notes were left', 'maintenance notes from last visit'. Scoped like query_ticket_detail.",
    input_schema: {
      type: "object",
      properties: {
        ticketId: { type: "number" },
        limit: { type: "number", description: "1-50, defaults to 10." },
      },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_work_type_history",
    description:
      "Lists recent tickets for a work type (e.g. 'Maintenance', 'Frac') optionally at one site. Answers 'when was maintenance last performed', 'last time we did X at this pad', with ticket numbers and dates. Field employees see only tickets in their scope; vendors/partners see their org's jobs.",
    input_schema: {
      type: "object",
      properties: {
        workTypeName: { type: "string", description: "Partial match on work type name, e.g. 'Maintenance'." },
        workTypeId: { type: "number" },
        siteId: { type: "number" },
        sinceDays: { type: "number", description: "1-365, defaults to 365." },
        limit: { type: "number", description: "1-50, defaults to 10." },
      },
      additionalProperties: false,
    },
  },
  // ── Vendor / partner financial toolbox ────────────────────────
  {
    name: "query_invoices",
    description:
      "Lists individual invoices (number, status, amounts, due date) in the caller's scope. Use when the user needs specific invoice numbers or a list, not just totals. Field employees blocked.",
    input_schema: {
      type: "object",
      properties: {
        sinceDays: { type: "number", description: "1-365, defaults to 90." },
        status: { type: "string", description: "e.g. open, paid, sent, overdue." },
        limit: { type: "number", description: "1-50, defaults to 20." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_invoice_lines",
    description:
      "Line-level invoice detail for a period (same engine as Reports exports): labor, mileage, parts, tax, 1099 category per line. Use for 'break down this invoice', 'show labor lines YTD', 'what was billed for ticket X on invoices'. Field employees blocked.",
    input_schema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "ytd"],
          description: "Period shortcut. Defaults to ytd.",
        },
        limit: { type: "number", description: "1-50, defaults to 25." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_ar_aging",
    description:
      "Accounts-receivable aging buckets (current, 1-15, 16-30, 31-60, 60+ days past due). Vendors see what each partner owes them; partners see what they owe each vendor. Field employees blocked.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "query_revenue_summary",
    description:
      "Revenue/spend breakdown for a period. Vendors: by work type (default) or by partner. Partners: by work type or by vendor. Use for 'revenue by service type YTD', 'how much did we spend with vendor X'. Field employees blocked.",
    input_schema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "ytd"],
          description: "Defaults to ytd.",
        },
        breakdown: {
          type: "string",
          enum: ["work_type", "partner", "vendor"],
          description: "Vendors: work_type or partner. Partners: work_type or vendor.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_crew_cost",
    description:
      "Crew hours billed vs internal labor cost and margin per employee (vendor only). Same engine as Reports crew-cost card. Use for 'labor margin', 'what did we bill vs pay the crew'. Field employees blocked.",
    input_schema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "ytd"],
          description: "Defaults to ytd.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_1099_k_summary",
    description:
      "1099-K card-payment totals for a tax year (gross amount, transaction count). Same engine as Reports → 1099-K. Field employees blocked.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Tax year. Defaults to current UTC year." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_1099_misc_summary",
    description:
      "1099-MISC box totals (rents, royalties, other income, medical, attorney) for a tax year. Same engine as Reports → 1099-MISC. Field employees blocked.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Tax year. Defaults to current UTC year." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_safety_events",
    description: "List or count safety events (near miss, injury, stop-work) in the caller's scope. Filters: status, siteId, openOnly, sinceDays, countOnly.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        siteId: { type: "number" },
        openOnly: { type: "boolean" },
        sinceDays: { type: "number" },
        limit: { type: "number" },
        countOnly: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_safety_metrics",
    description: "Returns safety score (0-100), days without recordable, open HiPo count, and formula explanation for org or site.",
    input_schema: {
      type: "object",
      properties: { siteId: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_site_operational_status",
    description: "Returns whether a site is active/inactive and the last stop-work safety event if any.",
    input_schema: {
      type: "object",
      properties: { siteId: { type: "number" } },
      required: ["siteId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_site_locations",
    description: "Lists site locations in scope with active/inactive status, AFE, site code. Optional search and inactiveOnly filter.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string" },
        inactiveOnly: { type: "boolean" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_site_detail",
    description: "Site detail: geofence, status, assigned vendors, last stop-work link.",
    input_schema: {
      type: "object",
      properties: { siteId: { type: "number" } },
      required: ["siteId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_notifications",
    description: "Lists recent unread (or all) in-app notifications for the signed-in user.",
    input_schema: {
      type: "object",
      properties: {
        unreadOnly: { type: "boolean" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_live_crew",
    description: "Tickets currently en route, on location, or on site — live crew map snapshot.",
    input_schema: {
      type: "object",
      properties: { siteId: { type: "number" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_crew_member_status",
    description:
      "Find one crew member by name/email/id and return their current active ticket, lifecycle/check-in state, latest GPS point, distance to site, and location source. Use for 'where is Bob', 'is Daniel on site', or 'show me Joe's current status'. Vendor admins, foremen, partners, and admins only. Current GPS is ticket-scoped, so if multiple workers share a ticket the response says so.",
    input_schema: {
      type: "object",
      properties: {
        crewEmployeeId: { type: "number" },
        crewMemberName: { type: "string" },
        ticketId: { type: "number", description: "Optional ticket to disambiguate the active job." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_crew_eta",
    description:
      "Estimate a crew member ETA to their active ticket site from the latest ticket GPS point and current GPS speed when available. Use for 'what is Bob's ETA', 'how long until Daniel gets here', or 'how far out is Joe'. Vendor admins, foremen, partners, and admins only.",
    input_schema: {
      type: "object",
      properties: {
        crewEmployeeId: { type: "number" },
        crewMemberName: { type: "string" },
        ticketId: { type: "number", description: "Optional ticket to disambiguate the active job." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_crew_route_summary",
    description:
      "Summarize the GPS route for a ticket or for one crew member's active ticket: approximate route miles, first/last GPS point, duration, active check-in, and site. Use for mileage/travel questions like 'how many miles has Bob driven' or 'route summary for ticket #10959'. Current GPS is ticket-scoped.",
    input_schema: {
      type: "object",
      properties: {
        ticketId: { type: "number" },
        crewEmployeeId: { type: "number" },
        crewMemberName: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_hotlist_jobs",
    description: "Open hotlist marketplace jobs visible to the caller.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "query_hotlist_bids",
    description: "Vendor's hotlist bids with job titles and status.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "query_vendor_catalog",
    description: "Vendor work-type catalog with unit pricing.",
    input_schema: {
      type: "object",
      properties: { vendorId: { type: "number" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "query_partner_approvals",
    description: "Partner-vendor work type approval rows in scope.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "query_certifications",
    description: "Employee certifications expiring within N days.",
    input_schema: {
      type: "object",
      properties: { expiringWithinDays: { type: "number" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_org_contacts",
    description: "Find org contacts by company role pill (default HSE / Safety Officer).",
    input_schema: {
      type: "object",
      properties: { role: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "query_flagged_tickets",
    description: "Open ticket flags awaiting review.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_ticket_payment_status",
    description: "Payment/disbursement status for one ticket.",
    input_schema: {
      type: "object",
      properties: { ticketId: { type: "number" } },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_accounting_connection",
    description: "QuickBooks / OpenAccountant connection status for vendor.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "query_active_visitors",
    description: "Guests currently checked in at sites (no check-out yet).",
    input_schema: {
      type: "object",
      properties: { siteId: { type: "number" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_stock_quote",
    description:
      "Returns the latest US equity quote for a ticker symbol. Use for questions like 'what is Exxon trading at?' — pass symbol XOM (not the company name). Finnhub is preferred when FINNHUB_API_KEY is set (near real-time); otherwise falls back to Alpha Vantage end-of-day GLOBAL_QUOTE. Available to all signed-in users; not scoped to org data.",
    input_schema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "US stock ticker, e.g. XOM (Exxon Mobil), CVX, COP.",
        },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_crude_oil_price",
    description:
      "Returns the latest West Texas Intermediate (WTI) light sweet crude oil price in USD per barrel from EIA data via Alpha Vantage. Use for 'price of a barrel of crude', 'WTI price', 'oil price today'. Requires ALPHA_VANTAGE_API_KEY. Free tier returns daily (default), weekly, or monthly snapshots — not a live NYMEX futures tick.",
    input_schema: {
      type: "object",
      properties: {
        interval: {
          type: "string",
          enum: ["daily", "weekly", "monthly"],
          description: "Defaults to daily (most recent trading day).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "mark_notifications_read",
    description:
      "Marks one notification or all unread notifications as read for the signed-in user — the same action as the bell inbox Mark all read button. Use when the user asks to clear their notification badge or mark alerts as read. Requires explicit user intent; do not call proactively.",
    input_schema: {
      type: "object",
      properties: {
        notificationId: { type: "number", description: "Mark a single notification read by id." },
        markAll: {
          type: "boolean",
          description: "When true (default if notificationId omitted), mark every unread notification read.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "schedule_ticket_crew",
    description:
      "Schedules one active crew member onto a ticket using the same server workflow as the ticket Schedule modal: scope checks, conflict detection, certification checks, schedule reminders, and crew notifications. Use for requests like 'schedule Daniel Elerick to ticket #10959 for 8am tomorrow'. Before calling, confirm the exact ticket, crew member, and scheduled date/time with the user. Pass confirmed:true only after that confirmation. If the tool returns requiresConfirm/conflicts, summarize the conflict and ask before re-calling with force:true.",
    input_schema: {
      type: "object",
      properties: {
        ticketId: { type: "number", description: "Ticket number/id, e.g. 10959." },
        crewEmployeeId: { type: "number", description: "Optional exact vendor_people crew employee id when known." },
        crewMemberName: { type: "string", description: "Crew member name or email to resolve on the ticket vendor's active roster." },
        scheduledStartAt: { type: "string", description: "Exact ISO timestamp for the start time after resolving relative language like tomorrow 8am." },
        scheduledDurationMinutes: { type: "number", description: "Optional duration in minutes. Omit/null when unknown." },
        warningKinds: {
          type: "array",
          items: { type: "string", enum: ["3d", "2d", "1d", "12h", "4h", "1h", "start"] },
          description: "Optional reminder offsets. Defaults to 1d, 12h, and 1h.",
        },
        force: { type: "boolean", description: "Only true after the user confirms they want to override returned scheduling conflicts." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation of ticket, crew member, and exact start time." },
      },
      required: ["ticketId", "scheduledStartAt", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "set_ticket_flag",
    description:
      "Flags or clears a flag on a ticket using the same server workflow as the Flagged tab: ticket access checks, terminal-ticket protection, and flag notifications. Use for explicit requests like 'flag ticket #10959 for safety follow-up' or 'clear the flag on #10959'. Before calling, confirm the exact ticket and whether the user wants it flagged or unflagged. Pass confirmed:true only after that confirmation.",
    input_schema: {
      type: "object",
      properties: {
        ticketId: { type: "number", description: "Ticket number/id, e.g. 10959." },
        flagged: { type: "boolean", description: "true to flag the ticket; false to clear the active flag." },
        reason: { type: "string", description: "Optional reason for a new flag. Keep concise; ignored when clearing a flag." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation of the ticket and flag/unflag action." },
      },
      required: ["ticketId", "flagged", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "post_ticket_comment",
    description:
      "Posts a text comment into a ticket's Crew Comms/comments thread and notifies ticket participants. Use for explicit requests like 'tell the crew on #10959 I am running 20 minutes late'. Before calling, confirm the exact ticket and exact message text. Pass confirmed:true only after confirmation.",
    input_schema: {
      type: "object",
      properties: {
        ticketId: { type: "number", description: "Ticket number/id, e.g. 10959." },
        content: { type: "string", description: "Exact comment text to post." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation of ticket and message text." },
      },
      required: ["ticketId", "content", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "deep_link_to",
    description:
      "Returns a URL the user can navigate to in this web app for a given screen. Use this instead of describing 'click X then Y' when a single link will do. Detail screens (ticket-detail, vendor-detail, partner-detail, invoice-detail, vendor-analytics, partner-analytics, crew-replay) require `id`. Field-employee onboarding requires the invite `token`. For Reports, pass reportCard (e.g. salesTaxByState) and optional reportPreset (ytd, this_year, …) plus highlightState (e.g. TX) to open the matching card scrolled into view.",
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
        reportCard: {
          type: "string",
          enum: ["salesTaxByState", "accountingExport"],
          description: "When screen is reports, scroll to this report card with a period preset.",
        },
        reportPreset: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "ytd"],
          description: "Period for report deep links. Defaults to ytd.",
        },
        highlightState: {
          type: "string",
          description: "Optional two-letter state to highlight on salesTaxByState (e.g. TX).",
        },
      },
      required: ["screen"],
      additionalProperties: false,
    },
  },
];
