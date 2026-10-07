import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "10000000-0000-4000-8000-000000000001" }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: () => null }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetReports from "./FleetReports";
afterEach(() => { cleanup(); mocks.api.mockReset(); });
it("labels recorded timing and late-vs-plan counts without duty, billing or physical proof",async()=>{
 const report={generatedAt:"2026-10-07T12:00:00Z",filters:{},source:"recorded_fleet_events",dateBasis:"run_created_at",runCount:2,completedRunCount:2,submittedRunCount:0,inspectionExceptions:0,loadTotals:[],distanceTotals:[],fuelTotals:null,unavailableMetrics:[],recordedTiming:{source:"server_recorded_event_times",physicalPresenceVerified:false,contractualTimelinessVerified:false,eligibleRunCount:1,invalidSequenceCount:1,elapsedMinutes:90,pausedMinutes:10,activeMinutes:80,plannedStartCount:1,lateStartCount:1,startOffsetTotalMinutes:5,plannedFinishCount:1,lateFinishCount:0,finishOffsetTotalMinutes:-5}};
 mocks.api.mockImplementation(async path=>path==="/api/fleet/views"?{views:[]}:report);
 render(<FleetReports overview={{fleets:[],runs:[]} as any}/>);fireEvent.click(screen.getByRole("button",{name:"Run authorized report"}));expect(await screen.findByText("Recorded workflow timing")).toBeTruthy();expect(screen.getByText(/Eligible recorded sequences: 1.*Excluded invalid sequences: 1/)).toBeTruthy();expect(screen.getByText(/Recorded starts after plan: 1 \/ 1.*Recorded closeouts after plan: 0 \/ 1/)).toBeTruthy();expect(screen.getByText(/not duty hours, billable time, physical presence/)).toBeTruthy();
});
it("uses exact permitted filters and distinguishes unavailable financial metrics from recorded zero", async () => {
  const id="20000000-0000-4000-8000-000000000001";
  const result = {generatedAt:"2026-10-07T12:00:00Z",filters:{fleetId:id,siteId:392},source:"recorded_fleet_events",dateBasis:"run_created_at",runCount:1,completedRunCount:0,submittedRunCount:0,inspectionExceptions:0,loadTotals:[{commodity:"Synthetic sand",unit:"tons",quantity:5,deliveredQuantity:0}],distanceTotals:[],fuelTotals:null,unavailableMetrics:[{metric:"Live ETA",reason:"No sourced vehicle location"}]};
  mocks.api.mockImplementation(async path=>path === "/api/fleet/views" ? {views:[]} : result);
  render(<FleetReports overview={{fleets:[{id,name:"Approved fleet",siteIds:[392]}],runs:[{labels:{sites:[{siteId:392,name:"Approved site"}]}}]} as any}/>);
  fireEvent.click(screen.getByRole("button",{name:"Approved fleet"}));
  fireEvent.click(screen.getByRole("button",{name:"Approved site"}));
  fireEvent.click(screen.getByRole("button",{name:"Run authorized report"}));
  expect(await screen.findByText("Fuel totals require separate financial read permission.")).toBeTruthy();
  expect(screen.getByText("Live ETA: No sourced vehicle location")).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledWith(`/api/fleet/reports?fleetId=${id}&siteId=392`);
});

it("verifies saved view operation identity rather than a matching name after an interrupted create", async()=>{
  const view={id:"50000000-0000-4000-8000-000000000001",userId:1,companyId:609,version:1,name:"My hauling",filters:{},archived:false,recordedAt:"2026-10-07T12:00:00Z",lastOperationId:"10000000-0000-4000-8000-000000000002"};
  mocks.api.mockImplementation(async(_,options)=>{
    if(!options)return {views:[view]};
    const writes=mocks.api.mock.calls.filter(call=>call[1]?.method==="POST");
    if(writes.length===1)throw new Error("response lost");
    return {...view,lastOperationId:JSON.parse(options.body).operationId};
  });
  render(<FleetReports overview={{fleets:[],runs:[]} as any}/>);
  fireEvent.change(screen.getByLabelText("View name"),{target:{value:"My hauling"}});
  fireEvent.click(screen.getByRole("button",{name:"Save current filters"}));
  fireEvent.click(await screen.findByRole("button",{name:"Verify the exact saved view operation"}));
  await screen.findByRole("button",{name:"Archive saved view"});
  const writes=mocks.api.mock.calls.filter(call=>call[1]?.method==="POST");
  expect(writes).toHaveLength(2);expect(writes[1][1].body).toBe(writes[0][1].body);
});
