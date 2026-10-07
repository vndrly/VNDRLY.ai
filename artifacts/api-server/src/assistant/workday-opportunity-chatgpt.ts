import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { requireChatGptReadableTool } from "./chatgpt-tool-access";
import { readGateStaffingCandidates, GATE_STAFFING_CANDIDATE_OUTPUT_SCHEMA } from "./gate-staffing-candidates";
import { createQualifiedHotlistRead, QualifiedHotlistInputSchema, QUALIFIED_HOTLIST_OUTPUT_SCHEMA } from "./qualified-hotlist-read";

const gateInput = z.object({ shiftId: z.uuid() }).strict();
export type WorkdayOpportunityName = "query_gate_staffing_candidates" | "query_qualified_hotlist_jobs";
export function workdayOpportunityAvailable(name: WorkdayOpportunityName, session: SessionPayload, scopes: string[]) {
  if (!session.userId || !session.activeMembershipId || !session.sv || !session.vendorId) return false;
  try {
    if (name === "query_gate_staffing_candidates") {
      if (!["vendor", "field_employee"].includes(session.role ?? "")) return false;
      requireChatGptReadableTool(session, scopes, "query_gate_stations");
      requireChatGptReadableTool(session, scopes, "query_workforce_coverage");
    } else {
      if (session.role !== "vendor" || !scopes.includes("catalog:read")) return false;
      requireChatGptReadableTool(session, scopes, "query_hotlist_jobs");
    }
    return true;
  } catch { return false; }
}
export const WORKDAY_OPPORTUNITY_TOOLS = [
  { name: "query_gate_staffing_candidates" as const, description: "Read recorded staffing candidates for one exact saved vendor Gate shift. Requires current contracted site and supervisor access. Separates saved qualification, conflicts and availability from unknown reachability or physical readiness. Never assigns, contacts or proves attendance.", inputSchema: { ...z.toJSONSchema(gateInput), type: "object" as const }, outputSchema: GATE_STAFFING_CANDIDATE_OUTPUT_SCHEMA, securitySchemes: [{ type: "oauth2" as const, scopes: ["gate:read", "workforce:read"] }], annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "query_qualified_hotlist_jobs" as const, description: "Read a bounded page of open Hotlist opportunities matched to the current vendor's exact service catalog, recorded relationship, compliance and operating radius. Capacity and worker readiness remain unknown; matching never authorizes a bid, award or legal acceptance. Empty catalog matches no work.", inputSchema: { ...z.toJSONSchema(QualifiedHotlistInputSchema), type: "object" as const }, outputSchema: QUALIFIED_HOTLIST_OUTPUT_SCHEMA, securitySchemes: [{ type: "oauth2" as const, scopes: ["catalog:read"] }], annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
];
export function availableWorkdayOpportunityTools(session: SessionPayload, scopes: string[]) {
  return WORKDAY_OPPORTUNITY_TOOLS.filter(tool => workdayOpportunityAvailable(tool.name, session, scopes));
}
export function createWorkdayOpportunityHandler(overrides: { gate?: typeof readGateStaffingCandidates; hotlist?: ReturnType<typeof createQualifiedHotlistRead> } = {}) {
  const gate = overrides.gate ?? readGateStaffingCandidates;
  const hotlist = overrides.hotlist ?? createQualifiedHotlistRead();
  return async (name: WorkdayOpportunityName, raw: unknown, session: SessionPayload, scopes: string[]) => {
    if (!workdayOpportunityAvailable(name, session, scopes)) throw Error("Current vendor and opportunity read permissions required");
    return name === "query_gate_staffing_candidates" ? gate(gateInput.parse(raw), session, scopes) : hotlist(QualifiedHotlistInputSchema.parse(raw), session, scopes);
  };
}
export const handleWorkdayOpportunityTool = createWorkdayOpportunityHandler();
