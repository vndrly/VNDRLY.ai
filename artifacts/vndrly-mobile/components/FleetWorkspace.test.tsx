import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn(), membership: 1, actions: [] as any[] }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/fleet-offline-native", () => ({ nativeFleetOffline: { read: async () => ({ actions: mocks.actions }), cache: async () => {}, resolve: async () => {}, enqueue: async () => {} } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, vendorId: 609 }, activeMembershipId: mocks.membership }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "10000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: ({ title }: any) => <h1>{title}</h1> }));
vi.mock("@/components/MapboxNativeMap", () => ({ default: () => <div>Fleet location map</div> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetWorkspace from "./FleetWorkspace";
const overview = { companyId: 609, enabled: true, roles: ["driver"], capabilities: { canDispatch: false, canManage: false, canDrive: true }, fleets: [], runs: [], observations: [], unavailableIntegrations: [], generatedAt: "2026-10-07T12:00:00Z" };
afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.membership = 1; mocks.actions = []; });
describe("mobile Fleet authorization", () => {
  it("saves own acknowledgement using server revision and renders the saved next step without claiming completion", async () => {
    const run = { id: "20000000-0000-4000-8000-000000000001", title: "Synthetic load", version: 4, driverUserId: 1, vehicleAssetId: "30000000-0000-4000-8000-000000000001", trailerAssetId: null, status: "dispatched", allowedActions: ["acknowledge"], currentStopId: null, loads: [], inspections: [], records: [], events: [], stops: [] };
    let accepted = false;
    mocks.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/actions")) { accepted = true; return { ...run, status: "acknowledged", version: 5 }; }
      return { ...overview, runs: [{ ...run, status: accepted ? "acknowledged" : "dispatched", version: accepted ? 5 : 4, allowedActions: accepted ? ["inspect"] : ["acknowledge"] }] };
    });
    render(<FleetWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Synthetic load · dispatched" }));
    fireEvent.click(screen.getByRole("button", { name: "acknowledge" }));
    expect(await screen.findByRole("button", { name: "Synthetic load · acknowledged" })).toBeTruthy();
    const request = mocks.api.mock.calls.find(call => call[0].endsWith("/actions"));
    expect(JSON.parse(request![1].body)).toMatchObject({ expectedVersion: 4, action: "acknowledge", operationId: "10000000-0000-4000-8000-000000000001", source: "user_report" });
    expect(screen.queryByText(/completed/)).toBeNull();
  });
  it("loads driver work without dispatcher roster and labels absent telemetry", async () => {
    mocks.api.mockResolvedValue(overview);
    render(<FleetWorkspace />);
    expect(await screen.findByText("My Fleet Day")).toBeTruthy();
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith("/api/fleet/overview");
    expect(screen.getByText(/No sourced Fleet location/)).toBeTruthy();
    expect(screen.queryByText("Create draft run")).toBeNull();
  });
  it("clears old company records immediately when active membership changes", async () => {
    mocks.api.mockResolvedValueOnce(overview).mockImplementation(() => new Promise(() => {}));
    const view = render(<FleetWorkspace />);
    await screen.findByText("My Fleet Day");
    mocks.membership = 2;
    view.rerender(<FleetWorkspace />);
    expect(screen.queryByText("Active company: 609")).toBeNull();
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  });
});

it("keeps canonical loads separate while proposed queued load enables the next ordered step", async () => {
  const id = "20000000-0000-4000-8000-000000000001", pickup = "40000000-0000-4000-8000-000000000001", delivery = "40000000-0000-4000-8000-000000000002";
  const run = { id, companyId:609, title: "Offline hauling", version:7, driverUserId:1, vehicleAssetId:"30000000-0000-4000-8000-000000000001", trailerAssetId:null, status:"in_progress", phase:"traveling_to_pickup", allowedActions:["arrive_stop"], currentStopId:null, visitedStopIds:[], loads:[], inspections:[], records:[], events:[], siteIds:[392], stops:[{id:pickup,siteId:392,sequence:0,kind:"pickup"},{id:delivery,siteId:392,sequence:1,kind:"delivery"}] };
  const base = { runId:id,companyId:609,driverUserId:1,vehicleAssetId:run.vehicleAssetId,trailerAssetId:null,version:7 };
  mocks.actions = [
    {base,runId:id,state:"unsynced",capturedAt:"2026-10-07T12:00:00Z",input:{action:"arrive_stop",expectedVersion:7,operationId:"10000000-0000-4000-8000-000000000001",stopId:pickup}},
    {base,runId:id,state:"unsynced",capturedAt:"2026-10-07T12:01:00Z",input:{action:"record_load",expectedVersion:8,operationId:"10000000-0000-4000-8000-000000000002",loadId:"50000000-0000-4000-8000-000000000001",commodity:"Synthetic sand",quantity:5,unit:"tons",manifestReference:"SYN-1"}},
  ];
  mocks.api.mockResolvedValue({...overview,runs:[run]});
  render(<FleetWorkspace initialRunId={id}/>);
  expect(await screen.findByText(/Pending device sequence, not accepted by the server/)).toBeTruthy();
  expect((screen.getByRole("button",{name:"depart stop"}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/Synthetic sand:/)).toBeNull();
  expect(mocks.api.mock.calls.some(call => call[1]?.method === "POST")).toBe(false);
});

it("loads an exact authorized device run outside the first overview page",async()=>{
  const id="20000000-0000-4000-8000-000000000010";
  const run={id,companyId:609,title:"Historical authorized run",version:9,driverUserId:1,vehicleAssetId:"30000000-0000-4000-8000-000000000001",trailerAssetId:null,status:"completed",allowedActions:[],currentStopId:null,visitedStopIds:[],loads:[],inspections:[],records:[],events:[],stops:[],siteIds:[]};
  mocks.api.mockImplementation(async path=>path===`/api/fleet/runs/${id}`?run:overview);
  render(<FleetWorkspace initialRunId={id}/>);
  expect(await screen.findByRole("button",{name:"Historical authorized run · completed"})).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledWith(`/api/fleet/runs/${id}`);
  expect(screen.queryByRole("button",{name:"start"})).toBeNull();
});

it("shows only authorized resource projections and submitted runs in the review view",async()=>{
  const resources={drivers:[{userId:1,name:"Synthetic authorized driver",fleetIds:[]}],equipment:[{id:"30000000-0000-4000-8000-000000000001",name:"Synthetic held truck",category:"truck",status:"held",dispatchable:false}]};
  const run=(id:string,title:string,status:string)=>({id,title,status,version:1,driverUserId:1,vehicleAssetId:resources.equipment[0].id,trailerAssetId:null,allowedActions:[],stops:[],loads:[],inspections:[],records:[],events:[],currentStopId:null});
  mocks.api.mockImplementation(async path=>path==="/api/fleet/resources"?resources:{...overview,capabilities:{canDispatch:true,canManage:true,canDrive:false},runs:[run("20000000-0000-4000-8000-000000000001","Review candidate","submitted_for_review"),run("20000000-0000-4000-8000-000000000002","Active work","in_progress")]});
  render(<FleetWorkspace/>);fireEvent.click(await screen.findByRole("button",{name:"Fleet directory / readiness"}));
  expect(screen.getByText(/Synthetic held truck.*Not dispatchable/)).toBeTruthy();
  expect(screen.getByText(/dispatch rechecks qualifications, holds and site access/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Fleet review"}));
  expect(screen.getByRole("button",{name:"Review candidate · submitted for review"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Active work · in progress"})).toBeNull();
  expect(mocks.api.mock.calls.some(call=>call[1]?.method==="POST")).toBe(false);
});
