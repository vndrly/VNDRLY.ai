import { describe,it,expect,vi } from "vitest";
vi.mock("@workspace/db",()=>({pool:{connect:vi.fn()}}));
import { randomUUID } from "node:crypto";
import { FleetRunSchema } from "@workspace/api-zod";
import type { Pool } from "pg";
import { createGateArrivalsService, freshGateObservation, gateIncomingStop, gateStopMatchesSite, gatePhoneDirectionAvailable } from "./gate-arrivals";
import { OfflineGateError } from "./gate-offline-observation";
import { chatGptReadableTools } from "../assistant/chatgpt-tool-access";
import { workspaceRequest, workspaceOutput } from "../assistant/chatgpt-workspace";

const now=new Date("2026-10-22T15:00:00Z"),site={id:9,name:"Authorized pad",partner_id:2,latitude:35,longitude:-97,geofence_radius_m:500};
function fixture() {
  const stopId=randomUUID();
  const run=FleetRunSchema.parse({id:randomUUID(),companyId:7,fleetId:randomUUID(),title:"Directed haul",driverUserId:2,vehicleAssetId:randomUUID(),trailerAssetId:null,status:"in_progress",phase:"traveling_to_next_stop",version:2,siteIds:[9],stops:[{id:stopId,siteId:9,kind:"delivery",sequence:0}],loads:[],inspections:[],records:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:101,allowedActions:[]});
  const observation={runId:run.id,driverUserId:2,vehicleAssetId:run.vehicleAssetId,latitude:35.1,longitude:-97.1,recordedAt:now.toISOString(),receivedAt:now.toISOString(),accuracyMeters:10,source:"driver_phone",freshness:"recent",physicalProofVerified:false};
  let consent=true;
  const query=vi.fn(async(sql:string)=> {
    if(sql.startsWith("SELECT id,name,partner_id"))return {rows:[site]};
    if(sql.includes("WITH heads AS"))return {rows:[{run,company_id:7,company_name:"Hauler",driver_name:"Driver",vehicle_label:"Truck"}]};
    if(sql.includes("SELECT DISTINCT ON(a.vendor_id,a.target_id) a.vendor_id,a.target_id"))return {rows:consent?[{vendor_id:7,target_id:run.id,tool_output:{assignment:JSON.stringify([run.id,7,2,run.vehicleAssetId,null]),observation},native_operations:{consent:{locationSharing:true},duty:{active:true,mode:"manual",endsAt:null}}}]:[]};
    return {rows:[]};
  });
  const release=vi.fn(),database={connect:vi.fn(async()=>({query,release}))} as unknown as Pick<Pool,"connect">;
  const authorize=vi.fn(async()=>{}),estimate=vi.fn(async()=>({ok:true as const,provider:"mapbox" as const,trafficAware:true,distanceMiles:7,durationMinutes:12,routeConfidence:"medium" as const}));
  const service=createGateArrivalsService(database,authorize,estimate,()=>now);
  return {service,run,observation,query,release,authorize,estimate,revoke:()=>{consent=false;}};
}
const session={role:"vendor",vendorId:20,userId:3,sv:1,activeMembershipId:4,membershipRole:"admin"};
describe("Gate arrivals operational boundary",()=>{
  it("recognizes legacy physical sites but never treats explicit destination billing IDs as the destination",()=>{
    const {run}=fixture(),stop=run.stops[0];
    expect(gateIncomingStop(run,site)?.id).toBe(stop.id);
    const destination={id:randomUUID(),revision:1,name:"Other terminal",kind:"delivery" as const,address:"Elsewhere",latitude:36,longitude:-98,materials:[],hours:"",instructions:"",active:true,ownerType:"partner" as const,ownerId:2};
    expect(gateStopMatchesSite({...stop,destination},site)).toBe(false);
    expect(gateStopMatchesSite({...stop,siteId:88,destination:{...destination,latitude:35,longitude:-97}},site)).toBe(true);
    expect(gateStopMatchesSite({...stop,destination:{...destination,latitude:35,longitude:-97,ownerId:99}},site)).toBe(false);
    run.currentStopId=stop.id;expect(gateIncomingStop(run,site)).toBeNull();
    run.currentStopId=null;run.phase="paused";expect(gateIncomingStop(run,site)).toBeNull();
  });
  it("rejects stale, future, inaccurate and reassigned phone reports",()=>{
    const {run,observation}=fixture();
    expect(freshGateObservation(observation,run,now)).toBeTruthy();
    for(const patch of [{recordedAt:"2026-10-22T14:50:00Z"},{recordedAt:"2026-10-22T15:01:00Z"},{accuracyMeters:null},{accuracyMeters:1001},{driverUserId:99},{vehicleAssetId:randomUUID()}])
      expect(freshGateObservation({...observation,...patch},run,now)).toBeNull();
  });
  it("excludes staged phases and reliable phone motion away from the site",()=>{
    const f=fixture();f.run.phase="staging";expect(gateIncomingStop(f.run,site)).toBeNull();
    const o=freshGateObservation(f.observation,f.run,now)!;
    expect(gatePhoneDirectionAvailable({...o,speedMetersPerSecond:0,speedAccuracyMetersPerSecond:0.1},site)).toBe(false);
    expect(gatePhoneDirectionAvailable({...o,speedMetersPerSecond:10,speedAccuracyMetersPerSecond:0.1,headingDegrees:315},site)).toBe(false);
    expect(gatePhoneDirectionAvailable({...o,speedMetersPerSecond:10,speedAccuracyMetersPerSecond:0.1,headingDegrees:135},site)).toBe(true);
  });
  it("uses provider duration only and rechecks consent after routing",async()=>{
    const f=fixture();
    expect((await f.service.list(session,9)).arrivals[0]).toMatchObject({etaMinutes:12,ticketId:101,physicalProofVerified:false});
    expect(f.authorize).toHaveBeenCalledTimes(2);
    f.estimate.mockImplementationOnce(async()=>{f.revoke();return {ok:true,provider:"mapbox",trafficAware:true,distanceMiles:7,durationMinutes:12,routeConfidence:"medium"};});
    expect((await f.service.list(session,9)).arrivals).toEqual([]);
  });
  it("reports routing unavailability without fabricating an estimate",async()=>{
    const f=fixture();f.estimate.mockResolvedValue({ok:false,errorCode:"mapbox.no_route",message:"Unavailable"} as never);
    expect((await f.service.list(session,9)).arrivals[0]).toMatchObject({etaMinutes:null,etaUnavailableReason:"gate_arrivals.route_unavailable"});
  });
  it("fails before reading runs when selected-site Gate authority is denied",async()=>{
    const f=fixture();f.authorize.mockRejectedValue(new OfflineGateError("gate.site_no_access",403));
    await expect(f.service.list(session,9)).rejects.toMatchObject({status:403});
    expect(f.query.mock.calls.some(([sql])=>sql.includes("WITH heads AS"))).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("discloses only selected-site operational fields, including retained completed work",async()=>{
    const f=fixture(),otherId=randomUUID();f.run.status="completed";
    f.run.stops.push({id:otherId,siteId:88,kind:"delivery",sequence:1});
    f.run.records.push({id:randomUUID(),kind:"fuel",vehicleAssetId:null,quantity:30,reading:null,unit:"gal",notes:"PRIVATE COST",recordedByUserId:2,recordedAt:now.toISOString(),capturedAt:null,source:"user_report"});
    f.run.loads.push({id:randomUUID(),pickupStopId:f.run.stops[0].id,deliveryStopId:otherId,commodity:"Water",quantity:12,unit:"bbl",manifestReference:"PRIVATE DOC",deliveryReference:null,recordedByUserId:2,recordedAt:now.toISOString(),deliveredAt:now.toISOString(),source:"user_report"});
    const detail=await f.service.detail(session,9,f.run.id);
    expect(detail).toMatchObject({runComplete:true,detailScope:"selected_site",loads:[{commodity:"Water",deliveredAt:null}]});
    expect(detail.stops).toHaveLength(1);expect(JSON.stringify(detail)).not.toMatch(/PRIVATE|manifestReference|billing|records|allowedActions/);
  });
  it("discovers the read under gate:read and renders the same bounded embedded projection",()=>{
    expect(chatGptReadableTools(session,["gate:read"]).some(t=>t.name==="query_gate_arrivals")).toBe(true);
    expect(chatGptReadableTools(session,["work_hub:read"]).some(t=>t.name==="query_gate_arrivals")).toBe(false);
    expect(workspaceRequest({view:"gate_arrivals",siteId:9})).toMatchObject({sourceTool:"query_gate_arrivals",sourceArguments:{siteLocationId:9}});
    const output=workspaceOutput("gate_arrivals","query_gate_arrivals",{siteLocationId:9},{arrivals:[],generatedAt:now.toISOString(),truncated:false},now);
    expect(output.sections[0].empty).toContain("No incoming");
  });
});
