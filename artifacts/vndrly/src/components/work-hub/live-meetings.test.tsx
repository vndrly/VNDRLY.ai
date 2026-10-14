import React from "react";
import {render,screen,cleanup} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({query:{isError:true,error:{status:403},data:{meeting:{admissionMode:"host_approval",canEnter:true,canManage:true},requests:[],members:[{name:"Private member"}]},refetch:vi.fn()}}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>m.query,useMutation:()=>({mutate:vi.fn()})}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:7}})}));
vi.mock("@/components/brand-pill-button",()=>({default:({children,onClick}:any)=><button onClick={onClick}>{children}</button>}));
import {LiveMeetingLobby} from "./live-meetings";
afterEach(cleanup);
it("hides cached room contents and company people after access is revoked",()=>{
 render(<LiveMeetingLobby occurrenceId="10000000-0000-4000-8000-000000000002" owner={{type:"vendor",id:12}}><div>Private room</div></LiveMeetingLobby>);
 expect(screen.queryByText("Private room")).toBeNull();expect(screen.queryByText("Private member")).toBeNull();expect(screen.getByRole("alert")).toBeTruthy();
});
