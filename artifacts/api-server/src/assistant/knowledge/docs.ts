import type { KnowledgeDoc } from "./index";

// One entry per feature surface. Keep each `body` short — the assistant
// is meant to point users at the right screen, not replicate the docs.
// When adding a new feature to the app, add (or update) the matching doc
// here so the assistant can answer questions about it.
export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  {
    id: "nav-overview",
    title: "App navigation overview",
    roles: ["any"],
    body: `VNDRLY's web app uses a left sidebar with role-aware links. Admins see Dashboard (includes the Hotlist jobs panel), Partners, Vendors, Field Employees, Site Locations, Tracking (tickets), Crew Map, Visitors, Invoices, Statements, Reports, and Platform Catalog (Catalog Health is linked from the catalog page). Partners see their Partner page, Site Locations, Tracking, Site Map, Visitors, Bills to Pay, Statements, Reports, Partner Catalog, and Analytics. Vendors see their Vendor page, Site Locations, Tracking, Crew Map, Visitors, Invoices, Statements, Reports, Your Services (vendor catalog), and Analytics. Field employees use the separate field portal for on-the-go mobile work — see the field portal home doc.`,
  },
  {
    id: "ask-vndrly",
    title: "About this assistant",
    roles: ["any"],
    body: `I'm the VNDRLY assistant ("askV"). I'm a full help guide — not a gatekeeper. I answer how-to questions, walk you through onboarding step by step, and pull live numbers from your account when you ask. Examples: "how many tickets are open at site X this week?", "what's our average vendor rating this month?", "show me the GPS trail for ticket 1234", "how much have we billed YTD?", or "how much sales tax did we collect in Texas this year?". I use read-only data tools scoped to your org — I never invent totals and I can't see other partners' or vendors' data. I don't make changes you can't make yourself (no silent writes).`,
  },
  {
    id: "data-tools-overview",
    title: "Live data lookups (askV can query the database)",
    roles: ["admin", "partner", "vendor"],
    body: `I have read-only tools that query the live VNDRLY database scoped to your account. Ticket lookups: query_tickets, query_ticket_detail, query_ticket_crew, query_ticket_labor, query_ticket_notes, query_work_type_history, query_gps_trail. Org metrics: query_field_metrics, query_vendor_performance, query_visits. Financial: query_invoice_summary, query_invoices, query_invoice_lines, query_ar_aging, query_revenue_summary, query_crew_cost (vendors), query_sales_tax_by_state, query_nec1099_summary, query_1099_k_summary, query_1099_misc_summary. Field employees and foremen can use ticket-scoped tools for jobs they are on, crew for, or foreman — not org-wide financial aggregates. Row lists cap at 50; date windows clamp to 1-365 days. I refuse cross-org reads. Bounded write: mark_notifications_read.`,
  },
  {
    id: "data-tools-field",
    title: "Field employee & foreman data lookups",
    roles: ["field_employee"],
    body: `On mobile AskV I can pull live data for tickets you work on, are crew on, or foreman: query_ticket_detail (status, miles, crew count, notes/photos count), query_ticket_crew (who is on the job), query_ticket_labor (hours and estimated labor cost per person), query_ticket_notes (notes and attachment URLs), query_work_type_history ("when was maintenance last done at this site?"), query_tickets (list/count), query_gps_trail (GPS summary). Ask with a ticket number when you have one. I cannot see other vendors' data or org-wide invoice/1099 totals.`,
  },
  {
    id: "metrics-collected",
    title: "What numbers VNDRLY captures (web + mobile)",
    roles: ["admin", "partner", "vendor"],
    body: `Tickets use two axes: office \`status\` (accounting workflow) and field \`lifecycleState\` (GPS phase). Office flow: awaiting_acceptance → initiated → in_progress → pending_review/completed → submitted → approved → awaiting_payment → funds_dispersed (plus kicked_back, denied, cancelled). Field GPS: pending_arrival → en_route → on_location → on_site → off_site. Rule of thumb: in_progress pairs with on_site; terminal office statuses pair with off_site. Captured data: check-in/check-out timestamps + GPS, en-route + on-location timestamps + GPS, starting/ending odometer (miles, mobile-prompted), unlock count, payment method/reference/receipt photo. Mobile-only: high-frequency GPS pings during live-tracked lifecycle states, location consent audit log, push tokens, biometric session enrollment. Visitor portal: name, company, vehicle plate, purpose, host, check-in/out GPS, safety acknowledgment. Vendor performance ratings, invoices, hotlist jobs as elsewhere in VNDRLY.`,
  },
  // ===================== ONBOARDING =====================
  {
    id: "onboarding-partner",
    title: "Partner onboarding wizard",
    roles: ["partner", "admin"],
    body: `Partner onboarding wizard at /onboarding/partner — 8 steps: 1) Company basics (legal name from signup). 2) Platform agreement (platform EULA — mandatory, cannot skip). 3) Branding (primary + accent colors, square + horizontal logo — optional). 4) First site (name, address, site code, geofence radius — required). 5) Tax & Billing (federal + state tax IDs, physical + billing addresses — required). 6) Preferences (notification defaults — skippable). 7) Invite team — skippable. 8) Done. Skipped optional steps appear in the dashboard "Finish setting up your account" card; resume with ?step=<key> deep links.`,
  },
  {
    id: "onboarding-vendor",
    title: "Vendor onboarding wizard",
    roles: ["vendor", "admin"],
    body: `Vendor onboarding wizard at /onboarding/vendor — 9 steps: 1) Company basics. 2) Platform agreement (platform EULA — mandatory). 3) Branding (logo + primary color — skippable). 4) Tax IDs + addresses (required). 5) Service area + work types (operating radius miles + catalog work type selections — required). 6) Compliance (insurance carrier, policy #, COI expiration, COI upload — required). 7) Rates (hourly rate, daily OT hours, weekly OT hours, OT multiplier, 1099 e-delivery consent — required). 8) First field employee (name, email — required). 9) Done. Skipped optional steps appear on the dashboard Finish setup card.`,
  },
  {
    id: "onboarding-field",
    title: "Field employee onboarding",
    roles: ["field_employee", "admin", "vendor"],
    body: `Field employees get an emailed invite link that opens their onboarding flow (a token-bound URL only the invited person can use). Three required steps: 1) Personal info (name, phone, language). 2) Photo and certifications (profile photo for compliance ID, optional cert uploads). 3) Set password. On finish, they're logged in and taken straight to the field portal home.`,
  },
  {
    id: "finish-setup-widget",
    title: "Finish-setup dashboard card",
    roles: ["partner", "vendor", "admin"],
    body: `If you skipped any optional onboarding step, the dashboard shows a yellow "Finish setting up your account" card with a Finish button per item. Clicking Finish takes you straight to the right wizard step (uses ?step=<key> deep links). Dismiss the card to hide it for the session.`,
  },
  // ===================== TICKETS =====================
  {
    id: "tickets-list",
    title: "Tickets list (Tracking)",
    // Field employees use the field portal — they don't have a /tickets
    // sidebar entry — so this doc is scoped to web-app personas only.
    // The field-portal equivalent is covered by ticket-detail (any).
    roles: ["admin", "partner", "vendor"],
    body: `Tickets live at /tickets. Admins see all tickets; partners see tickets at their sites; vendors see tickets assigned to them. Filter by status (Open, En Route, On Site, Complete, Closed), site, vendor, or date range. Click a ticket to see full detail.`,
  },
  {
    id: "ticket-detail",
    title: "Ticket detail and status stepper",
    roles: ["any"],
    body: `Ticket detail at /tickets/:id shows the office status stepper, field lifecycle phase (pending arrival → en route → on location → on site → off site), crew tracker map, line items, comments, and audit log. Field employees use the mobile app for full GPS lifecycle actions; the web field portal supports check-out (Send for Review) and line-item edits. Once a ticket is submitted or otherwise closed to field edits, it is read-only until an admin unlocks it.`,
  },
  {
    id: "field-portal-home",
    // Field-portal-only counterpart to tickets-list. Field employees
    // don't have a /tickets sidebar entry — their ticket list lives on
    // the field portal home at /field. Keep this doc scoped to
    // field_employee so the role-gating lint can prove every URL it
    // mentions (/field, /tickets/:id) is reachable.
    title: "Field portal home and your tickets",
    roles: ["field_employee"],
    body: `The field portal lives at /field and is your home base on the phone. The header shows your name and vendor with a sign-out button and a language toggle (English/Español). Below that, "Start New Job" begins a new ticket at the current site. The "Continue Existing" list below shows every open Ticket assigned to you and your crew — site, partner, work type, who's on it, when they checked in, and how long they've been on site. Tickets assigned to you are highlighted with a "You" badge. Tap any ticket to open ticket detail at /tickets/:id, where you change status (En Route → On Site → Complete), add comments, and review line items. A "Manage location sharing" link at the bottom opens your background-tracking settings.`,
  },
  {
    id: "field-portal-notifications",
    // Field-portal-only counterpart to the web-app notifications doc.
    // The web app has /notifications and /notifications/preferences,
    // but neither is reachable to a field employee — so this doc
    // describes the mobile push surface instead and intentionally
    // contains no URLs that would trip the role-gating lint.
    title: "Notifications on the field portal",
    roles: ["field_employee"],
    body: `Field employees don't have a notifications inbox screen on the field portal — important alerts reach you as push notifications on your phone. You'll get a push when a new ticket is assigned to you, when a ticket you're on is kicked back for rework, when a teammate @mentions you in a comment, and when there's a reply to a comment thread you're part of. Tap a push to jump straight to the relevant ticket. If pushes aren't arriving, accept notification permission in your phone's OS settings and make sure you're signed in to the field portal. The comment thread inside a ticket is the source of truth for back-and-forth on that job.`,
  },
  {
    id: "ticket-kickback",
    title: "Kickback (rework, not rejection)",
    roles: ["partner", "admin", "vendor"],
    body: `A "kickback" sends a completed ticket back to the vendor for rework — it's not a rejection of the vendor. Use it when the work needs to be redone (e.g. wrong material). The vendor gets notified and the ticket reopens.`,
  },
  {
    id: "ticket-unlock",
    title: "Unlocking a closed ticket",
    roles: ["admin"],
    body: `Closed tickets are read-only. Admins can unlock from the ticket detail page (Unlock button) to allow edits — useful for correcting an invoice line. Unlocks are audit-logged.`,
  },
  {
    id: "hotlist",
    title: "Hotlist (jobs in flight)",
    roles: ["partner", "vendor", "admin"],
    body: `The Hotlist is a live jobs panel on the Dashboard (/) — not a separate sidebar link. Partners and admins use it to watch open Hotlist marketplace jobs and in-flight work across sites. Vendors see matching jobs they can bid on (filtered by service area and catalog work types). Click a row to open the job or underlying ticket.`,
  },
  // ===================== CREW + LOCATION =====================
  {
    id: "crew-map",
    title: "Crew Map (vendor + admin)",
    roles: ["vendor", "admin"],
    body: `/crew-map shows real-time GPS positions of your field employees. Tap a marker to see who, where, current ticket. Replay mode (/crew-map/:id) plays back a single employee's track for a given day.`,
  },
  {
    id: "site-map",
    title: "Site Map (partner)",
    roles: ["partner"],
    body: `/site-map shows any field employees currently within a quarter mile of one of your partner sites. Useful to see who's actually on-site right now.`,
  },
  {
    id: "background-tracking",
    title: "Background GPS tracking",
    roles: ["field_employee"],
    body: `The mobile app tracks your location while a ticket is En Route or On Site. You can pause tracking from Account → Location consent. The app warns you when the OS pauses tracking in the background.`,
  },
  // ===================== PARTNERS / VENDORS / FIELD EMPLOYEES =====================
  {
    id: "partners-detail",
    title: "Partner detail page",
    roles: ["admin", "partner"],
    body: `/partners/:id has tabs for Brand customization (colors + logos), Sites, Contacts, AFE codes, Vendor relationships, Notes, Notifications. Brand changes apply immediately to the partner's branded experience.`,
  },
  {
    id: "vendors-detail",
    title: "Vendor detail page",
    roles: ["admin", "vendor"],
    body: `/vendors/:id has tabs for Brand, Compliance (COI + carrier + expiration), Ratings, Work types (catalog), Field employees, Notes, Billing settings (per-partner). COI expiration drives the dashboard alert.`,
  },
  {
    id: "field-employees",
    title: "Field employees list and detail",
    roles: ["admin", "vendor"],
    body: `/field-employees shows everyone who can use the field portal. Click an employee to manage profile photo, certifications (with expiration), notes, and account status. Removing an employee revokes their portal access.`,
  },
  {
    id: "site-locations",
    title: "Site Locations",
    // Field employees don't manage site locations — they encounter
    // sites via tickets. Scope to the personas that actually have a
    // /site-locations sidebar entry so we never deep-link a field
    // employee here.
    roles: ["admin", "partner", "vendor"],
    body: `/site-locations lists every site, with a geofence radius (drives auto check-in) and a unique site code (used in the visitor portal URL /portal/:siteCode). Bulk-print visitor QR posters from this page.`,
  },
  // ===================== INVOICES + 1099 =====================
  {
    id: "invoices-vendor",
    title: "Invoices (vendor)",
    roles: ["vendor", "admin"],
    body: `/invoices lists all invoices the vendor has sent. Filter by partner, status (Open, Paid, Past due). Click an invoice to see line items, payments, aging. New invoices are generated from completed tickets.`,
  },
  {
    id: "bills-to-pay",
    title: "Bills to Pay (partner)",
    roles: ["partner", "admin"],
    body: `/bills-to-pay lists invoices vendors have sent the partner. Filter by vendor, status, or due date. Mark a payment to close out an invoice.`,
  },
  {
    id: "statements",
    title: "Statements",
    roles: ["partner", "vendor", "admin"],
    body: `/statement is a per-partner-per-vendor statement of charges + payments over a date range. Useful for monthly reconciliation.`,
  },
  {
    id: "reports-1099",
    title: "1099 reports",
    roles: ["admin", "vendor", "partner"],
    body: `/reports has a 1099 section: year-end summary per vendor, 1099 generation, and IRS-compliant e-delivery (vendors must consent to e-delivery during onboarding for this to apply). Reports are exportable as CSV/PDF.`,
  },
  {
    id: "billing-settings",
    title: "Billing settings (per-partner)",
    roles: ["vendor"],
    body: `Vendors set per-partner billing rules from /billing-settings/:vendorId/:partnerId: net terms, accepted payment methods, billing email. These flow into invoices automatically.`,
  },
  // ===================== VISITORS + PORTAL =====================
  {
    id: "visitors",
    title: "Visitors and the public site portal",
    roles: ["partner", "admin", "vendor"],
    body: `Visitors check in at /portal/:siteCode (the URL on the QR poster). They sign in (name + company + reason), the visit logs to /visitors, and they appear in the partner's site dashboard. /visitors lists active and completed visits — use it to see who is currently on your sites right now (anyone without a check-out time is still on site).`,
  },
  {
    id: "visitor-qr",
    title: "Printing visitor QR posters",
    roles: ["partner", "admin"],
    body: `From /site-locations, select sites and click "Print QR posters" — generates an 8.5x11 poster per site with the QR code, site name, and partner branding. Hang at the entrance.`,
  },
  {
    id: "visitor-scan",
    title: "Visitor verification by QR scan",
    roles: ["field_employee"],
    body: `Field employees can scan a visitor's QR code from the mobile app to verify they're checked in. Tap the camera icon on the field portal home.`,
  },
  // ===================== CATALOG / WORK TYPES =====================
  {
    id: "catalog-admin",
    title: "Master catalog (admin)",
    roles: ["admin"],
    body: `/catalog manages the master list of work types, equipment, and materials available across the platform. Vendors opt into work types in their Vendor catalog; partners pick from the same list when creating tickets and managing Partner Catalog approvals. Open Catalog Health from the catalog page (/catalog-health) to find platform work types with no vendor coverage, vendor selections missing prices, or site assignments without a catalog row.`,
  },
  {
    id: "catalog-health",
    title: "Catalog Health (admin)",
    roles: ["admin"],
    body: `/catalog-health is an admin diagnostics page (linked from /catalog) that surfaces catalog drift: platform work types with zero vendor selections, vendor catalog rows missing prices, and site assignments pointing at work types a vendor hasn't listed. Use it to clean up data before partners see missing services or bad Hotlist matches.`,
  },
  {
    id: "partner-catalog",
    title: "Partner product & service catalog",
    roles: ["partner", "admin"],
    body: `/partner-catalog is where partners review and approve vendor work types and pricing for their organization. Vendors publish services in their vendor catalog; partners approve them here before those services can be assigned at sites or bid on Hotlist jobs. Partner admins manage the catalog; members can view it.`,
  },
  {
    id: "vendor-catalog",
    title: "Vendor catalog",
    roles: ["vendor"],
    body: `/vendor-catalog is your vendor's authoritative service list (vendor_work_types): which work types you offer, your rates, and per-partner pricing overrides. This catalog drives site assignments, Hotlist job visibility, and partner approvals. Toggle work types on and set pricing — each partner approves your selections in their Partner Catalog before you can be assigned at their sites.`,
  },
  // ===================== ANALYTICS + COMMS =====================
  // Split per-persona so the role-gating lint can prove each URL is
  // reachable for every role tagged on its doc. /analytics/partner/:id
  // is partner-only (and admin) territory; /analytics/vendor/:id is
  // vendor-only (and admin). Mixing them in one doc would imply a
  // partner could deep-link to a vendor analytics page or vice versa,
  // which gateDeepLinkScreen rightly refuses.
  {
    id: "analytics-partner",
    title: "Partner analytics dashboard",
    roles: ["partner", "admin"],
    body: `/analytics/partner/:id is the partner analytics dashboard: stat tiles (total tickets, active, kickback rate, GPS compliance), spend pipeline (pending review / awaiting payment / approved-unpaid $), kickback trend, spend by line type, monthly/yearly spend, vendor scorecard (kickback rate + average cost per ticket), cost by site, spend by AFE, open bills aging (A/P buckets), and YTD 1099-NEC exposure by vendor. Links out to /bills-to-pay and /reports for detail.`,
  },
  {
    id: "analytics-vendor",
    title: "Vendor analytics dashboard",
    roles: ["vendor", "admin"],
    body: `/analytics/vendor/:id is the vendor analytics dashboard: stat tiles, revenue pipeline, kickback trend, revenue by line type, monthly/yearly revenue, employee scorecard, activity by site, revenue by AFE, open invoices aging (A/R buckets), and YTD 1099-NEC income by partner. Links out to /invoices and /reports for detail.`,
  },
  {
    id: "analytics-foreman",
    title: "Foreman crew analytics",
    roles: ["admin", "vendor"],
    body: `The foreman portal Analytics tab shows operational KPIs for tickets you foreman: active and on-site today counts, status breakdown, kickback trend, crew performance by field employee, and tickets by site. Vendor admins can open the same dashboard for a foreman user from the web app.`,
  },
  {
    id: "notifications",
    title: "Notifications",
    // The bell icon and /notifications/preferences live in the web app
    // sidebar. Field employees get notifications through the mobile
    // field portal, not these URLs, so they're scoped out here.
    roles: ["admin", "partner", "vendor"],
    body: `Bell icon in the sidebar opens unread notifications. Manage email/push preferences from /notifications/preferences. Important alerts (kickback, COI expiring, new ticket) trigger notifications based on role.`,
  },
  {
    id: "comments",
    title: "Comments and @mentions",
    roles: ["any"],
    body: `Tickets and visits have comment threads with @mentions. Mentioning a teammate notifies them. Replies thread under the parent comment.`,
  },
  // ===================== AUTH =====================
  {
    id: "auth-context",
    title: "Multi-org accounts and switching context",
    roles: ["any"],
    body: `If you belong to more than one org (e.g. you're an admin at one partner and a foreman at another), the sidebar shows an org switcher. Pick which view you want; the rest of the app re-scopes to that org instantly.`,
  },
  {
    id: "auth-password",
    title: "Forgot or reset password",
    roles: ["any"],
    body: `Use "Forgot password" on the login page (sends a reset email). If an admin set you a temporary password, the app forces a change-password modal on first login.`,
  },
  // ===================== SYNONYMS / COMMON CONFUSION =====================
  {
    id: "glossary",
    title: "VNDRLY glossary and common confusion",
    roles: ["any"],
    body: `AFE = Authorization for Expenditure (per-partner work-order code attached to tickets). COI = Certificate of Insurance (vendor compliance doc). Kickback ≠ rejection — it's a request for rework. Hotlist = focused list of in-flight jobs (not a TODO list). Field employee = the person on site (vendor's worker). Foreman = a field employee who can supervise others on a ticket. Site code = short alphanumeric identifier in /portal/:siteCode for the visitor portal. Operating radius = miles from a site we'll consider for vendor matching.`,
  },
];
