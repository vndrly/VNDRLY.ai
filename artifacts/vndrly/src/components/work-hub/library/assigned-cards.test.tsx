import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import AssignedCards from "./assigned-cards";
const env=vi.hoisted(()=>({items:[] as any[]}));
vi.mock("./use-library",()=>({useLibrary:(_path:string,parse:(data:unknown)=>unknown)=>({data:parse({items:env.items}),error:"",loading:false})}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(key:string)=>key,i18n:{language:"en"}})}));
afterEach(cleanup);
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function item(n:number,title:string,extra:Record<string,unknown>={}){return {instanceId:id(n),title,kind:"training",href:`/work-hub/training/${id(n)}`,assignment:{assignmentId:id(n+1000),sourceItemId:id(n+2000),membershipId:1,contentVersion:1,status:"assigned",assignedAt:"2026-11-01T00:00:00Z",dueAt:"2026-12-01T00:00:00Z"},...extra};}
const certA={id:id(100),title:"Certification A"},certB={id:id(101),title:"Certification B"};
function expand(label:string){const summary=screen.getByText(label,{exact:true});fireEvent.click(summary);return within(summary.closest("details")!);}
it("keeps standalone courses in Additional training without inventing a certification",()=>{
 env.items=[item(1,"Standalone course"),item(2,"Unlinked saved course",{certifications:[],individuallyAssigned:false}),item(3,"Personal form",{kind:"form"})];
 render(<AssignedCards/>);
 expect(document.querySelectorAll('section[aria-label="Training"] > details')).toHaveLength(2);
 const certifications=expand("Assigned certifications"),additional=expand("Additional training");
 expect(certifications.getByText("No assigned certifications.")).toBeTruthy();
 expect(certifications.queryByText("Standalone course")).toBeNull();
 expect(additional.getByText("Standalone course")).toBeTruthy();
 expect(additional.getByText("Unlinked saved course")).toBeTruthy();
 expect(additional.queryByText("Personal form")).toBeNull();
});
it("shows a shared course once per actual certification and leaves extra courses separate",()=>{
 const shared=item(1,"Shared course",{certifications:[certA,certB],individuallyAssigned:false});
 env.items=[shared,shared,item(2,"Extra course")];
 render(<AssignedCards/>);expand("Assigned certifications");const additional=expand("Additional training");
 for(const cert of [certA,certB])expect(within(screen.getByRole("region",{name:cert.title})).getAllByText("Shared course")).toHaveLength(1);
 expect(additional.queryByText("Shared course")).toBeNull();
 expect(additional.getByText("Extra course")).toBeTruthy();
});
it("uses the same saved completion for every certification and respects Complete and Incomplete",()=>{
 const shared=item(1,"Shared course",{certifications:[certA,certB],individuallyAssigned:false});
 shared.assignment.status="completed";
 env.items=[shared,item(2,"Completed extra",{assignment:{...shared.assignment,assignmentId:id(1002)}}),item(3,"Unfinished extra")];
 const view=render(<AssignedCards completed/>);expand("Assigned certifications");const additional=expand("Additional training");
 for(const cert of [certA,certB])expect(within(screen.getByRole("region",{name:cert.title})).getByText("Shared course")).toBeTruthy();
 expect(additional.getByText("Completed extra")).toBeTruthy();
 expect(additional.queryByText("Unfinished extra")).toBeNull();
 view.rerender(<AssignedCards/>);
 expect(screen.queryByRole("region",{name:certA.title})).toBeNull();
 expect(screen.queryByRole("region",{name:certB.title})).toBeNull();
 expect(screen.getByText("Unfinished extra")).toBeTruthy();
});
it("shows two text lines and Start or Continue according to saved course progress",()=>{
 const continuing=item(2,"Started course",{description:"Continue the existing course."});
 continuing.assignment.status="in_progress";
 env.items=[item(1,"New course",{description:"This is the actual course description."}),continuing];
 render(<AssignedCards/>);expand("Additional training");
 const fresh=within(screen.getByRole("article",{name:"New course"}));
 expect(fresh.getByRole("button",{name:"Start"})).toBeTruthy();
 expect(fresh.getByText("This is the actual course description.")).toBeTruthy();
 expect(fresh.queryByText("Training",{exact:true})).toBeNull();
 expect(fresh.queryByRole("time")).toBeNull();
 expect(within(screen.getByRole("article",{name:"Started course"})).getByRole("button",{name:"Continue"})).toBeTruthy();
});
