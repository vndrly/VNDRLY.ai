import { describe, expect, it } from "vitest";
import type { FleetOverview } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { fleetConsentChallenge, fleetConsentUpgradeTools, partnerFleetConsentUpgradeTools, supportFleetConsentUpgradeTools, fleetToolSecuritySchemes } from "./chatgpt-fleet-consent";
const session = {userId: 10, vendorId: 20, role: "field_employee", membershipRole: "field_employee", vendorPeopleId: 30} as SessionPayload;
const overview = {companyId: 20, enabled: true, roles: ["driver"], capabilities: {canDrive: true, canManage: false, canDispatch: false, canSetup: false}, fleets: [], runs: [], observations: [], unavailableIntegrations: [], generatedAt: new Date().toISOString()} as FleetOverview;
describe("Fleet consent discovery", () => {
  it("offers a separate policy consent to partner administrators without expanding billing grants",()=>{
    const partner={userId:3,role:"partner",partnerId:9,membershipRole:"admin"} as SessionPayload,scopes=["fleet:read","fleet:billing"];
    const offered=partnerFleetConsentUpgradeTools(partner,scopes,{sites:[{siteId:4}]});
    expect(offered.filter(row=>row.scope==="fleet:policy").map(row=>row.tool.name)).toEqual(["activate_fleet_compliance_policy"]);
    expect(scopes).toEqual(["fleet:read","fleet:billing"]);
    expect(partnerFleetConsentUpgradeTools(partner,[...scopes,"fleet:policy"],{sites:[{siteId:4}]})).toEqual([]);
  });
  it("offers explicit inventory consent to enabled-company administrators before a Detail grant exists", () => {
    const admin = { ...session, role: "vendor", membershipRole: "admin" } as SessionPayload;
    const setup = { ...overview, roles: [], capabilities: { ...overview.capabilities, canDrive: false, canSetup: true, canManage: false } };
    const scopes = ["fleet:admin"];
    const hints = fleetConsentUpgradeTools(admin, scopes, setup);
    expect(hints.filter(item => item.scope === "fleet:inventory").map(item => item.tool.name)).toEqual(["create_fleet_inventory_asset", "enroll_fleet_inventory_asset", "edit_fleet_inventory_asset"]);
    expect(scopes).toEqual(["fleet:admin"]);
    expect(fleetConsentUpgradeTools(admin, scopes, { ...setup, enabled: false }).some(item => item.scope === "fleet:inventory")).toBe(false);
    expect(fleetConsentUpgradeTools(admin, ["fleet:inventory"], setup).some(item => item.scope === "fleet:inventory")).toBe(false);
  });
  it("offers only read-only support consent for trusted nonempty support company choices",()=>{
    const admin={...session,role:"admin",vendorId:undefined} as SessionPayload;
    expect(supportFleetConsentUpgradeTools(admin,[],{companies:[{companyId:20}]}).map(item=>item.tool.name)).toEqual(["query_fleet_support"]);
    expect(supportFleetConsentUpgradeTools(admin,[],{companies:[]})).toEqual([]);
    expect(supportFleetConsentUpgradeTools(admin,["fleet:read"],{companies:[{}]})).toEqual([]);
    expect(supportFleetConsentUpgradeTools(session,[],{companies:[{}]})).toEqual([]);
  });
  it("offers only site activity to a trusted current Partner with permitted sites",()=>{
    const partner={...session,role:"partner",partnerId:21,vendorId:undefined} as SessionPayload;
    expect(partnerFleetConsentUpgradeTools(partner,[],{sites:[{siteId:392}]}).map(item=>item.tool.name)).toEqual(["query_fleet_site_activity"]);
    expect(partnerFleetConsentUpgradeTools(partner,[],{sites:[]})).toEqual([]);
    expect(partnerFleetConsentUpgradeTools(partner,["fleet:read"],{sites:[{siteId:392}]})).toEqual([]);
    expect(partnerFleetConsentUpgradeTools(session,[],{sites:[{siteId:392}]})).toEqual([]);
  });
  it("offers own driver consent without management or changing the grant", () => {
    const scopes = ["tickets:read"];
    const result = fleetConsentUpgradeTools(session, scopes, overview);
    expect(result.some(item => item.scope === "fleet:run")).toBe(true);
    expect(result.some(item => ["fleet:admin", "fleet:dispatch", "fleet:review"].includes(item.scope))).toBe(false);
    expect(result.some(item => item.tool.name === "query_fleet_resources")).toBe(false);
    expect(scopes).toEqual(["tickets:read"]);
  });
  it("offers Yard actions through a separate explicit scope without changing existing run consent", () => {
    const scopes = ["fleet:run"];
    const result = fleetConsentUpgradeTools(session, scopes, overview);
    expect(result.filter(item => item.scope === "fleet:yard").map(item => item.tool.name)).toEqual(["manage_fleet_yard_order", "record_fleet_custody"]);
    expect(scopes).toEqual(["fleet:run"]);
    expect(fleetToolSecuritySchemes("manage_fleet_yard_order")).toEqual([{ type: "oauth2", scopes: ["fleet:yard"] }]);
  });
  it("denies foreign company, absent authority and already consented hints", () => {
    expect(fleetConsentUpgradeTools(session, [], {...overview, companyId: 21})).toEqual([]);
    expect(fleetConsentUpgradeTools(session, [], null)).toEqual([]);
    expect(fleetConsentUpgradeTools(session, ["fleet:read", "fleet:run", "fleet:yard"], overview)).toEqual([]);
  });
  it("does not derive Fleet privileges from a title alone", () => {
    expect(fleetConsentUpgradeTools({...session, vendorRole: "foreman"}, [], {...overview, roles: [], capabilities: {...overview.capabilities, canDrive: false}})).toEqual([]);
  });
  it("offers maintenance only from current explicit manager capability", () => {
    const manager = {...overview, roles: ["fleet_manager"] as FleetOverview["roles"], capabilities: {...overview.capabilities, canDrive: false, canManage: true, canMaintain: true}};
    expect(fleetConsentUpgradeTools(session, [], manager).some(item => item.scope === "fleet:maintenance" && item.tool.name === "manage_fleet_maintenance")).toBe(true);
    expect(fleetConsentUpgradeTools(session, [], overview).some(item => item.scope === "fleet:maintenance")).toBe(false);
    expect(fleetToolSecuritySchemes("manage_fleet_maintenance")).toEqual([{type: "oauth2", scopes: ["fleet:maintenance"]}]);
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
