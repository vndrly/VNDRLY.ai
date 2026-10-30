import {cleanup,render,screen,fireEvent,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {GateMapRevealStaff,type RevealStaffPerson} from "./gate-map-reveal-staff";
const location={latitude:32,longitude:-102,capturedAt:new Date().toISOString()};
const people:RevealStaffPerson[]=[{userId:1,name:"Admin",membershipRole:"admin",fresh:true,location},{userId:2,name:"Office",role:"office",fresh:true,location},{userId:3,name:"Keeper",role:"gatekeeper",groups:[{id:"crew",name:"Night Team"}],fresh:true,location},{userId:4,name:"Contractor",role:"gatekeeper",vendorManaged:true,fresh:false,location:null}];
afterEach(cleanup);
it("reveals a static demonstration location without treating stale real reports as available",()=>{
 const sample={...people[0],fresh:false,demonstration:true};const reveal=vi.fn();
 render(<GateMapRevealStaff people={[sample,people[3]]} es={false} onReveal={reveal} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:"Reveal All"}));expect(reveal).toHaveBeenCalledWith([sample]);
});
it("expands staffing categories and preserves current-location availability",()=>{
 const reveal=vi.fn();render(<GateMapRevealStaff people={people} es={false} onReveal={reveal} onClose={()=>{}}/>);
 fireEvent.click(screen.getByText("Vendor Managed (1)"));expect(within(screen.getByText("Vendor Managed (1)").closest("details")!).getByRole("button",{name:/Contractor/}).hasAttribute("disabled")).toBe(true);
 fireEvent.click(screen.getByText("Administrative Team (1)"));fireEvent.click(within(screen.getByText("Administrative Team (1)").closest("details")!).getByRole("button",{name:"Admin"}));expect(reveal).toHaveBeenCalledWith([people[0]]);
 fireEvent.click(screen.getByRole("button",{name:"Reveal All"}));expect(reveal).toHaveBeenLastCalledWith(people.slice(0,3));
 fireEvent.click(screen.getByText("Groups (1)"));fireEvent.click(screen.getByRole("button",{name:"Reveal Night Team"}));expect(reveal).toHaveBeenLastCalledWith([people[2]]);
});
it("closes on outside, Escape or X without choosing staff",()=>{
 const close=vi.fn(),reveal=vi.fn();render(<GateMapRevealStaff people={people} es={false} onReveal={reveal} onClose={close}/>);
 fireEvent.pointerDown(document.body);fireEvent.keyDown(document,{key:"Escape"});fireEvent.click(screen.getByRole("button",{name:"Close Reveal Staff"}));
 expect(close).toHaveBeenCalledTimes(3);expect(reveal).not.toHaveBeenCalled();
});
