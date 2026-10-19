import React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import type {FleetRun} from "@workspace/api-zod";
vi.mock("@/hooks/useColors",()=>({useColors:()=>({text:"white",primary:"orange",border:"gray"})}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(s:string)=>s}));
vi.mock("expo-crypto",()=>({randomUUID:()=>"10000000-0000-4000-8000-000000000001"}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetDriverRun,{nextDriverRunAction} from "./FleetDriverRun";
const run={id:"run",version:3,status:"acknowledged",phase:null,currentStopId:null,stops:[],loads:[],inspections:[],records:[],visitedStopIds:[],allowedActions:["inspect","record_meter"]} as unknown as FleetRun;
afterEach(cleanup);
it("binds the driver's explicit truck/rig check to every component of the saved Detail",()=>{
 const truck="30000000-0000-4000-8000-000000000001",trailer="30000000-0000-4000-8000-000000000002",submit=vi.fn();
 render(<FleetDriverRun run={{...run,vehicleAssetId:truck,trailerAssetId:trailer,resourceAssignment:{snapshot:{detail:{vehicleAssetId:truck},rigPackage:{components:[{assetId:trailer}]}}} as any}} disabled={false} onSubmit={submit}/>);
 fireEvent.click(screen.getByRole("button",{name:"No defects found"}));fireEvent.click(screen.getByRole("button",{name:"Save truck/rig check"}));
 expect(submit).toHaveBeenCalledWith("inspect",expect.objectContaining({inspectionOutcome:"passed",inspectedAssetIds:[truck,trailer]}));
});
it("asks for the replacement rig's check rather than cycling the odometer against a prior inspection",()=>{
 expect(nextDriverRunAction({...run,status:"in_progress",phase:"paused",activeReplacement:{inspectionCount:1} as any,inspections:[{outcome:"passed"} as any]})).toBe("inspect");
});
it("shows one next step, requires the driver's actual inspection choice, and leaves photos and typed notes optional",()=>{
 const submit=vi.fn();render(<FleetDriverRun run={run} disabled={false} onSubmit={submit} photo={<div>Photo picker</div>}/>);
 expect(screen.queryByText("Photo picker")).toBeNull();
 expect(screen.queryByLabelText("Odometer reading")).toBeNull();
 expect(submit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Save truck/rig check"}));expect(submit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"No defects found"}));
 fireEvent.click(screen.getByRole("button",{name:"Save truck/rig check"}));
 expect(submit).toHaveBeenCalledWith("inspect",expect.objectContaining({inspectionOutcome:"passed",notes:"No defects found"}));
 fireEvent.click(screen.getByRole("button",{name:"Add photo (optional)"}));expect(screen.getByText("Photo picker")).toBeTruthy();
});
it("records a problem without requiring a typed note or falsely marking it passed",()=>{
 const submit=vi.fn();render(<FleetDriverRun run={run} disabled={false} onSubmit={submit}/>);
 fireEvent.click(screen.getByRole("button",{name:"Report a problem"}));fireEvent.click(screen.getByRole("button",{name:"Save truck/rig check"}));
 expect(submit).toHaveBeenCalledWith("inspect",expect.objectContaining({inspectionOutcome:"defect_reported",notes:"Report a problem"}));
});
it("uses the saved inspection to advance to one plainly labeled odometer entry without inventing a reading",()=>{
 const submit=vi.fn();render(<FleetDriverRun run={{...run,inspections:[{outcome:"passed"} as any]}} disabled={false} onSubmit={submit}/>);
 expect(screen.queryByRole("button",{name:"No defects found"})).toBeNull();
 expect(screen.queryByRole("button",{name:/miles|kilometers|Change unit/})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Save odometer"}));expect(submit).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("Odometer reading"),{target:{value:"8100"}});
 fireEvent.click(screen.getByRole("button",{name:"Save odometer"}));
 expect(submit).toHaveBeenCalledWith("record_meter",expect.objectContaining({reading:8100,unit:"miles"}));
});
it("advances retained offline reports without claiming server acceptance and never starts automatically",()=>{
 const submit=vi.fn();render(<FleetDriverRun run={{...run,status:"acknowledged",allowedActions:["inspect","record_meter","start"]}} pendingActions={[{action:"inspect",inspectionOutcome:"passed"},{action:"record_meter",reading:8100,unit:"miles"}]} disabled={false} onSubmit={submit}/>);
 expect(screen.getByRole("button",{name:"Start Run"})).toBeTruthy();expect(submit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Start Run"}));expect(submit).toHaveBeenCalledWith("start",{});
});
