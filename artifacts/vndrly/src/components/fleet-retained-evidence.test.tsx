import React from "react";
import {it,expect,vi} from "vitest";import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {FleetRetainedEvidence} from "./fleet-retained-evidence";
vi.mock("@/components/png-pill-rollover",()=>({PngPillButton:({children,...props}:any)=><button {...props}>{children}</button>}));
it("saves successive photos to the original journal without a live authority GET or replacing pending originals",async()=>{
 const captureEvidence=vi.fn().mockResolvedValue({durability:"durable",canonicalApplied:false}),onChanged=vi.fn(),session={captureEvidence,scope:{userId:7}} as any,run={id:"run",driverUserId:7} as any;
 render(<FleetRetainedEvidence session={session} run={run} onChanged={onChanged}/>);
 for(const name of ["inspection.jpg","damage.jpg"]){fireEvent.change(screen.getByLabelText("Retain Fleet evidence file"),{target:{files:[new File(["photo"],name,{type:"image/jpeg"})]}});fireEvent.click(screen.getByText("Save photo on this device"));await waitFor(()=>expect(captureEvidence).toHaveBeenCalledTimes(name==="inspection.jpg"?1:2));await waitFor(()=>expect((screen.getByText("Save photo on this device") as HTMLButtonElement).disabled).toBe(true));}
 expect(await screen.findByText(/Saved on this device.*photo pending sync/)).toBeTruthy();expect(onChanged).toHaveBeenCalledTimes(2);
});
