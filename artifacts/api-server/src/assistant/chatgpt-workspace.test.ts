import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { workspaceOutput, workspaceRequest, WORKSPACE_HTML } from "./chatgpt-workspace";
const now = new Date("2026-10-05T17:00:00Z");
it("binds operational review requirements to the exact run without implying approval or exposing private files", () => {
  const runId="17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
  const request=workspaceRequest({view:"fleet_review",runId});
  expect(request).toMatchObject({sourceTool:"query_fleet_review_packet",sourceArguments:{runId}});
  expect(()=>workspaceRequest({view:"fleet_review"})).toThrow();
  const packet={runId,runVersion:5,status:"in_progress",requirements:[{id:"delivery",label:"Delivery photo",kind:"photo",scope:"run",required:true,loadId:null,evidenceIds:[],missing:true,fileUrl:"/private-file",sha256:"private-hash"}],missingRequiredCount:1,readyForOperationalReview:false,inspectionComplete:false,manifestComplete:true,closeoutRecordsComplete:false,inspectionExceptions:0,undeliveredLoadCount:0,source:"recorded_fleet_records",physicalProofVerified:false,signatureIdentityVerified:false,limitations:["Saved associations do not verify physical work."]};
  const output=workspaceOutput("fleet_review",request.sourceTool,request.sourceArguments,packet,now);
  const optionalOutput=workspaceOutput("fleet_review",request.sourceTool,request.sourceArguments,{...packet,requirements:[{...packet.requirements[0],required:false}],missingRequiredCount:0,inspectionComplete:true,manifestComplete:true,closeoutRecordsComplete:true},now); expect(optionalOutput.attention).toHaveLength(0); expect(optionalOutput.sections[0].rows[0].detail).toContain("Optional, no saved file"); expect(output.attention[0].title).toBe("Delivery photo"); expect(output.attention.map(row=>row.title)).toContain("Inspection records"); expect(output.sections[1].rows.find(row=>row.title==="Load manifests")?.detail).toBe("Complete saved records");
  expect(output.sections[1].rows[0].detail).toContain("does not approve");
  expect(JSON.stringify(output)).not.toMatch(/private-file|private-hash/);
  expect(()=>workspaceOutput("fleet_review",request.sourceTool,{runId:"afafd3ab-bca4-4949-a3db-768ae3b31f10"},packet,now)).toThrow("another run");
});
it("keeps Fleet evidence metadata bound to the exact run without disclosing file URLs", () => {
  const runId="17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
  expect(workspaceRequest({view:"fleet_evidence",runId})).toMatchObject({sourceTool:"query_fleet_evidence",sourceArguments:{runId}});
  expect(()=>workspaceRequest({view:"fleet_evidence"})).toThrow();
  const item={evidenceId:runId,runId,companyId:1107,operationId:runId,runVersion:2,kind:"photo",stopId:null,loadId:null,notes:"Synthetic device test",size:100,contentType:"image/png",sha256:"a".repeat(64),recordedByUserId:1073,recordedAt:now.toISOString(),capturedAt:null,source:"device_upload",physicalProofVerified:false,signatureIdentityVerified:false,fileUrl:"/private-test-file"};
  const output=workspaceOutput("fleet_evidence","query_fleet_evidence",{runId},{runId,evidence:[item]},now);
  expect(output.sections[0].rows[0].title).toBe("photo");
  expect(output.attention[0].detail).toContain("not verified");
  expect(JSON.stringify(output)).not.toContain("/private-test-file");
  expect(()=>workspaceOutput("fleet_evidence","query_fleet_evidence",{runId},{runId,evidence:[{...item,runId:"afafd3ab-bca4-4949-a3db-768ae3b31f10"}]},now)).toThrow("another run");
  expect(WORKSPACE_HTML).toContain("Saved evidence");
});
function workspaceHarness() {
  const nodes = new Map<string, any>();
  const makeNode = () => ({ textContent: "", className: "", append() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {} });
  for (const id of ["title", "status", "content", "updated", "refresh"]) nodes.set(id, makeNode());
  const links = ["fleet", "tickets", "notifications"].map(view => ({ ...makeNode(), dataset: { view }, hidden: false, onclick: undefined as any }));
  const requests: any[] = [];
  const intervals: (() => void)[] = [];
  let receive: (event: any) => void;
  const parent = { postMessage: (message: any) => requests.push(message) };
  runInNewContext(WORKSPACE_HTML.match(/<script>([\s\S]*)<\/script>/)![1], {
    document: { getElementById: (id: string) => nodes.get(id), createElement: makeNode, querySelectorAll: () => links, documentElement: { scrollHeight: 300 } },
    window: { parent, addEventListener: (_: string, callback: any) => { receive = callback; } },
    setTimeout: () => 0, clearTimeout() {}, setInterval: (callback: () => void) => { intervals.push(callback); return 0; },
  });
  const output = (view: string) => ({ view, title: view, availableViews: ["tickets", "notifications"], sections: [], attention: [], metrics: [], generatedAt: now.toISOString(), sourceArguments: {} });
  return {
    nodes,
    requests,
    tick: () => intervals.forEach(callback => callback()),
    publish: (view: string) => receive!({ source: parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: output(view) } } }),
    click: (view: string) => links.find(link => link.dataset.view === view)!.onclick({ preventDefault() {} }),
    reply: async (view: string, failed = false) => {
      const sent = requests.find(message => message.params?.arguments?.view === view);
      receive!({ source: parent, data: { jsonrpc: "2.0", id: sent.id, result: failed ? { isError: true } : { structuredContent: output(view) } } });
      await Promise.resolve();
    },
  };
}
describe("VNDRLY workspace presentation", () => {
  it("shows an exact sourced driving estimate or its honest unavailable state", () => {
    const runId="17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
    expect(workspaceRequest({view:"fleet_eta",runId})).toMatchObject({sourceTool:"query_fleet_run_eta",sourceArguments:{runId}});
    expect(()=>workspaceRequest({view:"fleet_eta"})).toThrow();
    const estimate={ok:true,runId,stopId:runId,siteId:392,siteName:"Synthetic well",provider:"mapbox",trafficAware:true,routeConfidence:"medium",distanceMiles:12,durationMinutes:20,estimatedAt:now.toISOString(),source:"driver_phone",sourceRecordedAt:now.toISOString(),sourceReceivedAt:now.toISOString(),sourceAccuracyMeters:10,truckSafeRouting:false,physicalProofVerified:false};
    const result=workspaceOutput("fleet_eta","query_fleet_run_eta",{runId},estimate,now);
    expect(result.sections[0].rows[0].detail).toContain("12 miles");
    expect(result.sections[0].rows[1].title).toBe("Driver-phone source");
    expect(result.attention[0].detail).toContain("Not verified truck-safe");
    const unavailable=workspaceOutput("fleet_eta","query_fleet_run_eta",{runId},{ok:false,runId,code:"fleet.eta_run_paused",truckSafeRouting:false,physicalProofVerified:false},now);
    expect(unavailable.sections[0].rows[0].title).toBe("The run is paused.");
    expect(()=>workspaceOutput("fleet_eta","query_fleet_run_eta",{runId:"afafd3ab-bca4-4949-a3db-768ae3b31f10"},estimate,now)).toThrow();
    expect(()=>workspaceOutput("fleet_eta","query_field_trip_eta",{runId},estimate,now)).toThrow();
    expect(WORKSPACE_HTML).toContain("Request driving estimate");
  });
  it("selects canonical Fleet sources and requires an exact run identity", () => {
    expect(workspaceRequest({ view: "fleet" }, new Set(["query_fleet_briefing"])).sourceTool).toBe("query_fleet_briefing");
    expect(workspaceRequest({ view: "fleet_dispatch" }).sourceTool).toBe("query_fleet_resources");
    expect(workspaceRequest({ view: "fleet_map", limit: 20, cursor: "20:40" }).sourceArguments).toEqual({limit: 20, cursor: "20:40"});
    expect(() => workspaceRequest({ view: "fleet_map", cursor: "forged" })).toThrow();
    expect(() => workspaceRequest({ view: "fleet_map", limit: 500 })).toThrow();
    expect(() => workspaceRequest({ view: "fleet_run", runId: "all" })).toThrow();
  });
  it("keeps maintenance holds visible without claiming repair releases them", () => {
    const record = {id:"16b9e6dd-c2ea-44eb-82f4-2698199d92a1",companyId:1107,fleetId:"16b9e6dd-c2ea-44eb-82f4-2698199d92a2",assetId:"16b9e6dd-c2ea-44eb-82f4-2698199d92a3",runId:null,kind:"defect",title:"Synthetic defect",status:"repair_recorded",version:3,dueAt:null,holdId:"16b9e6dd-c2ea-44eb-82f4-2698199d92a4",events:[],allowedActions:[]};
    expect(workspaceRequest({view:"fleet_maintenance"}).sourceTool).toBe("query_fleet_maintenance");
    expect(workspaceRequest({view:"fleet_maintenance",cursor:"200",limit:10}).sourceArguments).toEqual({cursor:"200",limit:10});
    expect(()=>workspaceRequest({view:"fleet_maintenance",cursor:"20:40"})).toThrow();
    const output=workspaceOutput("fleet_maintenance","query_fleet_maintenance",{},{records:[record],nextCursor:null},now);
    expect(output.attention[0].attention).toContain("repair notes alone do not release");
    expect(output.sections[0].rows[0].detail).not.toContain("permitted: release");
    expect(()=>workspaceOutput("fleet_maintenance","query_fleet_maintenance",{},{},now)).toThrow("Incomplete");
  });
  it("renders sourced report totals separately by unit and preserves redacted fuel", () => {
    const data={generatedAt:now.toISOString(),filters:{},source:"recorded_fleet_events",dateBasis:"run_created_at",runCount:2,completedRunCount:1,submittedRunCount:1,inspectionExceptions:0,loadTotals:[{commodity:"Water",unit:"barrels",quantity:10,deliveredQuantity:10},{commodity:"Water",unit:"gallons",quantity:5,deliveredQuantity:0}],distanceTotals:[{unit:"miles",distance:10},{unit:"km",distance:8}],fuelTotals:null,unavailableMetrics:[{metric:"Vehicle telemetry",reason:"Not configured"}]};
    const output=workspaceOutput("fleet_reports","query_fleet_report",{},data,now);
    expect(output.sections[1].rows.map(row=>row.title)).toEqual(["Water · barrels","Water · gallons"]);
    expect(output.sections[2].rows.map(row=>row.title)).toEqual(["miles","km"]);
    expect(output.sections[3].empty).toContain("not available under this grant");
    expect(output.sections[4].rows[0].detail).toBe("Not configured");
    expect(workspaceRequest({view:"fleet_reports",start:now.toISOString()}).sourceArguments).toEqual({startsAt:now.toISOString()});
  });
  it("shows only the Partner's returned site events without disclosing identities or coordinates",()=>{
    expect(workspaceRequest({view:"fleet_site",siteId:392,start:now.toISOString()}).sourceArguments).toEqual({siteId:392,startsAt:now.toISOString()});
    const output=workspaceOutput("fleet_site","query_fleet_site_activity",{siteId:392},{siteName:"Synthetic site",source:"recorded_fleet_events",coordinateDisclosure:false,records:[{vendorName:"Synthetic vendor",status:"in_progress",driverName:"PRIVATE_DRIVER",latitude:35,stops:[{kind:"pickup",events:[{type:"arrive_stop",recordedAt:now.toISOString()}]}],loads:[]}],unavailableMetrics:[]},now);
    expect(JSON.stringify(output)).toContain("arrive_stop");
    expect(JSON.stringify(output)).not.toContain("PRIVATE_DRIVER");
    expect(JSON.stringify(output)).not.toContain("latitude");
    expect(()=>workspaceOutput("fleet_site","query_fleet_site_activity",{}, {records:[],source:"recorded_fleet_events",coordinateDisclosure:true},now)).toThrow("Incomplete");
  });
  it("shows only sourced authorized driver-phone observations and page-scoped counts", () => {
    const run = { id: "16b9e6dd-c2ea-44eb-82f4-2698199d92a1", fleetId: "16b9e6dd-c2ea-44eb-82f4-2698199d92a2", companyId: 1107, title: "Synthetic run", driverUserId: 1073, vehicleAssetId: "16b9e6dd-c2ea-44eb-82f4-2698199d92a3", trailerAssetId: null, siteIds: [392], status: "in_progress", phase: "en_route", version: 4, stops: [{id: "16b9e6dd-c2ea-44eb-82f4-2698199d92a4", siteId: 392, kind: "pickup", sequence: 0}], loads: [], inspections: [], currentStopId: null, visitedStopIds: [], events: [], linkedTicketId: null, allowedActions: ["pause"] };
    const observation = {runId: run.id, source: "driver_phone", latitude: 35, longitude: -97, recordedAt: now.toISOString(), freshness: "stale"};
    const data = {runs: [run], roles: ["driver"], observations: [observation, {...observation, source: "unknown"}, {...observation, runId: "other"}], unavailableIntegrations: ["Vehicle GPS"], page: {nextCursor: "next"}};
    const output = workspaceOutput("fleet_map", "query_fleet_briefing", {}, data, now);
    expect(output.fleetMap?.points).toHaveLength(1);
    expect(output.fleetMap?.points[0]).toMatchObject({label: "Driver phone · Synthetic run", freshness: "stale"});
    expect(output.sections[0].rows[0].runId).toBe(run.id);
    expect(output.metrics.find(metric => metric.label === "Shown in progress")?.value).toBe(1);
    expect(output.attention.some(row => row.title === "More authorized runs available")).toBe(true);
    expect(() => workspaceOutput("fleet", "query_fleet_briefing", {}, {...data, roles: []}, now)).toThrow("unavailable");
    const detail = workspaceOutput("fleet_run", "query_fleet_run_detail", {runId: run.id}, run, now);
    expect(detail.sourceArguments).toEqual({runId: run.id});
    expect(detail.sections.some(section => section.rows.some(row => row.title === "pause"))).toBe(true);
    expect(detail.sections.find(section => section.title === "Draft editing")?.rows).toEqual([]);
    const planned = workspaceOutput("fleet_run", "query_fleet_run_detail", {runId: run.id}, {...run, canEditDraft: true, schedule: {plannedStartAt:"2026-10-07T08:00:00Z",plannedEndAt:"2026-10-07T16:00:00Z",timezone:"America/Chicago"}, operationalProfile:{name:"Synthetic profile",inspectionItems:[{id:"brakes",label:"Brake check",required:true}],manifestFields:[]}}, now);
    expect(planned.sections.find(section => section.title === "Draft editing")?.rows[0].title).toBe("Draft edits permitted");
    expect(planned.sections.find(section => section.title === "Saved operational requirements")?.rows[0].title).toBe("Brake check");
    expect(planned.sections.find(section => section.title === "Planned hours")?.rows[0].detail).toContain("does not end duty automatically");
  });
  it("shows only the canonical inventory projection and highlights missing assets", () => {
    expect(workspaceRequest({ view: "inventory" })).toMatchObject({ sourceTool: "query_asset_custody", sourceArguments: {} });
    const output = workspaceOutput("inventory", "query_asset_custody", {}, { assets: [{ name: "Test truck", status: "checked_out", currentHolderDisplayName: "User 7", condition: "missing", privateTelemetry: "secret" }] }, now);
    expect(output.sections[0].rows[0]).toMatchObject({ title: "Test truck", attention: "missing" });
    expect(output.sections[0].rows[0].detail).toContain("User 7");
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(() => workspaceOutput("inventory", "query_asset_custody", {}, {}, now)).toThrow("Incomplete inventory");
  });
  it("labels fleet package capabilities unavailable without inventing truck positions", () => {
    const output = workspaceOutput("fleet", "query_field_trips", {}, { trips: [] }, now);
    expect(output.sections[1]).toMatchObject({ title: "VENDRY Fleet" });
    expect(output.sections[1].rows[0].detail).toContain("not connected yet");
    expect(output.fleetMap?.points).toEqual([]);
  });
  it("refreshes an initially host-rendered Fleet panel without overlapping a pending refresh", async () => {
    const ui = workspaceHarness();
    ui.publish("fleet");
    ui.tick();
    ui.tick();
    expect(ui.requests.filter(message => message.method === "tools/call")).toHaveLength(1);
    await ui.reply("fleet");
    ui.tick();
    expect(ui.requests.filter(message => message.method === "tools/call")).toHaveLength(2);
  });
  it("refreshes the recorded Fleet Map through the same authorized view", () => {
    const ui = workspaceHarness();
    ui.publish("fleet_map");
    ui.tick();
    expect(ui.requests.find(message => message.method === "tools/call")?.params.arguments.view).toBe("fleet_map");
  });
  it("does not let Fleet polling override a newer panel while navigation is pending", async () => {
    const ui = workspaceHarness();
    ui.click("fleet");
    await ui.reply("fleet");
    ui.click("tickets");
    ui.tick();
    expect(ui.requests.filter(message => message.method === "tools/call").map(message => message.params.arguments.view)).toEqual(["fleet", "tickets"]);
    await ui.reply("tickets");
    expect(ui.nodes.get("title").textContent).toBe("tickets");
  });
  it("keeps the latest selected panel when older requests finish afterward", async () => {
    const ui = workspaceHarness();
    ui.click("tickets");
    ui.click("notifications");
    await ui.reply("notifications");
    expect(ui.nodes.get("title").textContent).toBe("notifications");
    await ui.reply("tickets");
    expect(ui.nodes.get("title").textContent).toBe("notifications");
  });
  it("does not overwrite a newer panel with an older request failure", async () => {
    const ui = workspaceHarness();
    ui.click("tickets");
    ui.click("notifications");
    await ui.reply("notifications");
    await ui.reply("tickets", true);
    expect(ui.nodes.get("title").textContent).toBe("notifications");
    expect(ui.nodes.get("status").textContent).toBe("");
  });
  it("maps only returned reliable positions and preserves freshness states", () => {
    const output = workspaceOutput("fleet", "query_field_trips", {}, { trips: [{ driverName: "Synthetic Driver", vehicleName: "Truck", presenceState: "on_site", trackingState: "active", freshness: "stale", recordedAt: now.toISOString(), location: { latitude: 35, longitude: -97 } }, { driverName: "Redacted Driver", presenceState: "en_route", freshness: "redacted", location: null }] }, now);
    expect(output.fleetMap?.points).toEqual([expect.objectContaining({ label: "Truck · Synthetic Driver", freshness: "stale" })]);
    expect(output.attention).toHaveLength(1);
    expect(workspaceRequest({ view: "fleet" }).sourceTool).toBe("query_field_trips");
    expect(() => workspaceOutput("fleet", "query_field_trips", {}, {}, now)).toThrow("Incomplete");
  });
  it("shows authorized ticket statuses without inventing age or tracking claims", () => {
    const output = workspaceOutput("tickets", "query_tickets", {}, { tickets: [{ id: 42, status: "kicked_back", createdAt: "2026-10-01T12:00:00Z" }, { id: 43, status: "approved" }] }, now);
    expect(output.attention).toEqual([expect.objectContaining({ title: "Ticket 42", attention: "Returned for changes" })]);
    expect(JSON.stringify(output)).not.toMatch(/stale|tracking/i);
    expect(workspaceRequest({ view: "tickets" }).sourceTool).toBe("query_tickets");
    expect(() => workspaceOutput("tickets", "query_tickets", {}, {}, now)).toThrow("Incomplete");
  });
  it("uses canonical personal notification rows and rejects incomplete responses", () => {
    const output = workspaceOutput("notifications", "query_notifications", {}, { rows: [{ title: "<script>text</script>", body: "Meeting scheduled", createdAt: now.toISOString() }] }, now);
    expect(output.sections[0].rows[0].title).toBe("<script>text</script>");
    expect(workspaceRequest({ view: "notifications" }).sourceArguments).toEqual({ limit: 50, unreadOnly: true });
    expect(() => workspaceOutput("notifications", "query_notifications", {}, {}, now)).toThrow("Incomplete");
  });
  it("shows canonical onboarding steps without private payload fields", () => {
    const output = workspaceOutput("onboarding", "lookup_user_progress", {}, { progress: { orgType: "vendor", currentStep: "branding", completedSteps: ["company-basics"], skippedSteps: [], payload: { taxId: "private-tax-value" } } }, now);
    expect(output.sections[0].rows.find(row => row.title === "Vendor branding")).toMatchObject({ detail: "Current step" });
    expect(output.sections[0].rows.some(row => row.detail === "Completed")).toBe(true);
    expect(JSON.stringify(output)).not.toContain("private-tax-value");
    expect(workspaceRequest({ view: "onboarding" }).sourceTool).toBe("lookup_user_progress");
    expect(() => workspaceOutput("onboarding", "lookup_user_progress", {}, {}, now)).toThrow("Incomplete");
    expect(workspaceOutput("onboarding", "lookup_user_progress", {}, { progress: null }, now).sections[0].rows).toEqual([]);
  });
  it("projects canonical nested calendar meetings", () => {
    const output = workspaceOutput("work_calendar", "get_work_hub_calendar", {}, { tasks: [], shifts: [], meetings: [{ item: { meeting: { title: "Safety briefing" }, occurrence: { startsAt: now.toISOString() } } }] }, now);
    expect(output.sections[1].rows[0]).toMatchObject({ title: "Safety briefing", time: now.toISOString() });
  });
  it("reports display limits and rejects incomplete selected-gate results", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: Array.from({ length: 51 }, () => ({ title: "Task" })), shifts: [], meetings: [] }, now);
    expect(output.sections[1].rows).toHaveLength(50);
    expect(output.attention[0].detail).toContain("50 of 51");
    expect(() => workspaceOutput("gate_board", "query_gate_change_over", {}, {}, now)).toThrow("Incomplete");
  });
  it("rejects arbitrary views, invalid gate identifiers and excessive calendar windows", () => {
    expect(() => workspaceRequest({ view: "arbitrary_tool" })).toThrow();
    expect(() => workspaceRequest({ view: "gate_board", stationId: "untrusted" })).toThrow();
    expect(() => workspaceRequest({ view: "gate_board", siteId: -1 })).toThrow();
    expect(() => workspaceRequest({ view: "work_calendar", start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z" })).toThrow();
    expect(workspaceRequest({ view: "my_workday", sourceTool: "delete_records" })).toEqual({ view: "my_workday", sourceTool: "get_work_hub_briefing", sourceArguments: {} });
  });
  it("flags only announcements requiring acknowledgement", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: [], shifts: [], meetings: [], announcements: [{ announcement: { title: "FYI", acknowledgementRequired: false }, recipient: {} }, { announcement: { title: "Required", acknowledgementRequired: true }, recipient: {} }] }, now);
    expect(output.attention.map(row => row.title)).toEqual(["Required"]);
  });
  it("marks overdue open tasks without marking completed tasks overdue", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: [{ title: "Open", dueAt: "2026-10-04T12:00:00Z", status: "open" }, { title: "Done", dueAt: "2026-10-04T12:00:00Z", status: "completed" }], shifts: [], meetings: [], announcements: [] }, now);
    expect(output.attention.map(row => row.title)).toEqual(["Open"]);
    expect(output.sections[1].rows).toHaveLength(2);
  });
  it("preserves empty results but rejects canonical tool failures", () => {
    expect(workspaceOutput("work_calendar", "get_work_hub_calendar", {}, { shifts: [], meetings: [], tasks: [] }, now).sections.every(section => section.rows.length === 0)).toBe(true);
    expect(() => workspaceOutput("my_workday", "get_work_hub_briefing", {}, { error: "Not authorized" }, now)).toThrow();
  });
  it("never creates shift counts when no gate shift is active", () => {
    const output = workspaceOutput("gate_board", "query_gate_change_over", { stationId: "gate" }, { station: { name: "North Gate" }, shift: null, snapshot: null, items: [], roster: [] }, now);
    expect(output.metrics).toEqual([]);
    expect(output.sections[0].empty).toContain("unavailable");
  });
  it("keeps visitor and employee record counts separate and shows source exceptions", () => {
    const output = workspaceOutput("gate_board", "query_gate_change_over", {}, { station: { name: "Gate" }, shift: { started_at: now.toISOString() }, snapshot: { generatedAt: now.toISOString(), metrics: { onSiteVisitorRecords: 2, onSiteEmployeeRecords: 3 }, outstanding: [{ name: "Fixture driver", plate: "TEST" }], exceptions: [{ text: "Visit exceeds its expected duration." }] }, items: [] }, now);
    expect(output.metrics).toEqual([{ label: "Visitor records on site", value: 2 }, { label: "Employee records on site", value: 3 }]);
    expect(output.attention[0].title).toContain("expected duration");
    expect(output.sections[1].rows[0].title).toBe("Fixture driver");
  });
  it("does not propagate credential-like or unrelated fields into display data", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: [{ title: "<img src=x onerror=alert(1)>", password: "secret", token: "secret" }], shifts: [], meetings: [], announcements: [], token: "secret" }, now);
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(output.sections[1].rows[0].title).toContain("<img");
    expect(WORKSPACE_HTML).not.toContain("innerHTML");
  });
});


it("shows continuous custody age without guessing unknown checkout dates", () => {
  const result = workspaceOutput("inventory", "query_asset_custody", {}, { assets: [
    { name: "Old kit", holderUserId: 7, custodyDays: 91, status: "checked_out" },
    { name: "Unknown kit", holderUserId: 8, custodyDays: null, status: "checked_out" },
  ] }, now);
  expect(result.sections[0].rows[0]).toMatchObject({ attention: "Checked out longer than 90 days" });
  expect(result.sections[0].rows[0].detail).toContain("91 days");
  expect(result.sections[0].rows[1].detail).toContain("Checkout date unknown");
});
