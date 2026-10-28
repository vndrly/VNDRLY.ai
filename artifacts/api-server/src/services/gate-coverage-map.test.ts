import {beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({query:vi.fn(),release:vi.fn(),connect:vi.fn(),access:vi.fn()}));
vi.mock("./gate-arrivals",()=>({createGateArrivalsService:()=>({map:async()=>({vehicles:[],truncated:false})})}));
vi.mock("@workspace/db",()=>({pool:{connect:mock.connect}}));
vi.mock("./gate-change-over",()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}},listChangeOverSites:vi.fn(async()=>[{id:10,name:"Site",latitude:35,longitude:-97}]),listChangeOverStations:vi.fn(async()=>[{id:"gate",name:"Main",latitude:35,longitude:-97}]),requireChangeOverAccess:mock.access}));
import {readGateCoverageMap} from "./gate-coverage-map";
const session={userId:1,vendorId:54,activeMembershipId:7,sv:2} as any;
beforeEach(()=>{vi.clearAllMocks();mock.connect.mockResolvedValue({query:mock.query,release:mock.release});mock.access.mockResolvedValue({supervisor:true});});
describe("Gate coverage map authorization",()=>{
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
  expect(mock.query.mock.calls.find(([sql])=>sql.includes("DISTINCT ON(u.id)"))?.[1]).toEqual([54]);
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
