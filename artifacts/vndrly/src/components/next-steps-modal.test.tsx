import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextStepsProvider, NextStepsNavButton, useNextSteps } from "./next-steps";
import { useGuidedTarget } from "./guided-target";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user:{userId:7,vendorId:4,activeMembershipId:2,role:"vendor",vendorRole:"office",availableMemberships:[{id:2,role:"admin"}]} }) }));
vi.mock("@/hooks/use-brand", () => ({useBrand:()=>({primary:"#187650",name:"Gate Company"})}));
vi.mock("wouter",()=>({useLocation:()=>["/field-employees",vi.fn()]}));
let client:QueryClient, scroll:ReturnType<typeof vi.fn>, confirm:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});scroll=vi.fn();confirm=vi.fn(()=>false);vi.stubGlobal("confirm",confirm);
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({setup:[],credentials:[],firstWatch:{complete:false,action:{title:"Give a gate employee access",href:"/field-employees?siteId=11&stationId=main"},message:null,context:{siteId:11,stationId:"main",siteName:"Lease A",stationName:"Main"}}})})));
 vi.spyOn(HTMLElement.prototype,"getClientRects").mockImplementation(function(this:HTMLElement){return this.closest("[hidden]")?[] as unknown as DOMRectList:[{left:20,top:50,right:220,bottom:90,width:200,height:40}] as unknown as DOMRectList;});
 Object.defineProperty(HTMLElement.prototype,"scrollIntoView",{configurable:true,value:scroll});
});
afterEach(()=>{cleanup();client.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
function Fields(){const next=useNextSteps();useGuidedTarget({scopeId:"actual-employee:4:30",targetId:"name",prompt:"Enter the actual employee name."},next?.selected?.id==="first-watch",100);return <div data-guidance-scope="actual-employee:4:30"><label>Employee name<input data-guidance-id="name" aria-label="Employee name" defaultValue="Saved draft"/></label></div>;}
function Harness(){
 const next=useNextSteps();const [open,setOpen]=useState(false);
 return <><NextStepsNavButton/><button onClick={()=>next?.startHelper("first-watch")}>Start helper</button><Dialog.Root open={open} onOpenChange={value=>{if(!value&&!window.confirm("Discard unsaved form changes?"))return;setOpen(value);}}><Dialog.Trigger>Open actual form</Dialog.Trigger><Dialog.Portal><Dialog.Overlay/><Dialog.Content aria-describedby={undefined}><Dialog.Title>Actual employee form</Dialog.Title><Fields/><Dialog.Close>Close actual form</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}
function mount(){render(<QueryClientProvider client={client}><NextStepsProvider><Harness/></NextStepsProvider></QueryClientProvider>);}
it("keeps real modal forms free of automatic helper panels and preserves their draft",async()=>{
 mount();await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole("button",{name:"Start helper"}));fireEvent.click(screen.getByRole("button",{name:"Open actual form"}));
 const modal=await screen.findByRole("dialog",{name:"Actual employee form"});
 expect(modal.querySelector("[data-testid=next-steps-panel]")).toBeNull();
 expect(screen.queryByTestId("next-steps-active-helper")).toBeNull();
 expect(screen.queryByTestId("next-steps-selected-workflow")).toBeNull();
 expect((screen.getByLabelText("Employee name") as HTMLInputElement).value).toBe("Saved draft");
 expect(confirm).not.toHaveBeenCalled();expect(scroll).not.toHaveBeenCalled();
 expect(vi.mocked(fetch).mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
});
it("preserves the dirty-form close guard, and shows retained guidance only after the Next Steps button is clicked",async()=>{
 mount();await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole("button",{name:"Start helper"}));fireEvent.click(screen.getByRole("button",{name:"Open actual form"}));
 await screen.findByRole("dialog");
 fireEvent.click(screen.getByRole("button",{name:"Close actual form"}));expect(confirm).toHaveBeenCalledOnce();expect(screen.getByRole("dialog")).toBeTruthy();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"Close actual form"}));await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
 expect(screen.queryByTestId("next-steps-panel")).toBeNull();
 expect(screen.queryByTestId("next-steps-selected-workflow")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/Next Steps,/}));
 const panel=screen.getByTestId("next-steps-panel");expect(panel.contains(screen.getByTestId("next-steps-selected-workflow"))).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Close Next Steps"}));
 expect(screen.queryByTestId("next-steps-selected-workflow")).toBeNull();
 expect(vi.mocked(fetch).mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
});
