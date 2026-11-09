import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import GateAssumeWatchFlyout from "./gate-assume-watch-flyout";
const m=vi.hoisted(()=>({request:vi.fn(),helper:null as any}));
vi.mock("@/components/next-steps",()=>({useNextSteps:()=>m.helper}));
vi.mock("@/lib/change-over-api",()=>({changeOverRequest:m.request}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:7,vendorId:4,activeMembershipId:2}})}));
const snapshot={revision:"a",facts:[{id:"fact",text:"Two vehicles remain on site"}],openItems:[{id:"item",text:"Check barrier lamp",status:"open"}]};
const current=()=>({station:{id:"gate",name:"Main Gate"},site:{id:1,name:"Test site"},shift:{id:"old-watch",operator_id:8,operator_name:"Outgoing worker",started_at:new Date().toISOString(),preparation_id:"prep"},preparation:{id:"prep",notes:"Radio battery replaced",snapshot,summary:{facts:snapshot.facts}},snapshot,stale:false});
const caches:QueryClient[]=[];
beforeEach(()=>{m.helper=null;Object.defineProperty(navigator,"onLine",{value:true,configurable:true});m.request.mockReset();m.request.mockImplementation(async(path:string)=>path.split("?")[0].endsWith("/state")?current():{});});
afterEach(()=>{cleanup();caches.splice(0).forEach(c=>c.clear());});
function mount(extra={}){const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});caches.push(cache);const closed=vi.fn();render(<QueryClientProvider client={cache}><GateAssumeWatchFlyout stationId="gate" open onOpenChange={closed} {...extra}/></QueryClientProvider>);return closed;}
async function confirm(){const button=await screen.findByRole("button",{name:"ASSUME"});await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));fireEvent.click(button);}
it("uses the narrow assume purpose to review a watch before office self-coverage",async()=>{
  mount();await screen.findByText("Radio battery replaced");
  expect(m.request).toHaveBeenCalledWith("/gate/state?purpose=assume");
});
it("shows the saved briefing and does not change the watch when X closes it",async()=>{
  const close=mount();expect(await screen.findByText("Radio battery replaced")).toBeTruthy();expect(screen.getByText("Check barrier lamp")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Close watch summary"}));expect(close).toHaveBeenCalledWith(false);
  expect(m.request.mock.calls.every(call=>call.length===1)).toBe(true);
});
it("closes on Escape or clicking outside without assuming",async()=>{
  const close=mount();await screen.findByText("Radio battery replaced");
  fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});expect(close).toHaveBeenCalledWith(false);
  close.mockClear();fireEvent.pointerDown(document.querySelector('[data-state="open"][class*="bg-black"]')!,{pointerType:"mouse",button:0});
  expect(m.request.mock.calls.some(([,body])=>body)).toBe(false);
});
it("assumes only after ASSUME, bound to the reviewed watch and handover",async()=>{
  const close=mount();await screen.findByText("Radio battery replaced");expect(m.request.mock.calls.some(([,body])=>body)).toBe(false);
  await confirm();await waitFor(()=>expect(close).toHaveBeenCalledWith(false));
  expect(m.request).toHaveBeenCalledWith("/gate/watch/assume",expect.objectContaining({expectedWatchId:"old-watch",preparationId:"prep",reviewedRevision:"a",acknowledged:true,allowUnprepared:false,source:"web"}));
});
it("explicitly permits a watch without a handover and uses the same flow for an administrator",async()=>{
  m.request.mockImplementation(async(path:string)=>path.split("?")[0].endsWith("/state")?{...current(),preparation:null,shift:{...current().shift,preparation_id:null}}:{});
  mount({adminWatchId:"old-watch"});expect(await screen.findByText("No handover prepared")).toBeTruthy();await confirm();
  await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/gate/watch/admin",expect.objectContaining({expectedShiftId:"old-watch",action:"assume",preparationId:null,acknowledged:true,allowUnprepared:true})));
});
it("retains an uncertain command through close and rechecks its receipt before retrying",async()=>{
  let writes=0;m.request.mockImplementation(async(path:string)=>{if(path.split("?")[0].endsWith("/state"))return current();if(path.includes("/operations/"))return {receipt:null};if(path.endsWith("/assume")&&++writes===1)throw Error("Lost response");return {};});
  const close=mount();await confirm();await screen.findByText("Lost response");
  const original=m.request.mock.calls.find(([path])=>path.endsWith("/assume"));fireEvent.click(screen.getByRole("button",{name:"Close watch summary"}));expect(close).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole("button",{name:"Check assumption"}));
  await waitFor(()=>expect(writes).toBe(2));expect(m.request.mock.calls.filter(([path])=>path.endsWith("/assume"))[1]).toEqual(original);
});
it("records a discrepancy against the reviewed watch without assuming it", async () => {
  mount();
  await screen.findByText("Radio battery replaced");
  fireEvent.click(screen.getByText("Report a turnover discrepancy"));
  fireEvent.change(screen.getByRole("textbox", { name: "What needs to be checked?" }), {
    target: { value: "Confirm the vehicle count at South Gate" },
  });
  expect((screen.getByRole("button", { name: "ASSUME" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save discrepancy" }));
  await screen.findByText("Discrepancy added to the gate’s open items.");
  expect(m.request).toHaveBeenCalledWith("/gate/handoff/discrepancy", {
    operationId: expect.any(String), expectedWatchId: "old-watch", text: "Confirm the vehicle count at South Gate",
  });
  expect(m.request.mock.calls.some(([path]) => path.endsWith("/watch/assume"))).toBe(false);
});
it("requires the reviewed calendar site to match the loaded gate before assuming", async () => {
  mount({calendarContext:{siteId:99,shiftId:"scheduled",date:"2026-11-09",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+60000).toISOString()}});
  await screen.findByText("Radio battery replaced");
  expect((screen.getByRole("button",{name:"ASSUME"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/calendar gate could not be verified/i)).toBeTruthy();
  expect(m.request.mock.calls.some(([,body])=>body)).toBe(false);
});
it("records helper completion only from the confirmed saved own watch, never the reviewed outgoing watch", async () => {
  m.helper={selected:{id:"gate-staffing-recovery",context:{siteId:1,stationId:"gate"}},recordCompletion:vi.fn().mockResolvedValue(true)};
  let saved=false;m.request.mockImplementation(async(path:string)=>{
    if(path.endsWith("/assume")){saved=true;return {id:"duty-id-not-a-watch"};}
    if(path.includes("/state"))return saved?{...current(),shift:{...current().shift,id:"actual-saved-watch",operator_id:7}}:current();
    return {};
  });
  mount();await screen.findByText("Radio battery replaced");expect(m.helper.recordCompletion).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").getAttribute("data-guidance-scope")).toBe("gate-guide:assume-review:1:gate:");
  expect(screen.getByRole("button",{name:"ASSUME"}).getAttribute("data-guidance-id")).toBe("assume");
  await confirm();await waitFor(()=>expect(m.helper.recordCompletion).toHaveBeenCalledWith("gate-staffing-recovery",{recordType:"gate-watch",recordId:"actual-saved-watch",siteId:1}));
  expect(m.helper.recordCompletion).not.toHaveBeenCalledWith(expect.anything(),expect.objectContaining({recordId:"duty-id-not-a-watch"}));
});
it("does not complete a watch guide on a failed save or uncertain response",async()=>{
  m.helper={selected:{id:"gate-watch-handoff",context:{siteId:1,stationId:"gate"}},recordCompletion:vi.fn()};
  m.request.mockImplementation(async(path:string)=>{if(path.includes("/state"))return current();if(path.endsWith("/assume"))throw Error("No saved confirmation");return {};});
  mount();await confirm();await screen.findByText("No saved confirmation");expect(m.helper.recordCompletion).not.toHaveBeenCalled();
});
