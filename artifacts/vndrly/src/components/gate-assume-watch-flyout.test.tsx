import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import GateAssumeWatchFlyout from "./gate-assume-watch-flyout";
const m=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("@/lib/change-over-api",()=>({changeOverRequest:m.request}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:7,vendorId:4,activeMembershipId:2}})}));
const snapshot={revision:"a",facts:[{id:"fact",text:"Two vehicles remain on site"}],openItems:[{id:"item",text:"Check barrier lamp",status:"open"}]};
const current=()=>({station:{id:"gate",name:"Main Gate"},site:{id:1,name:"Test site"},shift:{id:"old-watch",operator_id:8,operator_name:"Outgoing worker",started_at:new Date().toISOString(),preparation_id:"prep"},preparation:{id:"prep",notes:"Radio battery replaced",snapshot,summary:{facts:snapshot.facts}},snapshot,stale:false});
const caches:QueryClient[]=[];
beforeEach(()=>{Object.defineProperty(navigator,"onLine",{value:true,configurable:true});m.request.mockReset();m.request.mockImplementation(async(path:string)=>path.endsWith("/state")?current():{});});
afterEach(()=>{cleanup();caches.splice(0).forEach(c=>c.clear());});
function mount(extra={}){const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});caches.push(cache);const closed=vi.fn();render(<QueryClientProvider client={cache}><GateAssumeWatchFlyout stationId="gate" open onOpenChange={closed} {...extra}/></QueryClientProvider>);return closed;}
async function confirm(){const button=await screen.findByRole("button",{name:"ASSUME",exact:true});await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));fireEvent.click(button);}
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
  m.request.mockImplementation(async(path:string)=>path.endsWith("/state")?{...current(),preparation:null,shift:{...current().shift,preparation_id:null}}:{});
  mount({adminWatchId:"old-watch"});expect(await screen.findByText("No handover prepared")).toBeTruthy();await confirm();
  await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/gate/watch/admin",expect.objectContaining({expectedShiftId:"old-watch",action:"assume",preparationId:null,acknowledged:true,allowUnprepared:true})));
});
it("retains an uncertain command through close and rechecks its receipt before retrying",async()=>{
  let writes=0;m.request.mockImplementation(async(path:string)=>{if(path.endsWith("/state"))return current();if(path.includes("/operations/"))return {receipt:null};if(path.endsWith("/assume")&&++writes===1)throw Error("Lost response");return {};});
  const close=mount();await confirm();await screen.findByText("Lost response");
  const original=m.request.mock.calls.find(([path])=>path.endsWith("/assume"));fireEvent.click(screen.getByRole("button",{name:"Close watch summary"}));expect(close).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole("button",{name:"Check assumption"}));
  await waitFor(()=>expect(writes).toBe(2));expect(m.request.mock.calls.filter(([path])=>path.endsWith("/assume"))[1]).toEqual(original);
});
