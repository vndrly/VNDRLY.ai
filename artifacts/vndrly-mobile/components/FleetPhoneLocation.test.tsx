import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({api:vi.fn(),route:vi.fn(),native:vi.fn(),read:vi.fn(),start:vi.fn(),stop:vi.fn(),app:null as null|((s:string)=>void),token:null as null|(()=>void),background:null as null|((s:any)=>void),consent:true,backgroundGranted:true,storage:new Map<string,string>()}));
vi.mock("@/lib/fleet-location-setup",()=>({enableFleetRunLocation:vi.fn(async()=>{})}));
vi.mock("@/lib/native-operations",()=>({nativeLocationCollectionAllowed:m.native,readNativeOperations:m.read}));
vi.mock("@/lib/fleet-background-location-native",()=>({startFleetBackgroundLocation:m.start,stopFleetBackgroundLocation:m.stop,subscribeFleetBackgroundLocation:(cb:any)=>{m.background=cb;return()=>{};}}));
vi.mock("@/lib/fleet-device-storage",()=>({AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:1,getItemAsync:async(k:string)=>m.storage.get(k)??null,setItemAsync:async(k:string,v:string)=>{m.storage.set(k,v);},deleteItemAsync:async(k:string)=>{m.storage.delete(k);}}));
vi.mock("@/lib/api",()=>({apiFetch:m.api}));
vi.mock("@/lib/auth",()=>({captureAuthScope:()=>({generation:1}),isAuthScopeCurrent:()=>true,subscribeUser:()=>()=>{},subscribeToken:(cb:()=>void)=>{m.token=cb;return()=>{};}}));
vi.mock("@/lib/locationConsent",()=>({hasActiveConsentForThisDevice:async()=>m.consent}));
vi.mock("@/lib/deviceId",()=>({getDeviceId:async()=>"synthetic-device"}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({text:"black"})}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>(s:string)=>s}));
vi.mock("expo-crypto",()=>({randomUUID:()=>"10000000-0000-4000-8000-000000000001"}));
vi.mock("expo-router",()=>({router:{push:m.route}}));
vi.mock("expo-location",()=>({Accuracy:{Balanced:1},getForegroundPermissionsAsync:async()=>({status:"granted"}),getBackgroundPermissionsAsync:async()=>({status:m.backgroundGranted?"granted":"denied"}),getCurrentPositionAsync:async()=>({coords:{latitude:35,longitude:-97,accuracy:15},timestamp:Date.parse("2026-10-07T12:00:00Z")})}));
vi.mock("react-native",async()=>({...await vi.importActual<any>("react-native"),AppState:{currentState:"active",addEventListener:(_:string,cb:(s:string)=>void)=>{m.app=cb;return{remove:()=>{}};}}}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
vi.mock("@/components/work-hub/library/OptionSwitch",()=>({default:({label,value,onChange,disabled}:any)=><button role="switch" aria-label={label} aria-checked={value} disabled={disabled} onClick={()=>onChange(!value)}/> }));
import FleetPhoneLocation from "./FleetPhoneLocation";
const account={userId:1,companyId:2,membershipId:3,sessionVersion:1};
const run={id:"20000000-0000-4000-8000-000000000001",version:7,companyId:2,driverUserId:1,vehicleAssetId:"30000000-0000-4000-8000-000000000001",trailerAssetId:null,status:"in_progress",phase:"traveling_to_pickup"} as any;
const view=(r=run)=><FleetPhoneLocation run={r} account={account} disabled={false}/>;
beforeEach(()=>{
 m.consent=true;m.backgroundGranted=true;m.storage.clear();m.native.mockResolvedValue(true);m.read.mockResolvedValue({policy:{enabled:true,allowDriverLocationPause:false}});
 m.start.mockImplementation(async()=>{m.background?.({state:"configured",message:"configured",lastAcceptedAt:null});});m.stop.mockResolvedValue(undefined);
 m.api.mockImplementation(async(path,options)=>options?{runId:run.id,vehicleAssetId:run.vehicleAssetId,driverUserId:1,latitude:35,longitude:-97,accuracyMeters:15,recordedAt:"2026-10-07T12:00:00Z",receivedAt:"2026-10-07T12:00:01Z",source:"driver_phone",freshness:"recent",physicalProofVerified:false}:path.endsWith("overview")?{accountScope:account,capabilities:{canDrive:true}}:run);
});
afterEach(()=>{cleanup();vi.clearAllMocks();m.app=null;m.token=null;m.background=null;});
it("automatically starts active-run background sharing without driver switches",async()=>{
 render(view());await waitFor(()=>expect(m.start).toHaveBeenCalledWith(account,run));
 expect(screen.queryByRole("switch")).toBeNull();expect(screen.queryByText("Start foreground phone sharing")).toBeNull();expect(screen.queryByText("Stop phone sharing")).toBeNull();
 expect(await screen.findByText("Location sharing active")).toBeTruthy();
});
it("shows one sharing slider only after admin permission, preserves pause across remount and resumes",async()=>{
 m.read.mockResolvedValue({policy:{enabled:true,allowDriverLocationPause:true}});
 const mounted=render(view());const slider=await screen.findByRole("switch",{name:"Share location during this run"});
 await waitFor(()=>expect(m.start).toHaveBeenCalled());fireEvent.click(slider);
 expect(await screen.findByText("Location sharing paused")).toBeTruthy();expect(m.stop).toHaveBeenCalledWith(false);
 mounted.unmount();m.start.mockClear();render(view());expect(await screen.findByText("Location sharing paused")).toBeTruthy();expect(m.start).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("switch"));await waitFor(()=>expect(m.start).toHaveBeenCalledTimes(1));
});
it("ignores an old driver pause when admin no longer permits it",async()=>{
 m.read.mockResolvedValue({policy:{enabled:true,allowDriverLocationPause:true}});const mounted=render(view());const toggle=await screen.findByRole("switch");await waitFor(()=>expect((toggle as HTMLButtonElement).disabled).toBe(false));fireEvent.click(toggle);await screen.findByText("Location sharing paused");mounted.unmount();m.start.mockClear();
 m.read.mockResolvedValue({policy:{enabled:true,allowDriverLocationPause:false}});render(view());await waitFor(()=>expect(m.start).toHaveBeenCalled());expect(screen.queryByRole("switch")).toBeNull();
});
it("does not collect without device consent and offers setup instead of a stop control",async()=>{
 m.consent=false;render(view());expect(await screen.findByRole("button",{name:"Enable run location"})).toBeTruthy();expect(m.start).not.toHaveBeenCalled();expect(m.api.mock.calls.some(([,o])=>Boolean(o))).toBe(false);
 fireEvent.click(screen.getByRole("button",{name:"Enable run location"}));await waitFor(()=>expect(m.route).toHaveBeenCalledWith({pathname:"/location-consent",params:{returnTo:`/fleet-run/${run.id}`}}));
});
it("falls back to automatic foreground reporting when Always permission is unavailable",async()=>{
 m.backgroundGranted=false;render(view());await waitFor(()=>expect(m.api.mock.calls.some(([,o])=>Boolean(o))).toBe(true));expect(m.start).not.toHaveBeenCalled();expect(screen.queryByRole("switch")).toBeNull();
 act(()=>m.app?.("background"));act(()=>m.token?.());expect(m.stop).toHaveBeenCalledWith(false);
});
it("stops on completed/paused duty without discarding pending reports",async()=>{
 const mounted=render(view());await waitFor(()=>expect(m.start).toHaveBeenCalled());mounted.rerender(view({...run,status:"completed"}));await waitFor(()=>expect(m.stop).toHaveBeenCalledWith(false));expect(m.stop).not.toHaveBeenCalledWith(true);
});
it("does not start when fresh company policy cannot be verified",async()=>{
 m.read.mockRejectedValue(new Error("offline"));render(view());await screen.findByText("Location sharing unavailable");expect(m.start).not.toHaveBeenCalled();expect(screen.queryByRole("switch")).toBeNull();
});
it("automatically retries foreground collection after a temporary duty refusal clears",async()=>{
 m.backgroundGranted=false;let refused=true;
 const normal=m.api.getMockImplementation()!;m.api.mockImplementation(async(path,options)=>{if(path.endsWith("overview")&&refused){refused=false;throw Object.assign(new Error("temporary refusal"),{status:403});}return normal(path,options);});
 render(view());await screen.findByText("Location sharing unavailable");act(()=>m.app?.("active"));
 await waitFor(()=>expect(m.api.mock.calls.some(([,o])=>Boolean(o))).toBe(true));
});
it("keeps pause changes disabled until an in-flight automatic start settles",async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 m.native.mockImplementation(async()=>{await gate;return true;});m.read.mockResolvedValue({policy:{enabled:true,allowDriverLocationPause:true}});
 render(view());const slider=await screen.findByRole("switch");expect((slider as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>release());await waitFor(()=>expect((slider as HTMLButtonElement).disabled).toBe(false));fireEvent.click(slider);await screen.findByText("Location sharing paused");
});
