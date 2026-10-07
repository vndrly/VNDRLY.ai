import React from "react";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({read:vi.fn(),capture:vi.fn(),submit:vi.fn(),clear:vi.fn(),api:vi.fn()}));
vi.mock("@/lib/api",()=>({apiFetch:mocks.api,getApiBase:()=>"https://vndrly.ai"}));
vi.mock("@/lib/auth",()=>({captureAuthScope:()=>({generation:1}),isAuthScopeCurrent:()=>true,getToken:async()=>"synthetic",subscribeUser:()=>()=>{},subscribeToken:()=>()=>{}}));
vi.mock("@/lib/fleet-evidence-device-native",()=>({readFleetEvidencePending:mocks.read,captureFleetEvidence:mocks.capture,submitFleetEvidencePending:mocks.submit,clearFleetEvidencePending:mocks.clear}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetEvidence from "./FleetEvidence";
const account={userId:1,companyId:609,membershipId:4,sessionVersion:0};
const run:any={id:"20000000-0000-4000-8000-000000000001",companyId:609,driverUserId:1,status:"acknowledged",stops:[],loads:[]};
const pending:any={account,runId:run.id,input:{kind:"photo",notes:"Synthetic image"},asset:{size:3},uploaded:true,finalized:true};
beforeEach(()=>{mocks.read.mockResolvedValue(null);mocks.clear.mockResolvedValue(undefined);});
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("keeps finalized private upload pending until association readback succeeds",async()=>{
 mocks.read.mockResolvedValue(pending);mocks.submit.mockRejectedValue(new Error("Response lost"));
 const changed=vi.fn();render(<FleetEvidence run={run} account={account} disabled={false} onChanged={changed}/>);
 expect(await screen.findByText("Captured upload is pending, not saved Fleet evidence.")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Verify and retry exact Fleet evidence upload"}));
 expect(await screen.findByText("Response lost")).toBeTruthy();expect(changed).not.toHaveBeenCalled();
 expect(screen.queryByText("Fleet evidence association saved and verified.")).toBeNull();
});
it("does not disclose another account's pending notes or expose its retry",async()=>{
 mocks.read.mockResolvedValue({...pending,account:{...account,userId:2},input:{kind:"photo",notes:"Private other notes"}});
 render(<FleetEvidence run={run} account={account} disabled={false} onChanged={()=>{}}/>);
 expect(await screen.findByText(/Another run has an unresolved/)).toBeTruthy();
 expect(screen.queryByText("Private other notes")).toBeNull();expect(screen.queryByRole("button",{name:"Verify and retry exact Fleet evidence upload"})).toBeNull();
});
it("allows authorized metadata reads but never offers manager capture for another driver's run",async()=>{
 mocks.api.mockResolvedValue({runId:run.id,evidence:[]});
 render(<FleetEvidence run={run} account={{...account,userId:2}} disabled={false} onChanged={()=>{}}/>);
 expect(screen.queryByRole("button",{name:"Capture Fleet image"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Read saved Fleet evidence"}));await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(1));
});
