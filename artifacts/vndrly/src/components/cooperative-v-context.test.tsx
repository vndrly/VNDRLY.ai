import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"en"}})}));
vi.mock("@/components/png-pill-rollover",()=>({PngPillButton:(props:any)=><button {...props}/>}));
import { CooperativeVContext } from "./cooperative-v-context";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("requires explicit personal permission and never fetches unselected content",async()=>{
 const select=vi.fn(),fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(String(url).endsWith("connections")?{connections:[{id:"35c34a3c-ef90-459d-9a4b-e980ec0c8a12",provider:"Calendar",scope:"personal"}]}:String(url).endsWith("cooperation")?{approvedProviders:["anthropic"],providers:{anthropic:{configured:true}}}:{tokens:0,estimatedCostUsd:0}),{status:200}));
 vi.stubGlobal("fetch",fetcher);
 render(<CooperativeVContext identity="one" revision={0} disabled={false} selectConnection={select} selectSavedTask={vi.fn()}/>);
 await screen.findByRole("option",{name:"Calendar · Personal"});
 fireEvent.change(screen.getByLabelText("Connection"),{target:{value:"35c34a3c-ef90-459d-9a4b-e980ec0c8a12"}});
 expect((screen.getByRole("button",{name:"Use selected connection"}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText("Allow this personal connection for this task"));
 fireEvent.click(screen.getByRole("button",{name:"Use selected connection"}));
 expect(select).toHaveBeenLastCalledWith({connectionId:"35c34a3c-ef90-459d-9a4b-e980ec0c8a12",scope:"personal",personalPermission:true,savePersonalContentToCompany:false});
 expect(fetcher.mock.calls.every(([url])=>!String(url).includes("calendar/events"))).toBe(true);
});
it("selects a saved task only after exact canonical recovery and clears on new chat",async()=>{
 const taskId="35c34a3c-ef90-459d-9a4b-e980ec0c8a12",selectTask=vi.fn();
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>new Response(JSON.stringify(String(url).includes("/tasks/")?{taskId,completed:[{id:"saved"}],remaining:[{id:"pending",state:"waiting"}],needed:"Read saved results"}:String(url).endsWith("connections")?{connections:[]}:{approvedProviders:[],providers:{}}),{status:200})));
 const view=render(<CooperativeVContext identity="one" revision={0} disabled={false} selectConnection={vi.fn()} selectSavedTask={selectTask}/>);
 fireEvent.change(screen.getByLabelText("Saved task ID"),{target:{value:taskId}});fireEvent.click(screen.getByRole("button",{name:"Read saved task"}));
 await waitFor(()=>expect(selectTask).toHaveBeenLastCalledWith(taskId));
 expect(screen.getByText(/Completed: saved/)).toBeTruthy();
 view.rerender(<CooperativeVContext identity="one" revision={1} disabled={false} selectConnection={vi.fn()} selectSavedTask={selectTask}/>);
 await waitFor(()=>expect(selectTask).toHaveBeenLastCalledWith(null));
});
