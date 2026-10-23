import {render,screen,fireEvent,cleanup,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import MyWatchSchedule from "./gate-my-watch-schedule";
const m=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("@/lib/change-over-api",()=>({changeOverRequest:m.request}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:7,vendorId:4,activeMembershipId:2}})}));
const watch={id:"shift-one",assignmentId:"assignment-one",version:2,title:"Night gate",startsAt:"2099-10-23T23:00:00Z",endsAt:"2099-10-24T11:00:00Z",timezone:"America/Chicago",siteName:"Antelope Draw",gateName:"Main Gate",scheduler:{userId:8,name:"Sharon Pike",profileHref:"/field-employees/20"},response:"pending",escalated:false};
beforeEach(()=>{m.request.mockReset();m.request.mockResolvedValue({watches:[watch,{...watch,id:"shift-two",assignmentId:"assignment-two",startsAt:"2099-10-25T23:00:00Z",siteName:"Coyote Ridge"}]});});
afterEach(cleanup);
function mount(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><MyWatchSchedule/></QueryClientProvider>);}
it("replaces elapsed watch time with the next scheduled date and expands all personal assignments",async()=>{
  mount();await screen.findAllByText(/Oct 23, 2099/);fireEvent.click(screen.getByText("My Watch"));
  expect(screen.getByText("Antelope Draw · Main Gate")).toBeTruthy();expect(screen.getByText("Coyote Ridge · Main Gate")).toBeTruthy();
  expect(screen.getAllByRole("button",{name:"Confirm"})).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button",{name:"Sharon Pike"})[0]);
  expect((await screen.findByRole("link",{name:"Open supervisor profile"})).getAttribute("href")).toBe("/field-employees/20");
});
it("confirms the exact assignment without assuming watch or starting a shift",async()=>{
  m.request.mockImplementation(async(path:string)=>path.endsWith('/response')?{response:"confirm",escalated:false,notifiedCount:1}:{watches:[watch]});
  mount();fireEvent.click(await screen.findByText("My Watch"));fireEvent.click(await screen.findByRole("button",{name:"Confirm"}));
  expect(await screen.findByText("Watch confirmed. Scheduler notified.")).toBeTruthy();
  expect(m.request).toHaveBeenCalledWith('/my-scheduled-watches/shift-one/response',expect.objectContaining({assignmentId:'assignment-one',expectedVersion:2,response:'confirm',operationId:expect.any(String)}));
  expect(m.request.mock.calls.some(([path])=>/assume|workday|release/.test(path))).toBe(false);
});
it("requires a reason for Conflict and displays the server's urgent escalation result",async()=>{
  m.request.mockImplementation(async(path:string)=>path.endsWith('/response')?{response:"conflict",escalated:true,notifiedCount:4}:{watches:[watch]});
  mount();fireEvent.click(await screen.findByText("My Watch"));fireEvent.click(await screen.findByRole("button",{name:"Conflict"}));
  const report=screen.getByRole('button',{name:'Report conflict'});expect((report as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox',{name:'Scheduling conflict'}),{target:{value:'Personal appointment'}});fireEvent.click(report);
  expect(await screen.findByText(/Scheduler and office\/admin notified/)).toBeTruthy();
  expect(m.request).toHaveBeenCalledWith('/my-scheduled-watches/shift-one/response',expect.objectContaining({response:'conflict',reason:'Personal appointment'}));
});
it("retries an uncertain result with the original assignment and operation ID",async()=>{
  let failed=false;m.request.mockImplementation(async(path:string)=>{if(path.endsWith('/response')){if(!failed){failed=true;throw Error('Lost response');}return {response:'confirm',notifiedCount:1};}return {watches:[watch]};});
  mount();fireEvent.click(await screen.findByText('My Watch'));fireEvent.click(await screen.findByRole('button',{name:'Confirm'}));
  fireEvent.click(await screen.findByRole('button',{name:'Retry saved response'}));
  await waitFor(()=>expect(m.request.mock.calls.filter(([path])=>path.endsWith('/response'))).toHaveLength(2));
  const calls=m.request.mock.calls.filter(([path])=>path.endsWith('/response'));expect(calls[1]).toEqual(calls[0]);
});
