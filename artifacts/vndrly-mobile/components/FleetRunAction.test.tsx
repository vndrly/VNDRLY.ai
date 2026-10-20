import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetRun } from "@workspace/api-zod";
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "10000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetRunAction from "./FleetRunAction";
const run = { version: 3, currentStopId: null, stops: [], loads: [] } as unknown as FleetRun;
afterEach(cleanup);
describe("Fleet reported workflow forms", () => {
  it("does not offer transferred-out cargo as a delivery choice",()=>{
    const load={id:"50000000-0000-4000-8000-000000000001",commodity:"Transferred history",quantity:10,unit:"tons",manifestReference:"SYN-01",transferOut:{transferId:"90000000-0000-4000-8000-000000000001"}};
    render(<FleetRunAction run={{...run,loads:[load]}} action="record_delivery" disabled={false} onSubmit={()=>{}}/>);
    expect(screen.queryByRole("button",{name:/Transferred history/})).toBeNull();
  });
  it("links only a selected existing ticket candidate", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="link_ticket" disabled={false} onSubmit={submit} tickets={[{ id: 77, siteId: 392, status: "submitted" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "link ticket" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ticket #77 · site 392 · submitted" }));
    fireEvent.click(screen.getByRole("button", { name: "link ticket" }));
    expect(submit).toHaveBeenCalledWith({ ticketId: 77 });
  });
  it("records the supplied odometer reading in miles without a unit selection", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="record_meter" disabled={false} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText("record_meter reading"), { target: { value: "8100" } });
    fireEvent.change(screen.getByLabelText("record_meter notes"), { target: { value: "Truck odometer at pickup" } });
    expect(screen.queryByRole("button", { name: /miles|kilometers|engine hours/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "record meter" }));
    expect(submit).toHaveBeenCalledWith({ reading: 8100, notes: "Truck odometer at pickup", unit: "miles" });
  });
  it("requires inspection notes and defaults to reporting a defect", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="inspect" disabled={false} onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("inspect notes"), { target: { value: "Brake warning light" } });
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    expect(submit).toHaveBeenCalledWith({ notes: "Brake warning light", inspectionOutcome: "defect_reported" });
  });
  it("records a supplied load reference and quantity without location or media claims", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="record_load" disabled={false} onSubmit={submit} />);
    for (const [field, value] of Object.entries({ commodity: "Water", quantity: "12", unit: "bbl", manifestReference: "MAN-2" })) fireEvent.change(screen.getByLabelText(`record_load ${field}`), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "record load" }));
    expect(submit).toHaveBeenCalledWith({ commodity: "Water", quantity: 12, unit: "bbl", manifestReference: "MAN-2", loadId: "10000000-0000-4000-8000-000000000001" });
    expect(screen.getByText(/No device location/)).toBeTruthy();
  });
});

it("requires exact saved inspection responses and rejects a defect with an overall passed report",()=>{
 const submit=vi.fn(),profile={name:"Synthetic haul",inspectionItems:[{id:"brakes",label:"Brake condition",required:true}],manifestFields:[]};
 render(<FleetRunAction run={{...run,operationalProfile:profile}} action="inspect" disabled={false} onSubmit={submit}/>);
 fireEvent.change(screen.getByLabelText("inspect notes"),{target:{value:"Checked while stopped"}});
 fireEvent.click(screen.getByRole("button",{name:"Report inspection passed"}));fireEvent.click(screen.getByRole("button",{name:"inspect"}));expect(submit).not.toHaveBeenCalled();
 expect(screen.queryByRole("button",{name:"Brake condition: not applicable"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Brake condition: defect reported"}));fireEvent.click(screen.getByRole("button",{name:"inspect"}));expect(submit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Report defect"}));fireEvent.click(screen.getByRole("button",{name:"inspect"}));
 expect(submit).toHaveBeenCalledWith(expect.objectContaining({inspectionOutcome:"defect_reported",inspectionResponses:[{id:"brakes",outcome:"defect_reported"}]}));
});
it("collects required manifest values against saved labels without inventing them",()=>{
 const submit=vi.fn(),profile={name:"Synthetic haul",inspectionItems:[],manifestFields:[{id:"seal",label:"Actual seal reference",required:true}]};
 render(<FleetRunAction run={{...run,operationalProfile:profile}} action="record_load" disabled={false} onSubmit={submit}/>);
 for(const [field,value]of Object.entries({commodity:"Sand",quantity:"12",unit:"tons",manifestReference:"SYN-1"}))fireEvent.change(screen.getByLabelText(`record_load ${field}`),{target:{value}});
 fireEvent.click(screen.getByRole("button",{name:"record load"}));expect(submit).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("Actual seal reference"),{target:{value:"SYN-SEAL"}});fireEvent.click(screen.getByRole("button",{name:"record load"}));
 expect(submit).toHaveBeenCalledWith(expect.objectContaining({manifestValues:{seal:"SYN-SEAL"}}));
});
it("requires a saved approved destination when starting a commercial run",()=>{const submit=vi.fn(),destination={id:"70000000-0000-4000-8000-000000000001",revision:1,name:"Synthetic Disposal",kind:"disposal" as const,address:"123 Test Rd",latitude:35,longitude:-97,materials:[],hours:"",instructions:"",active:true,ownerType:"vendor" as const,ownerId:609};render(<FleetRunAction run={{...run,commercial:{ticketId:88,originSiteId:392,mode:"batch",rateCents:2000,currency:"USD",approvedDestinations:[destination],destinationId:null,billedLineId:null}}} action="start" disabled={false} onSubmit={submit}/>);fireEvent.click(screen.getByRole("button",{name:"start"}));expect(submit).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Synthetic Disposal · 123 Test Rd"}));fireEvent.click(screen.getByRole("button",{name:"start"}));expect(submit).toHaveBeenCalledWith({destinationId:destination.id});});
it("shows the physical destination name for commercial delivery stops",()=>{const destination={id:"70000000-0000-4000-8000-000000000001",revision:1,name:"Synthetic Disposal",kind:"disposal" as const,address:"123 Test Rd",latitude:35,longitude:-97,materials:[],hours:"",instructions:"",active:true,ownerType:"vendor" as const,ownerId:609};render(<FleetRunAction run={{...run,stops:[{id:"80000000-0000-4000-8000-000000000001",siteId:392,kind:"delivery",sequence:1,destination}]}} action="arrive_stop" disabled={false} onSubmit={()=>{}}/>);expect(screen.getByRole("button",{name:"2. delivery · Synthetic Disposal"})).toBeTruthy();});

it("requires explicit actual billable hours when office accepts an hourly run",()=>{
 const submit=vi.fn();
 render(<FleetRunAction run={{...run,billing:{afeNumber:"AFE-SYN",workDate:"2026-10-16",billedLineId:null,unit:"per_hour"}}} action="review" disabled={false} onSubmit={submit}/>);
 fireEvent.click(screen.getByRole("button",{name:"Accept Fleet closeout"}));fireEvent.change(screen.getByLabelText("review reason"),{target:{value:"Office verified actual hours"}});fireEvent.click(screen.getByRole("button",{name:"review"}));expect(submit).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("review billingQuantity"),{target:{value:"2.5"}});fireEvent.click(screen.getByRole("button",{name:"review"}));expect(submit).toHaveBeenCalledWith({reason:"Office verified actual hours",decision:"accept",billingQuantity:2.5});
});
