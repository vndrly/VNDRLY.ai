import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import WorkHubPage from "./work-hub";

const env=vi.hoisted(()=>({path:"/work-hub/tasks",request:vi.fn()}));
vi.mock("wouter",()=>({useLocation:()=>[env.path,vi.fn()],useSearch:()=>"",Redirect:()=>null}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:7,role:"vendor",vendorId:1054,partnerId:null,membershipRole:"admin",activeMembershipId:1}})}));
vi.mock("@/lib/work-hub-client",async original=>({...await original<any>(),workHubRequest:env.request}));
vi.mock("@/components/work-hub/library/assigned-cards",()=>({default:()=> <div>My training assignments</div>}));
vi.mock("@/components/work-hub/form-campaigns",()=>({default:({management}:any)=><div>{management?"Campaign management":"My campaign assignments"}</div>}));
vi.mock("@/components/implementation-a/client",()=>({implementationARequest:async()=>({sponsorships:[]})}));
afterEach(cleanup);
function mount(path:string,readAdmin:()=>any=()=>({checklists:[],forms:[],announcements:[],approvals:[]})){
 env.path=path;
 env.request.mockReset().mockImplementation(async (url:string)=>{
  if(url==="/tasks")return [{id:"mine",title:"My task",assigneeUserId:7,status:"open",priority:"normal",version:1},{id:"other",title:"Another employee task",assigneeUserId:8,status:"open",priority:"normal",version:1},{id:"unassigned",title:"Unassigned office task",assigneeUserId:null,status:"open",priority:"normal",version:1}];
  if(url.startsWith("/gate-task-hopper/options"))return {gates:[],people:[],canManage:true,canComplete:true};
  if(url.startsWith("/gate-task-hopper"))return {tasks:[],total:0,nextBefore:null};
  if(url==="/required-actions")return {checklists:[],forms:[],approvals:[]};
  if(url==="/admin")return readAdmin();
  return [];
 });
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><WorkHubPage/></QueryClientProvider>);
}
it("shows only the administrator's own assignments on Tasks & Forms",async()=>{
 mount("/work-hub/tasks");
 expect(await screen.findByText("My task")).toBeTruthy();
 expect(screen.queryByText("Another employee task")).toBeNull();
 expect(screen.queryByText("Unassigned office task")).toBeNull();
 expect(screen.getByText("My training assignments")).toBeTruthy();
 expect(screen.queryByRole("region",{name:"Unassigned Task Hopper"})).toBeNull();
 expect(screen.queryByText("Assign task")).toBeNull();
 expect(screen.queryByRole("button",{name:"Create checklist"})).toBeNull();
 expect(screen.queryByText("Campaign management")).toBeNull();
 expect(env.request.mock.calls.some(([url])=>url==="/admin")).toBe(false);
});
it("keeps company task-management controls without the duplicate hopper on Managed Crews",async()=>{
 mount("/work-hub/managed-crews");
 expect(screen.queryByText("Another employee task")).toBeNull();
 expect(screen.queryByText("Unassigned office task")).toBeNull();
 expect(screen.getByRole("region",{name:"Tasks",exact:true})).toBeTruthy();
 expect(screen.queryByRole("region",{name:"Unassigned Task Hopper"})).toBeNull();
 expect(screen.queryByRole("textbox",{name:"Unassigned task"})).toBeNull();
 expect(screen.queryByRole("button",{name:"Add task"})).toBeNull();
 expect(screen.queryByText("Assign task")).toBeNull();
 expect(screen.getByRole("button",{name:"Create checklist"})).toBeTruthy();
 expect(screen.queryByText("Campaign management")).toBeNull();
 expect(screen.queryByText("My training assignments")).toBeNull();
 expect(env.request.mock.calls.some(([url])=>url==="/required-actions")).toBe(false);
});
it("shows saved checklists above the creator card",async()=>{
 mount("/work-hub/managed-crews",()=>({checklists:[{id:"saved-checklist",name:"Equipment inspection",currentVersion:1,workTypeId:22,workTypeName:"Equipment service",definition:[{id:"inspect",label:"Inspect equipment"}]}],forms:[],workTypes:[{id:22,name:"Equipment service"}]}));
 const list=screen.getByRole("region",{name:"Created checklists"});
 expect(await within(list).findByText("Equipment inspection")).toBeTruthy();
 expect(within(list).getByText("Work type: Equipment service")).toBeTruthy();
 expect(within(list).queryByText("No created checklists yet.")).toBeNull();
 expect(list.compareDocumentPosition(screen.getByRole("button",{name:"Create checklist"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("refreshes the created checklist list after creation without reloading the page",async()=>{
 let saved:any[]=[];
 mount("/work-hub/managed-crews",()=>({checklists:saved,forms:[],workTypes:[{id:22,name:"Equipment service"}]}));
 expect(await screen.findByText("No created checklists yet.")).toBeTruthy();
 const readRequest=env.request.getMockImplementation()!;
 env.request.mockImplementation(async(url:string,options:any)=>{
  if(url==="/admin/checklists"){
   const {payload}=JSON.parse(options.body);
   expect(payload.workTypeId).toBe(22);
   saved=[{id:"new-checklist",name:payload.name,definition:payload.definition,workTypeId:payload.workTypeId,workTypeName:"Equipment service",currentVersion:1}];
   return saved[0];
  }
  return readRequest(url,options);
 });
 fireEvent.change(screen.getByRole("textbox",{name:"Name",exact:true}),{target:{value:"Pre-trip inspection"}});
 fireEvent.change(screen.getByRole("combobox",{name:"Work type",exact:true}),{target:{value:"22"}});
 fireEvent.click(screen.getByRole("button",{name:"Create checklist",exact:true}));
 const list=screen.getByRole("region",{name:"Created checklists"});
 expect(await within(list).findByText("Pre-trip inspection")).toBeTruthy();
 expect(within(list).queryByText("No created checklists yet.")).toBeNull();
});
it("shows a service once across partners and saves Other without a work type",async()=>{
 mount("/work-hub/managed-crews",()=>({checklists:[],forms:[],workTypes:[{id:210,name:"Gatekeeping",partnerName:"Flywheel Energy"},{id:967676,name:"Gatekeeping",partnerName:"Warwick Energy Group"}]}));
 expect(await screen.findByRole("option",{name:"Gatekeeping",exact:true})).toBeTruthy();
 expect(screen.getAllByRole("option",{name:"Gatekeeping",exact:true})).toHaveLength(1);
 expect(screen.queryByRole("option",{name:/Flywheel|Warwick/})).toBeNull();
 const readRequest=env.request.getMockImplementation()!;
 let createdPayload:any;
 env.request.mockImplementation(async(url:string,options:any)=>{
  if(url==="/admin/checklists"){
   createdPayload=JSON.parse(options.body).payload;
   return {id:"other-checklist"};
  }
  return readRequest(url,options);
 });
 fireEvent.change(screen.getByRole("textbox",{name:"Name",exact:true}),{target:{value:"End of shift"}});
 fireEvent.change(screen.getByRole("combobox",{name:"Work type",exact:true}),{target:{value:"other"}});
 fireEvent.click(screen.getByRole("button",{name:"Create checklist",exact:true}));
 await screen.findByText("No work type attached.");
 await waitFor(()=>expect(createdPayload).toMatchObject({name:"End of shift",workTypeId:null}));
});
