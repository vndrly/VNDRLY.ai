import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({failed:false,groupId:"north-spur" as string | null,gates:[
  {id:"one",siteId:1,name:"Gate 1",siteName:"Site A",connection:"online"},
  {id:"two",siteId:1,name:"Gate 2",siteName:"Site A",connection:"offline"},
  {id:"three",siteId:1,name:"Gate 3",siteName:"Site A",connection:"online"},
]}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:7}})}));
vi.mock("@/hooks/use-linked-gates",()=>({useLinkedGates:()=>({data:{groupId:mocks.groupId,name:"North Spur",siteIds:[1],gates:mocks.gates},isError:mocks.failed})}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"en"},t:(key:string)=>({"changeOver.site":"Site","changeOver.gate":"Gate","changeOver.choose":"Choose"}[key]??key)})}));
import GateSiteGateSelect from "./gate-site-gate-select";
beforeEach(()=>{mocks.failed=false;mocks.groupId="north-spur";});
const gates=mocks.gates.map(({id,name,siteId})=>({id,name,siteId}));
function view(id:string,onChange=vi.fn()) {return <QueryClientProvider client={new QueryClient()}><GateSiteGateSelect sites={[{id:1,name:"Site A"}]} siteId={1} gate={{id,name:gates.find(g=>g.id===id)!.name}} gateOptions={gates} gpsStatus="mismatch" gpsLabel="Outside selected gate" onChange={onChange}/></QueryClientProvider>;}
it("shows separate GPS and selected linked-booth status without visible extra labels",()=>{
  render(view("one"));
  expect(screen.getByTestId("gate-link-indicator").getAttribute("data-connection")).toBe("online");
  expect(screen.getByTestId("gate-gps-indicator").getAttribute("data-gps-status")).toBe("mismatch");
  expect(screen.getByRole("img",{name:/2\/3 connected/})).toBeTruthy();
  expect(screen.getByRole("option",{name:"Site A | Gate 1 · Online"})).toBeTruthy();
  expect(screen.getByRole("option",{name:"Site A | Gate 2"})).toBeTruthy();
});
it("cycles to an offline gate without hiding it or changing GPS evidence",()=>{
  const change=vi.fn(); const page=render(view("one",change));
  fireEvent.change(screen.getByRole("combobox",{name:"Site | Gate"}),{target:{value:"two"}});
  expect(change).toHaveBeenCalledWith(1,"two");
  page.rerender(view("two",change));
  expect(screen.getByTestId("gate-link-indicator").getAttribute("data-connection")).toBe("offline");
  expect(screen.getByTestId("gate-link-indicator").querySelector('stop[offset="100%"]')?.getAttribute("stop-color")).toBe("#ef4444");
});
it("does not keep a green connection indicator after a failed status read",()=>{
  mocks.failed=true;render(view("one"));
  expect(screen.getByTestId("gate-link-indicator").getAttribute("data-connection")).toBe("unknown");
});
it("hides the left indicator for an unlinked gate and retains GPS on the right",()=>{
  mocks.groupId=null;render(view("one"));
  expect(screen.queryByTestId("gate-link-indicator")).toBeNull();
  expect(screen.getByTestId("gate-gps-indicator").getAttribute("data-gps-status")).toBe("mismatch");
});
