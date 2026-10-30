import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("@/lib/change-over-api",()=>({changeOverRequest:m.request}));
vi.mock("./work-hub/chrome",()=>({BrandedSelect:(props:any)=><select {...props}/>}));
vi.mock("./png-pill-rollover",()=>({PngPillButton:({color,...props}:any)=><button {...props}/>}));
import {GateMapPinShare} from "./gate-map-pin-share";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("opens a compact recipient picker without sending and only shares on explicit Share",async()=>{
 m.request.mockResolvedValue({people:[{userId:2,name:"Worker"},{userId:3,name:"Admin"}],groups:[{id:"group",name:"Day crew",userIds:[2]}]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateMapPinShare pinId="pin" es={false}/></QueryClientProvider>);
 expect(m.request).not.toHaveBeenCalled();const disclosure=screen.getByText("Share Pin").closest("details")!;disclosure.open=true;fireEvent(disclosure,new Event("toggle"));
 await screen.findByRole("button",{name:"Individuals"});expect(m.request.mock.calls.every(call=>call.length===1)).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Individuals"}));
 fireEvent.click(screen.getByLabelText("Admin"));m.request.mockResolvedValueOnce({notifiedCount:1});
 fireEvent.click(screen.getByRole("button",{name:"Share"}));
 await screen.findByText("Notified 1 people.");
 expect(m.request).toHaveBeenLastCalledWith("/map-pins/pin/share",expect.objectContaining({audience:"individuals",userIds:[3],operationId:expect.any(String)}));
 expect((screen.getByRole("button",{name:"Share"}) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps the same operation identity for an uncertain retry",async()=>{
 m.request.mockResolvedValueOnce({people:[{userId:2,name:"Worker"}],groups:[]}).mockRejectedValueOnce(Error("Not confirmed")).mockResolvedValueOnce({notifiedCount:1});
 render(<QueryClientProvider client={new QueryClient()}><GateMapPinShare pinId="pin" es={false}/></QueryClientProvider>);
 const disclosure=screen.getByText("Share Pin").closest("details")!;disclosure.open=true;fireEvent(disclosure,new Event("toggle"));
 await screen.findByRole("button",{name:"All"});fireEvent.click(screen.getByRole("button",{name:"All"}));await screen.findByText("1 company members");fireEvent.click(screen.getByRole("button",{name:"Share"}));await screen.findByText("Not confirmed");
 fireEvent.click(screen.getByRole("button",{name:"Share"}));await screen.findByText("Notified 1 people.");
 expect(m.request.mock.calls[1][1]).toEqual(m.request.mock.calls[2][1]);
});
