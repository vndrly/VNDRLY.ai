import { describe,expect,it,vi } from "vitest";
vi.mock("@workspace/db",()=>({pool:{query:vi.fn()}}));
vi.mock("./gate-watch-ticket",()=>({gateWatchTicketReadiness:vi.fn()}));
vi.mock("./gate-change-over",()=>({listChangeOverSites:vi.fn(),ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}));
import { firstWatchStep, type FirstWatchRecord } from "./account-next-steps";
import { readAccountNextSteps,saveAccountCoi } from "./account-next-steps";
import { pool } from "@workspace/db";
const storage=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('../lib/objectStorage',()=>({ObjectStorageService:class{getStoredObject=storage.get;}}));
const row: FirstWatchRecord={siteId:1,stationId:"main",siteName:"Lease A",stationName:"Main",employeeId:null,shiftId:null,assignedUserId:null,watchId:null,ticketId:null};
describe("saved first watch workflow",()=>{
  it("omits completed worker setup and does not invent missing credential records",async()=>{
    vi.mocked(pool.query).mockClear();
    for(const rows of [[{role:"field_employee"}],[{operations_categories:["field"]}],[{id:3,first_name:"Gate",last_name:"Worker",email:"gate@example.invalid",phone:"5555555555",photo_url:"saved.jpg"}],[]]) vi.mocked(pool.query).mockResolvedValueOnce({rows,rowCount:rows.length} as never);
    expect(await readAccountNextSteps({userId:7,vendorId:4,activeMembershipId:2,sv:1,role:"field_employee"})).toEqual({setup:[],credentials:[],firstWatch:null});
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
    expect(firstWatchStep([],7,true).action?.title).toBe("Set up a gate site and station");
    expect(firstWatchStep([row],7,true).action?.title).toContain("access");
    expect(firstWatchStep([{...row,employeeId:3}],7,true).action?.title).toContain("Create a shift");
    expect(firstWatchStep([{...row,employeeId:3,shiftId:"shift"}],7,true).action?.title).toContain("Assign an eligible");
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
