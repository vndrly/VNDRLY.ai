import React from "react";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
const api=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({apiFetch:api}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetEta from "./FleetEta";
const id="20000000-0000-4000-8000-000000000001";
afterEach(()=>{cleanup();api.mockReset();});
it("reads only on explicit request and preserves provider unavailability",async()=>{
 api.mockResolvedValue({runId:id,ok:false,code:"location_stale",truckSafeRouting:false,physicalProofVerified:false});
 render(<FleetEta runId={id} disabled={false}/>);expect(api).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Read phone-based driving estimate"}));
 expect(await screen.findByText("ETA unavailable: location_stale")).toBeTruthy();expect(api).toHaveBeenCalledWith(`/api/fleet/runs/${id}/eta`);
});
it("rejects another run's estimate and disables cached or queued requests",async()=>{
 api.mockResolvedValue({runId:"20000000-0000-4000-8000-000000000002",ok:false,code:"location_stale",truckSafeRouting:false,physicalProofVerified:false});
 const view=render(<FleetEta runId={id} disabled={false}/>);fireEvent.click(screen.getByRole("button",{name:"Read phone-based driving estimate"}));
 expect(await screen.findByText("ETA scope could not be verified.")).toBeTruthy();
 view.rerender(<FleetEta runId={id} disabled={true}/>);expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
