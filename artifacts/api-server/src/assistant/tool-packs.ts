import {
  ASK_V_TOOL_REGISTRY,
  normalizeAskVRole,
  type AskVRole,
  type AskVToolDefinition,
} from "./tool-registry";

const CORE_TOOLS = new Set([
  "select_tool_pack",
  "lookup_user_progress",
  "query_attention_briefing",
  "query_notifications",
  "query_site_locations",
  "lookup_site_detail",
  "open_screen",
  "focus_control",
  "prefill_draft",
  "launch_camera",
  "launch_maps",
  "launch_scanner",
]);

const GATE_SCREEN_TOOLS = new Set([
  "prepare_visitor_check_in",
  "confirm_visitor_check_in",
  "find_active_visitors",
  "prepare_visitor_check_out",
  "confirm_visitor_check_out",
  "query_active_visitors",
  "query_visits",
]);

const TICKET_SCREEN_TOOLS = new Set([
  "lookup_open_tickets",
  "query_gps_trail",
  "query_ticket_labor",
  "query_ticket_logged_miles",
  "query_work_type_history",
  "query_ticket_detail",
  "query_tickets",
  "query_ticket_notes",
  "query_ticket_proof_packet",
  "query_ticket_crew",
  "query_ticket_route_eta",
  "query_ticket_mileage_audit",
  "set_ticket_lifecycle",
  "close_ticket_for_review",
  "post_ticket_comment",
  "start_ticket_entry",
]);

const SAFETY_SCREEN_TOOLS = new Set([
  "query_safety_events",
  "lookup_safety_metrics",
  "draft_safety_report",
]);

export const VOICE_WORKFLOWS = [
  "auto",
  "gate",
  "tickets",
  "safety",
  "operations",
  "finance",
  "reports",
  "catalog",
  "market",
] as const;
export type VoiceWorkflow = (typeof VOICE_WORKFLOWS)[number];
export function isVoiceWorkflow(value: unknown): value is VoiceWorkflow {
  return (
    typeof value === "string" &&
    (VOICE_WORKFLOWS as readonly string[]).includes(value)
  );
}
const WORKFLOW_TOOLS: Record<Exclude<VoiceWorkflow, "auto">, Set<string>> = {
  gate: GATE_SCREEN_TOOLS,
  tickets: TICKET_SCREEN_TOOLS,
  safety: SAFETY_SCREEN_TOOLS,
  operations: new Set([
    "query_vendor_performance",
    "query_field_metrics",
    "lookup_site_operational_status",
    "query_live_crew",
    "lookup_crew_member_status",
    "query_crew_eta",
    "query_crew_route_summary",
    "lookup_map_origin",
    "estimate_driving_route",
    "query_certifications",
    "lookup_org_contacts",
    "query_flagged_tickets",
  ]),
  finance: new Set([
    "lookup_open_invoices",
    "query_invoice_summary",
    "query_invoices",
    "query_invoice_lines",
    "query_ar_aging",
    "query_revenue_summary",
    "query_crew_cost",
    "lookup_ticket_payment_status",
    "lookup_accounting_connection",
  ]),
  reports: new Set([
    "query_sales_tax_by_state",
    "query_nec1099_summary",
    "query_1099_k_summary",
    "query_1099_misc_summary",
    "query_revenue_summary",
    "query_vendor_performance",
    "query_field_metrics",
  ]),
  catalog: new Set([
    "query_hotlist_jobs",
    "query_hotlist_bids",
    "query_vendor_catalog",
    "query_partner_approvals",
  ]),
  market: new Set(["get_stock_quote", "get_crude_oil_price"]),
};

const ROLE_READ_TOOLS: Record<AskVRole, Set<string>> = {
  admin: new Set([
    "query_tickets",
    "query_live_crew",
    "query_crew_eta",
    "lookup_org_contacts",
  ]),
  partner: new Set(["query_tickets", "query_live_crew", "lookup_site_detail"]),
  vendor: new Set([
    "query_tickets",
    "query_live_crew",
    "query_crew_eta",
    "lookup_crew_member_status",
  ]),
  field_employee: new Set([
    "query_tickets",
    "query_ticket_detail",
    "query_ticket_route_eta",
  ]),
  any: new Set(["query_tickets"]),
};

export function voiceWorkflowForPath(path: string): VoiceWorkflow {
  if (/gate|visitor/i.test(path)) return "gate";
  if (/ticket/i.test(path)) return "tickets";
  if (/safety/i.test(path)) return "safety";
  if (/invoice|statement|bill|accounting/i.test(path)) return "finance";
  if (/report|analytics/i.test(path)) return "reports";
  if (/hotlist|catalog/i.test(path)) return "catalog";
  if (/crew|site|field-employee/i.test(path)) return "operations";
  return "auto";
}

export function toolsForRealtime(args: {
  role: AskVRole | string | null | undefined;
  path?: string | null;
  entityId?: number | null;
  workflow?: VoiceWorkflow;
}): AskVToolDefinition[] {
  const role = normalizeAskVRole(args.role);
  const path = args.path ?? "";
  const allowed = new Set<string>(CORE_TOOLS);
  for (const name of ROLE_READ_TOOLS[role] ?? []) allowed.add(name);
  const workflow =
    args.workflow && args.workflow !== "auto"
      ? args.workflow
      : voiceWorkflowForPath(path);
  if (workflow !== "auto")
    for (const name of WORKFLOW_TOOLS[workflow]) allowed.add(name);
  return ASK_V_TOOL_REGISTRY.filter((tool) => {
    if (!allowed.has(tool.name)) return false;
    return tool.roles.includes(role) || tool.roles.includes("any");
  });
}
