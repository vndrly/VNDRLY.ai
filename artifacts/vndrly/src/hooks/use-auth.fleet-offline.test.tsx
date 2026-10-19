import React from "react";import {it,expect,vi,afterEach} from "vitest";import {render,screen,cleanup} from "@testing-library/react";
import {AuthProvider,useAuth} from "./use-auth";
const cache=vi.hoisted(()=>({read:vi.fn(),deactivate:vi.fn()}));
vi.mock("@/lib/fleet-offline-bootstrap",()=>({readWebFleetOfflineAuth:cache.read,deactivateWebFleetOffline:cache.deactivate}));
vi.mock("@/lib/i18n",()=>({default:{language:"en",changeLanguage:vi.fn()}}));
function View(){const {user,isLoading}=useAuth();return <div>{isLoading?"Loading":user?`${user.displayName}:${user.offlineOnly?"offline":"live"}`:"Signed out"}</div>;}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it("restores provisioned original Fleet context only on network loss, never after an authentication rejection",async()=>{
 window.history.replaceState({},"","/fleet/runs");cache.read.mockResolvedValue({userId:7,role:"vendor",vendorId:11,activeMembershipId:9,displayName:"Original worker"});vi.stubGlobal("fetch",vi.fn().mockRejectedValue(Error("offline")));
 const first=render(<AuthProvider><View/></AuthProvider>);expect(await screen.findByText("Original worker:offline")).toBeTruthy();first.unmount();cache.read.mockClear();
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({})}));render(<AuthProvider><View/></AuthProvider>);expect(await screen.findByText("Signed out")).toBeTruthy();expect(cache.read).not.toHaveBeenCalled();expect(cache.deactivate).toHaveBeenCalled();
});
