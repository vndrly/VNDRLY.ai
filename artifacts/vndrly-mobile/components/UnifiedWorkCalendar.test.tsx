import React from "react";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {normalizeUnifiedCalendar} from "@/lib/unified-work-calendar";
const state=vi.hoisted(()=>({result:{} as any,push:vi.fn(),fetch:vi.fn(),refetch:vi.fn(),language:"en"}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:state.language}})}));
vi.mock("expo-router",()=>({useRouter:()=>({push:state.push})}));
vi.mock("@/lib/use-unified-work-calendar",()=>({useUnifiedWorkCalendar:()=>state.result}));
vi.mock("@/lib/api",()=>({apiFetch:(path:string)=>state.fetch(path)}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:1,vendorId:7},activeMembershipId:1})}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({primary:"cyan",foreground:"white",card:"black",mutedForeground:"grey",border:"grey"})}));
vi.mock("./TogglePillButton",()=>({default:({children,onPress,disabled,accessibilityLabel}:{children:React.ReactNode;onPress:()=>void;disabled?:boolean;accessibilityLabel?:string})=><button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>}));
vi.mock("./ForemanScheduleTicketsModal",()=>({default:()=> <div>Existing field scheduling</div>}));
vi.mock("./ShiftScheduling",()=>({default:()=> <div>Existing shift scheduling</div>}));
vi.mock("./MeetingScheduling",()=>({default:()=> <div>Existing meeting scheduling</div>}));
import UnifiedWorkCalendar from "./UnifiedWorkCalendar";
const day=new Date(2026,9,13,12),start=day.toISOString();
beforeEach(()=>{state.result={data:{items:normalizeUnifiedCalendar({tickets:{tickets:[{id:5,scheduledStartAt:start,scheduledDurationMinutes:60,workTypeName:"Synthetic repair"}]}}),capabilities:{fieldTicket:true,fleetRun:true,shift:true,meeting:true},unavailable:[]},isPending:false,isError:false,refetch:state.refetch};state.push.mockClear();state.fetch.mockClear();});afterEach(cleanup);
it("opens a canonical scheduled ticket and shows the shared daily count",()=>{render(<UnifiedWorkCalendar initialDate={day}/>);fireEvent.click(screen.getByText("Synthetic repair"));expect(state.push).toHaveBeenCalledWith("/ticket/5");expect(screen.getByText(/Tuesday, October 13 · 1 scheduled records/)).toBeTruthy();expect(state.fetch).not.toHaveBeenCalled();});
it("has one explicit Schedule menu that opens existing forms and Fleet workspace",()=>{render(<UnifiedWorkCalendar initialDate={day}/>);expect(screen.queryByText("Existing field scheduling")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Schedule"}));fireEvent.click(screen.getByRole("button",{name:"Field ticket"}));expect(screen.getByText("Existing field scheduling")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Schedule"}));fireEvent.click(screen.getByRole("button",{name:"Fleet run"}));expect(state.push).toHaveBeenCalledWith("/fleet");expect(state.fetch).not.toHaveBeenCalled();});
it("does not offer scheduling without current capabilities and reports partial source failure",()=>{state.result.data.capabilities={fieldTicket:false,fleetRun:false,shift:false,meeting:false};state.result.data.unavailable=["fleet"];render(<UnifiedWorkCalendar initialDate={day}/>);expect(screen.queryByRole("button",{name:"Schedule"})).toBeNull();expect(screen.getByText(/Some schedules could not load: fleet/)).toBeTruthy();});
it("labels weekdays and returns to the current day after navigating months",()=>{
 render(<UnifiedWorkCalendar initialDate={day}/>);
 for(const name of ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]) expect(screen.getByText(name)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Next month"}));
 expect(screen.getByText("November 2026")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Today"}));
 expect(screen.getByText(new Date().toLocaleDateString([],{weekday:"long",month:"long",day:"numeric"})+" · 0 scheduled records")).toBeTruthy();
});

it("identifies an immediate dispatch, assigned driver and canonical ticket without claiming shift hours",()=>{
 state.result.data.items=normalizeUnifiedCalendar({fleet:{runs:[{id:"activity",title:"Crude haul",status:"dispatched",driverUserId:27,linkedTicketId:601,labels:{driverName:"Bob Villa"},schedule:null,events:[{type:"dispatch",recordedAt:start}]}]}});render(<UnifiedWorkCalendar initialDate={day}/>);
 expect(screen.getByText("Dispatch recorded · no planned time")).toBeTruthy();expect(screen.getByText("Bob Villa")).toBeTruthy();expect(screen.getByText("Ticket #601")).toBeTruthy();fireEvent.click(screen.getByText("Crude haul"));expect(state.push).toHaveBeenCalledWith("/fleet-run/activity");
});
it("uses Spanish for the new weekday labels and Today control",()=>{
 state.language="es";render(<UnifiedWorkCalendar initialDate={day}/>);
 expect(screen.getByText("dom")).toBeTruthy();expect(screen.getByText("sáb")).toBeTruthy();
 expect(screen.getByRole("button",{name:"Hoy"})).toBeTruthy();state.language="en";
});
