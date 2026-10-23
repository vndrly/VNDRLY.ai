import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),access:vi.fn(),delivery:vi.fn(),publish:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:m.query}}));
vi.mock("./gate-change-over",()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}},requireChangeOverAccess:m.access,changeOverTransaction:async(fn:any)=>fn({query:m.query})}));
vi.mock("./gate-alert-repository",()=>({processPendingGateAlert:m.delivery}));
vi.mock("../lib/notification-events",()=>({publishNotificationCreated:m.publish}));
import {respondToScheduledWatch,listMyScheduledWatches} from "./gate-watch-schedule";
let hours=12,receipt:any=null,assignmentStatus="assigned",version=2;
const actor={userId:7,vendorId:4,activeMembershipId:2,sv:1,role:"vendor"};
const input={operationId:"op",expectedVersion:2,assignmentId:"assignment",response:"conflict" as const,reason:"Private appointment"};
beforeEach(()=>{
  vi.clearAllMocks();hours=12;receipt=null;assignmentStatus="assigned";version=2;m.access.mockResolvedValue({site:{name:"Antelope Draw"}});
  m.query.mockImplementation(async(sql:string,args:any[]=[])=>{
    let rows:any[]=[];
    if(sql.startsWith("SELECT u.display_name"))rows=[{display_name:"Gatekeeper"}];
    else if(sql.startsWith("SELECT result_json"))rows=receipt?[{result_json:receipt}]:[];
    else if(sql.startsWith("SELECT s.*,a.id"))rows=[{id:"shift",assignment_id:"assignment",assignment_status:assignmentStatus,version,gate_station_id:"gate",site_location_id:3,scheduler_id:8,starts_at:new Date(Date.now()+hours*3600000),ends_at:new Date(Date.now()+(hours+12)*3600000),timezone:"America/Chicago"}];
    else if(sql.startsWith("SELECT name FROM"))rows=[{name:"Main Gate"}];
    else if(sql.startsWith("SELECT m.user_id"))rows=[{user_id:8}];
    else if(sql.startsWith("SELECT DISTINCT m.user_id"))rows=[{user_id:8},{user_id:9},{user_id:10}];
    else if(sql.startsWith("INSERT INTO notifications"))rows=[{id:args[0],userId:args[0],type:args[1],title:args[2],body:args[3],link:args[4],createdAt:new Date()}];
    else if(sql.startsWith("INSERT INTO work_hub_client_operations"))receipt=JSON.parse(args[5]);
    else if(sql.startsWith("SELECT s.id,s.title"))rows=[];
    else if(!/^(SELECT pg_advisory|UPDATE work_hub_shift_requests|INSERT INTO work_hub_shift_requests|UPDATE work_hub_shift_assignments|UPDATE workforce_assignment_states)/.test(sql))throw Error(`Unexpected query ${sql}`);
    return {rows,rowCount:rows.length};
  });
});
it("notifies the scheduler and all same-company office/admin once for an under-24-hour conflict",async()=>{
  const result=await respondToScheduledWatch(actor,"shift",input);
  expect(result).toMatchObject({response:"conflict",escalated:true,notifiedCount:3});
  const notices=m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO notifications"));expect(notices).toHaveLength(3);
  for(const [,args] of notices){expect(args[1]).toBe("gate_watch_conflict_urgent");expect(args[3]).not.toContain("Private appointment");}
  expect(m.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE work_hub_shift_assignments"))).toBe(false);
  expect(m.delivery).toHaveBeenCalledTimes(3);
  expect(m.query.mock.calls.find(([sql])=>sql.startsWith("UPDATE workforce_assignment_states"))![1]).toEqual(["shift",7,"declined"]);
});
it("notifies only the scheduler when a conflict has at least 24 hours notice",async()=>{
  hours=30;expect(await respondToScheduledWatch(actor,"shift",input)).toMatchObject({escalated:false,notifiedCount:1});
  expect(m.query.mock.calls.some(([sql])=>sql.startsWith("SELECT DISTINCT m.user_id"))).toBe(false);
});
it("includes the reporting worker when they also belong to office/admin, without a self-notification exception",async()=>{
  const query=m.query.getMockImplementation()!;
  m.query.mockImplementation((sql:string,args:any[]=[])=>sql.startsWith("SELECT DISTINCT m.user_id")?{rows:[{user_id:7},{user_id:8},{user_id:9}],rowCount:3}:query(sql,args));
  expect(await respondToScheduledWatch(actor,"shift",input)).toMatchObject({notifiedCount:3});
  expect(m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO notifications")).map(([,args])=>args[0])).toContain(7);
});
it("confirms only the signed-in worker's assignment without changing physical watch, authentication or timekeeping",async()=>{
  expect(await respondToScheduledWatch(actor,"shift",{...input,response:"confirm",reason:undefined})).toMatchObject({response:"confirm",escalated:false});
  expect(m.query).toHaveBeenCalledWith("UPDATE work_hub_shift_assignments SET status='accepted' WHERE id=$1 AND user_id=$2",["assignment",7]);
  expect(m.query.mock.calls.find(([sql])=>sql.startsWith("UPDATE workforce_assignment_states"))![1]).toEqual(["shift",7,"acknowledged"]);
  expect(m.query.mock.calls.some(([sql])=>/UPDATE users|INSERT INTO gate_shifts|workday|gate_work_sessions/.test(sql))).toBe(false);
});
it("replays the original operation without duplicate response records or notifications",async()=>{
  await respondToScheduledWatch(actor,"shift",input);await respondToScheduledWatch(actor,"shift",input);
  expect(m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO work_hub_shift_requests"))).toHaveLength(1);
  expect(m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO notifications"))).toHaveLength(3);
  await expect(respondToScheduledWatch(actor,"shift",{...input,reason:"changed"})).rejects.toMatchObject({status:409});
});
it.each(["cancelled","declined"])("rejects a removed assignment (%s)",async(status)=>{assignmentStatus=status;await expect(respondToScheduledWatch(actor,"shift",input)).rejects.toMatchObject({status:409});expect(m.delivery).not.toHaveBeenCalled();});
it("rejects stale schedule versions and blank conflict reasons",async()=>{
  version=3;await expect(respondToScheduledWatch(actor,"shift",input)).rejects.toMatchObject({status:409});
  version=2;await expect(respondToScheduledWatch(actor,"shift",{...input,reason:"  "})).rejects.toMatchObject({status:400});
});
it("returns no made-up schedules when there are no personal assignments",async()=>{expect(await listMyScheduledWatches(actor)).toEqual({watches:[]});});
