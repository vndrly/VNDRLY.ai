/** Explicit server-read adapters. A new registry tool is not exposed automatically. */
export const CHATGPT_READ_CAPABILITIES = {
  "invitations:read": { label: "Vendor administrator invitation enrollment and delivery status", tools: ["query_account_invitations", "prepare_account_invitations_action"] },
  "workforce:read": { label: "Authorized staffing coverage and assignment status", tools: ["query_workforce_coverage", "prepare_workforce_coverage_action"] },
  "tickets:read": { label: "Assigned tickets, work details, and proof", tools: ["lookup_open_tickets", "query_tickets", "query_ticket_detail", "query_ticket_proof_packet", "query_ticket_crew", "query_ticket_labor", "query_ticket_notes", "query_work_type_history", "query_flagged_tickets", "query_ticket_logged_miles", "query_ticket_mileage_audit"] },
  "sites:read": { label: "Authorized sites and operational status", tools: ["query_site_locations", "lookup_site_detail", "lookup_site_operational_status"] },
  "crew:read": { label: "Authorized crew locations, routes, GPS trails, and ETA", tools: ["query_field_trips", "prepare_field_trips_action", "query_live_crew", "lookup_crew_member_status", "query_crew_eta", "query_crew_route_summary", "query_gps_trail", "query_ticket_route_eta", "lookup_map_origin", "estimate_driving_route"] },
  "finance:read": { label: "Authorized invoices, payment status, accounting status, and reports", tools: ["lookup_open_invoices", "query_invoice_summary", "query_invoices", "query_invoice_lines", "query_ar_aging", "query_revenue_summary", "query_crew_cost", "lookup_ticket_payment_status", "lookup_accounting_connection", "query_sales_tax_by_state", "query_nec1099_summary", "query_1099_k_summary", "query_1099_misc_summary"] },
  "catalog:read": { label: "Catalog, Hotlist, approvals, certifications, and company contacts", tools: ["query_hotlist_jobs", "query_hotlist_bids", "query_vendor_catalog", "query_partner_approvals", "query_certifications", "lookup_org_contacts"] },
  "safety:read": { label: "Authorized safety events and safety metrics", tools: ["query_safety_events", "lookup_safety_metrics", "query_incident_response", "prepare_incident_response_action"] },
  "onboarding:read": { label: "Your permitted onboarding progress", tools: ["lookup_user_progress"] },
  "operations:read": { label: "Authorized notifications, attention items, assets, subscriptions, and operating metrics", tools: ["get_stock_quote", "get_crude_oil_price", "deep_link_to", "query_notifications", "query_attention_briefing", "query_vendor_performance", "query_field_metrics", "query_asset_custody", "prepare_asset_custody_action", "query_worker_subscriptions", "prepare_worker_subscriptions_action"] },
} as const;
export type ChatGptReadCapabilityScope = keyof typeof CHATGPT_READ_CAPABILITIES;
