import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminPinSetup } from "./admin-pin-setup";
const state=vi.hoisted(()=>({user:{userId:1,activeMembershipId:2,offlineOnly:false,mustChangePassword:false}}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>state}));
const t=(key:string)=>key;
vi.mock("react-i18next",()=>({useTranslation:()=>({t})}));
vi.mock("@/components/png-pill-rollover",()=>({PngPillButton:(props:any)=><button {...props}/> }));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("requires first-login setup before mounting account content",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({required:true,configured:false})}).mockResolvedValueOnce({ok:true,json:async()=>({ok:true})});vi.stubGlobal("fetch",fetcher);
 render(<AdminPinSetup><p>Account content</p></AdminPinSetup>);
 await screen.findByLabelText("gateNav.createPin", { selector: "input" });expect(screen.queryByText("Account content")).toBeNull();
 fireEvent.change(screen.getByLabelText("gateNav.createPin", { selector: "input" }),{target:{value:"7531"}});fireEvent.change(screen.getByLabelText("gateNav.confirmPin"),{target:{value:"7531"}});
 fireEvent.click(screen.getByText("gateNav.savePin"));await screen.findByText("Account content");
 expect(fetcher.mock.calls[1][1].method).toBe("POST");expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({action:"create",pin:"7531",confirmPin:"7531"});
});
it("does not prompt configured accounts or field accounts",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({required:false,configured:true})}));render(<AdminPinSetup><p>Account content</p></AdminPinSetup>);await screen.findByText("Account content");expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps setup open on mismatch without a write",async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({required:true})});vi.stubGlobal("fetch",fetcher);render(<AdminPinSetup><p>Account content</p></AdminPinSetup>);
 await screen.findByLabelText("gateNav.createPin", { selector: "input" });fireEvent.change(screen.getByLabelText("gateNav.createPin", { selector: "input" }),{target:{value:"7531"}});fireEvent.change(screen.getByLabelText("gateNav.confirmPin"),{target:{value:"1357"}});fireEvent.click(screen.getByText("gateNav.savePin"));await screen.findByRole("alert");expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.queryByText("Account content")).toBeNull();
});
