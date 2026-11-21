import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ManagedCrews } from "./managed-crews";
vi.mock("@/components/work-hub/work-crews",()=>({WorkCrews:()=> <section aria-label="Current work crews"/>}));
vi.mock("@/components/work-hub/dashboard-tasks",()=>({default:()=> <section aria-label="Tasks"/>}));
vi.mock("@/components/work-hub/chrome",()=>({WorkHubPageHeading:({title}:any)=><h1>{title}</h1>,WORK_HUB_CARD_CLASS:""}));
it("shows crews before tasks without requesting sponsored workers",()=>{
 const request=vi.fn();vi.stubGlobal("fetch",request);
 render(<ManagedCrews personalTasks={<section aria-label="My Tasks"/>}/>);
 expect(screen.getByRole("heading",{name:"Tasks & Crews"})).toBeTruthy();
 expect(screen.getByRole("region",{name:"Current work crews"}).compareDocumentPosition(screen.getByRole("region",{name:"Tasks"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.getByRole("region",{name:"My Tasks"})).toBeTruthy();expect(request).not.toHaveBeenCalled();
});
