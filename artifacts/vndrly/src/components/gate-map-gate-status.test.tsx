import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,expect,it,vi} from "vitest";
import {GateMapGateStatus} from "./gate-map-gate-status";
const gate={id:"north",siteId:1,name:"North Gate",latitude:32.24,longitude:-101.97,geofenceRadiusM:150,active:false,version:3};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function show(active=false,historical=false,forbidden=false,writeFails=false){
 const current={...gate,active};
 const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method!=="POST")return {ok:!forbidden,json:async()=>forbidden?{code:"gate_locations.forbidden"}:{gates:[current]}};
  const body=JSON.parse(init.body as string);
  if(url.endsWith("/preview"))return {ok:true,json:async()=>({values:body,confirmation:"signed-review"})};
  if(writeFails)return {ok:false,json:async()=>({message:"Gate changed. Refresh and try again."})};
  Object.assign(current,{active:body.active,version:4});
  return {ok:true,json:async()=>current};
 });
 vi.stubGlobal("fetch",fetcher);
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateMapGateStatus stationId="north" siteId={1} userId={7} membershipId={2} active={active} historical={historical} es={false}/></QueryClientProvider>);
 return fetcher;
}
it.each([false,true])("requires confirmation before changing active=%s and preserves gate fields",async active=>{
 const fetcher=show(active);
 fireEvent.click(await screen.findByRole("button",{name:`${active?"Deactivate":"Activate"} North Gate`}));
 expect(screen.getByText(/Are you sure/)).toBeTruthy();
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
 if(!active)expect(screen.getByText(/coverage gaps/)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:active?"Deactivate Gate":"Activate Gate"}));
 await screen.findByRole("button",{name:`${active?"Activate":"Deactivate"} North Gate`});
 const posts=fetcher.mock.calls.filter(([,init])=>init?.method==="POST");
 expect(posts).toHaveLength(2);
 expect(JSON.parse(posts[1][1]!.body as string)).toMatchObject({...gate,active:!active,confirmation:"signed-review",idempotencyKey:expect.any(String)});
});
it("cancels without issuing any write",async()=>{
 const fetcher=show();fireEvent.click(await screen.findByRole("button",{name:"Activate North Gate"}));
 fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
 expect(screen.queryByText(/Are you sure/)).toBeNull();
 expect(fetcher.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
});
it("keeps failed activation inactive",async()=>{
 show(false,false,false,true);fireEvent.click(await screen.findByRole("button",{name:"Activate North Gate"}));
 fireEvent.click(screen.getByRole("button",{name:"Activate Gate"}));
 expect(await screen.findByRole("alert")).toHaveProperty("textContent","Gate changed. Refresh and try again.");
 expect(screen.getByRole("button",{name:"Activate North Gate"}).textContent).toBe("Inactive");
});
it("keeps status read-only when current authorization is denied",async()=>{
 const fetcher=show(false,false,true);await waitFor(()=>expect(fetcher).toHaveBeenCalled());
 expect(screen.queryByRole("button")).toBeNull();expect(screen.getByText("Inactive")).toBeTruthy();
});
it("does not expose current-status writes from historical maps",()=>{
 const fetcher=show(false,true);expect(fetcher).not.toHaveBeenCalled();expect(screen.queryByRole("button")).toBeNull();
});
