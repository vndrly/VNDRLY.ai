import {describe,it,expect} from "vitest";
import {workspaceRequest,workspaceOutput,WORKSPACE_TOOL,WORKSPACE_HTML} from "./chatgpt-workspace";
const now=new Date("2026-10-13T12:00:00Z"),runId="17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
describe("embedded operations parity",()=>{
 it("requires exact canonical identities and preserves historical time",()=>{
  expect(workspaceRequest({view:"fleet_history",runId})).toMatchObject({sourceTool:"query_fleet_location_history",sourceArguments:{runId}});
  expect(()=>workspaceRequest({view:"fleet_history",runId:"all"})).toThrow();
  expect(()=>workspaceRequest({view:"fleet_plan",ticketId:0})).toThrow();
  expect(workspaceRequest({view:"fleet_plan",ticketId:42}).sourceArguments).toEqual({ticketId:42});
  expect(workspaceRequest({view:"gate_coverage",at:now.toISOString()}).sourceArguments).toEqual({at:now.toISOString()});
  expect(()=>workspaceRequest({view:"gate_coverage",at:"yesterday"})).toThrow();
  expect(WORKSPACE_TOOL.inputSchema.properties.view.enum).toContain("company_operations");
 });
 it("binds replay to the exact run and shows gaps and display caps without leaking device IDs",()=>{
  const point={runId,vehicleAssetId:runId,driverUserId:1,latitude:35,longitude:-97,accuracyMeters:10,recordedAt:now.toISOString(),receivedAt:now.toISOString(),source:"driver_phone",freshness:"stale",physicalProofVerified:false};
  const result=workspaceOutput("fleet_history","query_fleet_location_history",{runId},{runId,points:Array.from({length:51},()=>point),events:[],truncated:true,deviceId:"private-device"},now);
  expect(result.sections[0].rows).toHaveLength(50);
  expect(result.attention[0].detail).toContain("gaps");
  expect(result.attention[1].detail).toContain("truncated");
  expect(JSON.stringify(result)).not.toContain("private-device");
  expect(()=>workspaceOutput("fleet_history","query_fleet_location_history",{runId},{runId,points:[{...point,runId:"afafd3ab-bca4-4949-a3db-768ae3b31f10"}],events:[],truncated:false},now)).toThrow("another run");
 });
 it("projects selected services without granting administration",()=>{
  const output=workspaceOutput("company_operations","query_company_operations",{},{categories:["field","gate"],canManage:false,privateSecret:"secret"},now);
  expect(output.sections[0].rows.map(row=>row.title)).toEqual(["field","gate"]);
  expect(output.sections[1].rows[0].detail).toContain("company:settings consent");
  expect(JSON.stringify(output)).not.toContain("secret");
  expect(()=>workspaceOutput("company_operations","query_company_operations",{},{categories:["all"],canManage:false},now)).toThrow();
 });
 it("preserves absent and stale Gate locations without identifying an incident as resolved",()=>{
  const output=workspaceOutput("gate_coverage","query_gate_coverage_map",{},{at:now.toISOString(),historical:true,gates:[],duties:[{name:"Synthetic worker",coverage:{incident:{id:"test",acknowledgedAt:now.toISOString(),escalatedAt:now.toISOString()}}}],staff:[{name:"Synthetic worker",assignment:"Gate A",fresh:false,location:null,locationReason:"no_report"}]},now);
  expect(output.sections[0].rows[0].detail).toContain("no_report");
  expect(output.fleetMap?.points).toEqual([]);
  expect(output.attention[0].detail).toContain("never acknowledges");
  expect(output.sections[2].rows[0].detail).toContain("acknowledged, unresolved");
  expect(output.sections[2].rows[0].detail).toContain("escalated");
  expect(()=>workspaceOutput("gate_coverage","query_gate_coverage_map",{},{staff:[],gates:[]},now)).toThrow("Incomplete");
 });
 it("displays canonical no-plan charges while requiring confirmation for subsequent saves",()=>{
  const output=workspaceOutput("fleet_plan","query_fleet_ticket_plan",{ticketId:42},{ticketId:42,siteId:9,plan:null,charges:{runs:0,total:"0.00"}},now);
  expect(output.sections[0].rows[0].detail).toContain("Origin site #9");
  expect(output.sections[2].rows[0].title).toBe("0.00 USD");
  expect(output.attention[0].detail).toContain("authenticated confirmation");
  expect(()=>workspaceOutput("fleet_plan","query_fleet_ticket_plan",{ticketId:41},{ticketId:42,siteId:9,plan:null,charges:{}},now)).toThrow("mismatched");
  expect(WORKSPACE_HTML).toContain("Recorded sample replay");
  expect(WORKSPACE_HTML).toContain("Show selected time");
 });
});
