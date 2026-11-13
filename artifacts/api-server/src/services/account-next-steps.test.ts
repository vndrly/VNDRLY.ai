import { describe,expect,it,vi } from "vitest";
vi.mock("@workspace/db",()=>({pool:{query:vi.fn()}}));
vi.mock("./gate-watch-ticket",()=>({gateWatchTicketReadiness:vi.fn()}));
const helperProgress=vi.hoisted(()=>({independentThreshold:3,independentCompletions:{"first-watch":0}}));
vi.mock("./workflow-helper-progress",()=>({readWorkflowHelperProgress:vi.fn(async()=>helperProgress)}));
vi.mock("./gate-change-over",()=>({listChangeOverSites:vi.fn(),ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}));
import { firstWatchStep, type FirstWatchRecord } from "./account-next-steps";
import { readAccountNextSteps,saveAccountCoi } from "./account-next-steps";
import { pool } from "@workspace/db";
import { listChangeOverSites } from "./gate-change-over";
import { gateWatchTicketReadiness } from "./gate-watch-ticket";
const storage=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('../lib/objectStorage',()=>({ObjectStorageService:class{getStoredObject=storage.get;}}));
const row: FirstWatchRecord={siteId:1,stationId:"main",siteName:"Lease A",stationName:"Main",employeeId:null,shiftId:null,assignedUserId:null,watchId:null,ticketId:null};
it("keeps a saved watch awaiting its ticket ahead of an earlier unstarted station", () => {
  const saved = {...row, siteId:2, stationId:"south", employeeId:3, shiftId:"shift", assignedUserId:7, watchId:"watch"};
  expect(firstWatchStep([row, saved], 7, true)).toMatchObject({action:null, context:{watchId:"watch"}});
  expect(firstWatchStep([{...saved, ticketId:100}], 8, false)).toMatchObject({complete:false, action:null, context:null});
});
describe("saved first watch workflow",()=>{
  it("omits completed worker setup and does not invent missing credential records",async()=>{
    vi.mocked(pool.query).mockClear();
    for(const rows of [[{role:"field_employee"}],[{operations_categories:["field"]}],[{id:3,first_name:"Gate",last_name:"Worker",email:"gate@example.invalid",phone:"5555555555",photo_url:"saved.jpg"}],[]]) vi.mocked(pool.query).mockResolvedValueOnce({rows,rowCount:rows.length} as never);
    expect(await readAccountNextSteps({userId:7,vendorId:4,activeMembershipId:2,sv:1,role:"field_employee"})).toEqual({setup:[],credentials:[],firstWatch:null,helperProgress});
    expect(vi.mocked(pool.query).mock.calls.some(([sql])=>String(sql).includes("training"))).toBe(false);
    vi.mocked(pool.query).mockClear();
  });
  it("keeps employee office setup read-only and picks their own saved assignment",()=>{
    expect(firstWatchStep([row],7,false)).toMatchObject({action:null});
    expect(firstWatchStep([],7,false)).toMatchObject({action:null});
    expect(firstWatchStep([row,{...row,shiftId:"mine",employeeId:3,assignedUserId:7}],7,false).action?.title).toBe("Assume Watch");
  });
  it("rejects a removed current company membership before reading setup records",async()=>{
    vi.mocked(pool.query).mockResolvedValueOnce({rows:[],rowCount:0} as never);
    await expect(readAccountNextSteps({userId:7,vendorId:4,activeMembershipId:2,sv:1})).rejects.toThrow("Current company membership required");
    expect(pool.query).toHaveBeenCalledTimes(1);
    vi.mocked(pool.query).mockClear();
  });
  it("shows one blocking action at each unfinished step",()=>{
    expect(firstWatchStep([],7,true,[{id:1,name:"Lease A"}]).action?.title).toBe("Add a gate station at this site");
    expect(firstWatchStep([row],7,true).action?.title).toContain("access");
    expect(firstWatchStep([{...row,employeeId:3}],7,true).action?.title).toContain("Create a shift");
    expect(firstWatchStep([{...row,employeeId:3,shiftId:"shift"}],7,true).action?.title).toContain("Assign an eligible");
  });
  it("waits for real site authority and preserves an actual authorized site without inventing a station",()=>{
    expect(firstWatchStep([],7,true)).toMatchObject({action:null,message:expect.stringContaining("Gate service authorization"),context:null});
    expect(firstWatchStep([],7,true,[{id:3,name:"Authorized lease"}])).toMatchObject({action:{title:"Add a gate station at this site",href:"/mapping?siteId=3"},context:{siteId:3,siteName:"Authorized lease",stationId:null,stationName:null,employeeId:null}});
  });
  it("advances an eligible managed worker without inventing a direct employee record",()=>{
    const managed={...row,eligibleUserId:7,day:"2026-11-09"};
    expect(firstWatchStep([managed],8,true)).toMatchObject({action:{title:"Create a shift for this gate station",href:"/work-hub/calendar?siteId=1&stationId=main&day=2026-11-09&employee=7"},context:{employeeId:null,eligibleUserId:7}});
    expect(firstWatchStep([{...managed,shiftId:"shift"}],8,true).action?.title).toBe("Assign an eligible gate employee to this shift");
    expect(firstWatchStep([{...managed,shiftId:"shift",assignedUserId:7}],8,true)).toMatchObject({action:null,message:expect.stringContaining("Waiting on the assigned gatekeeper")});
    expect(firstWatchStep([{...managed,shiftId:"shift",assignedUserId:7}],7,false).action).toEqual({title:"Assume Watch",href:"/gate/change-over?siteId=1&stationId=main&shiftId=shift&day=2026-11-09&employee=7"});
  });
  it("keeps a managed worker's watch in progress until its saved ticket exists",()=>{
    const saved={...row,eligibleUserId:7,shiftId:"shift",assignedUserId:7,watchId:"watch"};
    expect(firstWatchStep([saved],7,false)).toMatchObject({complete:false,action:null,message:expect.stringContaining("do not assume"),context:{employeeId:null}});
    expect(firstWatchStep([{...saved,ticketId:100}],8,true)).toMatchObject({complete:true,action:null,context:{employeeId:null,eligibleUserId:7,ticketId:100}});
  });
  it("checks ticket readiness for the selected company, station, shift and managed worker",async()=>{
    vi.mocked(pool.query).mockReset();
    const session={userId:8,vendorId:4,activeMembershipId:2,sv:1,role:"vendor" as const};
    const managed={...row,eligibleUserId:7,employeeKind:"managed" as const,managedOrganizationId:"organization",managedWorkerId:"sponsorship",shiftId:"selected",assignedUserId:7};
    vi.mocked(pool.query).mockResolvedValueOnce({rows:[{role:"admin"}]} as never).mockResolvedValueOnce({rows:[{operations_categories:["gate"],coi_document_url:"/saved.pdf"}]} as never).mockResolvedValueOnce({rows:[managed]} as never);
    vi.mocked(listChangeOverSites).mockResolvedValueOnce([{id:1}] as never);
    vi.mocked(gateWatchTicketReadiness).mockResolvedValueOnce({ticketId:null,ticketBlocker:"gate_ticket.scheduled_ticket_unavailable",shiftId:"selected"});
    vi.mocked(pool.query).mockResolvedValueOnce({rows:[]} as never);
    expect((await readAccountNextSteps(session)).firstWatch).toMatchObject({action:{title:"Review gate service setup"},context:{shiftId:"selected",eligibleUserId:7,employeeId:null,ticketBlocker:"gate_ticket.scheduled_ticket_unavailable"}});
    expect(gateWatchTicketReadiness).toHaveBeenLastCalledWith(pool,{...session,userId:7},"main",1,undefined,false,"selected");
    vi.mocked(pool.query).mockReset();
  });
  it("keeps site, station and shift on the assigned worker's Assume link",()=>{
    const result=firstWatchStep([{...row,employeeId:3,shiftId:"shift",assignedUserId:7}],7,false);
    expect(result.action).toEqual({title:"Assume Watch",href:"/gate/change-over?siteId=1&stationId=main&shiftId=shift"});
    expect(firstWatchStep([{...row,employeeId:3,shiftId:"shift",assignedUserId:7}],8,true).message).toContain("Waiting on the assigned gatekeeper");
    expect(firstWatchStep([{...row,employeeId:3,shiftId:"shift",assignedUserId:7}],7,true).action?.title).toBe("Assume Watch");
  });
  it("does not combine an employee, shift and watch from different stations",()=>{
    const result=firstWatchStep([{...row,employeeId:3},{...row,siteId:2,stationId:"south",shiftId:"other"}],7,true);
    expect(result.action?.title).toContain("Create a shift");
    expect(result.action?.href).toContain("siteId=1&stationId=main");
  });
  it("requires a persisted watch and confirmed ticket, never asks an existing watch to assume again",()=>{
    const saved={...row,employeeId:3,shiftId:"shift",assignedUserId:7,watchId:"watch"};
    expect(firstWatchStep([saved],7,false)).toMatchObject({complete:false,action:null});
    expect(firstWatchStep([saved],7,false).message).toContain("do not assume");
    expect(firstWatchStep([{...saved,ticketId:100}],7,false)).toMatchObject({complete:true,action:null});
    expect(firstWatchStep([{...row,ticketId:100}],7,false).complete).toBe(false);
  });
  it("directs office to saved ticket blockers without offering Start Ticket or another Assume",()=>{
    expect(firstWatchStep([{...row,watchId:"watch",ticketBlocker:"missing_service"}],7,true).action?.title).toBe("Review gate service setup");
    expect(firstWatchStep([{...row,watchId:"watch",ticketBlocker:"missing_service"}],7,false).action).toBeNull();
  });
});

it('counts a saved COI upload as complete without approval or expiration review',async()=>{
  vi.mocked(pool.query).mockReset();
  const session={userId:7,vendorId:4,activeMembershipId:2,sv:1,role:'vendor' as const};
  for(const url of [null,'   ','/api/storage/objects/uploads/saved']){
    vi.mocked(pool.query).mockResolvedValueOnce({rows:[{role:'admin'}]} as never).mockResolvedValueOnce({rows:[{operations_categories:['field'],coi_document_url:url,insurance_expiration_date:'2020-01-01'}]} as never);
    expect((await readAccountNextSteps(session)).coiUploadNeeded).toBe(!url?.trim());
  }
});
it('saves only the current administrator’s finalized private COI and does not mark approval',async()=>{
  vi.mocked(pool.query).mockReset();
  const path='/objects/uploads/11111111-1111-4111-8111-111111111111';
  const session={userId:7,vendorId:4,activeMembershipId:2,sv:1,role:'vendor' as const};
  vi.mocked(pool.query).mockResolvedValueOnce({rows:[{id:2}]} as never).mockResolvedValueOnce({rows:[{id:4}]} as never);
  storage.get.mockResolvedValue({acl:{owner:'7',visibility:'private'},contentType:'application/pdf',size:100});
  expect(await saveAccountCoi(session,path)).toEqual({uploaded:true});
  const [sql,args]=vi.mocked(pool.query).mock.calls[1];
  expect(sql).toContain('coi_document_url=$1');expect(sql).not.toContain('approved_at');expect(args).toEqual(['/api/storage'+path,4,2,7,1]);
  vi.mocked(pool.query).mockReset();vi.mocked(pool.query).mockResolvedValueOnce({rows:[{id:2}]} as never);
  storage.get.mockResolvedValue({acl:{owner:'8',visibility:'private'},contentType:'application/pdf',size:100});
  await expect(saveAccountCoi(session,path)).rejects.toMatchObject({code:'coi.invalid_upload'});
  expect(pool.query).toHaveBeenCalledTimes(1);
  vi.mocked(pool.query).mockReset();vi.mocked(pool.query).mockResolvedValueOnce({rows:[]} as never);
  await expect(saveAccountCoi(session,path)).rejects.toMatchObject({code:'coi.forbidden'});
});
