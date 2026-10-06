import type { SessionPayload } from "../lib/session";
import { toolsForRealtime } from "./tool-packs";
import type { AskVToolDefinition } from "./tool-registry";
import { ASK_V_TOOL_REGISTRY } from "./tool-registry";
import { CHATGPT_READ_CAPABILITIES, type ChatGptReadCapabilityScope } from "./chatgpt-read-capabilities";
import { CHATGPT_WRITE_CAPABILITIES, type ChatGptWriteCapabilityScope } from "./chatgpt-write-capabilities";

export type ChatGptAssistantScope = "gate:read" | "work_hub:read" | "gate:write" | "work_hub:write" | ChatGptReadCapabilityScope | ChatGptWriteCapabilityScope;

const hasOnboardingScope = (session: SessionPayload) =>
  (session.role === "field_employee" && Boolean(session.vendorPeopleId)) ||
  (session.membershipRole === "admin" && ((session.role === "partner" && Boolean(session.partnerId)) || (session.role === "vendor" && Boolean(session.vendorId))));

const GATE_ACTIONS = new Set(["confirm_visitor_check_in", "confirm_visitor_check_out", "start_paid_travel", "assume_gate_shift", "set_gate_coverage_status", "deliver_gate_report", "reconcile_stale_gate_visit", "reverse_gate_reconciliation"]);
const GATE_DRAFT_TOOLS = new Set(["resolve_gate_check_in", "prepare_visitor_check_in", "prepare_visitor_check_out"]);
export function chatGptReadToolDescription(tool: AskVToolDefinition): string {
  if (/^prepare_(account_invitations|workforce_coverage|incident_response|field_trips|asset_custody|worker_subscriptions)_action$/.test(tool.name)) return `${tool.description} This reads authorized context only. No bound action, approval, or record change is created. Use an exposed write tool to prepare an authenticated approval.`;
  return GATE_DRAFT_TOOLS.has(tool.name)
    ? `${tool.description} In ChatGPT this returns draft fields and matching candidates only. No VNDRLY form is populated and no entry or checkout is submitted. Use the authenticated VNDRLY approval flow to submit a change; device location must come from the approval device.`
    : tool.description;
}
export function chatGptReadToolOutput(name: string, output: unknown): unknown {
  if (name === "lookup_user_progress" && output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    const progress = record.progress;
    if (!progress || typeof progress !== "object" || Array.isArray(progress)) return output;
    const source = progress as Record<string, unknown>;
    return { progress: Object.fromEntries(["orgType", "currentStep", "completedSteps", "skippedSteps", "completedAt"].filter(key => key in source).map(key => [key, source[key]])) };
  }
  if (!GATE_DRAFT_TOOLS.has(name) || !output || typeof output !== "object" || Array.isArray(output)) return output;
  const { intent: _intent, execution: _execution, ...draft } = output as Record<string, unknown>;
  return { ...draft, execution: "draft_only", submitted: false, formPopulated: false,
    message: "Draft fields and candidates only. No VNDRLY form was populated and no gate record was submitted. Submit through the authenticated VNDRLY approval flow." };
}
export function chatGptActionTools(session: SessionPayload, scopes: readonly string[]): AskVToolDefinition[] {
  if (!session.userId || !["admin", "partner", "vendor", "field_employee"].includes(session.role ?? "")) return [];
  const gate = scopes.includes("gate:write") ? toolsForRealtime({ role: session.role, membershipRole: session.membershipRole, path: "/gate", workflow: "gate" }).filter((tool) => GATE_ACTIONS.has(tool.name)) : [];
  const hub = scopes.includes("work_hub:write") ? toolsForRealtime({ role: session.role, membershipRole: session.membershipRole, path: "/work-hub/askv" }).filter((tool) => Boolean(tool.workHubFamily) && tool.mutating) : [];
  const names = new Set<string>(Object.entries(CHATGPT_WRITE_CAPABILITIES).filter(([scope]) => scopes.includes(scope)).flatMap(([, capability]) => [...capability.tools]));
  const additional = ASK_V_TOOL_REGISTRY.filter(tool => names.has(tool.name)
    && (!tool.name.includes("account_invitations") || (session.role === "vendor" && Boolean(session.vendorId) && session.membershipRole === "admin"))
    && (!(CHATGPT_WRITE_CAPABILITIES["onboarding:write"].tools as readonly string[]).includes(tool.name) || hasOnboardingScope(session))
    && (tool.roles.includes(session.role as "admin" | "partner" | "vendor" | "field_employee") || tool.roles.includes("any"))
    && (!tool.companyAdminOnly || session.membershipRole === "admin") && tool.mutating);
  return [...new Map([...gate, ...hub, ...additional].filter((tool) => tool.execution !== "client").map((tool) => [tool.name, tool])).values()];
}

/** A scoped connection never broadens the tool registry's role permissions.
 * Writes remain unavailable until trusted user authorization is integrated.
 */
export function chatGptReadableTools(
  session: SessionPayload,
  scopes: readonly string[],
): AskVToolDefinition[] {
  if (!session.userId || !["admin", "partner", "vendor", "field_employee"].includes(session.role ?? "")) return [];
  const candidates: AskVToolDefinition[] = [];
  const explicitNames = new Set<string>(Object.entries(CHATGPT_READ_CAPABILITIES)
    .filter(([scope]) => scopes.includes(scope)).flatMap(([, capability]) => [...capability.tools]));
  candidates.push(...ASK_V_TOOL_REGISTRY.filter(tool => explicitNames.has(tool.name)
    && (!tool.name.includes("account_invitations") || (session.role === "vendor" && Boolean(session.vendorId) && session.membershipRole === "admin"))
    && (!tool.name.includes("worker_subscriptions") || (session.role === "vendor" && Boolean(session.vendorId) && session.membershipRole === "admin"))
    && (tool.name !== "lookup_user_progress" || hasOnboardingScope(session))
    && (tool.roles.includes(session.role as "admin" | "partner" | "vendor" | "field_employee") || tool.roles.includes("any"))
    && (!tool.companyAdminOnly || session.membershipRole === "admin")));
  if (scopes.includes("gate:read")) {
    candidates.push(...toolsForRealtime({
      role: session.role, membershipRole: session.membershipRole,
      path: "/gate", workflow: "gate",
    }).filter((tool) => GATE_DRAFT_TOOLS.has(tool.name) || /^(query_gate_|query_shift_notes$|search_gate_history$|query_active_visitors$|query_visits$|find_active_visitors$)/.test(tool.name)));
  }
  if (scopes.includes("work_hub:read")) {
    candidates.push(...toolsForRealtime({
      role: session.role, membershipRole: session.membershipRole,
      path: "/work-hub/askv",
    }).filter((tool) => Boolean(tool.workHubFamily)));
  }
  return [...new Map(candidates.filter((tool) =>
    !tool.mutating && tool.confirmation === "none" && tool.execution !== "client",
  ).map((tool) => [tool.name, tool])).values()];
}

export function requireChatGptReadableTool(
  session: SessionPayload,
  scopes: readonly string[],
  name: string,
): AskVToolDefinition {
  const tool = chatGptReadableTools(session, scopes).find((candidate) => candidate.name === name);
  if (!tool) throw new Error("Tool is unavailable for this account and connection scope");
  return tool;
}
