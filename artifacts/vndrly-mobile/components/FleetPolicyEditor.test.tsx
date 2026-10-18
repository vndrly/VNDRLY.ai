import React from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import FleetPolicyEditor from "./FleetPolicyEditor";
const api=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({apiFetch:api}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"en"}})}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:3},activeMembershipId:4})}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({text:"#fff",card:"#333",primary:"#f90"})}));
vi.mock("expo-crypto",()=>({randomUUID:()=>"11111111-1111-4111-8111-111111111111"}));
vi.mock("./TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
vi.mock("./FleetChoiceField",()=>({default:({label,value,options,onChange,disabled}:any)=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{options.map((o:any)=><option key={o.id} value={o.id}>{o.label}</option>)}</select>}));
afterEach(()=>{cleanup();api.mockReset();});
it("previews exact future native policy before activation and preserves the proposal after a transport failure",async()=>{
 const sent:any[]=[];api.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(!init?.body)return {version:0,policies:[]};const input=JSON.parse(String(init.body));sent.push({path,input});
  if(path.endsWith("/preview"))return {version:0,mode:input.proposal.mode,existingActivities:2,currentlyRed:1,evaluatedAt:new Date().toISOString(),basis:"recorded_checkpoints_only",existingWorkTreatment:input.proposal.existingWorkTreatment};throw Error("Synthetic lost response");
 });
 render(<FleetPolicyEditor partnerId={9} vendorId={7} serviceId={8}/>);expect(api).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Future Fleet compliance policy"}));fireEvent.click(screen.getByRole("button",{name:"Load current policy"}));await screen.findByText("Revision: 0");
 fireEvent.change(screen.getByLabelText("Effective from (ISO time with offset)"),{target:{value:"2030-01-01T06:00:00-06:00"}});fireEvent.change(screen.getByLabelText("Partner notice"),{target:{value:"Native future notice"}});
 expect(screen.queryByRole("button",{name:"Activate this future policy"})).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Preview policy impact"}));await screen.findByText("Recorded activities / red checkpoints: 2 / 1");
 fireEvent.click(screen.getByRole("button",{name:"Activate this future policy"}));await screen.findByText(/Policy request failed/);fireEvent.click(screen.getByRole("button",{name:"Activate this future policy"}));await waitFor(()=>expect(sent.filter(s=>s.path.endsWith("/activate"))).toHaveLength(2));expect(sent[1].input).toEqual(sent[2].input);
 fireEvent.change(screen.getByLabelText("Partner notice"),{target:{value:"Changed native notice"}});expect(screen.queryByRole("button",{name:"Activate this future policy"})).toBeNull();
});
