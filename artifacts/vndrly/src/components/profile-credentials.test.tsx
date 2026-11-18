import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const training = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock("./work-hub/library/use-library", () => ({ useLibrary: () => ({data:training,loading:false,error:""}) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n:{language:"en"} }) }));
vi.mock("./certifications-section", () => ({default:({profileTraining}:any)=><>
  {profileTraining.assigned}<h3>Certifications &amp; Training</h3><div>Industry certifications</div>{profileTraining.completed}
</>}));
import ProfileCredentials from "./profile-credentials";

afterEach(() => {cleanup();training.items=[];vi.restoreAllMocks();});
const item = (id:string,title:string,status:string,extra:Record<string,unknown>={}) => ({
  instanceId:id,title,kind:"training",assignment:{status},href:`/work-hub/training/${id}`,...extra,
});

it("puts assigned training above the certifications header and completed VNDRLY below industry", () => {
  training.items=[item("active","H2S assigned","assigned"),item("earned","H2S complete","completed"),item("cancelled","Cancelled course","cancelled")];
  render(<ProfileCredentials employeeId={12}/>);
  const assigned=screen.getByRole("heading",{name:"My assigned training"});
  const completed=screen.getByRole("button",{name:"VNDRLY/U certifications"});
  expect(assigned.compareDocumentPosition(screen.getByText("Certifications & Training")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Industry certifications").compareDocumentPosition(completed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Extra training"}));
  expect(screen.getByRole("link",{name:"H2S assigned"})).toBeTruthy();
  expect(screen.queryByText("H2S complete")).toBeNull();
  fireEvent.click(completed);
  expect(screen.getByRole("link",{name:"H2S complete"})).toBeTruthy();
  expect(screen.queryByText("Cancelled course")).toBeNull();
});

it("moves a finished assignment to the completed VNDRLY list and keeps pending exams assigned", () => {
  training.items=[item("course","H2S course","in_progress")];
  const view=render(<ProfileCredentials employeeId={12}/>);
  fireEvent.click(screen.getByRole("button",{name:"Extra training"}));
  fireEvent.click(screen.getByRole("button",{name:"VNDRLY/U certifications"}));
  expect(screen.getByText("No VNDRLY certifications yet.")).toBeTruthy();
  training.items=[item("course","H2S course","completed"),item("exam","Pending final exam","completed",{examPending:true})];
  view.rerender(<ProfileCredentials employeeId={12}/>);
  expect(screen.queryByText("No VNDRLY certifications yet.")).toBeNull();
  const assignedList=screen.getByRole("region",{name:"My assigned training"});
  expect(assignedList.textContent).toContain("Pending final exam");
  expect(assignedList.textContent).not.toContain("H2S course");
  const completedList=screen.getByRole("button",{name:"VNDRLY/U certifications"}).closest(".gate-profile-row")!;
  expect(completedList.textContent).toContain("H2S course");
  expect(completedList.textContent).not.toContain("Pending final exam");
});

it("keeps individual assignments in extra training without inventing certification groups", () => {
  training.items=[item("standalone","H2S course","assigned")];
  render(<ProfileCredentials employeeId={12}/>);
  fireEvent.click(screen.getByRole("button",{name:"Assigned certifications"}));
  expect(screen.getByText("No assigned certifications.")).toBeTruthy();
  expect(screen.queryByRole("link",{name:"H2S course"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Extra training"}));
  expect(screen.getByRole("link",{name:"H2S course"})).toBeTruthy();
});

it("shows a shared course once per assigned certification and reflects its one completion in both", () => {
  const links=[{id:"cert-a",title:"Assigned certification A"},{id:"cert-b",title:"Assigned certification B"}];
  const shared=item("shared","Shared course","assigned",{certifications:links,individuallyAssigned:false});
  training.items=[shared,shared,
    item("a","Remaining A","assigned",{certifications:[links[0]],individuallyAssigned:false}),
    item("b","Remaining B","assigned",{certifications:[links[1]],individuallyAssigned:false}),
    item("extra","Standalone course","assigned")];
  const view=render(<ProfileCredentials employeeId={12}/>);
  fireEvent.click(screen.getByRole("button",{name:"Assigned certifications"}));
  fireEvent.click(screen.getByRole("button",{name:"Extra training"}));
  for(const link of links) {
    const group=screen.getByRole("region",{name:link.title});
    expect(within(group).getAllByRole("link",{name:"Shared course"})).toHaveLength(1);
    expect(within(group).queryByText("Standalone course")).toBeNull();
  }
  shared.assignment.status="completed";
  view.rerender(<ProfileCredentials employeeId={12}/>);
  for(const link of links) expect(within(screen.getByRole("region",{name:link.title})).getByText("Completed")).toBeTruthy();
  const extra=screen.getByRole("button",{name:"Extra training"}).closest(".gate-profile-row")!;
  expect(extra.textContent).toContain("Standalone course");
  expect(extra.textContent).not.toContain("Shared course");
});

it("keeps the main heading plain and shows percentages on both lists and extra courses", () => {
  training.items=[item("partial","Partial course","in_progress",{completionPercent:40}),item("done","Finished course","completed")];
  render(<ProfileCredentials employeeId={12}/>);
  expect(screen.queryByLabelText("My assigned training completion")).toBeNull();
  expect(screen.queryByRole("button",{name:"My assigned training"})).toBeNull();
  expect(screen.getByRole("heading",{name:"My assigned training"})).toBeTruthy();
  expect(screen.getByLabelText("Assigned certifications completion").textContent).toBe("0%");
  expect(screen.getByLabelText("Extra training completion").textContent).toBe("70%");
  fireEvent.click(screen.getByRole("button",{name:"Extra training"}));
  expect(screen.getByLabelText("Partial course completion").textContent).toBe("40%");
  expect(screen.queryByText("In progress")).toBeNull();
});

it("colors unfinished percentages by assignment age: green below 60, yellow through 90, red from 91", () => {
  const now=Date.parse("2026-11-18T12:00:00Z");
  vi.spyOn(Date,"now").mockReturnValue(now);
  training.items=[59,60,90,91].map(days=>item(String(days),`Course ${days}`,"assigned",{
    assignment:{status:"assigned",assignedAt:new Date(now-days*86400000).toISOString()},completionPercent:25,
  }));
  render(<ProfileCredentials employeeId={12}/>);
  fireEvent.click(screen.getByRole("button",{name:"Extra training"}));
  expect(screen.getByLabelText("Course 59 completion").style.color).toBe("rgb(74, 222, 128)");
  expect(screen.getByLabelText("Course 60 completion").style.color).toBe("rgb(251, 191, 36)");
  expect(screen.getByLabelText("Course 90 completion").style.color).toBe("rgb(251, 191, 36)");
  expect(screen.getByLabelText("Course 91 completion").style.color).toBe("rgb(248, 113, 113)");
});
