import {beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({query:vi.fn(),release:vi.fn(),connect:vi.fn(),access:vi.fn()}));
vi.mock("./gate-arrivals",()=>({createGateArrivalsService:()=>({map:async()=>({vehicles:[],truncated:false})})}));
vi.mock("@workspace/db",()=>({pool:{connect:mock.connect}}));
vi.mock("./gate-change-over",()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}},listChangeOverSites:vi.fn(async()=>[{id:10,name:"Site",latitude:35,longitude:-97}]),listChangeOverStations:vi.fn(async()=>[{id:"gate",name:"Main",latitude:35,longitude:-97}]),requireChangeOverAccess:mock.access}));
import {readGateCoverageMap} from "./gate-coverage-map";
import {listChangeOverStations} from "./gate-change-over";
import {summarizeWorkday} from "@workspace/api-zod";
const session={userId:1,vendorId:54,activeMembershipId:7,sv:2} as any;
beforeEach(()=>{vi.clearAllMocks();mock.connect.mockResolvedValue({query:mock.query,release:mock.release});mock.access.mockResolvedValue({supervisor:true});});
describe("Gate coverage map authorization",()=>{
 it("shows explicitly synthetic GateGo positions without recording them as fresh phone GPS",async()=>{
  const sample={synthetic:true,sampleBatch:"gatego-static-map-2026-10-30",userId:2,label:"GateGo office · Web terminal",location:{latitude:32.18,longitude:-101.83,accuracy:0,capturedAt:"2026-10-30T12:00:00.000Z"}};
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:sql.includes("DISTINCT ON(u.id)")?[{id:2,display_name:"Sample worker",vendor_role:"office"}]:sql.includes("target_type='gate-map-demonstration'")?[{tool_output:sample}]:[]}));
  const result=await readGateCoverageMap({...session,vendorId:1115});
  expect(result.staff[0]).toMatchObject({fresh:false,demonstration:true,location:sample.location,locationReason:"sample_location",assignment:sample.label});
  mock.query.mockClear();expect((await readGateCoverageMap(session)).staff).toEqual([]);
  expect(mock.query.mock.calls.some(([sql])=>sql.includes("target_type='gate-map-demonstration'"))).toBe(false);
  expect((await readGateCoverageMap({...session,vendorId:1115},new Date(Date.now()-3600000))).staff).toEqual([]);
 });
 it("returns staffing categories and only company-scoped accessible group metadata",async()=>{
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:sql.includes("DISTINCT ON(u.id)")?[{id:2,display_name:"Admin",app_installed:true,membership_role:"admin",vendor_role:"office",roles:["Administrative Team"],vendor_managed:false,staff_groups:[{id:"crew",name:"Office team"}]}]:[]}));
  const result=await readGateCoverageMap(session);
  expect(result.staff[0]).toMatchObject({membershipRole:"admin",roles:["Administrative Team"],vendorManaged:false,groups:[{id:"crew",name:"Office team"}],location:null,fresh:false});
  const [sql,params]=mock.query.mock.calls.find(([sql])=>sql.includes("DISTINCT ON(u.id)"))!;
  expect(params).toEqual([54,1,true]);expect(sql).toContain("crew.owner_org_id=$1");expect(sql).toContain("mine.user_id=$2");expect(sql).toContain("vp.vendor_id=m.vendor_id");expect(sql).toContain("ms.sponsor_vendor_id=$1");
 });
 it("includes linked-site metadata only for the authorized map sites",async()=>{
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:sql.startsWith("SELECT id,gate_link_id")?[{id:10,gate_link_id:"spur"}]:[]}));
  const result=await readGateCoverageMap(session);
  expect(result.gates[0].linkGroupId).toBe("spur");
  expect(mock.query.mock.calls.find(([sql])=>sql.startsWith("SELECT id,gate_link_id"))?.[1]).toEqual([[10]]);
 });
 it("returns a paid started shift without an assignment, call start time and contact details",async()=>{
  const now=new Date(),id="00000000-0000-4000-8000-000000000001",owner={type:"vendor",id:54};
  const clock={id,version:1,owner,workerUserId:2,timezone:"America/Chicago",summary:summarizeWorkday([{id,shiftId:id,owner,workerUserId:2,kind:"start_shift",capturedAt:now.toISOString(),receivedAt:now.toISOString(),source:"worker_report"}] as never)};
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:sql.includes("DISTINCT ON(u.id)")?[{id:2,display_name:"Worker",phone:"555",email:"worker@example.invalid",app_installed:true,native_operations:{onCallActive:true}}]:sql.includes("DISTINCT ON(worker_user_id)")?[{worker_user_id:"2",tool_output:clock}]:sql.includes("DISTINCT ON(user_id)")?[{user_id:2,payload:{active:true},created_at:now}]:sql.includes("SELECT gate_map_pins")?[{gate_map_pins:[{id:"visible",siteId:10,createdAt:now.toISOString()},{id:"other-site",siteId:99,createdAt:now.toISOString()}]}]:[]}));
  const result=await readGateCoverageMap(session,now);
  expect(result.staff[0]).toMatchObject({onShift:true,onCall:true,onWatch:false,assignment:"No active assignment recorded",phone:"555",email:"worker@example.invalid",onCallStartedAt:now.toISOString()});
  expect(result.pins.map(pin=>pin.id)).toEqual(["visible"]);
 });
 it("includes inactive gates with a recorded location without reviving retired locationless duplicates",async()=>{
  vi.mocked(listChangeOverStations).mockResolvedValueOnce([
   {id:"east",name:"East Gate",active:true,latitude:35,longitude:-97},
   {id:"north",name:"North Gate",active:false,latitude:35.01,longitude:-97},
   {id:"archived",name:"Archived duplicate",active:false,latitude:null,longitude:null},
  ] as any);
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:[]}));
  const result=await readGateCoverageMap(session);
  expect(result.gates.map(g=>g.id)).toEqual(["east","north"]);
  expect(result.gates.find(g=>g.id==="north").active).toBe(false);
  expect(listChangeOverStations).toHaveBeenCalledWith(session,10,"history");
 });
 it("includes app employees outside watch duty and respects on-call and current sharing",async()=>{
  const now=new Date(), location={latitude:35,longitude:-97,accuracy:5,capturedAt:now.toISOString()};
  const members=[
   {id:2,display_name:"Off duty",app_installed:true,native_operations:{consent:{locationSharing:true},duty:{active:false},designatedDeviceId:"device"}},
   {id:3,display_name:"On call",app_installed:true,native_operations:{consent:{locationSharing:true},onCallActive:true,designatedDeviceId:"device"}},
   {id:4,display_name:"Field worker",app_installed:true,native_operations:{consent:{locationSharing:true},duty:{active:true},designatedDeviceId:"device"}},
   {id:5,display_name:"No app",native_operations:{}},
  ];
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"employee",vendor_role:"office"}]:sql.includes("DISTINCT ON(u.id)")?members:sql.includes("SELECT a.tool_output")?[{tool_output:{deviceId:"device",location}}]:[]}));
  const result=await readGateCoverageMap(session,now);
  expect(result.staff.map(person=>person.userId)).toEqual([2,3,4]);
  expect(result.staff[0]).toMatchObject({onDuty:false,onWatch:false,fresh:false,location:null,locationReason:"off_duty"});
  expect(result.staff[1]).toMatchObject({onCall:true,onWatch:false,fresh:true,location});
  expect(result.staff[2]).toMatchObject({onCall:false,onDuty:true,fresh:true,location});
  expect(mock.query.mock.calls.find(([sql])=>sql.includes("DISTINCT ON(u.id)"))?.[1]).toEqual([54,1,false]);
 });
 it("never presents stale coordinates as a current staff position",async()=>{
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:sql.includes("DISTINCT ON(u.id)")?[{id:2,display_name:"Old report",app_installed:true,native_operations:{consent:{locationSharing:true},duty:{active:true},designatedDeviceId:"phone"}}]:sql.includes("SELECT a.tool_output")?[{tool_output:{deviceId:"phone",location:{latitude:35,longitude:-97,accuracy:5,capturedAt:new Date(Date.now()-3600000).toISOString()}}}]:[]}));
  expect((await readGateCoverageMap(session)).staff[0]).toMatchObject({location:null,fresh:false,locationReason:"stale_or_inaccurate"});
 });
 it("never inserts live vehicles into a historical coverage view",async()=>{
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:[]}));
  const readVehicles=vi.fn(async()=>({vehicles:[],truncated:false}));
  const result=await readGateCoverageMap(session,new Date(Date.now()-3600000),readVehicles);
  expect(result.vehicles).toEqual([]);expect(readVehicles).not.toHaveBeenCalled();
 });
 it("rejects a stale or unrelated active membership before reading employee data",async()=>{mock.query.mockResolvedValue({rows:[]});await expect(readGateCoverageMap(session)).rejects.toMatchObject({status:403});expect(mock.query).toHaveBeenCalledTimes(1);expect(mock.release).toHaveBeenCalled();});
 it("redacts stored GPS when sharing is off and never returns private incident coordinates",async()=>{mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"admin"}]:sql.includes("SELECT d.*")?[{id:"duty",station_id:"gate",site_id:10,user_id:2,display_name:"Demo",email:"demo@example.invalid",started_at:new Date(),post_coverage:{lastLocation:{latitude:1,longitude:2},incident:{id:"incident"}}}]:sql.includes("DISTINCT ON(u.id)")?[{id:2,display_name:"Demo",vendor_role:"gatekeeper",native_operations:{consent:{locationSharing:false},designatedDeviceId:"device"}}]:sql.includes("SELECT a.tool_output")?[{tool_output:{deviceId:"device",location:{latitude:35,longitude:-97,accuracy:5,capturedAt:new Date().toISOString()}}}]:[]}));const result=await readGateCoverageMap(session);expect(result.staff[0].location).toBeNull();expect(result.staff[0].locationReason).toBe("sharing_off");expect(result.duties[0].coverage).not.toHaveProperty("lastLocation");expect(result.staff[0].reliefCandidate).toBe(false);});
 it("does not disclose unrelated employees to an ordinary employee",async()=>{mock.access.mockResolvedValue({supervisor:false});mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("SELECT m.role")?[{role:"employee"}]:sql.includes("DISTINCT ON(u.id)")?[{id:2,display_name:"Other",native_operations:{duty:{active:true}}}]:[]}));expect((await readGateCoverageMap(session)).staff).toEqual([]);});
});
