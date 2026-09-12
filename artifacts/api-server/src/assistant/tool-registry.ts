import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";
import { DEEP_LINK_SCREENS, TOOLS } from "./tools";
import {
  WORK_HUB_TOOL_METADATA,
  type WorkHubToolFamily,
} from "./work-hub-tools";

export type AskVRole = "admin" | "partner" | "vendor" | "field_employee" | "any";
export type AskVConfirmationMode = "none" | "required";
export type AskVRiskLevel = "read" | "low" | "high";
export type AskVExecution = "server" | "client";
export type AskVToolPack = "core" | "role" | "screen";
export type AskVAuditTarget =
  | "ticket"
  | "notification"
  | "onboarding"
  | "message"
  | "site"
  | "crew"
  | "safety"
  | "hotlist"
  | "invoice"
  | "work_hub";

export interface AskVToolDefinition {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool["input_schema"];
  roles: AskVRole[];
  mutating: boolean;
  confirmation: AskVConfirmationMode;
  risk?: AskVRiskLevel;
  execution?: AskVExecution;
  pack?: AskVToolPack;
  auditTarget?: AskVAuditTarget;
  workHubFamily?: WorkHubToolFamily;
  companyAdminOnly?: boolean;
}

export interface OpenAIRealtimeTool {
  type: "function";
  name: string;
  description: string;
  parameters: Anthropic.Tool["input_schema"];
}

export interface OpenAIRealtimeToolMetadata {
  name: string;
  mutating: boolean;
  confirmation: AskVConfirmationMode;
  auditTarget: AskVAuditTarget | null;
}

type ToolMetadata = Omit<AskVToolDefinition, "name" | "description" | "inputSchema">;
type JsonSchema = Record<string, unknown>;

const ALL_SIGNED_IN_ROLES: AskVRole[] = ["admin", "partner", "vendor", "field_employee"];
const OFFICE_ROLES: AskVRole[] = ["admin", "partner", "vendor"];
const VENDOR_FIELD_ROLES: AskVRole[] = ["admin", "vendor", "field_employee"];
const ONBOARDING_ROLES: AskVRole[] = ["partner", "vendor", "field_employee"];

const DEFAULT_METADATA: ToolMetadata = {
  roles: ALL_SIGNED_IN_ROLES,
  mutating: false,
  confirmation: "none",
  risk: "read",
  execution: "server",
  pack: "role",
};

const TOOL_METADATA: Record<string, Partial<ToolMetadata>> = {
  ...Object.fromEntries(
    Object.entries(WORK_HUB_TOOL_METADATA).map(([name, metadata]) => [
      name,
      {
        mutating: metadata.mutating,
        confirmation: metadata.mutating ? "required" : "none",
        risk: metadata.mutating ? "high" : "read",
        pack: "screen",
        auditTarget: "work_hub",
        workHubFamily: metadata.family,
        companyAdminOnly: metadata.companyAdminOnly,
      },
    ]),
  ),
  query_work_hub: { auditTarget: "work_hub" },
  propose_work_hub_action: { mutating: true, confirmation: "required", risk: "high", auditTarget: "work_hub" },
  lookup_user_progress: { auditTarget: "onboarding" },
  start_onboarding: { roles: ONBOARDING_ROLES, mutating: true, pack: "screen", auditTarget: "onboarding" },
  set_onboarding_field: { roles: ONBOARDING_ROLES, mutating: true, confirmation: "required", pack: "screen", auditTarget: "onboarding" },
  complete_onboarding_step: { roles: ONBOARDING_ROLES, mutating: true, confirmation: "required", pack: "screen", auditTarget: "onboarding" },
  finalize_onboarding: { roles: ["partner", "vendor"], mutating: true, confirmation: "required", pack: "screen", auditTarget: "onboarding" },
  lookup_open_invoices: { roles: OFFICE_ROLES, auditTarget: "invoice" },
  lookup_open_tickets: { auditTarget: "ticket" },
  query_tickets: { auditTarget: "ticket" },
  query_gps_trail: { auditTarget: "ticket" },
  query_vendor_performance: { roles: OFFICE_ROLES },
  query_visits: { roles: OFFICE_ROLES },
  query_field_metrics: { roles: OFFICE_ROLES },
  query_invoice_summary: { roles: OFFICE_ROLES, auditTarget: "invoice" },
  query_sales_tax_by_state: { roles: OFFICE_ROLES },
  query_nec1099_summary: { roles: OFFICE_ROLES },
  query_ticket_detail: { auditTarget: "ticket" },
  query_ticket_proof_packet: { auditTarget: "ticket" },
  query_ticket_crew: { auditTarget: "crew" },
  query_ticket_labor: { auditTarget: "ticket" },
  query_ticket_notes: { auditTarget: "ticket" },
  query_work_type_history: { auditTarget: "ticket" },
  query_invoices: { roles: OFFICE_ROLES, auditTarget: "invoice" },
  query_invoice_lines: { roles: OFFICE_ROLES, auditTarget: "invoice" },
  query_ar_aging: { roles: OFFICE_ROLES, auditTarget: "invoice" },
  query_revenue_summary: { roles: OFFICE_ROLES },
  query_crew_cost: { roles: ["admin", "vendor"] },
  query_1099_k_summary: { roles: OFFICE_ROLES },
  query_1099_misc_summary: { roles: OFFICE_ROLES },
  query_safety_events: { auditTarget: "safety" },
  lookup_safety_metrics: { auditTarget: "safety" },
  lookup_site_operational_status: { auditTarget: "site" },
  query_site_locations: { auditTarget: "site" },
  lookup_site_detail: { auditTarget: "site" },
  query_notifications: { auditTarget: "notification" },
  query_attention_briefing: { auditTarget: "ticket" },
  query_live_crew: { roles: OFFICE_ROLES, auditTarget: "crew" },
  lookup_crew_member_status: { roles: OFFICE_ROLES, auditTarget: "crew" },
  query_crew_eta: { roles: OFFICE_ROLES, auditTarget: "crew" },
  query_crew_route_summary: { roles: OFFICE_ROLES, auditTarget: "crew" },
  lookup_map_origin: { auditTarget: "site" },
  query_ticket_route_eta: { auditTarget: "ticket" },
  query_ticket_mileage_audit: { auditTarget: "ticket" },
  estimate_driving_route: { auditTarget: "ticket" },
  query_hotlist_jobs: { roles: OFFICE_ROLES, auditTarget: "hotlist" },
  query_hotlist_bids: { roles: ["admin", "vendor"], auditTarget: "hotlist" },
  query_vendor_catalog: { roles: OFFICE_ROLES },
  query_partner_approvals: { roles: OFFICE_ROLES },
  query_certifications: { roles: ["admin", "vendor"], auditTarget: "crew" },
  lookup_org_contacts: { roles: OFFICE_ROLES },
  query_flagged_tickets: { auditTarget: "ticket" },
  lookup_ticket_payment_status: { roles: OFFICE_ROLES, auditTarget: "ticket" },
  lookup_accounting_connection: { roles: ["admin", "vendor"] },
  query_active_visitors: { roles: OFFICE_ROLES },
  query_gate_report: { roles: OFFICE_ROLES },
  prepare_visitor_check_in: { roles: OFFICE_ROLES, pack: "screen", auditTarget: "site" },
  confirm_visitor_check_in: {
    roles: OFFICE_ROLES,
    mutating: true,
    confirmation: "required",
    risk: "high",
    pack: "screen",
    auditTarget: "site",
  },
  find_active_visitors: { roles: OFFICE_ROLES, pack: "screen", auditTarget: "site" },
  prepare_visitor_check_out: { roles: OFFICE_ROLES, pack: "screen", auditTarget: "site" },
  confirm_visitor_check_out: {
    roles: OFFICE_ROLES,
    mutating: true,
    confirmation: "required",
    risk: "high",
    pack: "screen",
    auditTarget: "site",
  },
  set_ticket_lifecycle: { roles: VENDOR_FIELD_ROLES, mutating: true, pack: "screen", auditTarget: "ticket" },
  close_ticket_for_review: {
    roles: VENDOR_FIELD_ROLES,
    mutating: true,
    confirmation: "required",
    risk: "high",
    pack: "screen",
    auditTarget: "ticket",
  },
  draft_safety_report: { mutating: true, pack: "screen", auditTarget: "safety" },
  open_screen: { execution: "client", pack: "core" },
  select_tool_pack: { pack: "core" },
  focus_control: { execution: "client", pack: "core" },
  prefill_draft: { execution: "client", pack: "core" },
  launch_camera: { execution: "client", pack: "core" },
  launch_maps: { execution: "client", pack: "core" },
  launch_scanner: { execution: "client", pack: "core" },
  start_ticket_entry: { execution: "client", pack: "screen", auditTarget: "ticket" },
  mark_notifications_read: { mutating: true, confirmation: "required", auditTarget: "notification" },
  schedule_ticket_crew: { roles: OFFICE_ROLES, mutating: true, confirmation: "required", auditTarget: "ticket" },
  set_ticket_flag: { mutating: true, confirmation: "required", auditTarget: "ticket" },
  post_ticket_comment: { roles: VENDOR_FIELD_ROLES, mutating: true, confirmation: "required", auditTarget: "message" },
};

export { DEEP_LINK_SCREENS };

export const ASK_V_TOOL_REGISTRY: AskVToolDefinition[] = TOOLS.map((tool) => {
  const metadata = { ...DEFAULT_METADATA, ...(TOOL_METADATA[tool.name] ?? {}) };
  return {
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.input_schema,
    roles: metadata.roles,
    mutating: metadata.mutating,
    confirmation: metadata.confirmation,
    risk: metadata.mutating ? (metadata.confirmation === "required" ? "high" : "low") : "read",
    execution: metadata.execution,
    pack: metadata.pack,
    auditTarget: metadata.auditTarget,
    workHubFamily: metadata.workHubFamily,
    companyAdminOnly: metadata.companyAdminOnly,
  };
});

export function toAnthropicTools(tools: AskVToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function withNullableType(schema: JsonSchema): JsonSchema {
  const copy = { ...schema };
  const type = copy.type;
  if (Array.isArray(type)) {
    copy.type = type.includes("null") ? type : [...type, "null"];
  } else if (typeof type === "string") {
    copy.type = type === "null" ? type : [type, "null"];
  } else if (Array.isArray(copy.anyOf)) {
    const hasNull = copy.anyOf.some((item) => {
      return item && typeof item === "object" && (item as JsonSchema).type === "null";
    });
    copy.anyOf = hasNull ? copy.anyOf : [...copy.anyOf, { type: "null" }];
  } else {
    copy.anyOf = [{ ...copy }, { type: "null" }];
    delete copy.type;
    delete copy.properties;
    delete copy.required;
    delete copy.additionalProperties;
  }
  if (Array.isArray(copy.enum) && !copy.enum.includes(null)) {
    copy.enum = [...copy.enum, null];
  }
  return copy;
}

function toStrictRealtimeSchema(schema: unknown, requiredByParent = true): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const source = schema as JsonSchema;
  const copy: JsonSchema = { ...source };

  if (copy.type === "object") {
    const properties = copy.properties && typeof copy.properties === "object" && !Array.isArray(copy.properties)
      ? (copy.properties as Record<string, unknown>)
      : {};
    const originalRequired = new Set(Array.isArray(copy.required) ? copy.required.filter((item): item is string => typeof item === "string") : []);
    const normalizedProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      normalizedProperties[key] = toStrictRealtimeSchema(value, originalRequired.has(key));
    }
    copy.properties = normalizedProperties;
    copy.required = Object.keys(properties);
    copy.additionalProperties = false;
  } else if (copy.items) {
    copy.items = toStrictRealtimeSchema(copy.items);
  }

  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(copy[key])) {
      copy[key] = copy[key].map((item) => toStrictRealtimeSchema(item));
    }
  }

  return requiredByParent ? copy : withNullableType(copy);
}

export function toRealtimeTools(tools: AskVToolDefinition[]): OpenAIRealtimeTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: toStrictRealtimeSchema(tool.inputSchema) as Anthropic.Tool["input_schema"],
  }));
}

export function toRealtimeToolMetadata(tools: AskVToolDefinition[]): OpenAIRealtimeToolMetadata[] {
  return tools.map((tool) => ({
    name: tool.name,
    mutating: tool.mutating,
    confirmation: tool.confirmation,
    auditTarget: tool.auditTarget ?? null,
  }));
}

export function normalizeAskVRole(role: string | null | undefined): AskVRole {
  if (role === "admin" || role === "partner" || role === "vendor" || role === "field_employee") {
    return role;
  }
  return "any";
}

export function toolsForRole(role: AskVRole | string | null | undefined): AskVToolDefinition[] {
  const normalized = normalizeAskVRole(role);
  if (normalized === "any") return ASK_V_TOOL_REGISTRY;
  return ASK_V_TOOL_REGISTRY.filter((tool) => tool.roles.includes(normalized) || tool.roles.includes("any"));
}

export function findAskVTool(name: string): AskVToolDefinition | null {
  return ASK_V_TOOL_REGISTRY.find((tool) => tool.name === name) ?? null;
}
