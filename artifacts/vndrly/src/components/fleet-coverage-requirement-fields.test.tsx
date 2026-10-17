import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import {FleetCoverageRequirementFields} from "./fleet-coverage-requirement-fields";
afterEach(cleanup);
it("leaves coverage terms unresolved until type, exact reviewed limit and filing applicability are explicitly chosen",()=>{
 const changed=vi.fn();render(<FleetCoverageRequirementFields onChange={changed}/>);
 expect((screen.getByLabelText("Coverage required") as HTMLSelectElement).value).toBe("");
 fireEvent.change(screen.getByLabelText("Coverage required"),{target:{value:"auto_liability"}});fireEvent.change(screen.getByLabelText("Exact minimum limit (USD)"),{target:{value:"750000.000000001"}});expect(changed).toHaveBeenLastCalledWith(undefined);
 fireEvent.change(screen.getByLabelText("Government filing required for this requirement"),{target:{value:"yes"}});expect(changed).toHaveBeenLastCalledWith({coverageType:"auto_liability",requiredLimitUSD:"750000.000000001",filingRequired:true});
 fireEvent.change(screen.getByLabelText("Exact minimum limit (USD)"),{target:{value:"1e6"}});expect(changed).toHaveBeenLastCalledWith(undefined);expect(screen.getByText(/Coverage terms unresolved/)).toBeTruthy();
});
it("shows an existing reviewed coverage requirement and respects view-only state",()=>{
 render(<FleetCoverageRequirementFields disabled value={{coverageType:"cargo",requiredLimitUSD:"50000.000000001",filingRequired:false}} onChange={vi.fn()}/>);
 expect((screen.getByLabelText("Exact minimum limit (USD)") as HTMLInputElement).value).toBe("50000.000000001");expect(screen.getByLabelText("Coverage required").matches(":disabled")).toBe(true);expect((screen.getByLabelText("Government filing required for this requirement") as HTMLSelectElement).value).toBe("no");
});
