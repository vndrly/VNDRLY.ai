import React from "react";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {FleetRunSchema} from "@workspace/api-zod";
const mocks=vi.hoisted(()=>({api:vi.fn(),uuid:0}));
vi.mock("@/lib/api",()=>({apiFetch:mocks.api}));
vi.mock("@/lib/auth",()=>({captureAuthScope:()=>({generation:1}),isAuthScopeCurrent:()=>true}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("expo-crypto",()=>({randomUUID:()=>`10000000-0000-4000-8000-${String(++mocks.uuid).padStart(12,"0")}`}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetCargo from "./FleetCargo";
const id=(prefix:number)=>`${prefix}0000000-0000-4000-8000-000000000001`;
const run=FleetRunSchema.parse({id:id(2),fleetId:id(6),companyId:609,title:"Synthetic source",driverUserId:1,vehicleAssetId:id(3),trailerAssetId:null,status:"in_progress",phase:"paused",version:4,stops:[{id:id(4),siteId:392,kind:"pickup",sequence:0}],siteIds:[392],loads:[{id:id(5),pickupStopId:id(4),deliveryStopId:null,commodity:"Synthetic sand",quantity:10,unit:"tons",manifestReference:"SYN-01",deliveryReference:null,recordedByUserId:1,recordedAt:"2026-10-07T12:00:00Z",deliveredAt:null,source:"user_report"}],inspections:[],records:[],events:[],currentStopId:id(4),visitedStopIds:[],linkedTicketId:null,allowedActions:[]});
const target={...run,id:id(7),driverUserId:2,title:"Synthetic recipient",version:9,loads:[],stops:[...run.stops,{id:id(8),siteId:393,kind:"delivery" as const,sequence:1}],siteIds:[392,393]};
function record(body:any){return {id:id(9),companyId:609,sourceRunId:run.id,targetRunId:target.id,sourceLoadId:id(5),targetLoadId:body.targetLoadId??id(1),targetDeliveryStopId:id(8),siteId:392,quantity:10,unit:"tons",commodity:"Synthetic sand",reason:body.reason??"Synthetic transfer",sourceDriverUserId:1,targetDriverUserId:2,sourceRunVersion:5,targetRunVersion:10,version:1,status:"proposed",sourceAcknowledgedBy:null,targetAcknowledgedBy:null,recordedAt:"2026-10-07T12:00:00Z",completedAt:null,originalCapture:{manifestReference:"SYN-01",recordedAt:"2026-10-07T12:00:00Z",recordedByUserId:1,source:"user_report"},events:[{operationId:body.operationId??id(1),action:"propose",actorUserId:1,recordedAt:"2026-10-07T12:00:00Z",notes:"Synthetic transfer"}],source:"user_report",physicalHandoffVerified:false,inventoryCustodyChanged:false,allowedActions:["acknowledge_source"]};}
afterEach(()=>{cleanup();mocks.api.mockReset();mocks.uuid=0;});
it("uses current authorized run revisions for dispatcher cancellation after runs changed",async()=>{
 const current={...record({}),allowedActions:["cancel"]};const changed=vi.fn();
 mocks.api.mockImplementation(async(path,options)=>{if(path.endsWith("/actions")){const body=JSON.parse(options.body);return {...current,status:"cancelled",events:[...current.events,{operationId:body.operationId,action:"cancel",actorUserId:3,recordedAt:"2026-10-07T12:01:00Z",notes:body.notes}]};}if(path===`/api/fleet/runs/${run.id}`)return {...run,version:20};if(path===`/api/fleet/runs/${target.id}`)return {...target,version:30};if(path.endsWith("cargo-transfers"))return {runId:run.id,transfers:[current]};return current;});
 render(<FleetCargo run={run} canDispatch={true} disabled={false} onChanged={changed}/>);fireEvent.click(screen.getByRole("button",{name:"Read run cargo transfers"}));await screen.findByLabelText("Cargo action notes");fireEvent.change(screen.getByLabelText("Cargo action notes"),{target:{value:"Synthetic cancellation"}});fireEvent.click(screen.getByRole("button",{name:"cancel"}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));const post=mocks.api.mock.calls.find(call=>call[0].endsWith("/actions"))!;expect(JSON.parse(post[1].body)).toMatchObject({sourceExpectedVersion:20,targetExpectedVersion:30});
});
it("acknowledges own side through transfer authority without reading the other driver's run",async()=>{
 const current=record({}),changed=vi.fn();
 mocks.api.mockImplementation(async(path,options)=>{
  if(path.includes("/runs/")&&!path.endsWith("cargo-transfers"))throw Object.assign(new Error("Other run forbidden"),{status:403});
  if(path.endsWith("/actions")){const body=JSON.parse(options.body);return {...current,events:[...current.events,{operationId:body.operationId,action:body.action,actorUserId:1,recordedAt:"2026-10-07T12:01:00Z",notes:body.notes}]};}
  if(path.endsWith("cargo-transfers"))return {runId:run.id,transfers:[current]};return current;
 });
 render(<FleetCargo run={run} canDispatch={false} disabled={false} onChanged={changed}/>);
 fireEvent.click(screen.getByRole("button",{name:"Read run cargo transfers"}));await screen.findByLabelText("Cargo action notes");
 fireEvent.change(screen.getByLabelText("Cargo action notes"),{target:{value:"Synthetic own acknowledgement"}});fireEvent.click(screen.getByRole("button",{name:"acknowledge_source"}));
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
 const post=mocks.api.mock.calls.find(call=>call[0].endsWith("/actions"))!;expect(JSON.parse(post[1].body)).toMatchObject({action:"acknowledge_source",sourceExpectedVersion:5,targetExpectedVersion:10,expectedVersion:1});
 expect(mocks.api.mock.calls.some(call=>call[0]===`/api/fleet/runs/${target.id}`)).toBe(false);
});
it("shows only server allowed own-side actions, with online-only boundaries",async()=>{
 mocks.api.mockResolvedValue({runId:run.id,transfers:[record({})]});
 render(<FleetCargo run={run} canDispatch={false} disabled={false} onChanged={()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:"Read run cargo transfers"}));
 expect(await screen.findByRole("button",{name:"acknowledge_source"})).toBeTruthy();
 expect(screen.queryByRole("button",{name:"acknowledge_target"})).toBeNull();expect(screen.queryByRole("button",{name:"complete"})).toBeNull();expect(screen.queryByLabelText("Recipient run ID")).toBeNull();
 expect(screen.getByText(/Online only/)).toBeTruthy();
});
it("preserves both exact run versions and resolves a lost proposal response by operation ID",async()=>{
 let saved:any=null;const changed=vi.fn();
 mocks.api.mockImplementation(async(path,options)=>{if(path==="/api/fleet/cargo-transfers"){saved=record(JSON.parse(options.body));throw new Error("Response lost");}if(path.endsWith("cargo-transfers"))return {runId:run.id,transfers:saved?[saved]:[]};return target;});
 render(<FleetCargo run={run} canDispatch={true} disabled={false} onChanged={changed}/>);
 fireEvent.change(screen.getByLabelText("Recipient run ID"),{target:{value:target.id}});fireEvent.click(screen.getByRole("button",{name:"Read authorized recipient run"}));await screen.findByText(/Synthetic recipient/);
 fireEvent.click(screen.getByRole("button",{name:/Synthetic sand/}));fireEvent.click(screen.getByRole("button",{name:/2. delivery/}));fireEvent.change(screen.getByLabelText("Cargo transfer reason"),{target:{value:"Synthetic transfer"}});fireEvent.click(screen.getByRole("button",{name:"Propose full-load cargo handoff"}));
 await screen.findByText("Response lost");const post=mocks.api.mock.calls.find(call=>call[0]==="/api/fleet/cargo-transfers")!;expect(JSON.parse(post[1].body)).toMatchObject({sourceExpectedVersion:4,targetExpectedVersion:9,quantity:10});expect(changed).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Verify and retry exact cargo operation"}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));expect(mocks.api.mock.calls.filter(call=>call[0]==="/api/fleet/cargo-transfers")).toHaveLength(1);
});
