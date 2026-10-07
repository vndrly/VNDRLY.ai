import React from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({apiFetch:api}));
vi.mock("@/lib/auth",()=>({captureAuthScope:()=>({generation:1}),isAuthScopeCurrent:()=>true}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetReviewPacket from "./FleetReviewPacket";
const id="20000000-0000-4000-8000-000000000001",loadId="50000000-0000-4000-8000-000000000001";
const run:any={id,version:4,loads:[{id:loadId,manifestReference:"SYN-01"}]};
const packet={runId:id,runVersion:4,status:"in_progress",requirements:[{id:"receipt",label:"Actual scale receipt",kind:"scale",scope:"each_load",required:true,loadId,evidenceIds:[],missing:true}],missingRequiredCount:1,readyForOperationalReview:false,inspectionComplete:true,manifestComplete:true,closeoutRecordsComplete:true,inspectionExceptions:0,undeliveredLoadCount:0,source:"recorded_fleet_records",physicalProofVerified:false,signatureIdentityVerified:false,limitations:[]};
afterEach(()=>{cleanup();api.mockReset();});
it("shows missing inspection and closeout records even when no required media is missing",async()=>{
 api.mockResolvedValue({...packet,requirements:[],missingRequiredCount:0,inspectionComplete:false,manifestComplete:true,closeoutRecordsComplete:false});render(<FleetReviewPacket run={run} disabled={false}/>);fireEvent.click(screen.getByRole("button",{name:"Read current Fleet review packet"}));expect(await screen.findByText(/Recorded inspection: Incomplete.*Recorded manifests: Complete.*Recorded closeout requirements: Incomplete/)).toBeTruthy();expect(screen.getByText("Missing required evidence: 0")).toBeTruthy();expect(screen.getByText("Recorded requirements are incomplete")).toBeTruthy();
});
it("does not claim optional empty evidence has a saved association",async()=>{
 api.mockResolvedValue({...packet,requirements:[{...packet.requirements[0],required:false,missing:false}],missingRequiredCount:0,readyForOperationalReview:true});render(<FleetReviewPacket run={run} disabled={false}/>);fireEvent.click(screen.getByRole("button",{name:"Read current Fleet review packet"}));expect(await screen.findByText(/No saved association \(optional\)/)).toBeTruthy();expect(screen.queryByText(/Saved association present/)).toBeNull();
});
it("shows exact missing saved associations without physical proof or write claims",async()=>{
 api.mockResolvedValue(packet);render(<FleetReviewPacket run={{...run,operationalProfile:{name:"Synthetic profile",inspectionItems:[],manifestFields:[],evidenceRequirements:[{id:"receipt",label:"Actual scale receipt",kind:"scale",scope:"each_load",required:true}]}}} disabled={false}/>);expect(screen.getByText(/Required saved association: Actual scale receipt/)).toBeTruthy();expect(screen.queryByText(/Missing required evidence/)).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Read current Fleet review packet"}));
 expect(await screen.findByText("Missing required evidence: 1")).toBeTruthy();expect(screen.getByText(/Actual scale receipt/)).toBeTruthy();expect(screen.getByText(/For each recorded load.*SYN-01/)).toBeTruthy();expect(screen.getByText("Recorded requirements are incomplete")).toBeTruthy();expect(api.mock.calls.every(call=>!call[1]?.method)).toBe(true);
});
it("refuses a different version instead of displaying stale readiness",async()=>{
 api.mockResolvedValue({...packet,runVersion:5,missingRequiredCount:0,readyForOperationalReview:true});render(<FleetReviewPacket run={run} disabled={false}/>);fireEvent.click(screen.getByRole("button",{name:"Read current Fleet review packet"}));expect(await screen.findByText("This run changed. Refresh before reading its review packet.")).toBeTruthy();expect(screen.queryByText("Recorded requirements ready for operational review")).toBeNull();
});
