import { describe, expect, it } from "vitest";
import type { FleetOverview } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { fleetConsentChallenge, fleetConsentUpgradeTools, fleetToolSecuritySchemes } from "./chatgpt-fleet-consent";
const session = {userId: 10, vendorId: 20, role: "field_employee", membershipRole: "field_employee", vendorPeopleId: 30} as SessionPayload;
const overview = {companyId: 20, enabled: true, roles: ["driver"], capabilities: {canDrive: true, canManage: false, canDispatch: false, canSetup: false}, fleets: [], runs: [], observations: [], unavailableIntegrations: [], generatedAt: new Date().toISOString()} as FleetOverview;
describe("Fleet consent discovery", () => {
  it("offers own driver consent without management or changing the grant", () => {
    const scopes = ["tickets:read"];
    const result = fleetConsentUpgradeTools(session, scopes, overview);
    expect(result.some(item => item.scope === "fleet:run")).toBe(true);
    expect(result.some(item => ["fleet:admin", "fleet:dispatch", "fleet:review"].includes(item.scope))).toBe(false);
    expect(result.some(item => item.tool.name === "query_fleet_resources")).toBe(false);
    expect(scopes).toEqual(["tickets:read"]);
  });
  it("denies foreign company, absent authority and already consented hints", () => {
    expect(fleetConsentUpgradeTools(session, [], {...overview, companyId: 21})).toEqual([]);
    expect(fleetConsentUpgradeTools(session, [], null)).toEqual([]);
    expect(fleetConsentUpgradeTools(session, ["fleet:read", "fleet:run"], overview)).toEqual([]);
  });
  it("does not derive Fleet privileges from a title alone", () => {
    expect(fleetConsentUpgradeTools({...session, vendorRole: "foreman"}, [], {...overview, roles: [], capabilities: {...overview.capabilities, canDrive: false}})).toEqual([]);
  });
  it("asks for only the selected missing scope alongside existing consent", () => {
    const result = fleetConsentChallenge("https://vndrly.ai/api/assistant-connection", ["gate:read"], "fleet:run");
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain('scope="gate:read fleet:run"');
    expect(result._meta["mcp/www_authenticate"][0]).not.toContain("finance:write");
  });
  it("declares the exact required Fleet scope for already-consented descriptors", () => {
    expect(fleetToolSecuritySchemes("transition_fleet_run")).toEqual([{type: "oauth2", scopes: ["fleet:run"]}]);
    expect(fleetToolSecuritySchemes("query_fleet_runs")).toEqual([{type: "oauth2", scopes: ["fleet:read"]}]);
    expect(fleetToolSecuritySchemes("record_ticket_payment")).toBeUndefined();
    expect(fleetToolSecuritySchemes("set_fleet_preferences", ["fleet:run"])).toEqual([{type: "oauth2", scopes: ["fleet:run"]}]);
  });
  it("does not demand another alternative scope for an already available operation", () => {
    const dual = {...overview, roles: ["driver", "dispatcher"] as FleetOverview["roles"], capabilities: {...overview.capabilities, canDispatch: true}};
    for (const granted of ["fleet:run", "fleet:dispatch"]) {
      expect(fleetConsentUpgradeTools(session, [granted], dual).some(item => item.tool.name === "set_fleet_preferences")).toBe(false);
    }
    const missing = fleetConsentUpgradeTools(session, [], dual);
    expect(missing.filter(item => item.tool.name === "set_fleet_preferences")).toHaveLength(1);
  });
});
