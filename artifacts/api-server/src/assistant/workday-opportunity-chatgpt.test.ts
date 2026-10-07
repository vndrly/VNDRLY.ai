import { describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "../lib/session";
import { createWorkdayOpportunityHandler } from "./workday-opportunity-chatgpt";
vi.mock("./gate-staffing-candidates", () => ({ readGateStaffingCandidates: vi.fn(), GATE_STAFFING_CANDIDATE_OUTPUT_SCHEMA: { type: "object" } }));
vi.mock("./qualified-hotlist-read", async () => {
  const { z } = await import("zod/v4");
  return { QualifiedHotlistInputSchema: z.object({ limit: z.number().int().min(1).max(25).default(25), afterJobId: z.number().int().nonnegative().default(0) }).strict(), QUALIFIED_HOTLIST_OUTPUT_SCHEMA: { type: "object" }, createQualifiedHotlistRead: () => vi.fn() };
});
vi.mock("./chatgpt-tool-access", () => ({ requireChatGptReadableTool: (_session: unknown, scopes: string[], name: string) => {
  const required = name === "query_gate_stations" ? "gate:read" : name === "query_workforce_coverage" ? "workforce:read" : "catalog:read";
  if (!scopes.includes(required)) throw Error("Scope unavailable");
} }));
const session = { userId: 1, vendorId: 2, activeMembershipId: 3, sv: 1, role: "vendor" } as SessionPayload;
describe("workday opportunity boundary", () => {
  it("refuses staffing without workforce consent before any read", async () => {
    const gate = vi.fn(), handler = createWorkdayOpportunityHandler({ gate });
    await expect(handler("query_gate_staffing_candidates", { shiftId: "00000000-0000-4000-8000-000000000001" }, session, ["gate:read"])).rejects.toThrow();
    expect(gate).not.toHaveBeenCalled();
  });
  it("refuses partner and model-selected vendor overrides", async () => {
    const hotlist = vi.fn(), handler = createWorkdayOpportunityHandler({ hotlist });
    await expect(handler("query_qualified_hotlist_jobs", {}, { ...session, role: "partner" }, ["catalog:read"])).rejects.toThrow();
    await expect(handler("query_qualified_hotlist_jobs", { vendorId: 99 }, session, ["catalog:read"])).rejects.toThrow();
    expect(hotlist).not.toHaveBeenCalled();
  });
  it("passes the exact shift and authenticated context to the canonical staffing read", async () => {
    const gate = vi.fn().mockResolvedValue({ assignmentMade: false }), handler = createWorkdayOpportunityHandler({ gate });
    const input = { shiftId: "00000000-0000-4000-8000-000000000001" }, scopes = ["gate:read", "workforce:read"];
    await expect(handler("query_gate_staffing_candidates", input, session, scopes)).resolves.toEqual({ assignmentMade: false });
    expect(gate).toHaveBeenCalledWith(input, session, scopes);
  });
});
