import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),deliver:vi.fn(),publish:vi.fn(),clock:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:m.query,connect:m.connect}}));
vi.mock("./gate-workday",()=>({recordGateWorkday:m.clock,endGateWorkdayForRecovery:m.clock}));
vi.mock("../work-hub/required-work-guard",()=>({assertRequiredWorkClear:vi.fn()}));
vi.mock("./gate-notification-events",()=>({notifyGateSiteEvent:vi.fn()}));
vi.mock("./gate-alert-repository",()=>({processPendingGateAlert:m.deliver}));
vi.mock("../lib/notification-events",()=>({publishNotificationCreated:m.publish}));
import {administerGateWatch,listAvailableGateWatchStanders} from "./gate-change-over";
const session={userId:7,role:"vendor",vendorId:4,activeMembershipId:2,membershipRole:"admin",sv:1};
const command={stationId:"gate",expectedShiftId:"old-watch",operationId:"op",action:"assign" as const,targetMembershipId:18};
let administrator:boolean,occupied:boolean,currentId:string,receipt:any;
beforeEach(()=>{
  vi.clearAllMocks();administrator=true;occupied=false;currentId="old-watch";receipt=null;
  m.connect.mockResolvedValue({query:m.query,release:vi.fn()});
  m.deliver.mockImplementation(async()=>{expect(m.query.mock.calls.some(([sql])=>sql==="COMMIT")).toBe(true);});
  m.query.mockImplementation(async(sql:string,args:any[]=[])=>{
    let rows:any[]=[];
    if(sql.startsWith("SELECT * FROM gate_stations"))rows=[{id:"gate",site_id:3,name:"Main Gate",active:true}];
    else if(sql.startsWith("SELECT id, role, session_version"))rows=[{id:args[0],role:"vendor",session_version:1,display_name:"Admin"}];
    else if(sql.startsWith("SELECT id, name, partner_id"))rows=[{id:3,name:"Antelope Draw",partner_id:5}];
    else if(sql.startsWith("SELECT id FROM site_work_assignments"))rows=[{id:1}];
    else if(sql.startsWith("SELECT id, vendor_people_id, role FROM user_org_memberships"))rows=[{id:args[0]===7?2:18,vendor_people_id:args[0]===7?70:80,role:args[0]===7?"admin":"field_employee"}];
    else if(sql.startsWith("SELECT id FROM user_org_memberships"))rows=administrator?[{id:2}]:[];
    else if(sql.startsWith("SELECT r.role FROM vendor_person_operational_roles"))rows=[{role:"gatekeeper"}];
    else if(sql.includes("SELECT m.id AS membership_id"))rows=[{membership_id:18,user_id:8,vendor_id:4,vendor_people_id:80,role:"field_employee",session_version:1,name:"Available Worker",company_name:"GateGo"},{membership_id:19,user_id:9,vendor_id:4,vendor_people_id:90,role:"field_employee",session_version:1,name:"Busy Worker",company_name:"GateGo"}];
    else if(sql.startsWith("SELECT DISTINCT operator_id"))rows=[{operator_id:9}];
    else if(sql.startsWith("SELECT DISTINCT p.user_id"))rows=[{user_id:8}];
    else if(sql.startsWith("SELECT result_json"))rows=receipt?[{result_json:receipt}]:[];
    else if(sql.startsWith("SELECT s.*, u.display_name"))rows=[{id:currentId,station_id:"gate",operator_id:9,operator_name:"Outgoing",started_at:"2026-10-23T06:00:00Z",preparation_id:"old-prep"}];
    else if(sql.startsWith("SELECT id FROM gate_shifts WHERE operator_id"))rows=occupied?[{id:"other-watch"}]:[];
    else if(sql.startsWith("SELECT notes FROM gate_preparations"))rows=[{notes:"East lane inspection due"}];
    else if(sql.startsWith("SELECT s.id,s.title,s.ends_at"))rows=[{id:"scheduled-post",title:"Day gate post",ends_at:"2026-10-23T23:00:00Z"}];
    else if(sql.startsWith("INSERT INTO gate_shifts")){currentId="new-watch";rows=[{id:currentId}];}
    else if(sql.startsWith("INSERT INTO notifications"))rows=[{id:99,userId:8,type:"gate_watch_assigned",title:args[1],body:args[2],link:args[3],createdAt:new Date().toISOString()}];
    else if(sql.startsWith("INSERT INTO work_hub_client_operations"))receipt=JSON.parse(args[4]);
    else if(sql.startsWith("INSERT INTO gate_")||sql.startsWith("UPDATE gate_")||sql.startsWith("UPDATE work_hub_shift")||sql.startsWith("INSERT INTO work_hub_shift")||sql.startsWith("SELECT id FROM users")||sql.startsWith("SELECT id FROM gate_stations")||sql.includes("FROM gate_shift_actions")||sql.includes("FROM site_visits WHERE")||["BEGIN","COMMIT","ROLLBACK"].includes(sql)||sql.startsWith("SET LOCAL")){}
    else throw Error(`Unexpected effect: ${sql}`);
    return {rows,rowCount:rows.length};
  });
});
it("lists only available authorized watch standers for an administrator",async()=>{
  expect(await listAvailableGateWatchStanders(session,"gate")).toEqual({operators:[{userId:8,membershipId:18,name:"Available Worker",companyName:"GateGo"}]});
});
it("assigns the exact current watch and scheduled shift, commits the alert, then dispatches",async()=>{
  expect(await administerGateWatch(session,command)).toMatchObject({watchId:"new-watch",workerUserId:8,shiftId:"scheduled-post",notification:{id:99}});
  expect(m.deliver).toHaveBeenCalledOnce();expect(m.publish).toHaveBeenCalledOnce();
  const prep=m.query.mock.calls.find(([sql])=>sql.startsWith("INSERT INTO gate_preparations"))!;
  expect(prep[1][4]).toBe("East lane inspection due");
  expect(JSON.parse(prep[1][5]).administrativeTransfer).toMatchObject({actorId:7,assignedUserId:8,assigneeAcknowledged:false,physicalAttendanceVerified:false});
  expect(m.query.mock.calls.find(([sql])=>sql.startsWith("INSERT INTO work_hub_shift_assignments"))![1]).toEqual(["scheduled-post",8,7]);
  expect(m.query.mock.calls.find(([sql])=>sql.startsWith("INSERT INTO notifications"))![1][0]).toBe(8);
  expect(m.clock).not.toHaveBeenCalled();
  expect(m.query.mock.calls.some(([sql])=>/UPDATE users|UPDATE gate_work_sessions/.test(sql))).toBe(false);
});
it("assumes immediately as the signed-in administrator without requiring outgoing preparation",async()=>{
  expect(await administerGateWatch(session,{...command,action:"assume",targetMembershipId:undefined})).toMatchObject({workerUserId:7,notification:null});
  expect(m.deliver).not.toHaveBeenCalled();expect(m.clock).not.toHaveBeenCalled();
});
it.each(["not-admin","stale-watch","became-busy"])("rejects %s before making an assignment",async(reason)=>{
  if(reason==="not-admin")administrator=false;if(reason==="stale-watch")currentId="later-watch";if(reason==="became-busy")occupied=true;
  await expect(administerGateWatch(session,command)).rejects.toMatchObject({code:reason==="not-admin"?"change_over.admin_required":reason==="stale-watch"?"change_over.shift_changed":"change_over.operator_on_watch"});
  expect(m.query.mock.calls.some(([sql])=>sql.startsWith("INSERT ")||sql.startsWith("UPDATE "))).toBe(false);expect(m.deliver).not.toHaveBeenCalled();
});
it("replays the saved result without another assignment or duplicate notification",async()=>{
  await administerGateWatch(session,command);await administerGateWatch(session,command);
  expect(m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO gate_shifts"))).toHaveLength(1);
  expect(m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO notifications"))).toHaveLength(1);
  await expect(administerGateWatch(session,{...command,targetMembershipId:19})).rejects.toMatchObject({code:"change_over.operation_conflict"});
});
