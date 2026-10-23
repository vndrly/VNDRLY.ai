import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),clock:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:m.query,connect:m.connect}}));
vi.mock("./gate-workday",()=>({recordGateWorkday:m.clock,endGateWorkdayForRecovery:m.clock}));
vi.mock("./gate-notification-events",()=>({notifyGateSiteEvent:vi.fn()}));
import {releaseGateWatch} from "./gate-change-over";
let shift:any;
beforeEach(()=>{
  vi.clearAllMocks();shift={id:"watch",station_id:"gate",operator_id:7,started_at:"2026-10-23T06:00:00Z",ended_at:null,preparation_id:null};
  m.connect.mockResolvedValue({query:m.query,release:vi.fn()});
  m.query.mockImplementation(async(sql:string,args:any[]=[])=>{
    let rows:any[]=[];
    if(sql.startsWith("SELECT * FROM gate_stations"))rows=[{id:"gate",site_id:3,active:true}];
    else if(sql.startsWith("SELECT id, role, session_version"))rows=[{id:7,role:"admin",session_version:1}];
    else if(sql.startsWith("SELECT id, name, partner_id"))rows=[{id:3,name:"Site",partner_id:5}];
    else if(sql.startsWith("SELECT * FROM gate_shifts WHERE id="))rows=[shift];
    else if(sql.startsWith("INSERT INTO gate_preparations"))rows=[{id:"prep"}];
    else if(sql.startsWith("UPDATE gate_shifts")){shift={...shift,ended_at:args[1],preparation_id:args[2]};}
    else if(sql.startsWith("UPDATE gate_duty_sessions")||sql.startsWith("INSERT INTO gate_shift_actions")||sql.startsWith("SELECT id FROM gate_stations")||sql.includes("FROM gate_shift_actions")||sql.includes("FROM site_visits WHERE")||["BEGIN","COMMIT","ROLLBACK"].includes(sql)||sql.startsWith("SET LOCAL")){}
    else throw Error(`Unexpected effect: ${sql}`);
    return {rows,rowCount:rows.length};
  });
});
const session={userId:7,role:"admin",sv:1};
it("saves an early handoff and ends only the expected watch and its owner's duty",async()=>{
  const result=await releaseGateWatch(session,{stationId:"gate",expectedShiftId:"watch",notes:"Relief needed at east approach"});
  expect(result).toMatchObject({watchId:"watch",preparationId:"prep"});
  expect(shift.ended_at).toBeInstanceOf(Date);
  const save=m.query.mock.calls.find(([sql])=>sql.startsWith("INSERT INTO gate_preparations"))!;
  expect(save[1][3]).toBe("Relief needed at east approach");
  expect(JSON.parse(save[1][4]).watchReleased).toBe(true);
  expect(m.query.mock.calls.find(([sql])=>sql.startsWith("UPDATE gate_duty_sessions"))![1].slice(0,2)).toEqual(["gate",7]);
  expect(m.clock).not.toHaveBeenCalled();
  expect(m.query.mock.calls.some(([sql])=>/UPDATE users|gate_work_sessions|assistant_action_audit/.test(sql))).toBe(false);
  expect(m.query).toHaveBeenLastCalledWith("COMMIT");
});
it("retries the same released watch without a second handoff or changes to another watch",async()=>{
  await releaseGateWatch(session,{stationId:"gate",expectedShiftId:"watch",notes:"Notes"});
  await releaseGateWatch(session,{stationId:"gate",expectedShiftId:"watch",notes:"Notes"});
  expect(m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO gate_preparations"))).toHaveLength(1);
});
it("preserves the outgoing notes exactly, including whitespace and the full editor length",async()=>{
  const notes=`  Night watch notes\n\n${"x".repeat(7900)}\n  `;
  await releaseGateWatch(session,{stationId:"gate",expectedShiftId:"watch",notes});
  const save=m.query.mock.calls.find(([sql])=>sql.startsWith("INSERT INTO gate_preparations"))!;
  expect(save[1][3]).toBe(notes);
});
it("does not let a supervisor's own Handoff link release somebody else's watch",async()=>{
  shift.operator_id=8;
  await expect(releaseGateWatch(session,{stationId:"gate",expectedShiftId:"watch",notes:"Notes"})).rejects.toMatchObject({code:"change_over.owner_required"});
  expect(m.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE ")||sql.startsWith("INSERT "))).toBe(false);
});
