import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({records:new Map<string,string>(),api:vi.fn(),start:vi.fn(),stop:vi.fn(),running:false,permission:true,consent:true,nativeDuty:true,epoch:0,token:null as null|(()=>void),task:null as any}));
vi.mock("expo-secure-store",()=>({AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:"device-only",getItemAsync:async(k:string)=>mocks.records.get(k)??null,setItemAsync:async(k:string,v:string)=>{mocks.records.set(k,v);},deleteItemAsync:async(k:string)=>{mocks.records.delete(k);}}));
vi.mock("expo-location",()=>({Accuracy:{Balanced:1},ActivityType:{Other:1},getForegroundPermissionsAsync:async()=>({status:mocks.permission?"granted":"denied"}),getBackgroundPermissionsAsync:async()=>({status:mocks.permission?"granted":"denied"}),hasStartedLocationUpdatesAsync:async()=>mocks.running,startLocationUpdatesAsync:async(...args:any[])=>{mocks.running=true;mocks.start(...args);},stopLocationUpdatesAsync:async(...args:any[])=>{mocks.running=false;mocks.stop(...args);}}));
vi.mock("expo-task-manager",()=>({isTaskDefined:()=>false,isAvailableAsync:async()=>true,defineTask:(name:string,callback:any)=>{mocks.task={name,callback};}}));
vi.mock("expo-crypto",()=>({randomUUID:()=>"10000000-0000-4000-8000-000000000001"}));
vi.mock("./native-operations",()=>({nativeLocationCollectionAllowed:async()=>mocks.nativeDuty}));
vi.mock("./runtime",()=>({isExpoGo:false}));
vi.mock("./api",()=>({apiFetch:mocks.api}));
vi.mock("./deviceId",()=>({getDeviceId:async()=>"synthetic-device"}));
vi.mock("./locationConsent",()=>({hasActiveConsentForThisDevice:async()=>mocks.consent}));
vi.mock("./auth",()=>({captureAuthScope:()=>({generation:mocks.epoch}),isAuthScopeCurrent:(s:any)=>s.generation===mocks.epoch,getUser:async()=>({id:1,activeMembershipId:4}),getToken:async()=>"synthetic-token-not-real",subscribeToken:(fn:()=>void)=>{mocks.token=fn;},subscribeUser:()=>{}}));
import {startFleetBackgroundLocation,stopFleetBackgroundLocation,handleFleetBackgroundSample,subscribeFleetBackgroundLocation,FLEET_BACKGROUND_TASK} from "./fleet-background-location-native";
const account={userId:1,companyId:609,membershipId:4,sessionVersion:7};
const run:any={id:"20000000-0000-4000-8000-000000000001",companyId:609,driverUserId:1,vehicleAssetId:"30000000-0000-4000-8000-000000000001",trailerAssetId:null,status:"in_progress",phase:"traveling_to_pickup",version:9};
const sample={latitude:35,longitude:-97,accuracy:15,timestamp:Date.parse("2026-10-07T12:00:00Z")};
function api(path:string,options?:any){if(options){const input=JSON.parse(options.body);return {runId:run.id,vehicleAssetId:run.vehicleAssetId,driverUserId:1,latitude:input.latitude,longitude:input.longitude,accuracyMeters:input.accuracyMeters,recordedAt:input.recordedAt,receivedAt:"2026-10-07T12:00:02Z",source:"driver_phone",freshness:"recent",physicalProofVerified:false};}return path.endsWith("overview")?{accountScope:account,capabilities:{canDrive:true}}:run;}
beforeEach(async()=>{await stopFleetBackgroundLocation(true);mocks.records.clear();mocks.api.mockReset().mockImplementation(api);mocks.start.mockReset();mocks.stop.mockReset();mocks.permission=true;mocks.consent=true;mocks.nativeDuty=true;});
it("registers a distinct Fleet task and configures visible duty sharing without calling ticket endpoints",async()=>{
 expect(mocks.task.name).toBe(FLEET_BACKGROUND_TASK);expect(FLEET_BACKGROUND_TASK).not.toBe("vndrly-live-location");
 await startFleetBackgroundLocation(account,run);expect(mocks.start).toHaveBeenCalledWith(FLEET_BACKGROUND_TASK,expect.objectContaining({showsBackgroundLocationIndicator:true}));
 await handleFleetBackgroundSample(sample);expect(mocks.api.mock.calls.some(call=>String(call[0]).includes("ticket"))).toBe(false);
 expect(JSON.parse([...mocks.records.values()][0]).pending).toBeNull();expect([...mocks.records.values()][0].length).toBeLessThan(1900);
});
it("keeps the OS task running across two successful callbacks and reports only accepted capture times",async()=>{
 const states:any[]=[];const unsubscribe=subscribeFleetBackgroundLocation(state=>states.push(state));
 await startFleetBackgroundLocation(account,run);await handleFleetBackgroundSample(sample);await handleFleetBackgroundSample({...sample,timestamp:sample.timestamp+120000});
 expect(mocks.running).toBe(true);expect(mocks.stop).not.toHaveBeenCalled();
 expect(mocks.api.mock.calls.filter(call=>call[1])).toHaveLength(2);
 expect(states.at(-1)).toMatchObject({state:"accepted",lastAcceptedAt:"2026-10-07T12:02:00.000Z"});unsubscribe();
});
it("stops collection offline and retries the exact encrypted pending report only after explicit restart",async()=>{
 await startFleetBackgroundLocation(account,run);mocks.api.mockImplementation((path,options)=>{if(options)throw new Error("offline");return api(path);});
 await handleFleetBackgroundSample(sample);const stored=JSON.parse([...mocks.records.values()][0]);expect(stored.enabled).toBe(false);expect(stored.pending.latitude).toBe(35);expect(mocks.running).toBe(false);
 const original=mocks.api.mock.calls.find(call=>call[1])![1].body;
 mocks.api.mockImplementation(api);await startFleetBackgroundLocation(account,run);await handleFleetBackgroundSample({...sample,latitude:36});
 expect(mocks.api.mock.calls.filter(call=>call[1]).at(-1)![1].body).toBe(original);
});
it("clears the duty and stops OS updates when consent or current session is revoked",async()=>{
 await startFleetBackgroundLocation(account,run);mocks.consent=false;await handleFleetBackgroundSample(sample);expect(mocks.records.size).toBe(0);expect(mocks.running).toBe(false);
 mocks.consent=true;await startFleetBackgroundLocation(account,run);mocks.epoch++;mocks.token?.();await stopFleetBackgroundLocation(true);expect(mocks.records.size).toBe(0);expect(mocks.running).toBe(false);
});
it("rejects paused duty before processing an OS sample",async()=>{
 await startFleetBackgroundLocation(account,run);mocks.api.mockImplementation(path=>path.endsWith("overview")?api(path):{...run,phase:"paused"});
 await handleFleetBackgroundSample(sample);expect(mocks.records.size).toBe(0);expect(mocks.api.mock.calls.some(call=>call[1])).toBe(false);expect(mocks.running).toBe(false);
});
it("accepts canonical initial session version zero",async()=>{
 const initial={...account,sessionVersion:0};
 mocks.api.mockImplementation((path,options)=>path.endsWith("overview")?{accountScope:initial,capabilities:{canDrive:true}}:api(path,options));
 await startFleetBackgroundLocation(initial,run);await handleFleetBackgroundSample(sample);
 expect(JSON.parse([...mocks.records.values()][0]).account.sessionVersion).toBe(0);
 expect(JSON.parse([...mocks.records.values()][0]).pending).toBeNull();
});

it("does not configure OS collection when native duty or the designated work phone is refused",async()=>{mocks.nativeDuty=false;await expect(startFleetBackgroundLocation(account,run)).rejects.toThrow("designated phone");expect(mocks.start).not.toHaveBeenCalled();});
