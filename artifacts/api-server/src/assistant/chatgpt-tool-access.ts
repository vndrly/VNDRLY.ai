import type { SessionPayload } from "../lib/session";
import { toolsForRealtime } from "./tool-packs";
import type { AskVToolDefinition } from "./tool-registry";

export type ChatGptAssistantScope = "gate:read" | "work_hub:read" | "gate:write" | "work_hub:write";

const GATE_ACTIONS = new Set(["confirm_visitor_check_in", "confirm_visitor_check_out", "start_paid_travel", "assume_gate_shift", "set_gate_coverage_status", "deliver_gate_report", "reconcile_stale_gate_visit", "reverse_gate_reconciliation"]);
export function chatGptActionTools(session: SessionPayload, scopes: readonly string[]): AskVToolDefinition[] {
  if (!session.userId || !["admin", "partner", "vendor", "field_employee"].includes(session.role ?? "")) return [];
  const gate = scopes.includes("gate:write") ? toolsForRealtime({ role: session.role, membershipRole: session.membershipRole, path: "/gate", workflow: "gate" }).filter((tool) => GATE_ACTIONS.has(tool.name)) : [];
  const hub = scopes.includes("work_hub:write") ? toolsForRealtime({ role: session.role, membershipRole: session.membershipRole, path: "/work-hub/askv" }).filter((tool) => Boolean(tool.workHubFamily) && tool.mutating) : [];
  return [...new Map([...gate, ...hub].filter((tool) => tool.execution !== "client").map((tool) => [tool.name, tool])).values()];
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
  if (scopes.includes("gate:read")) {
    candidates.push(...toolsForRealtime({
      role: session.role, membershipRole: session.membershipRole,
      path: "/gate", workflow: "gate",
    }).filter((tool) => /^(query_gate_|query_shift_notes$|search_gate_history$|query_active_visitors$|query_visits$|find_active_visitors$)/.test(tool.name)));
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
