import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GateShiftNoteContent } from "./gate-shift-note-content";
afterEach(cleanup);
it("collapses saved statistics, removes repeated task text and disclaimer, and lists recorded resolutions",()=>{
 const instruction="Verify east gate arm lamp after dusk.";
 const note:any={notes:`Radio accounted for. ${instruction} [gatego-operations-v2] Fictional GateGo test data; no real attendance, GPS proof, payroll approval or payment.`,snapshot:{metrics:{checkIns:4,checkOuts:2,pendingAdmission:1},exceptions:[],openItems:[],taskItems:[{id:"1",text:instruction,status:"resolved",resolution:"Replaced lamp; tested working."}]}};
 const {container}=render(<GateShiftNoteContent note={note}/>);
 expect(container.querySelectorAll("details")).toHaveLength(4);
 expect([...container.querySelectorAll("details")].every(row => !row.open)).toBe(true);
 expect(screen.getAllByText(instruction)).toHaveLength(1);
 expect(screen.getByText("Resolution: Replaced lamp; tested working.")).toBeTruthy();
 expect(container.textContent).not.toContain("Fictional GateGo");
 expect(container.textContent).toContain("Radio accounted for.");
});
