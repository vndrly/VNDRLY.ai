import React from "react";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({api:vi.fn(),membership:1}));
vi.mock("@/lib/api",()=>({apiFetch:mocks.api}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:1},activeMembershipId:mocks.membership})}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("@/components/ScreenSafeArea",()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetSupport from "./FleetSupport";
const choices={readOnly:true,companies:[{companyId:609,companyName:"Synthetic company",reason:"Explicit support",expiresAt:"2026-10-08T00:00:00Z"}]};
const read={...choices.companies[0],readOnly:true,coordinateDisclosure:false,runs:[],page:{nextCursor:null}};
afterEach(()=>{cleanup();mocks.api.mockReset();mocks.membership=1;});
it("uses explicit support choices and never exposes operational controls or writes",async()=>{
 mocks.api.mockImplementation(async path=>path==="/api/fleet/support"?choices:read);
 render(<FleetSupport/>);fireEvent.click(await screen.findByRole("button",{name:"Synthetic company"}));
 expect(await screen.findByText("Explicit support")).toBeTruthy();
 expect(mocks.api).toHaveBeenCalledWith("/api/fleet/support/609");
 expect(mocks.api.mock.calls.some(call=>call[1]?.method==="POST")).toBe(false);
 expect(screen.queryByRole("button",{name:"Dispatch"})).toBeNull();
});
it("refuses mismatched company data and clears old scope on membership change",async()=>{
 mocks.api.mockImplementation(async path=>path==="/api/fleet/support"?choices:{...read,companyId:989});
 const view=render(<FleetSupport/>);fireEvent.click(await screen.findByRole("button",{name:"Synthetic company"}));
 expect(await screen.findByText("Support scope could not be verified.")).toBeTruthy();
 mocks.membership=2;mocks.api.mockImplementation(()=>new Promise(()=>{}));view.rerender(<FleetSupport/>);
 expect(screen.queryByText("Support scope could not be verified.")).toBeNull();
});
