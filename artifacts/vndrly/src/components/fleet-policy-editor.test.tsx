import React from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import FleetPolicyEditor from "./fleet-policy-editor";
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"en"}})}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:3,activeMembershipId:4}})}));
vi.mock("./png-pill-rollover",()=>({PngPillButton:({children,...props}:React.ComponentProps<"button">)=><button {...props}>{children}</button>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("requires impact preview, retains exact activation on lost response and invalidates preview after a change",async()=>{
 const sent:any[]=[],fetch=vi.fn(async(path:string,init?:RequestInit)=>{
  if(!init?.body)return {ok:true,json:async()=>({version:0,policies:[]})};
  const input=JSON.parse(String(init.body));sent.push({path,input});
  if(path.endsWith("/preview"))return {ok:true,json:async()=>({version:0,mode:input.proposal.mode,existingActivities:2,currentlyRed:1,evaluatedAt:new Date().toISOString(),basis:"recorded_checkpoints_only",existingWorkTreatment:input.proposal.existingWorkTreatment})};
  throw Error("Synthetic lost response");
 });vi.stubGlobal("fetch",fetch);
 render(<FleetPolicyEditor partnerId={9} vendorId={7} serviceId={8}/>);
 expect(fetch).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Future Fleet compliance policy"}));fireEvent.click(screen.getByRole("button",{name:"Load current policy"}));await screen.findByText("Revision: 0");
 fireEvent.change(screen.getByLabelText("Effective from (ISO time with offset)"),{target:{value:"2030-01-01T06:00:00-06:00"}});fireEvent.change(screen.getByLabelText("Partner notice"),{target:{value:"Future synthetic notice"}});
 expect(screen.queryByRole("button",{name:"Activate this future policy"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Preview policy impact"}));await screen.findByText("Recorded activities / red checkpoints: 2 / 1");
 fireEvent.click(screen.getByRole("button",{name:"Activate this future policy"}));await screen.findByText(/Policy request failed/);
 fireEvent.click(screen.getByRole("button",{name:"Activate this future policy"}));await waitFor(()=>expect(sent.filter(s=>s.path.endsWith("/activate"))).toHaveLength(2));
 expect(sent[1].input).toEqual(sent[2].input);expect(sent[1].input.proposal).toMatchObject({scope:{partnerId:9,workTypeId:8},mode:"warn_only",existingWorkTreatment:"preserve_capture_policy"});
 fireEvent.change(screen.getByLabelText("Partner notice"),{target:{value:"Changed notice"}});expect(screen.queryByRole("button",{name:"Activate this future policy"})).toBeNull();
});
