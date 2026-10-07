import React from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("expo-crypto",()=>({randomUUID:()=>"10000000-0000-4000-8000-000000000001"}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetProfileEditor from "./FleetProfileEditor";
afterEach(cleanup);
it("preserves saved media rule IDs and adds an explicit required per-load association to the setup draft",()=>{
 const change=vi.fn(),rule={id:"photo",label:"Run image",kind:"photo" as const,scope:"run" as const,required:false};
 render(<FleetProfileEditor profile={{name:"Synthetic profile",inspectionItems:[],manifestFields:[],evidenceRequirements:[rule]}} disabled={false} onChange={change}/>);
 fireEvent.change(screen.getByLabelText("Media requirement label"),{target:{value:"Actual scale receipt"}});fireEvent.click(screen.getByRole("button",{name:"scale"}));fireEvent.click(screen.getByRole("button",{name:"For each recorded load"}));fireEvent.click(screen.getByRole("button",{name:"Add media requirement to draft"}));expect(change).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Apply profile to setup draft"}));
 expect(change).toHaveBeenCalledWith(expect.objectContaining({evidenceRequirements:[rule,{id:"10000000-0000-4000-8000-000000000001",label:"Actual scale receipt",kind:"scale",scope:"each_load",required:true}]}));
});
it("preserves configured requirement IDs and changes only the unsaved setup draft",()=>{
 const change=vi.fn(),profile={name:"Synthetic profile",inspectionItems:[{id:"brakes",label:"Brake condition",required:true}],manifestFields:[]};
 render(<FleetProfileEditor profile={profile} disabled={false} onChange={change}/>);
 fireEvent.change(screen.getByLabelText("Manifest field labels"),{target:{value:"* Actual seal reference"}});fireEvent.click(screen.getByRole("button",{name:"Apply profile to setup draft"}));
 expect(change).toHaveBeenCalledWith({name:"Synthetic profile",inspectionItems:profile.inspectionItems,manifestFields:[{id:"10000000-0000-4000-8000-000000000001",label:"Actual seal reference",required:true}]});
 expect(screen.getByText(/Existing runs keep their saved requirements/)).toBeTruthy();
});
it("does not silently overwrite an invalid profile",()=>{
 const change=vi.fn();render(<FleetProfileEditor profile={undefined} disabled={false} onChange={change}/>);fireEvent.click(screen.getByRole("button",{name:"Apply profile to setup draft"}));expect(change).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toBeTruthy();
});
