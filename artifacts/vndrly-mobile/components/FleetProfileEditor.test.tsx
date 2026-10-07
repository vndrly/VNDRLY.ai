import React from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(v:string)=>v}));
vi.mock("expo-crypto",()=>({randomUUID:()=>"10000000-0000-4000-8000-000000000001"}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetProfileEditor from "./FleetProfileEditor";
afterEach(cleanup);
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
