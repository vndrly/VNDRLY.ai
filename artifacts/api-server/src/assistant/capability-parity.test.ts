import { describe, expect, it } from "vitest";
import { ASK_V_CAPABILITY_PARITY, USER_FACING_ACTIONS } from "./capability-parity";
import { ASK_V_TOOL_REGISTRY } from "./tool-registry";
import { switchAskVCapabilityContext, type AskVCapabilityContext } from "./capability-context";
import { GATE_TOOLBOX_MANIFEST } from "./gate-toolbox-manifest";

describe("Ask V Implementation A parity", () => {
  it("has a read tool and route for every user-facing domain", () => {
    for (const action of USER_FACING_ACTIONS) {
      expect(ASK_V_CAPABILITY_PARITY[action.id]).toMatchObject({ readTool: expect.any(String), route: expect.stringMatching(/^\//) });
      expect(ASK_V_TOOL_REGISTRY.some((tool) => tool.name === action.readTool)).toBe(true);
    }
  });

  it("requires explicit confirmation for every domain mutation", () => {
    const mutations = ASK_V_TOOL_REGISTRY.filter((tool) => tool.name.startsWith("confirm_") && tool.name.endsWith("_action"));
    expect(mutations.length).toBeGreaterThanOrEqual(7);
    expect(mutations.every((tool) => tool.mutating && tool.confirmation === "required")).toBe(true);
  });

  it("invalidates pending confirmation when context switches", () => {
    const context: AskVCapabilityContext = { revision: 1, userId: 1, membershipId: 2, owner: { type: "vendor", id: 3 }, sponsorshipId: null, assignmentId: null, shiftId: null, siteId: 4, crewId: null, vehicleAssetId: null, tripId: null, deviceId: "phone", communication: null, pendingConfirmationId: "pending" };
    expect(switchAskVCapabilityContext(context, { siteId: 5 })).toMatchObject({ revision: 2, siteId: 5, pendingConfirmationId: null });
  });

  it("keeps every Gate action available on web and iOS", () => {
    expect(GATE_TOOLBOX_MANIFEST.length).toBeGreaterThan(0);
    expect(GATE_TOOLBOX_MANIFEST.every((row) => row.web && row.ios)).toBe(true);
  });
});
