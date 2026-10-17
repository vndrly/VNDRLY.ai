import React from "react";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import FleetCoverageRequirementFields from "./FleetCoverageRequirementFields";
vi.mock("@/hooks/useColors",()=>({useColors:()=>({text:"white",card:"gray",primary:"gold"})}));
vi.mock("./FleetChoiceField",()=>({default:({label,value,onChange,disabled,options}:any)=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">Choose</option>{options.map((row:any)=><option key={row.id} value={row.id}>{row.label}</option>)}</select>}));
afterEach(cleanup);
it("preserves exact native coverage terms without guessing a default filing decision or minimum",()=>{
 const changed=vi.fn();render(<FleetCoverageRequirementFields onChange={changed}/>);fireEvent.change(screen.getByLabelText("Coverage required"),{target:{value:"auto_liability"}});fireEvent.change(screen.getByLabelText("Exact minimum limit (USD)"),{target:{value:"750000.000000001"}});expect(changed).toHaveBeenLastCalledWith(undefined);
 fireEvent.change(screen.getByLabelText("Government filing required for this requirement"),{target:{value:"yes"}});expect(changed).toHaveBeenLastCalledWith({coverageType:"auto_liability",requiredLimitUSD:"750000.000000001",filingRequired:true});fireEvent.change(screen.getByLabelText("Exact minimum limit (USD)"),{target:{value:""}});expect(changed).toHaveBeenLastCalledWith(undefined);
});
