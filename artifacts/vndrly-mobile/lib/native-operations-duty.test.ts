import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({values:new Map<string,string>(),api:vi.fn(),dutyStop:vi.fn(),runStop:vi.fn(),fleetStop:vi.fn(),generation:1}));
vi.mock("expo-secure-store",()=>({AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:"device",getItemAsync:async(k:string)=>m.values.get(k)??null,setItemAsync:async(k:string,v:string)=>{m.values.set(k,v)},deleteItemAsync:async(k:string)=>{m.values.delete(k)}}));
vi.mock("expo-location",()=>({}));vi.mock("react-native",()=>({AppState:{currentState:"active"},Platform:{OS:"ios"}}));
vi.mock("./api",()=>({apiFetch:m.api}));vi.mock("./deviceId",()=>({getDeviceId:async()=>"phone"}));
vi.mock("./auth",()=>({captureAuthScope:()=>({generation:m.generation}),isAuthScopeCurrent:(s:any)=>s.generation===m.generation,getUser:async()=>({id:2,activeMembershipId:3})}));
vi.mock("./duty-background-location",()=>({stopDutyBackgroundLocation:m.dutyStop}));vi.mock("./liveLocationReporter",()=>({stopLiveLocationReporter:m.runStop}));vi.mock("./fleet-background-location-native",()=>({stopFleetBackgroundLocation:m.fleetStop}));
import {changeNativeDuty,readNativeOperations,nativeLocationLocallyAllowed,changeNativeOnCall} from "./native-operations";
const status={policy:{enabled:true},duty:{active:true},consent:{locationSharing:true},designatedDeviceId:"phone",bindingVersion:1,requests:[],onCallActive:true};
beforeEach(()=>{m.generation++;m.values.clear();vi.clearAllMocks();m.api.mockReset();});
it("retains previously consented On Call collection when explicit End of Day is queued offline",async()=>{
 m.api.mockResolvedValueOnce(status);await readNativeOperations();m.api.mockRejectedValueOnce(Error("offline"));
 await expect(changeNativeDuty("end")).rejects.toThrow("offline");expect(await nativeLocationLocallyAllowed()).toBe(true);expect(m.dutyStop).not.toHaveBeenCalled();
});
it("stops promptly without verified On Call and never revives sharing after a local On Call withdrawal",async()=>{
 m.api.mockResolvedValueOnce({...status,onCallActive:false});await readNativeOperations();m.api.mockRejectedValueOnce(Error("offline"));await expect(changeNativeDuty("end")).rejects.toThrow();expect(await nativeLocationLocallyAllowed()).toBe(false);
 m.api.mockResolvedValueOnce(status);await readNativeOperations();m.api.mockRejectedValueOnce(Error("offline"));await expect(changeNativeOnCall(false)).rejects.toThrow();
 m.api.mockRejectedValueOnce(Error("offline"));await expect(changeNativeDuty("end")).rejects.toThrow();expect(await nativeLocationLocallyAllowed()).toBe(false);
});
