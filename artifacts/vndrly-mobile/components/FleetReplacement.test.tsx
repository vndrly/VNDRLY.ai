import React from "react";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({api:vi.fn(),uuid:0}));
vi.mock("@/lib/api",()=>({apiFetch:mocks.api}));
vi.mock("@/lib/auth",()=>({captureAuthScope:()=>({generation:1}),isAuthScopeCurrent:()=>true}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("expo-crypto",()=>({randomUUID:()=>`10000000-0000-4000-8000-${String(++mocks.uuid).padStart(12,"0")}`}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetReplacement from "./FleetReplacement";
const id=(prefix:number)=>`${prefix}0000000-0000-4000-8000-000000000001`;
const run:any={id:id(2),companyId:609,driverUserId:1,vehicleAssetId:id(3),trailerAssetId:null,status:"in_progress",phase:"paused",version:4};
function record(body:any){return {id:id(9),companyId:609,runId:run.id,driverUserId:1,priorVehicleAssetId:id(3),priorTrailerAssetId:null,vehicleAssetId:id(4),trailerAssetId:null,runVersion:4,version:1,status:"proposed",reason:body.reason??"Synthetic replacement",proposedByUserId:2,recordedAt:"2026-10-07T12:00:00Z",acceptedAt:null,acceptedByUserId:null,source:"user_report",inventoryCustodyChanged:false,physicalExchangeVerified:false,events:[{operationId:body.operationId??id(1),action:"propose",actorUserId:2,notes:"Synthetic replacement",recordedAt:"2026-10-07T12:00:00Z"}],allowedActions:["accept"]};}
afterEach(()=>{cleanup();mocks.api.mockReset();mocks.uuid=0;});
it("cancels with the current own run revision rather than the old proposal revision",async()=>{
 const current={...record({}),allowedActions:["cancel"]};const changed=vi.fn();
 mocks.api.mockImplementation(async(path,options)=>{if(options?.method){const body=JSON.parse(options.body);return {...current,status:"cancelled",events:[...current.events,{operationId:body.operationId,action:"cancel",actorUserId:2,notes:body.notes,recordedAt:"2026-10-07T12:01:00Z"}]};}if(path===`/api/fleet/runs/${run.id}`)return {...run,version:20,fleetId:id(6),title:"Synthetic run",stops:[{id:id(5),siteId:392,kind:"pickup",sequence:0}],siteIds:[392],loads:[],inspections:[],records:[],events:[],currentStopId:null,visitedStopIds:[],linkedTicketId:null,allowedActions:[]};return {runId:run.id,replacements:[current]};});
 render(<FleetReplacement run={run} canDispatch={true} equipment={[]} disabled={false} onChanged={changed}/>);fireEvent.click(screen.getByRole("button",{name:"Read run replacement proposals"}));await screen.findByLabelText("Replacement action notes");fireEvent.change(screen.getByLabelText("Replacement action notes"),{target:{value:"Synthetic cancel"}});fireEvent.click(screen.getByRole("button",{name:"Cancel equipment replacement proposal"}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));const post=mocks.api.mock.calls.find(call=>call[1]?.method==="POST")!;expect(JSON.parse(post[1].body)).toMatchObject({runExpectedVersion:20,expectedVersion:1});
});
it("shows only canonical own-driver acceptance without roster discovery or automatic resume",async()=>{
 const changed=vi.fn();mocks.api.mockImplementation(async(path,options)=>{if(options?.method){const body=JSON.parse(options.body);return {...record({}),status:"accepted",acceptedByUserId:1,acceptedAt:"2026-10-07T12:01:00Z",runVersion:5,version:2,allowedActions:[],events:[...record({}).events,{operationId:body.operationId,action:"accept",actorUserId:1,notes:body.notes,recordedAt:"2026-10-07T12:01:00Z"}]};}return {runId:run.id,replacements:[record({})]};});
 render(<FleetReplacement run={run} canDispatch={false} equipment={[]} disabled={false} onChanged={changed}/>);
 fireEvent.click(screen.getByRole("button",{name:"Read run replacement proposals"}));await screen.findByLabelText("Replacement action notes");
 expect(screen.queryByRole("button",{name:"Propose equipment replacement"})).toBeNull();expect(screen.queryByRole("button",{name:"Cancel equipment replacement proposal"})).toBeNull();
 fireEvent.change(screen.getByLabelText("Replacement action notes"),{target:{value:"Synthetic own acceptance"}});fireEvent.click(screen.getByRole("button",{name:"Accept assigned equipment replacement"}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
 const post=mocks.api.mock.calls.find(call=>call[1]?.method==="POST")!;expect(JSON.parse(post[1].body)).toMatchObject({expectedVersion:1,runExpectedVersion:4,action:"accept"});expect(mocks.api.mock.calls.some(call=>call[0].includes("/actions")&&JSON.parse(call[1]?.body??"{}").action==="resume")).toBe(false);
});
it("resolves an accepted proposal with its exact operation after a lost response",async()=>{
 let saved:any=null;const changed=vi.fn();mocks.api.mockImplementation(async(path,options)=>{if(options?.method){saved=record(JSON.parse(options.body));throw new Error("Response lost");}return {runId:run.id,replacements:saved?[saved]:[]};});
 render(<FleetReplacement run={run} canDispatch={true} equipment={[{id:id(4),name:"Synthetic replacement truck",category:"truck",status:"checked_out",dispatchable:true}]} disabled={false} onChanged={changed}/>);
 fireEvent.click(screen.getByRole("button",{name:"Replacement truck: Synthetic replacement truck"}));fireEvent.change(screen.getByLabelText("Replacement reason"),{target:{value:"Synthetic replacement"}});fireEvent.click(screen.getByRole("button",{name:"Propose equipment replacement"}));await screen.findByText("Response lost");
 expect(changed).not.toHaveBeenCalled();expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toMatchObject({expectedVersion:4,vehicleAssetId:id(4),trailerAssetId:null});
 fireEvent.click(screen.getByRole("button",{name:"Verify and retry exact replacement operation"}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));expect(mocks.api.mock.calls.filter(call=>call[1]?.method==="POST")).toHaveLength(1);
});
