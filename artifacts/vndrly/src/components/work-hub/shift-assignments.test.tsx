import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {describe,it,expect,vi,beforeEach} from "vitest";
import {ShiftAssignments} from "./shift-assignments";
const state=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("@/lib/work-hub-client",async original=>({...await original<any>(),workHubRequest:state.request}));
vi.mock("@/components/png-pill-rollover",()=>({PngPillButton:({color,children,...props}:any)=><button {...props}>{children}</button>}));
vi.mock("@/hooks/use-brand",()=>({useBrand:()=>({name:"GateGo",primary:"#f1b637"})}));
const shift={id:"one",version:1,title:"Day",pattern:"Main Gate Day",date:"2099-10-25",weekday:0,starts:"06:00",ends:"18:00",startsAt:"2099-10-25T11:00:00.000Z",endsAt:"2099-10-25T23:00:00.000Z",timezone:"America/Chicago",required:1,assignees:[]};
beforeEach(()=>state.request.mockReset().mockResolvedValue({shifts:[shift],people:[{id:7,name:"Gatekeeper One"}],busy:[],readOnly:true}));
function mount(mode:"assign"|"gaps"){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ShiftAssignments owner={{type:"vendor",id:5}} siteId={9} mode={mode}/></QueryClientProvider>);}
describe("assignment views",()=>{
 it("asks before taking an occupied day, cancels cleanly, and stages the reviewed transfer",async()=>{
  const data={shifts:[{...shift,assignees:[8]}],people:[{id:7,name:"Gatekeeper One"},{id:8,name:"Gatekeeper Two"}],busy:[],readOnly:false};
  state.request.mockImplementation(async(_path,options)=>options?.method ? {resource:{changed:1}} : data);
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});
  fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));
  expect(screen.getByRole("alertdialog").textContent).toContain("already assigned to Gatekeeper Two");
  expect(screen.getByRole("alertdialog").textContent).toContain("to Gatekeeper One?");
  expect((screen.getByLabelText("Main Gate Day Sun") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByText("Cancel"));expect(screen.queryByRole("alertdialog")).toBeNull();
  expect((screen.getByLabelText("Main Gate Day Sun") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));fireEvent.click(screen.getByText("Yes Reassign Shift"));
  expect((screen.getByLabelText("Main Gate Day Sun") as HTMLInputElement).checked).toBe(true);
  expect(state.request.mock.calls.every(call=>!call[1]?.method)).toBe(true);
  fireEvent.click(screen.getByText("Review assignments"));expect(screen.getByText(/Transfer Gatekeeper Two → Gatekeeper One:/)).toBeTruthy();
  fireEvent.click(screen.getByText("Save assignments"));await screen.findByText("Assignments saved.");
  expect(JSON.parse(state.request.mock.calls.find(call=>call[1]?.method==="POST")![1].body).payload.changes).toEqual([{id:"one",version:1,addUserId:7,removeUserId:8}]);
 });
 it("requires choosing who to replace when multiple gatekeepers are assigned",async()=>{
  state.request.mockResolvedValue({shifts:[{...shift,required:2,assignees:[8,9]}],people:[{id:7,name:"Gatekeeper One"},{id:8,name:"Gatekeeper Two"},{id:9,name:"Gatekeeper Three"}],busy:[],readOnly:true});
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));
  expect((screen.getByText("Yes Reassign Shift") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Gatekeeper to replace 2099-10-25"),{target:{value:"9"}});
  expect((screen.getByText("Yes Reassign Shift") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByText("Yes Reassign Shift"));fireEvent.click(screen.getByText("Review assignments"));
  expect(screen.getByText(/Transfer Gatekeeper Three → Gatekeeper One:/)).toBeTruthy();
  expect(state.request.mock.calls.every(call=>!call[1]?.method)).toBe(true);
 });
 it("reviews removal and replacement before issuing a mocked save",async()=>{
  const data={shifts:[{...shift,assignees:[7]}],people:[{id:7,name:"Gatekeeper One"},{id:8,name:"Gatekeeper Two"}],busy:[],readOnly:false};
  state.request.mockImplementation(async(_path,options)=>options?.method ? {resource:{changed:1}} : data);
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");
  fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});
  fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));
  expect((screen.getByLabelText("Main Gate Day Sun") as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Replacement gatekeeper"),{target:{value:"8"}});
  fireEvent.click(screen.getByText("Review assignments"));
  expect(screen.getByText(/Transfer Gatekeeper One → Gatekeeper Two:/)).toBeTruthy();
  expect(state.request.mock.calls.every(call=>!call[1]?.method)).toBe(true);
  fireEvent.click(screen.getByText("Save assignments"));await screen.findByText("Assignments saved.");
  const post=state.request.mock.calls.find(call=>call[1]?.method==="POST")!;
  expect(JSON.parse(post[1].body).payload.changes).toEqual([{id:"one",version:1,removeUserId:7,addUserId:8}]);
 });
 it("reviews removal-only and lets rechecking cancel it without writing",async()=>{
  state.request.mockResolvedValue({shifts:[{...shift,assignees:[7]}],people:[{id:7,name:"Gatekeeper One"}],busy:[],readOnly:true});
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});
  fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));fireEvent.click(screen.getByText("Review assignments"));
  expect(screen.getByText(/Remove Gatekeeper One — leave unassigned:/)).toBeTruthy();expect((screen.getByText("Save assignments") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Back to editing"));fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));
  expect((screen.getByText("Review assignments") as HTMLButtonElement).disabled).toBe(true);
  expect(state.request.mock.calls.every(call=>!call[1]?.method)).toBe(true);
 });
 it("blocks a replacement with a conflicting shift",async()=>{
  state.request.mockResolvedValue({shifts:[{...shift,assignees:[7]}],people:[{id:7,name:"Gatekeeper One"},{id:8,name:"Gatekeeper Two"}],busy:[{userId:8,shiftId:"other",startsAt:shift.startsAt,endsAt:shift.endsAt}],readOnly:true});
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));fireEvent.change(screen.getByLabelText("Replacement gatekeeper"),{target:{value:"8"}});
  expect(screen.getByRole("alert").textContent).toContain("Double-booking prevented");expect((screen.getByText("Review assignments") as HTMLButtonElement).disabled).toBe(true);
 });
 it("checks saved weekdays for the selected gatekeeper and clears draft choices when switching",async()=>{
  state.request.mockResolvedValue({shifts:[{...shift,assignees:[7]},{...shift,id:"monday",weekday:1,date:"2099-10-26",assignees:[8]},{...shift,id:"tuesday",weekday:2,date:"2099-10-27",assignees:[]}],people:[{id:7,name:"Gatekeeper One"},{id:8,name:"Gatekeeper Two"}],busy:[],readOnly:true});
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");
  const sunday=screen.getByLabelText("Main Gate Day Sun") as HTMLInputElement;
  const monday=screen.getByLabelText("Main Gate Day Mon") as HTMLInputElement;
  const tuesday=screen.getByLabelText("Main Gate Day Tue") as HTMLInputElement;
  expect(sunday.checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});
  expect(sunday.checked).toBe(true);expect(sunday.indeterminate).toBe(false);expect(sunday.disabled).toBe(false);expect(monday.checked).toBe(false);
  expect((screen.getByText("Review assignments") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(tuesday);expect(tuesday.checked).toBe(true);
  fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"8"}});
  expect(sunday.checked).toBe(false);expect(monday.checked).toBe(true);expect(monday.indeterminate).toBe(false);expect(tuesday.checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:""}});
  expect(monday.checked).toBe(false);
  expect(state.request.mock.calls.every(call=>!call[1]?.method)).toBe(true);
 });
 it("shows a checked weekday across repeated dates without a partial state or new assignment",async()=>{
  state.request.mockResolvedValue({shifts:[{...shift,assignees:[7]},{...shift,id:"next-week",date:"2099-11-01",assignees:[]}],people:[{id:7,name:"Gatekeeper One"}],busy:[],readOnly:true});
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");
  fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});
  const sunday=screen.getByLabelText("Main Gate Day Sun") as HTMLInputElement;
  expect(sunday.checked).toBe(true);expect(sunday.indeterminate).toBe(false);
  expect((screen.getByText("Review assignments") as HTMLButtonElement).disabled).toBe(true);
  expect(state.request.mock.calls.every(call=>!call[1]?.method)).toBe(true);
 });
 it("reviews weekly choices without sending live mutations in preview",async()=>{
  mount("assign");await screen.findByLabelText("Main Gate Day Sun");
  fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});fireEvent.click(screen.getByLabelText("Main Gate Day Sun"));
  fireEvent.click(screen.getByText("Review assignments"));
  expect((screen.getByText("Save assignments") as HTMLButtonElement).disabled).toBe(true);
  expect(state.request.mock.calls.every(call=>!call[1]?.method)).toBe(true);
 });
 it("shows gaps and blocks an overlapping employee",async()=>{
  state.request.mockResolvedValue({shifts:[shift],people:[{id:7,name:"Gatekeeper One"}],busy:[{userId:7,shiftId:"other",startsAt:shift.startsAt,endsAt:shift.endsAt}],readOnly:true});
  mount("gaps");await screen.findByText(/1 needed/);fireEvent.change(screen.getByLabelText("Assignment gatekeeper"),{target:{value:"7"}});fireEvent.click(screen.getByLabelText("Fill Main Gate Day 2099-10-25"));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Double-booking prevented"));expect((screen.getByText("Review assignments") as HTMLButtonElement).disabled).toBe(true);
 });
});
